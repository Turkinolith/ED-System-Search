use anyhow::{Context, Result, bail};
use rayon::prelude::*;
use rustc_hash::FxHashMap;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

const DATA_MAGIC: &[u8; 8] = b"EDGRDAT1";
const INDEX_MAGIC: &[u8; 8] = b"EDGRIDX1";
const DATA_HEADER_BYTES: u64 = 16;
const INDEX_HEADER_BYTES: u64 = 32;
const MIN_DISTANCE_LS: f64 = 5.0;
const MAX_DISTANCE_LS: f64 = 12.0;
const MURDER_MAGIC: &[u8; 8] = b"EDMBIN01";
const MURDER_HEADER_BYTES: usize = 32;
const MURDER_RECORD_BYTES: usize = 32;

pub(crate) struct MurderImportConfig<'a> {
    pub data_dir: &'a Path,
    pub threads: usize,
    pub batch_size: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    updated_at: String,
    segments: Vec<ManifestSegment>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestSegment {
    kind: String,
    data_file: String,
    index_file: String,
}

#[derive(Clone, Copy)]
struct PackEntry {
    id64: u64,
    offset: u64,
    compressed_len: u32,
    raw_len: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RichSystem {
    name: String,
    coords: Coords,
    #[serde(default)]
    bodies: Vec<Body>,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
struct Coords {
    x: f64,
    y: f64,
    z: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Body {
    #[serde(default)]
    body_id: Option<u32>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default, rename = "type")]
    body_type: Option<String>,
    #[serde(default)]
    sub_type: Option<String>,
    #[serde(default)]
    distance_to_arrival: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Companion {
    name: String,
    star_type: String,
    distance_ls: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MurderPlace {
    id: String,
    name: String,
    category: &'static str,
    source: &'static str,
    source_group: &'static str,
    #[serde(rename = "type")]
    place_type: &'static str,
    type_label: &'static str,
    coords: Coords,
    system_name: String,
    description: String,
    details: MurderDetails,
    updated_at: String,
    default_enabled: bool,
    discovery: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MurderDetails {
    id64: String,
    minimum_distance_ls: f64,
    maximum_distance_ls: f64,
    companions: Vec<Companion>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MurderMeta {
    imported_at: String,
    source: String,
    count: usize,
    criteria: Criteria,
    format: &'static str,
    version: u32,
    record_bytes: usize,
    data_file: &'static str,
    names_file: &'static str,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Criteria {
    minimum_distance_ls: f64,
    maximum_distance_ls: f64,
}

struct MurderIndexRecord {
    id64: u64,
    name: String,
    coords: Coords,
    companion_count: u16,
    closest_distance_ls: f32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyPayload {
    imported_at: String,
    source: String,
    criteria: Criteria,
    places: Vec<LegacyPlace>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyPlace {
    name: String,
    coords: Coords,
    details: LegacyDetails,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyDetails {
    id64: String,
    companions: Vec<LegacyCompanion>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyCompanion {
    distance_ls: f64,
}

pub(crate) fn run(config: MurderImportConfig<'_>) -> Result<()> {
    let galaxy_dir = config.data_dir.join("galaxy");
    let manifest_path = galaxy_dir.join("manifest.json");
    if !manifest_path.exists() {
        bail!("Full galaxy data is not installed. Import galaxy data before building Murder Binaries.");
    }
    let manifest: Manifest = serde_json::from_reader(File::open(&manifest_path)?)
        .context("Could not read the rich galaxy manifest")?;
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(config.threads)
        .build()
        .context("Could not create Murder Binaries worker pool")?;
    let started = Instant::now();
    let mut matches = FxHashMap::<u64, MurderPlace>::default();

    println!(
        "Scanning {} rich galaxy segment(s) for stars between {} and {} ls...",
        manifest.segments.len(),
        MIN_DISTANCE_LS,
        MAX_DISTANCE_LS
    );
    for segment in manifest.segments.iter().rev() {
        scan_segment(
            &galaxy_dir,
            segment,
            &manifest.updated_at,
            &pool,
            config.batch_size,
            &mut matches,
        )?;
    }

    let mut places = matches.into_values().collect::<Vec<_>>();
    places.sort_unstable_by(|a, b| a.name.cmp(&b.name));
    let count = places.len();
    let imported_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let records = places
        .iter()
        .map(index_record_from_place)
        .collect::<Result<Vec<_>>>()?;
    write_index_files(
        config.data_dir,
        &imported_at,
        "Local full galaxy analysis",
        Criteria {
            minimum_distance_ls: MIN_DISTANCE_LS,
            maximum_distance_ls: MAX_DISTANCE_LS,
        },
        &records,
    )?;
    println!(
        "Murder Binaries complete: {} caution systems indexed in {} seconds.",
        count,
        started.elapsed().as_secs()
    );
    Ok(())
}

pub(crate) fn build_index(data_dir: &Path) -> Result<()> {
    let input = data_dir.join("murder-binaries.json");
    if !input.exists() {
        bail!("Cannot find legacy Murder Binaries file at {}", input.display());
    }
    println!("Converting {} to the compact map overlay index...", input.display());
    let payload: LegacyPayload = serde_json::from_reader(BufReader::with_capacity(
        32 * 1024 * 1024,
        File::open(&input)?,
    ))
    .context("Could not parse the legacy Murder Binaries JSON")?;
    let records = payload
        .places
        .into_iter()
        .map(|place| {
            let id64 = place
                .details
                .id64
                .parse::<u64>()
                .context("Invalid Murder Binary ID64")?;
            let companion_count = u16::try_from(place.details.companions.len())
                .context("Too many close stellar companions")?;
            let closest_distance_ls = place
                .details
                .companions
                .iter()
                .map(|companion| companion.distance_ls)
                .min_by(|a, b| a.total_cmp(b))
                .unwrap_or(0.0) as f32;
            Ok(MurderIndexRecord {
                id64,
                name: place.name,
                coords: place.coords,
                companion_count,
                closest_distance_ls,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    write_index_files(
        data_dir,
        &payload.imported_at,
        &payload.source,
        payload.criteria,
        &records,
    )?;
    println!("Compact Murder Binaries index complete: {} systems.", records.len());
    Ok(())
}

fn index_record_from_place(place: &MurderPlace) -> Result<MurderIndexRecord> {
    Ok(MurderIndexRecord {
        id64: place.details.id64.parse::<u64>().context("Invalid Murder Binary ID64")?,
        name: place.name.clone(),
        coords: place.coords,
        companion_count: u16::try_from(place.details.companions.len())
            .context("Too many close stellar companions")?,
        closest_distance_ls: place
            .details
            .companions
            .first()
            .map(|companion| companion.distance_ls as f32)
            .unwrap_or(0.0),
    })
}

fn write_index_files(
    data_dir: &Path,
    imported_at: &str,
    source: &str,
    criteria: Criteria,
    records: &[MurderIndexRecord],
) -> Result<()> {
    let data_path = data_dir.join("murder-binaries.bin");
    let names_path = data_dir.join("murder-binaries-names.txt");
    let meta_path = data_dir.join("murder-binaries-meta.json");
    let data_temp = PathBuf::from(format!("{}.tmp", data_path.display()));
    let names_temp = PathBuf::from(format!("{}.tmp", names_path.display()));
    let meta_temp = PathBuf::from(format!("{}.tmp", meta_path.display()));
    let mut data_writer = BufWriter::with_capacity(8 * 1024 * 1024, File::create(&data_temp)?);
    let mut names_writer = BufWriter::with_capacity(8 * 1024 * 1024, File::create(&names_temp)?);
    let mut header = [0u8; MURDER_HEADER_BYTES];
    header[0..8].copy_from_slice(MURDER_MAGIC);
    header[8..12].copy_from_slice(&1u32.to_le_bytes());
    header[12..16].copy_from_slice(&(MURDER_RECORD_BYTES as u32).to_le_bytes());
    header[16..24].copy_from_slice(&(records.len() as u64).to_le_bytes());
    data_writer.write_all(&header)?;
    let mut name_offset = 0u64;
    for record in records {
        let name = record.name.as_bytes();
        let offset = u32::try_from(name_offset).context("Murder Binary names exceed 4 GiB")?;
        let length = u16::try_from(name.len()).context("Murder Binary system name is too long")?;
        names_writer.write_all(name)?;
        name_offset += name.len() as u64;
        let mut row = [0u8; MURDER_RECORD_BYTES];
        row[0..4].copy_from_slice(&(record.coords.x as f32).to_le_bytes());
        row[4..8].copy_from_slice(&(record.coords.y as f32).to_le_bytes());
        row[8..12].copy_from_slice(&(record.coords.z as f32).to_le_bytes());
        row[12..16].copy_from_slice(&offset.to_le_bytes());
        row[16..18].copy_from_slice(&length.to_le_bytes());
        row[18..20].copy_from_slice(&record.companion_count.to_le_bytes());
        row[20..24].copy_from_slice(&record.closest_distance_ls.to_le_bytes());
        row[24..32].copy_from_slice(&record.id64.to_le_bytes());
        data_writer.write_all(&row)?;
    }
    data_writer.flush()?;
    names_writer.flush()?;
    replace_file(&data_temp, &data_path)?;
    replace_file(&names_temp, &names_path)?;

    let meta = MurderMeta {
        imported_at: imported_at.to_string(),
        source: source.to_string(),
        count: records.len(),
        criteria,
        format: "EDMBIN01",
        version: 1,
        record_bytes: MURDER_RECORD_BYTES,
        data_file: "murder-binaries.bin",
        names_file: "murder-binaries-names.txt",
    };
    let mut meta_writer = BufWriter::new(File::create(&meta_temp)?);
    serde_json::to_writer_pretty(&mut meta_writer, &meta)?;
    meta_writer.flush()?;
    replace_file(&meta_temp, &meta_path)?;
    Ok(())
}

fn scan_segment(
    galaxy_dir: &Path,
    segment: &ManifestSegment,
    updated_at: &str,
    pool: &rayon::ThreadPool,
    batch_size: usize,
    matches: &mut FxHashMap<u64, MurderPlace>,
) -> Result<()> {
    let mut entries = read_index(&galaxy_dir.join(&segment.index_file))?;
    println!(
        "Loading {} segment: sorting {} pack offsets for sequential reading...",
        segment.kind,
        format_count(entries.len() as u64)
    );
    pool.install(|| entries.par_sort_unstable_by_key(|entry| entry.offset));

    let pack_path = galaxy_dir.join(&segment.data_file);
    let file = File::open(&pack_path)
        .with_context(|| format!("Cannot open {}", pack_path.display()))?;
    let mut reader = BufReader::with_capacity(32 * 1024 * 1024, file);
    validate_data_header(&mut reader)?;
    let mut position = DATA_HEADER_BYTES;
    let mut batch = Vec::with_capacity(batch_size);
    let mut scanned = 0u64;

    for entry in entries {
        if position != entry.offset {
            reader.seek(SeekFrom::Start(entry.offset))?;
            position = entry.offset;
        }
        let mut compressed = vec![0u8; entry.compressed_len as usize];
        reader.read_exact(&mut compressed)?;
        position += entry.compressed_len as u64;
        batch.push((entry, compressed));
        if batch.len() >= batch_size {
            process_batch(pool, &mut batch, updated_at, matches)?;
        }
        scanned += 1;
        if scanned % 1_000_000 == 0 {
            println!(
                "Scanned {} systems; {} Murder Binaries found...",
                format_count(scanned),
                format_count(matches.len() as u64)
            );
        }
    }
    if !batch.is_empty() {
        process_batch(pool, &mut batch, updated_at, matches)?;
    }
    Ok(())
}

fn process_batch(
    pool: &rayon::ThreadPool,
    batch: &mut Vec<(PackEntry, Vec<u8>)>,
    updated_at: &str,
    matches: &mut FxHashMap<u64, MurderPlace>,
) -> Result<()> {
    let results = pool.install(|| {
        batch
            .par_iter()
            .map(|(entry, compressed)| -> Result<(u64, Option<MurderPlace>)> {
                let raw = zstd::bulk::decompress(compressed, entry.raw_len as usize)
                    .context("Could not decompress a rich galaxy record")?;
                let system: RichSystem = serde_json::from_slice(&raw)
                    .context("Could not parse a rich galaxy record")?;
                Ok((entry.id64, murder_place(entry.id64, system, updated_at)))
            })
            .collect::<Vec<_>>()
    });
    for result in results {
        let (id64, place) = result?;
        if let Some(place) = place {
            matches.insert(id64, place);
        } else {
            matches.remove(&id64);
        }
    }
    batch.clear();
    Ok(())
}

fn murder_place(id64: u64, system: RichSystem, updated_at: &str) -> Option<MurderPlace> {
    if system.name.trim().is_empty()
        || !system.coords.x.is_finite()
        || !system.coords.y.is_finite()
        || !system.coords.z.is_finite()
    {
        return None;
    }
    let mut companions = system
        .bodies
        .into_iter()
        .filter_map(|body| {
            let distance = body.distance_to_arrival?;
            let is_star = body.body_type.as_deref() == Some("Star")
                || body.sub_type.as_deref().is_some_and(|value| value.ends_with(" Star"));
            if !is_star
                || body.body_id == Some(0)
                || !(MIN_DISTANCE_LS..=MAX_DISTANCE_LS).contains(&distance)
            {
                return None;
            }
            Some(Companion {
                name: body.name.unwrap_or_else(|| "Secondary star".to_string()),
                star_type: body.sub_type.unwrap_or_else(|| "Star".to_string()),
                distance_ls: distance,
            })
        })
        .collect::<Vec<_>>();
    if companions.is_empty() {
        return None;
    }
    companions.sort_unstable_by(|a, b| a.distance_ls.total_cmp(&b.distance_ls));
    let closest = companions[0].distance_ls;
    Some(MurderPlace {
        id: format!("murder-{id64}"),
        name: system.name.clone(),
        category: "Murder Binaries",
        source: "Local full galaxy analysis",
        source_group: "Local Analysis",
        place_type: "Murder Binary",
        type_label: "Murder Binary",
        coords: system.coords,
        system_name: system.name.clone(),
        description: format!(
            "Caution: {} stellar companion{} between {} and {} ls; closest is {:.2} ls from arrival.",
            companions.len(),
            if companions.len() == 1 { "" } else { "s" },
            MIN_DISTANCE_LS,
            MAX_DISTANCE_LS,
            closest
        ),
        details: MurderDetails {
            id64: id64.to_string(),
            minimum_distance_ls: MIN_DISTANCE_LS,
            maximum_distance_ls: MAX_DISTANCE_LS,
            companions,
        },
        updated_at: updated_at.to_string(),
        default_enabled: false,
        discovery: true,
    })
}

fn read_index(path: &Path) -> Result<Vec<PackEntry>> {
    let mut reader = BufReader::with_capacity(32 * 1024 * 1024, File::open(path)?);
    let mut header = [0u8; INDEX_HEADER_BYTES as usize];
    reader.read_exact(&mut header)?;
    if &header[0..8] != INDEX_MAGIC {
        bail!("Invalid rich index header in {}", path.display());
    }
    let version = u32::from_le_bytes(header[8..12].try_into().unwrap());
    let record_bytes = u32::from_le_bytes(header[12..16].try_into().unwrap()) as usize;
    let count = u64::from_le_bytes(header[16..24].try_into().unwrap());
    if version != 1 || record_bytes < 24 {
        bail!("Unsupported rich index format in {}", path.display());
    }
    let count_usize = usize::try_from(count).context("Rich index is too large for this platform")?;
    let mut entries = Vec::new();
    entries
        .try_reserve_exact(count_usize)
        .context("Not enough memory to load rich pack offsets")?;
    let mut row = vec![0u8; record_bytes];
    for _ in 0..count_usize {
        reader.read_exact(&mut row)?;
        entries.push(PackEntry {
            id64: u64::from_le_bytes(row[0..8].try_into().unwrap()),
            offset: u64::from_le_bytes(row[8..16].try_into().unwrap()),
            compressed_len: u32::from_le_bytes(row[16..20].try_into().unwrap()),
            raw_len: u32::from_le_bytes(row[20..24].try_into().unwrap()),
        });
    }
    Ok(entries)
}

fn validate_data_header(reader: &mut BufReader<File>) -> Result<()> {
    let mut header = [0u8; DATA_HEADER_BYTES as usize];
    reader.read_exact(&mut header)?;
    if &header[0..8] != DATA_MAGIC {
        bail!("Invalid rich galaxy data header");
    }
    Ok(())
}

fn replace_file(temp: &Path, final_path: &Path) -> Result<()> {
    if final_path.exists() {
        fs::remove_file(final_path)?;
    }
    fs::rename(temp, final_path)?;
    Ok(())
}

fn format_count(value: u64) -> String {
    let text = value.to_string();
    let mut out = String::new();
    for (index, ch) in text.chars().rev().enumerate() {
        if index > 0 && index % 3 == 0 {
            out.push(',');
        }
        out.push(ch);
    }
    out.chars().rev().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifies_only_stars_in_the_caution_band() {
        let system = RichSystem {
            name: "Caution Test".to_string(),
            coords: Coords { x: 1.0, y: 2.0, z: 3.0 },
            bodies: vec![
                Body {
                    body_id: Some(0),
                    name: Some("Caution Test A".to_string()),
                    body_type: Some("Star".to_string()),
                    sub_type: Some("G (White-Yellow) Star".to_string()),
                    distance_to_arrival: Some(0.0),
                },
                Body {
                    body_id: Some(1),
                    name: Some("Caution Test B".to_string()),
                    body_type: Some("Star".to_string()),
                    sub_type: Some("M (Red dwarf) Star".to_string()),
                    distance_to_arrival: Some(8.0),
                },
                Body {
                    body_id: Some(2),
                    name: Some("Caution Test 1".to_string()),
                    body_type: Some("Planet".to_string()),
                    sub_type: Some("Rocky body".to_string()),
                    distance_to_arrival: Some(7.0),
                },
            ],
        };
        let place = murder_place(42, system, "2026-01-01T00:00:00Z").unwrap();
        assert_eq!(place.details.companions.len(), 1);
        assert_eq!(place.details.companions[0].distance_ls, 8.0);
    }
}
