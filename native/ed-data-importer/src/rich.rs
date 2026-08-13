use anyhow::{Context, Result, anyhow, bail};
use chrono::{DateTime, NaiveDate, Utc};
use flate2::read::GzDecoder;
use rayon::prelude::*;
use rustc_hash::FxHashMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{self, File};
use std::io::{self, BufRead, BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

const FORMAT_VERSION: u32 = 1;
const DATA_MAGIC: &[u8; 8] = b"EDGRDAT1";
const INDEX_MAGIC: &[u8; 8] = b"EDGRIDX1";
const DATA_HEADER_BYTES: u64 = 16;
const INDEX_HEADER_BYTES: u64 = 32;
const INDEX_RECORD_BYTES: u32 = 68;
const FILTER_RECORD_BYTES: u32 = 40;
const REPACK_BUCKET_COUNT: usize = 256;
const REPACK_DICTIONARY_BYTES: usize = 112_640;
const REPACK_DICTIONARY_SAMPLES: usize = 4_096;
const REPACK_VERIFY_SAMPLES: usize = 64;
const SYSTEM_RECORD_BYTES: usize = 32;
const LOD_RECORD_BYTES: usize = 20;
const UNKNOWN_UPDATE_SECONDS: u32 = u32::MAX;
const SCHEMA_URL: &str = "https://docs.spansh.co.uk/galaxy.schema.json";

const FLAG_BODIES: u32 = 1 << 0;
const FLAG_STATIONS: u32 = 1 << 1;
const FLAG_FACTIONS: u32 = 1 << 2;
const FLAG_POPULATED: u32 = 1 << 3;
const FLAG_POWERS: u32 = 1 << 4;
const FLAG_THARGOID_WAR: u32 = 1 << 5;
const FLAG_MARKETS: u32 = 1 << 6;
const FLAG_SHIPYARDS: u32 = 1 << 7;
const FLAG_OUTFITTING: u32 = 1 << 8;
const FLAG_SIGNALS: u32 = 1 << 9;
const FLAG_LANDABLE: u32 = 1 << 10;
const FLAG_RICH_DATA: u32 = 1 << 31;

const BODY_EARTH_LIKE: u32 = 1 << 0;
const BODY_WATER_WORLD: u32 = 1 << 1;
const BODY_AMMONIA_WORLD: u32 = 1 << 2;
const BODY_ICY: u32 = 1 << 3;
const BODY_ROCKY_ICE: u32 = 1 << 4;
const BODY_HIGH_METAL: u32 = 1 << 5;
const BODY_METAL_RICH: u32 = 1 << 6;
const BODY_GAS_WATER_LIFE: u32 = 1 << 7;
const BODY_GAS_AMMONIA_LIFE: u32 = 1 << 8;
const BODY_WATER_GIANT: u32 = 1 << 9;
const BODY_TERRAFORMABLE: u32 = 1 << 10;

const ATMOS_THIN_AMMONIA: u32 = 1 << 0;
const ATMOS_AMMONIA: u32 = 1 << 1;
const ATMOS_WATER: u32 = 1 << 2;
const ATMOS_OXYGEN: u32 = 1 << 3;
const ATMOS_CARBON_DIOXIDE: u32 = 1 << 4;
const ATMOS_METHANE: u32 = 1 << 5;
const ATMOS_NITROGEN: u32 = 1 << 6;
const ATMOS_SULPHUR_DIOXIDE: u32 = 1 << 7;
const ATMOS_SILICATE: u32 = 1 << 8;
const ATMOS_HELIUM: u32 = 1 << 9;
const ATMOS_NEON: u32 = 1 << 10;
const ATMOS_ARGON: u32 = 1 << 11;
const ATMOS_THIN: u32 = 1 << 12;
const ATMOS_THICK: u32 = 1 << 13;
const ATMOS_HOT: u32 = 1 << 14;
const ATMOS_WATER_LIFE: u32 = 1 << 15;

const RING_ICY: u32 = 1 << 0;
const RING_ROCKY: u32 = 1 << 1;
const RING_METAL_RICH: u32 = 1 << 2;
const RING_METALLIC: u32 = 1 << 3;

const VOLCANISM_SILICATE: u32 = 1 << 0;
const VOLCANISM_METALLIC: u32 = 1 << 1;
const VOLCANISM_ROCKY: u32 = 1 << 2;
const VOLCANISM_WATER: u32 = 1 << 3;
const VOLCANISM_CARBON_DIOXIDE: u32 = 1 << 4;
const VOLCANISM_NITROGEN: u32 = 1 << 5;
const VOLCANISM_METHANE: u32 = 1 << 6;
const VOLCANISM_AMMONIA: u32 = 1 << 7;
const VOLCANISM_MAJOR: u32 = 1 << 8;
const VOLCANISM_MINOR: u32 = 1 << 9;

const ECONOMY_EXTRACTION: u32 = 1 << 0;
const ECONOMY_REFINERY: u32 = 1 << 1;
const ECONOMY_INDUSTRIAL: u32 = 1 << 2;
const ECONOMY_AGRICULTURE: u32 = 1 << 3;
const ECONOMY_HIGH_TECH: u32 = 1 << 4;
const ECONOMY_MILITARY: u32 = 1 << 5;
const ECONOMY_TOURISM: u32 = 1 << 6;
const ECONOMY_SERVICE: u32 = 1 << 7;
const ECONOMY_COLONY: u32 = 1 << 8;
const ECONOMY_OTHER: u32 = 1 << 15;

const SECURITY_ANARCHY: u32 = 1 << 0;
const SECURITY_LOW: u32 = 1 << 1;
const SECURITY_MEDIUM: u32 = 1 << 2;
const SECURITY_HIGH: u32 = 1 << 3;

const GOVERNMENT_ANARCHY: u32 = 1 << 0;
const GOVERNMENT_COMMUNISM: u32 = 1 << 1;
const GOVERNMENT_CONFEDERACY: u32 = 1 << 2;
const GOVERNMENT_COOPERATIVE: u32 = 1 << 3;
const GOVERNMENT_CORPORATE: u32 = 1 << 4;
const GOVERNMENT_DEMOCRACY: u32 = 1 << 5;
const GOVERNMENT_DICTATORSHIP: u32 = 1 << 6;
const GOVERNMENT_FEUDAL: u32 = 1 << 7;
const GOVERNMENT_PATRONAGE: u32 = 1 << 8;
const GOVERNMENT_THEOCRACY: u32 = 1 << 9;
const GOVERNMENT_OTHER: u32 = 1 << 15;

const LOD_FILES: [(u8, &str); 7] = [
    (0, "systems-lod-0.bin"),
    (1, "systems-lod-1.bin"),
    (2, "systems-lod-2.bin"),
    (3, "systems-lod-3.bin"),
    (4, "systems-lod-4.bin"),
    (5, "systems-lod-5.bin"),
    (6, "systems-lod-6.bin"),
];

pub(crate) struct RichImportConfig<'a> {
    pub source: &'a str,
    pub data_dir: &'a Path,
    pub delta: bool,
    pub threads: usize,
    pub compression_level: i32,
    pub batch_size: usize,
}

pub(crate) struct RichRepackConfig<'a> {
    pub data_dir: &'a Path,
    pub threads: usize,
    pub compression_level: i32,
    pub batch_size: usize,
}

#[derive(Clone)]
struct PendingRecord {
    id64: u64,
    raw: Vec<u8>,
    update_seconds: u32,
    body_count: u32,
    station_count: u32,
    flags: u32,
    body_types: u32,
    atmosphere_types: u32,
    ring_types: u32,
    volcanism_types: u32,
    economy_types: u32,
    security_types: u32,
    government_types: u32,
}

#[derive(Clone, Copy)]
struct IndexEntry {
    id64: u64,
    offset: u64,
    compressed_len: u32,
    raw_len: u32,
    update_seconds: u32,
    body_count: u32,
    station_count: u32,
    flags: u32,
    body_types: u32,
    atmosphere_types: u32,
    ring_types: u32,
    volcanism_types: u32,
    economy_types: u32,
    security_types: u32,
    government_types: u32,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct SegmentSummary {
    body_count: u64,
    station_count: u64,
    systems_with_bodies: u64,
    systems_with_stations: u64,
    populated_systems: u64,
    systems_with_factions: u64,
    systems_with_powers: u64,
    systems_with_thargoid_war: u64,
    systems_with_markets: u64,
    systems_with_shipyards: u64,
    systems_with_outfitting: u64,
    systems_with_signals: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestSegment {
    kind: String,
    source_path: String,
    imported_at: String,
    data_file: String,
    index_file: String,
    count: u64,
    input_count: u64,
    duplicate_count: u64,
    data_bytes: u64,
    index_bytes: u64,
    compression: String,
    compression_level: i32,
    #[serde(default)]
    dictionary: Option<DictionaryManifest>,
    #[serde(default)]
    min_update_time: Option<String>,
    #[serde(default)]
    max_update_time: Option<String>,
    #[serde(default)]
    summary: Value,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DictionaryManifest {
    file: String,
    bytes: u64,
    dict_id: u32,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    format_version: u32,
    schema_url: String,
    updated_at: String,
    index_header_bytes: u64,
    index_record_bytes: u32,
    data_header_bytes: u64,
    #[serde(default)]
    map_filters: Option<MapFilterManifest>,
    segments: Vec<ManifestSegment>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MapFilterManifest {
    generated_at: String,
    record_bytes: u32,
    flags: Value,
    #[serde(default)]
    categories: Value,
    lod_levels: Vec<MapFilterLod>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MapFilterLod {
    level: u8,
    file: String,
    count: u64,
}

#[derive(Clone, Copy, Default)]
struct FilterSummary {
    flags: u32,
    body_count: u32,
    station_count: u32,
    body_types: u32,
    atmosphere_types: u32,
    ring_types: u32,
    volcanism_types: u32,
    economy_types: u32,
    security_types: u32,
    government_types: u32,
}

struct FilterLodWriter {
    level: u8,
    reader: BufReader<File>,
    writer: BufWriter<File>,
    final_path: PathBuf,
    temp_path: PathBuf,
    next_index: Option<u32>,
    count: u64,
}

pub(crate) fn rebuild_map_filters(data_dir: &Path) -> Result<()> {
    let rich_dir = data_dir.join("galaxy");
    let manifest_path = rich_dir.join("manifest.json");
    if !manifest_path.exists() {
        bail!(
            "Cannot rebuild rich map filters before a base galaxy import. Run the galaxy mode first."
        );
    }
    let mut manifest = serde_json::from_reader::<_, Manifest>(File::open(&manifest_path)?)
        .context("Could not read existing galaxy manifest")?;
    manifest.map_filters = build_map_filter_files_from_manifest(data_dir, &rich_dir, &manifest)?;
    manifest.updated_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    write_manifest(&manifest_path, &manifest)?;
    println!("Rich map filter sidecars rebuilt from existing galaxy segments.");
    Ok(())
}

pub(crate) fn run(config: RichImportConfig<'_>) -> Result<()> {
    let rich_dir = config.data_dir.join("galaxy");
    fs::create_dir_all(&rich_dir)?;
    let manifest_path = rich_dir.join("manifest.json");
    let previous_manifest = if manifest_path.exists() {
        serde_json::from_reader::<_, Manifest>(File::open(&manifest_path)?).ok()
    } else {
        None
    };
    if config.delta && !manifest_path.exists() {
        bail!(
            "Cannot import a galaxy delta before a base galaxy import. Run the galaxy mode first."
        );
    }
    let compression_dictionary = if config.delta {
        dictionary_from_manifest(&rich_dir, previous_manifest.as_ref())?
    } else {
        None
    };

    let imported_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let file_stem = if config.delta {
        format!("delta-{}", Utc::now().format("%Y%m%dT%H%M%SZ"))
    } else {
        "base".to_string()
    };
    let final_data = rich_dir.join(format!("{file_stem}.pack"));
    let final_index = rich_dir.join(format!("{file_stem}.idx"));
    let temp_tag = format!(".{}.tmp", Utc::now().timestamp_millis());
    let temp_data = PathBuf::from(format!("{}{}", final_data.display(), temp_tag));
    let temp_index = PathBuf::from(format!("{}{}", final_index.display(), temp_tag));
    let started = Instant::now();
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(config.threads)
        .build()
        .context("Could not create compression worker pool")?;

    println!(
        "Importing rich galaxy {} from {} with {} compression threads...",
        if config.delta { "delta" } else { "base" },
        config.source,
        config.threads
    );

    let result = (|| -> Result<(ManifestSegment, Vec<IndexEntry>)> {
        let mut reader = open_source(config.source)?;
        let mut writer = BufWriter::with_capacity(32 * 1024 * 1024, File::create(&temp_data)?);
        write_data_header(&mut writer)?;
        let mut offset = DATA_HEADER_BYTES;
        let mut line = String::new();
        let mut batch = Vec::with_capacity(config.batch_size);
        let mut entries = Vec::<IndexEntry>::new();
        let mut input_count = 0u64;
        let mut line_number = 0u64;

        loop {
            line.clear();
            let bytes = reader.read_line(&mut line)?;
            if bytes == 0 {
                break;
            }
            line_number += 1;
            let Some(cleaned) = clean_json_line(&line) else {
                continue;
            };
            let pending = parse_record(cleaned.as_bytes(), line_number)?;
            batch.push(pending);
            input_count += 1;
            if batch.len() >= config.batch_size {
                compress_batch(
                    &pool,
                    &mut writer,
                    &mut entries,
                    &mut offset,
                    &mut batch,
                    config.compression_level,
                    compression_dictionary.as_ref().map(|(bytes, _)| bytes.as_slice()),
                )?;
            }
            if input_count % 100_000 == 0 {
                println!(
                    "Packed {} systems; {} index entries; {:.1} GiB written...",
                    format_count(input_count),
                    format_count(entries.len() as u64),
                    offset as f64 / 1024.0 / 1024.0 / 1024.0
                );
            }
        }
        if !batch.is_empty() {
            compress_batch(
                &pool,
                &mut writer,
                &mut entries,
                &mut offset,
                &mut batch,
                config.compression_level,
                compression_dictionary.as_ref().map(|(bytes, _)| bytes.as_slice()),
            )?;
        }
        writer.flush()?;

        println!(
            "Sorting {} rich index entries in memory...",
            format_count(entries.len() as u64)
        );
        pool.install(|| entries.par_sort_unstable_by_key(|entry| (entry.id64, update_rank(entry))));
        let unique_count = deduplicate_entries(&mut entries);
        let duplicate_count = input_count.saturating_sub(unique_count as u64);
        let (summary, min_update, max_update) = summarize_entries(&entries);
        write_index(&temp_index, &entries)?;

        let data_bytes = fs::metadata(&temp_data)?.len();
        let index_bytes = fs::metadata(&temp_index)?.len();
        Ok((
            ManifestSegment {
                kind: if config.delta { "delta" } else { "base" }.to_string(),
                source_path: config.source.to_string(),
                imported_at: imported_at.clone(),
                data_file: final_data
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .to_string(),
                index_file: final_index
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .to_string(),
                count: unique_count as u64,
                input_count,
                duplicate_count,
                data_bytes,
                index_bytes,
                compression: "zstd".to_string(),
                compression_level: config.compression_level,
                dictionary: compression_dictionary.as_ref().map(|(_, descriptor)| descriptor.clone()),
                min_update_time: seconds_to_iso(min_update),
                max_update_time: seconds_to_iso(max_update),
                summary: serde_json::to_value(summary)?,
            },
            entries,
        ))
    })();

    let (segment, base_entries) = match result {
        Ok(result) => result,
        Err(error) => {
            let _ = fs::remove_file(&temp_data);
            let _ = fs::remove_file(&temp_index);
            return Err(error);
        }
    };

    replace_file(&temp_data, &final_data)?;
    replace_file(&temp_index, &final_index)?;
    let mut manifest = if config.delta {
        serde_json::from_reader::<_, Manifest>(File::open(&manifest_path)?)
            .context("Could not read existing galaxy manifest")?
    } else {
        Manifest {
            format_version: FORMAT_VERSION,
            schema_url: SCHEMA_URL.to_string(),
            updated_at: imported_at.clone(),
            index_header_bytes: INDEX_HEADER_BYTES,
            index_record_bytes: INDEX_RECORD_BYTES,
            data_header_bytes: DATA_HEADER_BYTES,
            map_filters: None,
            segments: Vec::new(),
        }
    };
    manifest.updated_at = imported_at;
    if config.delta {
        manifest.segments.insert(0, segment.clone());
    } else {
        manifest.segments = vec![segment.clone()];
        manifest.map_filters = build_map_filter_files(config.data_dir, &rich_dir, &base_entries)?;
    }
    write_manifest(&manifest_path, &manifest)?;
    if !config.delta {
        remove_superseded_segments(&rich_dir, previous_manifest.as_ref(), &manifest)?;
    }

    println!(
        "Rich galaxy {} complete: {} indexed systems, {:.1} GiB packed, {:.1} GiB index, {} duplicates resolved in {} seconds.",
        segment.kind,
        format_count(segment.count),
        segment.data_bytes as f64 / 1024.0 / 1024.0 / 1024.0,
        segment.index_bytes as f64 / 1024.0 / 1024.0 / 1024.0,
        format_count(segment.duplicate_count),
        started.elapsed().as_secs()
    );
    Ok(())
}

fn remove_superseded_segments(
    rich_dir: &Path,
    previous: Option<&Manifest>,
    current: &Manifest,
) -> Result<()> {
    let Some(previous) = previous else {
        return Ok(());
    };
    let retained = current
        .segments
        .iter()
        .flat_map(|segment| {
            std::iter::once(&segment.data_file)
                .chain(std::iter::once(&segment.index_file))
                .chain(segment.dictionary.as_ref().map(|dictionary| &dictionary.file))
        })
        .collect::<std::collections::HashSet<_>>();
    for filename in previous
        .segments
        .iter()
        .flat_map(|segment| {
            std::iter::once(&segment.data_file)
                .chain(std::iter::once(&segment.index_file))
                .chain(segment.dictionary.as_ref().map(|dictionary| &dictionary.file))
        })
    {
        if retained.contains(filename) || Path::new(filename).file_name().is_none() {
            continue;
        }
        let path = rich_dir.join(filename);
        if path.parent() == Some(rich_dir) && path.exists() {
            fs::remove_file(path)?;
        }
    }
    Ok(())
}

fn dictionary_from_manifest(
    rich_dir: &Path,
    manifest: Option<&Manifest>,
) -> Result<Option<(Vec<u8>, DictionaryManifest)>> {
    let Some(descriptor) = manifest
        .and_then(|manifest| manifest.segments.iter().find_map(|segment| segment.dictionary.clone()))
    else {
        return Ok(None);
    };
    if Path::new(&descriptor.file).file_name().is_none() {
        bail!("Invalid rich galaxy dictionary filename in manifest.");
    }
    let path = rich_dir.join(&descriptor.file);
    let dictionary = fs::read(&path)
        .with_context(|| format!("Could not read rich galaxy dictionary {}", path.display()))?;
    if dictionary.len() as u64 != descriptor.bytes {
        bail!("Rich galaxy dictionary {} has an unexpected size.", path.display());
    }
    let dictionary_id = zstd::zstd_safe::get_dict_id_from_dict(&dictionary)
        .map(|value| value.get())
        .ok_or_else(|| anyhow!("Rich galaxy dictionary {} is invalid.", path.display()))?;
    if dictionary_id != descriptor.dict_id {
        bail!("Rich galaxy dictionary {} has an unexpected dictionary ID.", path.display());
    }
    Ok(Some((dictionary, descriptor)))
}

pub(crate) fn repack(config: RichRepackConfig<'_>) -> Result<()> {
    let rich_dir = config.data_dir.join("galaxy");
    let manifest_path = rich_dir.join("manifest.json");
    let mut manifest: Manifest = serde_json::from_reader(
        File::open(&manifest_path).context("Could not read the rich galaxy manifest")?,
    )?;
    if manifest.segments.len() != 1 || manifest.segments[0].kind != "base" {
        bail!(
            "The dictionary repack currently requires one base galaxy segment and no deltas. Import or consolidate deltas first."
        );
    }
    let original = manifest.segments[0].clone();
    if original.dictionary.is_some() {
        bail!("The current rich galaxy base already uses a dictionary; no repack is needed.");
    }
    let source_pack = rich_dir.join(&original.data_file);
    let source_index = rich_dir.join(&original.index_file);
    let source_bytes = fs::metadata(&source_pack)
        .with_context(|| format!("Could not inspect {}", source_pack.display()))?
        .len();
    if source_bytes != original.data_bytes {
        bail!("Rich galaxy pack size does not match its manifest; refusing to repack it.");
    }

    let started = Instant::now();
    let tag = Utc::now().timestamp_millis();
    let work_dir = rich_dir.join(format!(".repack-{tag}.tmp"));
    fs::create_dir(&work_dir)?;
    let result = repack_impl(
        &mut manifest,
        &rich_dir,
        &source_pack,
        &source_index,
        &work_dir,
        config,
    );
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&work_dir);
        return Err(error);
    }
    let new_segment = manifest.segments.first().expect("repack retains base segment");
    println!(
        "Rich galaxy dictionary repack complete: {} systems, {:.1} GiB packed, {:.1} GiB index in {} seconds.",
        format_count(new_segment.count),
        new_segment.data_bytes as f64 / 1024.0 / 1024.0 / 1024.0,
        new_segment.index_bytes as f64 / 1024.0 / 1024.0 / 1024.0,
        started.elapsed().as_secs()
    );
    Ok(())
}

fn repack_impl(
    manifest: &mut Manifest,
    rich_dir: &Path,
    source_pack: &Path,
    source_index: &Path,
    work_dir: &Path,
    config: RichRepackConfig<'_>,
) -> Result<()> {
    let original = manifest.segments[0].clone();
    let dictionary = train_repack_dictionary(source_pack, source_index, original.count)?;
    let dictionary_id = zstd::zstd_safe::get_dict_id_from_dict(&dictionary)
        .map(|value| value.get())
        .ok_or_else(|| anyhow!("The trained rich galaxy dictionary is invalid."))?;
    let tag = Utc::now().timestamp_millis();
    let data_file = format!("base-dict-{tag}.pack");
    let index_file = format!("base-dict-{tag}.idx");
    let dictionary_file = format!("base-dict-{tag}.dict");
    let temp_data = work_dir.join(&data_file);
    let temp_index = work_dir.join(&index_file);
    let temp_dictionary = work_dir.join(&dictionary_file);
    fs::write(&temp_dictionary, &dictionary)?;

    println!("Preparing bounded sequential-read shards for {} rich index entries...", format_count(original.count));
    distribute_repack_order(source_index, work_dir, original.count, original.data_bytes)?;

    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(config.threads)
        .build()
        .context("Could not create dictionary repack compression worker pool")?;
    let mut data_writer = BufWriter::with_capacity(32 * 1024 * 1024, File::create(&temp_data)?);
    write_data_header(&mut data_writer)?;
    let mut mapping_writers = open_repack_mapping_writers(work_dir)?;
    let mut output_offset = DATA_HEADER_BYTES;
    let mut processed = 0u64;
    let mut source_reader = BufReader::with_capacity(32 * 1024 * 1024, File::open(source_pack)?);
    validate_data_header(&mut source_reader, source_pack)?;

    for bucket in 0..REPACK_BUCKET_COUNT {
        let entries = read_repack_order_bucket(work_dir, bucket)?;
        if entries.is_empty() {
            continue;
        }
        let bucket_count = entries.len() as u64;
        let mut batch = Vec::with_capacity(config.batch_size);
        let mut position = 0u64;
        for item in entries {
            if position != item.entry.offset {
                source_reader.seek(SeekFrom::Start(item.entry.offset))?;
                position = item.entry.offset;
            }
            let mut compressed = vec![0u8; item.entry.compressed_len as usize];
            source_reader.read_exact(&mut compressed)?;
            position += item.entry.compressed_len as u64;
            let raw = zstd::bulk::decompress(&compressed, item.entry.raw_len as usize)
                .context("Could not decompress a source rich galaxy record during repack")?;
            batch.push(RepackRecord { ordinal: item.ordinal, raw });
            if batch.len() >= config.batch_size {
                write_repack_batch(
                    &pool,
                    &mut data_writer,
                    &mut mapping_writers,
                    &mut output_offset,
                    &mut batch,
                    &dictionary,
                    config.compression_level,
                    original.count,
                )?;
            }
        }
        if !batch.is_empty() {
            write_repack_batch(
                &pool,
                &mut data_writer,
                &mut mapping_writers,
                &mut output_offset,
                &mut batch,
                &dictionary,
                config.compression_level,
                original.count,
            )?;
        }
        processed += bucket_count;
        println!("Repacked {} / {} systems...", format_count(processed), format_count(original.count));
    }
    if processed != original.count {
        bail!("The dictionary repack processed {processed} records but expected {}.", original.count);
    }
    data_writer.flush()?;
    for writer in &mut mapping_writers {
        writer.flush()?;
    }

    println!("Writing the updated rich index in system-ID order...");
    write_repacked_index(source_index, &temp_index, work_dir, original.count)?;
    verify_repacked_samples(
        source_pack,
        source_index,
        &temp_data,
        &temp_index,
        &dictionary,
        original.count,
    )?;

    let final_data = rich_dir.join(&data_file);
    let final_index = rich_dir.join(&index_file);
    let final_dictionary = rich_dir.join(&dictionary_file);
    fs::rename(&temp_data, &final_data)?;
    fs::rename(&temp_index, &final_index)?;
    fs::rename(&temp_dictionary, &final_dictionary)?;
    let data_bytes = fs::metadata(&final_data)?.len();
    let index_bytes = fs::metadata(&final_index)?.len();
    let mut replacement = original.clone();
    replacement.data_file = data_file;
    replacement.index_file = index_file;
    replacement.data_bytes = data_bytes;
    replacement.index_bytes = index_bytes;
    replacement.compression = "zstd-dictionary".to_string();
    replacement.compression_level = config.compression_level;
    replacement.dictionary = Some(DictionaryManifest {
        file: dictionary_file,
        bytes: dictionary.len() as u64,
        dict_id: dictionary_id,
    });
    manifest.updated_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    manifest.segments = vec![replacement];
    let manifest_path = rich_dir.join("manifest.json");
    write_manifest(&manifest_path, manifest)?;
    remove_superseded_segments(rich_dir, Some(&Manifest {
        format_version: manifest.format_version,
        schema_url: manifest.schema_url.clone(),
        updated_at: original.imported_at.clone(),
        index_header_bytes: manifest.index_header_bytes,
        index_record_bytes: manifest.index_record_bytes,
        data_header_bytes: manifest.data_header_bytes,
        map_filters: None,
        segments: vec![original],
    }), manifest)?;
    fs::remove_dir_all(work_dir)?;
    Ok(())
}

#[derive(Clone, Copy)]
struct RepackOrderEntry {
    ordinal: u64,
    entry: IndexEntry,
}

struct RepackRecord {
    ordinal: u64,
    raw: Vec<u8>,
}

#[derive(Clone, Copy)]
struct RepackMapping {
    ordinal: u64,
    offset: u64,
    compressed_len: u32,
}

fn repack_bucket(value: u64, total: u64) -> usize {
    ((value.saturating_mul(REPACK_BUCKET_COUNT as u64) / total)
        .min(REPACK_BUCKET_COUNT as u64 - 1)) as usize
}

fn repack_order_path(work_dir: &Path, bucket: usize) -> PathBuf {
    work_dir.join(format!("pack-order-{bucket:03}.bin"))
}

fn repack_mapping_path(work_dir: &Path, bucket: usize) -> PathBuf {
    work_dir.join(format!("index-map-{bucket:03}.bin"))
}

fn validate_data_header(reader: &mut BufReader<File>, path: &Path) -> Result<()> {
    let mut header = [0u8; DATA_HEADER_BYTES as usize];
    reader.read_exact(&mut header)?;
    if &header[..8] != DATA_MAGIC || u32::from_le_bytes(header[8..12].try_into().unwrap()) != FORMAT_VERSION {
        bail!("Unsupported rich galaxy pack format in {}", path.display());
    }
    Ok(())
}

fn write_index_entry(writer: &mut BufWriter<File>, entry: &IndexEntry) -> Result<()> {
    writer.write_all(&entry.id64.to_le_bytes())?;
    writer.write_all(&entry.offset.to_le_bytes())?;
    writer.write_all(&entry.compressed_len.to_le_bytes())?;
    writer.write_all(&entry.raw_len.to_le_bytes())?;
    writer.write_all(&entry.update_seconds.to_le_bytes())?;
    writer.write_all(&entry.body_count.to_le_bytes())?;
    writer.write_all(&entry.station_count.to_le_bytes())?;
    writer.write_all(&entry.flags.to_le_bytes())?;
    writer.write_all(&entry.body_types.to_le_bytes())?;
    writer.write_all(&entry.atmosphere_types.to_le_bytes())?;
    writer.write_all(&entry.ring_types.to_le_bytes())?;
    writer.write_all(&entry.volcanism_types.to_le_bytes())?;
    writer.write_all(&entry.economy_types.to_le_bytes())?;
    writer.write_all(&entry.security_types.to_le_bytes())?;
    writer.write_all(&entry.government_types.to_le_bytes())?;
    Ok(())
}

fn train_repack_dictionary(source_pack: &Path, source_index: &Path, count: u64) -> Result<Vec<u8>> {
    println!("Training a shared rich-galaxy dictionary from {} representative records...", REPACK_DICTIONARY_SAMPLES);
    let mut index_reader = BufReader::with_capacity(8 * 1024 * 1024, File::open(source_index)?);
    let (record_bytes, indexed_count) = read_index_header(&mut index_reader, source_index)?;
    if indexed_count != count {
        bail!("Rich galaxy index count does not match its manifest; refusing to repack it.");
    }
    let mut pack_reader = BufReader::with_capacity(32 * 1024 * 1024, File::open(source_pack)?);
    validate_data_header(&mut pack_reader, source_pack)?;
    let sample_count = usize::try_from(count.min(REPACK_DICTIONARY_SAMPLES as u64)).unwrap();
    let mut record = vec![0u8; record_bytes as usize];
    let mut samples = Vec::with_capacity(sample_count);
    for sample in 0..sample_count {
        let ordinal = ((sample as u64 + 1) * count / (sample_count as u64 + 1)).min(count - 1);
        index_reader.seek(SeekFrom::Start(INDEX_HEADER_BYTES + ordinal * record_bytes as u64))?;
        index_reader.read_exact(&mut record)?;
        let entry = read_index_entry(&record);
        pack_reader.seek(SeekFrom::Start(entry.offset))?;
        let mut compressed = vec![0u8; entry.compressed_len as usize];
        pack_reader.read_exact(&mut compressed)?;
        samples.push(
            zstd::bulk::decompress(&compressed, entry.raw_len as usize)
                .context("Could not decompress a dictionary-training record")?,
        );
    }
    zstd::dict::from_samples(&samples, REPACK_DICTIONARY_BYTES)
        .context("Could not train the rich galaxy dictionary")
}

fn distribute_repack_order(
    source_index: &Path,
    work_dir: &Path,
    count: u64,
    data_bytes: u64,
) -> Result<()> {
    let mut writers = (0..REPACK_BUCKET_COUNT)
        .map(|bucket| File::create(repack_order_path(work_dir, bucket)).map(|file| BufWriter::with_capacity(256 * 1024, file)))
        .collect::<io::Result<Vec<_>>>()?;
    let mut reader = BufReader::with_capacity(32 * 1024 * 1024, File::open(source_index)?);
    let (record_bytes, indexed_count) = read_index_header(&mut reader, source_index)?;
    if indexed_count != count {
        bail!("Rich galaxy index count does not match its manifest; refusing to repack it.");
    }
    let mut record = vec![0u8; record_bytes as usize];
    for ordinal in 0..count {
        reader.read_exact(&mut record)?;
        let entry = read_index_entry(&record);
        let bucket = repack_bucket(entry.offset, data_bytes);
        writers[bucket].write_all(&ordinal.to_le_bytes())?;
        writers[bucket].write_all(&record)?;
    }
    for writer in &mut writers {
        writer.flush()?;
    }
    Ok(())
}

fn read_repack_order_bucket(work_dir: &Path, bucket: usize) -> Result<Vec<RepackOrderEntry>> {
    let bytes = fs::read(repack_order_path(work_dir, bucket))?;
    let item_bytes = 8 + INDEX_RECORD_BYTES as usize;
    if bytes.len() % item_bytes != 0 {
        bail!("A dictionary repack pack-order shard is truncated.");
    }
    let mut entries = bytes
        .chunks_exact(item_bytes)
        .map(|item| RepackOrderEntry {
            ordinal: u64::from_le_bytes(item[..8].try_into().unwrap()),
            entry: read_index_entry(&item[8..]),
        })
        .collect::<Vec<_>>();
    entries.sort_unstable_by_key(|item| item.entry.offset);
    Ok(entries)
}

fn open_repack_mapping_writers(work_dir: &Path) -> Result<Vec<BufWriter<File>>> {
    (0..REPACK_BUCKET_COUNT)
        .map(|bucket| File::create(repack_mapping_path(work_dir, bucket)).map(|file| BufWriter::with_capacity(256 * 1024, file)).map_err(Into::into))
        .collect()
}

fn write_repack_batch(
    pool: &rayon::ThreadPool,
    data_writer: &mut BufWriter<File>,
    mapping_writers: &mut [BufWriter<File>],
    output_offset: &mut u64,
    batch: &mut Vec<RepackRecord>,
    dictionary: &[u8],
    compression_level: i32,
    total: u64,
) -> Result<()> {
    let compressed = compress_records(
        pool,
        batch.iter().map(|record| record.raw.as_slice()).collect(),
        compression_level,
        Some(dictionary),
    )?;
    for (record, compressed) in batch.iter().zip(compressed) {
        let compressed_len = u32::try_from(compressed.len())
            .context("One dictionary-compressed galaxy record exceeded 4 GiB")?;
        data_writer.write_all(&compressed)?;
        let writer = &mut mapping_writers[repack_bucket(record.ordinal, total)];
        writer.write_all(&record.ordinal.to_le_bytes())?;
        writer.write_all(&output_offset.to_le_bytes())?;
        writer.write_all(&compressed_len.to_le_bytes())?;
        *output_offset += compressed.len() as u64;
    }
    batch.clear();
    Ok(())
}

fn write_repacked_index(source_index: &Path, output_index: &Path, work_dir: &Path, count: u64) -> Result<()> {
    let mut source_reader = BufReader::with_capacity(32 * 1024 * 1024, File::open(source_index)?);
    let (record_bytes, indexed_count) = read_index_header(&mut source_reader, source_index)?;
    if indexed_count != count {
        bail!("Rich galaxy index count changed while the dictionary repack was running.");
    }
    let mut writer = BufWriter::with_capacity(32 * 1024 * 1024, File::create(output_index)?);
    writer.write_all(INDEX_MAGIC)?;
    writer.write_all(&FORMAT_VERSION.to_le_bytes())?;
    writer.write_all(&INDEX_RECORD_BYTES.to_le_bytes())?;
    writer.write_all(&count.to_le_bytes())?;
    writer.write_all(&0u64.to_le_bytes())?;
    let mut original = vec![0u8; record_bytes as usize];
    let mut expected = 0u64;
    for bucket in 0..REPACK_BUCKET_COUNT {
        let bytes = fs::read(repack_mapping_path(work_dir, bucket))?;
        if bytes.len() % 20 != 0 {
            bail!("A dictionary repack index-map shard is truncated.");
        }
        let mut mappings = bytes
            .chunks_exact(20)
            .map(|item| RepackMapping {
                ordinal: u64::from_le_bytes(item[..8].try_into().unwrap()),
                offset: u64::from_le_bytes(item[8..16].try_into().unwrap()),
                compressed_len: u32::from_le_bytes(item[16..20].try_into().unwrap()),
            })
            .collect::<Vec<_>>();
        mappings.sort_unstable_by_key(|item| item.ordinal);
        for mapping in mappings {
            if mapping.ordinal != expected {
                bail!("Dictionary repack index-map shards are incomplete or duplicated.");
            }
            source_reader.read_exact(&mut original)?;
            let mut entry = read_index_entry(&original);
            entry.offset = mapping.offset;
            entry.compressed_len = mapping.compressed_len;
            write_index_entry(&mut writer, &entry)?;
            expected += 1;
        }
    }
    if expected != count {
        bail!("Dictionary repack produced {expected} index rows but expected {count}.");
    }
    writer.flush()?;
    Ok(())
}

fn read_index_entry_at(reader: &mut BufReader<File>, ordinal: u64) -> Result<IndexEntry> {
    reader.seek(SeekFrom::Start(INDEX_HEADER_BYTES + ordinal * INDEX_RECORD_BYTES as u64))?;
    let mut record = [0u8; INDEX_RECORD_BYTES as usize];
    reader.read_exact(&mut record)?;
    Ok(read_index_entry(&record))
}

fn verify_repacked_samples(
    source_pack: &Path,
    source_index: &Path,
    repacked_pack: &Path,
    repacked_index: &Path,
    dictionary: &[u8],
    count: u64,
) -> Result<()> {
    println!("Verifying {} representative rich records before publishing the repack...", REPACK_VERIFY_SAMPLES);
    let mut old_index = BufReader::with_capacity(8 * 1024 * 1024, File::open(source_index)?);
    let mut new_index = BufReader::with_capacity(8 * 1024 * 1024, File::open(repacked_index)?);
    read_index_header(&mut old_index, source_index)?;
    read_index_header(&mut new_index, repacked_index)?;
    let mut old_pack = BufReader::with_capacity(32 * 1024 * 1024, File::open(source_pack)?);
    let mut new_pack = BufReader::with_capacity(32 * 1024 * 1024, File::open(repacked_pack)?);
    validate_data_header(&mut old_pack, source_pack)?;
    validate_data_header(&mut new_pack, repacked_pack)?;
    let mut decompressor = zstd::bulk::Decompressor::with_dictionary(dictionary)
        .context("Could not create rich galaxy dictionary decompressor")?;
    for sample in 0..REPACK_VERIFY_SAMPLES.min(count as usize) {
        let ordinal = ((sample as u64 + 1) * count / (REPACK_VERIFY_SAMPLES.min(count as usize) as u64 + 1)).min(count - 1);
        let old = read_index_entry_at(&mut old_index, ordinal)?;
        let new = read_index_entry_at(&mut new_index, ordinal)?;
        if old.id64 != new.id64 || old.raw_len != new.raw_len {
            bail!("Dictionary repack verification found a changed rich index record.");
        }
        let mut old_compressed = vec![0u8; old.compressed_len as usize];
        old_pack.seek(SeekFrom::Start(old.offset))?;
        old_pack.read_exact(&mut old_compressed)?;
        let old_raw = zstd::bulk::decompress(&old_compressed, old.raw_len as usize)?;
        let mut new_compressed = vec![0u8; new.compressed_len as usize];
        new_pack.seek(SeekFrom::Start(new.offset))?;
        new_pack.read_exact(&mut new_compressed)?;
        let new_raw = decompressor.decompress(&new_compressed, new.raw_len as usize)?;
        if old_raw != new_raw {
            bail!("Dictionary repack verification found a changed rich system payload.");
        }
    }
    Ok(())
}

fn open_source(source: &str) -> Result<Box<dyn BufRead>> {
    let input: Box<dyn Read> = if source.starts_with("http://") || source.starts_with("https://") {
        println!("Downloading {}", source);
        Box::new(reqwest::blocking::get(source)?.error_for_status()?)
    } else {
        Box::new(File::open(source).with_context(|| format!("Cannot open {}", source))?)
    };
    Ok(Box::new(BufReader::with_capacity(
        32 * 1024 * 1024,
        GzDecoder::new(input),
    )))
}

fn clean_json_line(line: &str) -> Option<&str> {
    let mut text = line.trim();
    if text.is_empty() || text == "[" || text == "]" {
        return None;
    }
    if let Some(stripped) = text.strip_suffix(',') {
        text = stripped;
    }
    if text.is_empty() { None } else { Some(text) }
}

fn parse_record(raw: &[u8], line_number: u64) -> Result<PendingRecord> {
    let value: Value = serde_json::from_slice(raw)
        .with_context(|| format!("Malformed galaxy JSON on source line {}", line_number))?;
    let id64 = value
        .get("id64")
        .and_then(value_as_u64)
        .ok_or_else(|| anyhow!("Galaxy source line {} has no valid id64", line_number))?;
    let bodies = value
        .get("bodies")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    let system_stations = value
        .get("stations")
        .and_then(Value::as_array)
        .map(|stations| stations.len() as u32)
        .unwrap_or(0);
    let body_stations = bodies
        .iter()
        .map(|body| {
            body.get("stations")
                .and_then(Value::as_array)
                .map(|stations| stations.len() as u32)
                .unwrap_or(0)
        })
        .sum::<u32>();
    let body_count = value
        .get("bodyCount")
        .and_then(Value::as_u64)
        .map(|count| count.min(u32::MAX as u64) as u32)
        .unwrap_or_else(|| bodies.len().min(u32::MAX as usize) as u32);
    let station_count = system_stations.saturating_add(body_stations);
    let mut flags = 0u32;
    if body_count > 0 || !bodies.is_empty() {
        flags |= FLAG_BODIES;
    }
    if station_count > 0 {
        flags |= FLAG_STATIONS;
    }
    if non_empty_array(&value, "factions") || value.get("controllingFaction").is_some_and(non_null)
    {
        flags |= FLAG_FACTIONS;
    }
    if value.get("population").and_then(Value::as_u64).unwrap_or(0) > 0 {
        flags |= FLAG_POPULATED;
    }
    if non_empty_array(&value, "powers") || value.get("controllingPower").is_some_and(non_null) {
        flags |= FLAG_POWERS;
    }
    if value.get("thargoidWar").is_some_and(non_null) {
        flags |= FLAG_THARGOID_WAR;
    }
    if has_nested_key(&value, bodies, "market") {
        flags |= FLAG_MARKETS;
    }
    if has_nested_key(&value, bodies, "shipyard") {
        flags |= FLAG_SHIPYARDS;
    }
    if has_nested_key(&value, bodies, "outfitting") {
        flags |= FLAG_OUTFITTING;
    }
    if bodies.iter().any(|body| {
        body.get("signals").is_some_and(non_null)
            || non_empty_array(body, "organics")
            || non_empty_array(body, "biology")
    }) {
        flags |= FLAG_SIGNALS;
    }
    if bodies
        .iter()
        .any(|body| body.get("isLandable").and_then(Value::as_bool) == Some(true))
    {
        flags |= FLAG_LANDABLE;
    }
    let mut body_types = 0u32;
    let mut atmosphere_types = 0u32;
    let mut ring_types = 0u32;
    let mut volcanism_types = 0u32;
    for body in bodies {
        body_types |= body_type_mask(body);
        atmosphere_types |= body
            .get("atmosphereType")
            .and_then(Value::as_str)
            .map(atmosphere_mask)
            .unwrap_or(0);
        volcanism_types |= body
            .get("volcanismType")
            .and_then(Value::as_str)
            .map(volcanism_mask)
            .unwrap_or(0);
        if let Some(rings) = body.get("rings").and_then(Value::as_array) {
            for ring in rings {
                ring_types |= ring
                    .get("type")
                    .and_then(Value::as_str)
                    .map(ring_mask)
                    .unwrap_or(0);
            }
        }
    }
    let economy_types = value
        .get("primaryEconomy")
        .and_then(Value::as_str)
        .map(economy_mask)
        .unwrap_or(0)
        | value
            .get("secondaryEconomy")
            .and_then(Value::as_str)
            .map(economy_mask)
            .unwrap_or(0);
    let security_types = value
        .get("security")
        .and_then(Value::as_str)
        .map(security_mask)
        .unwrap_or(0);
    let government_types = value
        .get("government")
        .and_then(Value::as_str)
        .map(government_mask)
        .unwrap_or(0);
    let update_seconds = value
        .get("date")
        .or_else(|| value.get("updateTime"))
        .and_then(Value::as_str)
        .map(parse_update_seconds)
        .unwrap_or(UNKNOWN_UPDATE_SECONDS);

    Ok(PendingRecord {
        id64,
        raw: raw.to_vec(),
        update_seconds,
        body_count,
        station_count,
        flags,
        body_types,
        atmosphere_types,
        ring_types,
        volcanism_types,
        economy_types,
        security_types,
        government_types,
    })
}

fn body_type_mask(body: &Value) -> u32 {
    let subtype = body
        .get("subType")
        .or_else(|| body.get("type"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    let mut mask = match subtype.as_str() {
        "earth-like world" => BODY_EARTH_LIKE,
        "water world" => BODY_WATER_WORLD,
        "ammonia world" => BODY_AMMONIA_WORLD,
        "icy body" => BODY_ICY,
        "rocky ice world" => BODY_ROCKY_ICE,
        "high metal content world" => BODY_HIGH_METAL,
        "metal-rich body" => BODY_METAL_RICH,
        "gas giant with water-based life" => BODY_GAS_WATER_LIFE,
        "gas giant with ammonia-based life" => BODY_GAS_AMMONIA_LIFE,
        "water giant" => BODY_WATER_GIANT,
        _ => 0,
    };
    let terraforming = body
        .get("terraformingState")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    if terraforming.contains("terraform") && !terraforming.contains("not terraform") {
        mask |= BODY_TERRAFORMABLE;
    }
    mask
}

fn atmosphere_mask(value: &str) -> u32 {
    let text = value.to_ascii_lowercase();
    let mut mask = 0u32;
    if text.contains("thin") && text.contains("ammonia") {
        mask |= ATMOS_THIN_AMMONIA;
    }
    for (needle, flag) in [
        ("ammonia", ATMOS_AMMONIA),
        ("water", ATMOS_WATER),
        ("oxygen", ATMOS_OXYGEN),
        ("carbon dioxide", ATMOS_CARBON_DIOXIDE),
        ("methane", ATMOS_METHANE),
        ("nitrogen", ATMOS_NITROGEN),
        ("sulphur dioxide", ATMOS_SULPHUR_DIOXIDE),
        ("silicate", ATMOS_SILICATE),
        ("helium", ATMOS_HELIUM),
        ("neon", ATMOS_NEON),
        ("argon", ATMOS_ARGON),
        ("thin", ATMOS_THIN),
        ("thick", ATMOS_THICK),
        ("hot", ATMOS_HOT),
        ("suitable for water-based life", ATMOS_WATER_LIFE),
    ] {
        if text.contains(needle) {
            mask |= flag;
        }
    }
    mask
}

fn ring_mask(value: &str) -> u32 {
    match value.to_ascii_lowercase().as_str() {
        "icy" => RING_ICY,
        "rocky" => RING_ROCKY,
        "metal rich" => RING_METAL_RICH,
        "metallic" => RING_METALLIC,
        _ => 0,
    }
}

fn volcanism_mask(value: &str) -> u32 {
    let text = value.to_ascii_lowercase();
    let mut mask = 0u32;
    for (needle, flag) in [
        ("silicate", VOLCANISM_SILICATE),
        ("metallic", VOLCANISM_METALLIC),
        ("rocky", VOLCANISM_ROCKY),
        ("water", VOLCANISM_WATER),
        ("carbon dioxide", VOLCANISM_CARBON_DIOXIDE),
        ("nitrogen", VOLCANISM_NITROGEN),
        ("methane", VOLCANISM_METHANE),
        ("ammonia", VOLCANISM_AMMONIA),
        ("major", VOLCANISM_MAJOR),
        ("minor", VOLCANISM_MINOR),
    ] {
        if text.contains(needle) {
            mask |= flag;
        }
    }
    mask
}

fn economy_mask(value: &str) -> u32 {
    match value.to_ascii_lowercase().as_str() {
        "" | "none" => 0,
        "extraction" => ECONOMY_EXTRACTION,
        "refinery" => ECONOMY_REFINERY,
        "industrial" => ECONOMY_INDUSTRIAL,
        "agriculture" => ECONOMY_AGRICULTURE,
        "high tech" => ECONOMY_HIGH_TECH,
        "military" => ECONOMY_MILITARY,
        "tourism" => ECONOMY_TOURISM,
        "service" => ECONOMY_SERVICE,
        "colony" => ECONOMY_COLONY,
        _ => ECONOMY_OTHER,
    }
}

fn security_mask(value: &str) -> u32 {
    match value.to_ascii_lowercase().as_str() {
        "anarchy" => SECURITY_ANARCHY,
        "low" => SECURITY_LOW,
        "medium" => SECURITY_MEDIUM,
        "high" => SECURITY_HIGH,
        _ => 0,
    }
}

fn government_mask(value: &str) -> u32 {
    match value.to_ascii_lowercase().as_str() {
        "" | "none" => 0,
        "anarchy" => GOVERNMENT_ANARCHY,
        "communism" => GOVERNMENT_COMMUNISM,
        "confederacy" => GOVERNMENT_CONFEDERACY,
        "cooperative" => GOVERNMENT_COOPERATIVE,
        "corporate" => GOVERNMENT_CORPORATE,
        "democracy" => GOVERNMENT_DEMOCRACY,
        "dictatorship" => GOVERNMENT_DICTATORSHIP,
        "feudal" => GOVERNMENT_FEUDAL,
        "patronage" => GOVERNMENT_PATRONAGE,
        "theocracy" => GOVERNMENT_THEOCRACY,
        _ => GOVERNMENT_OTHER,
    }
}

fn has_nested_key(system: &Value, bodies: &[Value], key: &str) -> bool {
    let system_has = system
        .get("stations")
        .and_then(Value::as_array)
        .is_some_and(|stations| {
            stations
                .iter()
                .any(|station| station.get(key).is_some_and(non_null))
        });
    system_has
        || bodies.iter().any(|body| {
            body.get("stations")
                .and_then(Value::as_array)
                .is_some_and(|stations| {
                    stations
                        .iter()
                        .any(|station| station.get(key).is_some_and(non_null))
                })
        })
}

fn non_empty_array(value: &Value, key: &str) -> bool {
    value
        .get(key)
        .and_then(Value::as_array)
        .is_some_and(|items| !items.is_empty())
}

fn non_null(value: &Value) -> bool {
    !value.is_null()
}

fn value_as_u64(value: &Value) -> Option<u64> {
    match value {
        Value::Number(number) => number.as_u64(),
        Value::String(text) => text.parse().ok(),
        _ => None,
    }
}

fn compress_batch(
    pool: &rayon::ThreadPool,
    writer: &mut BufWriter<File>,
    entries: &mut Vec<IndexEntry>,
    offset: &mut u64,
    batch: &mut Vec<PendingRecord>,
    compression_level: i32,
    dictionary: Option<&[u8]>,
) -> Result<()> {
    let compressed = compress_records(pool, batch.iter().map(|record| record.raw.as_slice()).collect(), compression_level, dictionary)?;
    for (record, compressed) in batch.iter().zip(compressed) {
        let compressed_len = u32::try_from(compressed.len())
            .context("One compressed galaxy record exceeded 4 GiB")?;
        let raw_len =
            u32::try_from(record.raw.len()).context("One galaxy record exceeded 4 GiB")?;
        writer.write_all(&compressed)?;
        entries.push(IndexEntry {
            id64: record.id64,
            offset: *offset,
            compressed_len,
            raw_len,
            update_seconds: record.update_seconds,
            body_count: record.body_count,
            station_count: record.station_count,
            flags: record.flags,
            body_types: record.body_types,
            atmosphere_types: record.atmosphere_types,
            ring_types: record.ring_types,
            volcanism_types: record.volcanism_types,
            economy_types: record.economy_types,
            security_types: record.security_types,
            government_types: record.government_types,
        });
        *offset += compressed.len() as u64;
    }
    batch.clear();
    Ok(())
}

fn compress_records(
    pool: &rayon::ThreadPool,
    records: Vec<&[u8]>,
    compression_level: i32,
    dictionary: Option<&[u8]>,
) -> Result<Vec<Vec<u8>>> {
    let compressed = pool.install(|| match dictionary {
        Some(dictionary) => records
            .par_iter()
            .map_init(
                || zstd::bulk::Compressor::with_dictionary(compression_level, dictionary),
                |compressor, record| {
                    compressor
                        .as_mut()
                        .map_err(|error| anyhow!("Could not create rich galaxy dictionary compressor: {error}"))?
                        .compress(record)
                        .context("Could not compress rich galaxy record")
                },
            )
            .collect::<Vec<_>>(),
        None => records
            .par_iter()
            .map(|record| {
                zstd::bulk::compress(record, compression_level)
                    .context("Could not compress rich galaxy record")
            })
            .collect::<Vec<_>>(),
    });
    compressed.into_iter().collect()
}

fn deduplicate_entries(entries: &mut Vec<IndexEntry>) -> usize {
    if entries.is_empty() {
        return 0;
    }
    let mut write = 0usize;
    for read in 0..entries.len() {
        let candidate = entries[read];
        if write > 0 && entries[write - 1].id64 == candidate.id64 {
            if update_rank(&candidate) >= update_rank(&entries[write - 1]) {
                entries[write - 1] = candidate;
            }
        } else {
            entries[write] = candidate;
            write += 1;
        }
    }
    entries.truncate(write);
    write
}

fn update_rank(entry: &IndexEntry) -> u64 {
    if entry.update_seconds == UNKNOWN_UPDATE_SECONDS {
        0
    } else {
        entry.update_seconds as u64 + 1
    }
}

fn write_data_header(writer: &mut BufWriter<File>) -> Result<()> {
    writer.write_all(DATA_MAGIC)?;
    writer.write_all(&FORMAT_VERSION.to_le_bytes())?;
    writer.write_all(&0u32.to_le_bytes())?;
    Ok(())
}

fn write_index(path: &Path, entries: &[IndexEntry]) -> Result<()> {
    let mut writer = BufWriter::with_capacity(32 * 1024 * 1024, File::create(path)?);
    writer.write_all(INDEX_MAGIC)?;
    writer.write_all(&FORMAT_VERSION.to_le_bytes())?;
    writer.write_all(&INDEX_RECORD_BYTES.to_le_bytes())?;
    writer.write_all(&(entries.len() as u64).to_le_bytes())?;
    writer.write_all(&0u64.to_le_bytes())?;
    for entry in entries {
        writer.write_all(&entry.id64.to_le_bytes())?;
        writer.write_all(&entry.offset.to_le_bytes())?;
        writer.write_all(&entry.compressed_len.to_le_bytes())?;
        writer.write_all(&entry.raw_len.to_le_bytes())?;
        writer.write_all(&entry.update_seconds.to_le_bytes())?;
        writer.write_all(&entry.body_count.to_le_bytes())?;
        writer.write_all(&entry.station_count.to_le_bytes())?;
        writer.write_all(&entry.flags.to_le_bytes())?;
        writer.write_all(&entry.body_types.to_le_bytes())?;
        writer.write_all(&entry.atmosphere_types.to_le_bytes())?;
        writer.write_all(&entry.ring_types.to_le_bytes())?;
        writer.write_all(&entry.volcanism_types.to_le_bytes())?;
        writer.write_all(&entry.economy_types.to_le_bytes())?;
        writer.write_all(&entry.security_types.to_le_bytes())?;
        writer.write_all(&entry.government_types.to_le_bytes())?;
    }
    writer.flush()?;
    Ok(())
}

fn read_index_header(reader: &mut BufReader<File>, path: &Path) -> Result<(u32, u64)> {
    let mut magic = [0u8; 8];
    reader.read_exact(&mut magic)?;
    if &magic != INDEX_MAGIC {
        bail!("Invalid rich index magic in {}", path.display());
    }
    let mut u32_bytes = [0u8; 4];
    reader.read_exact(&mut u32_bytes)?;
    let version = u32::from_le_bytes(u32_bytes);
    reader.read_exact(&mut u32_bytes)?;
    let record_bytes = u32::from_le_bytes(u32_bytes);
    let mut u64_bytes = [0u8; 8];
    reader.read_exact(&mut u64_bytes)?;
    let count = u64::from_le_bytes(u64_bytes);
    reader.read_exact(&mut u64_bytes)?;
    if version != FORMAT_VERSION || record_bytes != INDEX_RECORD_BYTES {
        bail!("Unsupported rich index format in {}", path.display());
    }
    Ok((record_bytes, count))
}

fn read_index_entry(record: &[u8]) -> IndexEntry {
    IndexEntry {
        id64: u64::from_le_bytes(record[0..8].try_into().unwrap()),
        offset: u64::from_le_bytes(record[8..16].try_into().unwrap()),
        compressed_len: u32::from_le_bytes(record[16..20].try_into().unwrap()),
        raw_len: u32::from_le_bytes(record[20..24].try_into().unwrap()),
        update_seconds: u32::from_le_bytes(record[24..28].try_into().unwrap()),
        body_count: u32::from_le_bytes(record[28..32].try_into().unwrap()),
        station_count: u32::from_le_bytes(record[32..36].try_into().unwrap()),
        flags: u32::from_le_bytes(record[36..40].try_into().unwrap()),
        body_types: u32::from_le_bytes(record[40..44].try_into().unwrap()),
        atmosphere_types: u32::from_le_bytes(record[44..48].try_into().unwrap()),
        ring_types: u32::from_le_bytes(record[48..52].try_into().unwrap()),
        volcanism_types: u32::from_le_bytes(record[52..56].try_into().unwrap()),
        economy_types: u32::from_le_bytes(record[56..60].try_into().unwrap()),
        security_types: u32::from_le_bytes(record[60..64].try_into().unwrap()),
        government_types: u32::from_le_bytes(record[64..68].try_into().unwrap()),
    }
}

fn filter_summary(entry: IndexEntry) -> FilterSummary {
    FilterSummary {
        flags: entry.flags | FLAG_RICH_DATA,
        body_count: entry.body_count,
        station_count: entry.station_count,
        body_types: entry.body_types,
        atmosphere_types: entry.atmosphere_types,
        ring_types: entry.ring_types,
        volcanism_types: entry.volcanism_types,
        economy_types: entry.economy_types,
        security_types: entry.security_types,
        government_types: entry.government_types,
    }
}

fn build_map_filter_files(
    data_dir: &Path,
    rich_dir: &Path,
    entries: &[IndexEntry],
) -> Result<Option<MapFilterManifest>> {
    let mut summaries = FxHashMap::default();
    summaries
        .try_reserve(entries.len())
        .context("Not enough memory to allocate rich map summaries")?;
    for entry in entries {
        summaries.insert(entry.id64, filter_summary(*entry));
    }
    build_map_filter_files_from_summaries(data_dir, rich_dir, &summaries)
}

fn build_map_filter_files_from_manifest(
    data_dir: &Path,
    rich_dir: &Path,
    manifest: &Manifest,
) -> Result<Option<MapFilterManifest>> {
    let total_count = manifest
        .segments
        .iter()
        .map(|segment| segment.count as usize)
        .sum::<usize>();
    println!(
        "Building in-memory rich summaries from {} galaxy segment(s)...",
        format_count(manifest.segments.len() as u64)
    );
    let mut summaries = FxHashMap::default();
    summaries
        .try_reserve(total_count)
        .context("Not enough memory to allocate rich map summaries")?;
    for segment in manifest.segments.iter().rev() {
        let path = rich_dir.join(&segment.index_file);
        let mut reader = BufReader::with_capacity(32 * 1024 * 1024, File::open(&path)?);
        let (record_bytes, count) = read_index_header(&mut reader, &path)?;
        let mut record = vec![0u8; record_bytes as usize];
        for index in 0..count {
            reader.read_exact(&mut record)?;
            let entry = read_index_entry(&record);
            summaries.insert(entry.id64, filter_summary(entry));
            if (index + 1) % 10_000_000 == 0 {
                println!(
                    "Loaded {} summaries from {}...",
                    format_count(index + 1),
                    segment.index_file
                );
            }
        }
    }
    build_map_filter_files_from_summaries(data_dir, rich_dir, &summaries)
}

fn build_map_filter_files_from_summaries(
    data_dir: &Path,
    rich_dir: &Path,
    summaries: &FxHashMap<u64, FilterSummary>,
) -> Result<Option<MapFilterManifest>> {
    let systems_path = data_dir.join("systems.bin");
    if !systems_path.exists() {
        println!(
            "Skipping map filter sidecars because {} does not exist.",
            systems_path.display()
        );
        return Ok(None);
    }
    let available_lods = LOD_FILES
        .iter()
        .filter(|(_, filename)| data_dir.join(filename).exists())
        .copied()
        .collect::<Vec<_>>();
    if available_lods.is_empty() {
        println!("Skipping map filter sidecars because no LOD files were found.");
        return Ok(None);
    }

    println!(
        "Building in-memory rich summaries for {} ID64 values...",
        format_count(summaries.len() as u64)
    );

    let temp_tag = format!(".{}.tmp", Utc::now().timestamp_millis());
    let mut lods = Vec::with_capacity(available_lods.len());
    for (level, source_name) in available_lods {
        let final_path = rich_dir.join(format!("systems-lod-{level}-rich.bin"));
        let temp_path = PathBuf::from(format!("{}{}", final_path.display(), temp_tag));
        let mut state = FilterLodWriter {
            level,
            reader: BufReader::with_capacity(
                8 * 1024 * 1024,
                File::open(data_dir.join(source_name))?,
            ),
            writer: BufWriter::with_capacity(8 * 1024 * 1024, File::create(&temp_path)?),
            final_path,
            temp_path,
            next_index: None,
            count: 0,
        };
        advance_lod(&mut state)?;
        lods.push(state);
    }

    let result = (|| -> Result<()> {
        let mut systems = BufReader::with_capacity(32 * 1024 * 1024, File::open(&systems_path)?);
        let mut record = [0u8; SYSTEM_RECORD_BYTES];
        let mut system_index = 0u32;
        loop {
            match systems.read_exact(&mut record) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => break,
                Err(error) => return Err(error.into()),
            }
            let id64 = u64::from_le_bytes(record[24..32].try_into().unwrap());
            let summary = summaries.get(&id64).copied().unwrap_or_default();
            for lod in &mut lods {
                if lod.next_index == Some(system_index) {
                    write_filter_summary(&mut lod.writer, summary)?;
                    lod.count += 1;
                    advance_lod(lod)?;
                } else if lod.next_index.is_some_and(|index| index < system_index) {
                    bail!(
                        "LOD {} record indexes are not sorted at system {}.",
                        lod.level,
                        system_index
                    );
                }
            }
            system_index = system_index
                .checked_add(1)
                .ok_or_else(|| anyhow!("System index exceeded u32"))?;
            if system_index % 10_000_000 == 0 {
                println!(
                    "Matched rich filters across {} map systems...",
                    format_count(system_index as u64)
                );
            }
        }
        for lod in &mut lods {
            if lod.next_index.is_some() {
                bail!("LOD {} contains an out-of-range system index.", lod.level);
            }
            lod.writer.flush()?;
        }
        Ok(())
    })();

    if let Err(error) = result {
        for lod in lods {
            let _ = fs::remove_file(lod.temp_path);
        }
        return Err(error);
    }

    let levels = lods
        .iter()
        .map(|lod| MapFilterLod {
            level: lod.level,
            file: lod
                .final_path
                .file_name()
                .unwrap()
                .to_string_lossy()
                .to_string(),
            count: lod.count,
        })
        .collect::<Vec<_>>();
    for lod in lods {
        replace_file(&lod.temp_path, &lod.final_path)?;
    }
    Ok(Some(MapFilterManifest {
        generated_at: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        record_bytes: FILTER_RECORD_BYTES,
        flags: serde_json::json!({
            "bodies": FLAG_BODIES,
            "stations": FLAG_STATIONS,
            "factions": FLAG_FACTIONS,
            "populated": FLAG_POPULATED,
            "powers": FLAG_POWERS,
            "thargoidWar": FLAG_THARGOID_WAR,
            "markets": FLAG_MARKETS,
            "shipyards": FLAG_SHIPYARDS,
            "outfitting": FLAG_OUTFITTING,
            "signals": FLAG_SIGNALS,
            "landable": FLAG_LANDABLE,
            "richData": FLAG_RICH_DATA,
        }),
        categories: category_manifest(),
        lod_levels: levels,
    }))
}

fn advance_lod(lod: &mut FilterLodWriter) -> Result<()> {
    let mut point = [0u8; LOD_RECORD_BYTES];
    match lod.reader.read_exact(&mut point) {
        Ok(()) => {
            lod.next_index = Some(u32::from_le_bytes(point[16..20].try_into().unwrap()));
            Ok(())
        }
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => {
            lod.next_index = None;
            Ok(())
        }
        Err(error) => Err(error.into()),
    }
}

fn write_filter_summary(writer: &mut BufWriter<File>, summary: FilterSummary) -> Result<()> {
    writer.write_all(&summary.flags.to_le_bytes())?;
    writer.write_all(&summary.body_count.to_le_bytes())?;
    writer.write_all(&summary.station_count.to_le_bytes())?;
    writer.write_all(&summary.body_types.to_le_bytes())?;
    writer.write_all(&summary.atmosphere_types.to_le_bytes())?;
    writer.write_all(&summary.ring_types.to_le_bytes())?;
    writer.write_all(&summary.volcanism_types.to_le_bytes())?;
    writer.write_all(&summary.economy_types.to_le_bytes())?;
    writer.write_all(&summary.security_types.to_le_bytes())?;
    writer.write_all(&summary.government_types.to_le_bytes())?;
    Ok(())
}

fn category_manifest() -> Value {
    serde_json::json!({
        "body": {
            "earthLike": BODY_EARTH_LIKE,
            "waterWorld": BODY_WATER_WORLD,
            "ammoniaWorld": BODY_AMMONIA_WORLD,
            "icyBody": BODY_ICY,
            "rockyIce": BODY_ROCKY_ICE,
            "highMetal": BODY_HIGH_METAL,
            "metalRich": BODY_METAL_RICH,
            "gasWaterLife": BODY_GAS_WATER_LIFE,
            "gasAmmoniaLife": BODY_GAS_AMMONIA_LIFE,
            "waterGiant": BODY_WATER_GIANT,
            "terraformable": BODY_TERRAFORMABLE,
        },
        "atmosphere": {
            "thinAmmonia": ATMOS_THIN_AMMONIA,
            "ammonia": ATMOS_AMMONIA,
            "water": ATMOS_WATER,
            "oxygen": ATMOS_OXYGEN,
            "carbonDioxide": ATMOS_CARBON_DIOXIDE,
            "methane": ATMOS_METHANE,
            "nitrogen": ATMOS_NITROGEN,
            "sulphurDioxide": ATMOS_SULPHUR_DIOXIDE,
            "silicate": ATMOS_SILICATE,
            "helium": ATMOS_HELIUM,
            "neon": ATMOS_NEON,
            "argon": ATMOS_ARGON,
            "thin": ATMOS_THIN,
            "thick": ATMOS_THICK,
            "hot": ATMOS_HOT,
            "waterLife": ATMOS_WATER_LIFE,
        },
        "ring": {
            "icy": RING_ICY,
            "rocky": RING_ROCKY,
            "metalRich": RING_METAL_RICH,
            "metallic": RING_METALLIC,
        },
        "volcanism": {
            "silicate": VOLCANISM_SILICATE,
            "metallic": VOLCANISM_METALLIC,
            "rocky": VOLCANISM_ROCKY,
            "water": VOLCANISM_WATER,
            "carbonDioxide": VOLCANISM_CARBON_DIOXIDE,
            "nitrogen": VOLCANISM_NITROGEN,
            "methane": VOLCANISM_METHANE,
            "ammonia": VOLCANISM_AMMONIA,
            "major": VOLCANISM_MAJOR,
            "minor": VOLCANISM_MINOR,
        },
        "economy": {
            "extraction": ECONOMY_EXTRACTION,
            "refinery": ECONOMY_REFINERY,
            "industrial": ECONOMY_INDUSTRIAL,
            "agriculture": ECONOMY_AGRICULTURE,
            "highTech": ECONOMY_HIGH_TECH,
            "military": ECONOMY_MILITARY,
            "tourism": ECONOMY_TOURISM,
            "service": ECONOMY_SERVICE,
            "colony": ECONOMY_COLONY,
            "other": ECONOMY_OTHER,
        },
        "security": {
            "anarchy": SECURITY_ANARCHY,
            "low": SECURITY_LOW,
            "medium": SECURITY_MEDIUM,
            "high": SECURITY_HIGH,
        },
        "government": {
            "anarchy": GOVERNMENT_ANARCHY,
            "communism": GOVERNMENT_COMMUNISM,
            "confederacy": GOVERNMENT_CONFEDERACY,
            "cooperative": GOVERNMENT_COOPERATIVE,
            "corporate": GOVERNMENT_CORPORATE,
            "democracy": GOVERNMENT_DEMOCRACY,
            "dictatorship": GOVERNMENT_DICTATORSHIP,
            "feudal": GOVERNMENT_FEUDAL,
            "patronage": GOVERNMENT_PATRONAGE,
            "theocracy": GOVERNMENT_THEOCRACY,
            "other": GOVERNMENT_OTHER,
        },
    })
}

fn summarize_entries(entries: &[IndexEntry]) -> (SegmentSummary, u32, u32) {
    let mut summary = SegmentSummary::default();
    let mut min_update = UNKNOWN_UPDATE_SECONDS;
    let mut max_update = 0u32;
    for entry in entries {
        summary.body_count += entry.body_count as u64;
        summary.station_count += entry.station_count as u64;
        summary.systems_with_bodies += u64::from(entry.flags & FLAG_BODIES != 0);
        summary.systems_with_stations += u64::from(entry.flags & FLAG_STATIONS != 0);
        summary.systems_with_factions += u64::from(entry.flags & FLAG_FACTIONS != 0);
        summary.populated_systems += u64::from(entry.flags & FLAG_POPULATED != 0);
        summary.systems_with_powers += u64::from(entry.flags & FLAG_POWERS != 0);
        summary.systems_with_thargoid_war += u64::from(entry.flags & FLAG_THARGOID_WAR != 0);
        summary.systems_with_markets += u64::from(entry.flags & FLAG_MARKETS != 0);
        summary.systems_with_shipyards += u64::from(entry.flags & FLAG_SHIPYARDS != 0);
        summary.systems_with_outfitting += u64::from(entry.flags & FLAG_OUTFITTING != 0);
        summary.systems_with_signals += u64::from(entry.flags & FLAG_SIGNALS != 0);
        if entry.update_seconds != UNKNOWN_UPDATE_SECONDS {
            min_update = min_update.min(entry.update_seconds);
            max_update = max_update.max(entry.update_seconds);
        }
    }
    (summary, min_update, max_update)
}

fn write_manifest(path: &Path, manifest: &Manifest) -> Result<()> {
    let temp = PathBuf::from(format!("{}.tmp", path.display()));
    serde_json::to_writer_pretty(File::create(&temp)?, manifest)?;
    replace_file(&temp, path)
}

fn replace_file(temp: &Path, final_path: &Path) -> Result<()> {
    if final_path.exists() {
        fs::remove_file(final_path)?;
    }
    fs::rename(temp, final_path)?;
    Ok(())
}

fn parse_update_seconds(value: &str) -> u32 {
    let mut normalized = value.replace(' ', "T");
    if let Some(prefix) = normalized.strip_suffix("+00:00") {
        normalized = format!("{prefix}Z");
    } else if let Some(prefix) = normalized.strip_suffix("+00") {
        normalized = format!("{prefix}Z");
    }
    let Ok(date) = DateTime::parse_from_rfc3339(&normalized) else {
        return UNKNOWN_UPDATE_SECONDS;
    };
    let epoch = NaiveDate::from_ymd_opt(2000, 1, 1)
        .unwrap()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc();
    date.with_timezone(&Utc)
        .signed_duration_since(epoch)
        .num_seconds()
        .clamp(0, UNKNOWN_UPDATE_SECONDS as i64 - 1) as u32
}

fn seconds_to_iso(seconds: u32) -> Option<String> {
    if seconds == UNKNOWN_UPDATE_SECONDS || seconds == 0 {
        return None;
    }
    let epoch = NaiveDate::from_ymd_opt(2000, 1, 1)
        .unwrap()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc();
    Some(
        (epoch + chrono::Duration::seconds(seconds as i64))
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    )
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

    fn entry(id64: u64, update_seconds: u32, body_count: u32) -> IndexEntry {
        IndexEntry {
            id64,
            offset: 0,
            compressed_len: 0,
            raw_len: 0,
            update_seconds,
            body_count,
            station_count: 0,
            flags: FLAG_BODIES,
            body_types: 0,
            atmosphere_types: 0,
            ring_types: 0,
            volcanism_types: 0,
            economy_types: 0,
            security_types: 0,
            government_types: 0,
        }
    }

    #[test]
    fn deduplication_keeps_the_newest_known_record() {
        let mut entries = vec![
            entry(42, UNKNOWN_UPDATE_SECONDS, 1),
            entry(42, 10, 2),
            entry(42, 20, 3),
            entry(99, 15, 1),
        ];
        entries.sort_unstable_by_key(|item| (item.id64, update_rank(item)));
        assert_eq!(deduplicate_entries(&mut entries), 2);
        assert_eq!(entries[0].id64, 42);
        assert_eq!(entries[0].body_count, 3);
        assert_eq!(entries[1].id64, 99);
    }

    #[test]
    fn parses_full_record_summary_without_changing_json() {
        let raw = br#"{"id64":18446744073709551615,"name":"Test","date":"2026-01-01T00:00:00+00:00","population":10,"security":"High","primaryEconomy":"High Tech","government":"Democracy","bodyCount":1,"bodies":[{"id64":2,"subType":"Water world","atmosphereType":"Thin Ammonia","volcanismType":"Major Water Geysers","rings":[{"type":"Icy"}],"terraformingState":"Terraformable","stations":[{"name":"Port","market":{"commodities":[]}}]}],"factions":[{"name":"Faction"}]}"#;
        let record = parse_record(raw, 1).unwrap();
        assert_eq!(record.id64, u64::MAX);
        assert_eq!(record.raw, raw);
        assert_eq!(record.body_count, 1);
        assert_eq!(record.station_count, 1);
        assert_ne!(record.flags & FLAG_MARKETS, 0);
        assert_ne!(record.flags & FLAG_FACTIONS, 0);
        assert_ne!(record.flags & FLAG_POPULATED, 0);
        assert_ne!(record.body_types & BODY_WATER_WORLD, 0);
        assert_ne!(record.body_types & BODY_TERRAFORMABLE, 0);
        assert_ne!(record.atmosphere_types & ATMOS_THIN_AMMONIA, 0);
        assert_ne!(record.ring_types & RING_ICY, 0);
        assert_ne!(record.volcanism_types & VOLCANISM_WATER, 0);
        assert_ne!(record.economy_types & ECONOMY_HIGH_TECH, 0);
        assert_ne!(record.security_types & SECURITY_HIGH, 0);
        assert_ne!(record.government_types & GOVERNMENT_DEMOCRACY, 0);
        assert_ne!(record.update_seconds, UNKNOWN_UPDATE_SECONDS);
    }

    #[test]
    fn repack_rewrites_a_small_base_pack_with_a_dictionary() {
        let root = std::env::temp_dir().join(format!(
            "edss-rich-repack-test-{}-{}",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap()
        ));
        let galaxy_dir = root.join("galaxy");
        fs::create_dir_all(&galaxy_dir).unwrap();
        let pack_path = galaxy_dir.join("base.pack");
        let index_path = galaxy_dir.join("base.idx");
        let mut pack = BufWriter::new(File::create(&pack_path).unwrap());
        write_data_header(&mut pack).unwrap();
        let mut offset = DATA_HEADER_BYTES;
        let mut entries = Vec::new();
        let mut expected = FxHashMap::default();
        for item in 0..512u64 {
            let id64 = 50_000 - item * 17;
            let raw = format!(
                "{{\"id64\":{id64},\"name\":\"Synthetic {item}\",\"bodies\":[{{\"name\":\"Synthetic {item} A\",\"subType\":\"Rocky body\",\"atmosphereType\":\"Thin nitrogen atmosphere\"}}],\"padding\":\"{}\"}}",
                "repeated rich galaxy dictionary training data ".repeat(80)
            ).into_bytes();
            let compressed = zstd::bulk::compress(&raw, 3).unwrap();
            pack.write_all(&compressed).unwrap();
            entries.push(IndexEntry {
                id64,
                offset,
                compressed_len: compressed.len() as u32,
                raw_len: raw.len() as u32,
                update_seconds: item as u32,
                body_count: 1,
                station_count: 0,
                flags: FLAG_BODIES,
                body_types: 0,
                atmosphere_types: 0,
                ring_types: 0,
                volcanism_types: 0,
                economy_types: 0,
                security_types: 0,
                government_types: 0,
            });
            expected.insert(id64, raw);
            offset += compressed.len() as u64;
        }
        pack.flush().unwrap();
        entries.sort_unstable_by_key(|entry| entry.id64);
        write_index(&index_path, &entries).unwrap();
        let manifest = Manifest {
            format_version: FORMAT_VERSION,
            schema_url: SCHEMA_URL.to_string(),
            updated_at: Utc::now().to_rfc3339(),
            index_header_bytes: INDEX_HEADER_BYTES,
            index_record_bytes: INDEX_RECORD_BYTES,
            data_header_bytes: DATA_HEADER_BYTES,
            map_filters: None,
            segments: vec![ManifestSegment {
                kind: "base".to_string(),
                source_path: "synthetic".to_string(),
                imported_at: Utc::now().to_rfc3339(),
                data_file: "base.pack".to_string(),
                index_file: "base.idx".to_string(),
                count: entries.len() as u64,
                input_count: entries.len() as u64,
                duplicate_count: 0,
                data_bytes: fs::metadata(&pack_path).unwrap().len(),
                index_bytes: fs::metadata(&index_path).unwrap().len(),
                compression: "zstd".to_string(),
                compression_level: 3,
                dictionary: None,
                min_update_time: None,
                max_update_time: None,
                summary: Value::Null,
            }],
        };
        write_manifest(&galaxy_dir.join("manifest.json"), &manifest).unwrap();
        repack(RichRepackConfig { data_dir: &root, threads: 2, compression_level: 3, batch_size: 32 }).unwrap();
        let manifest: Manifest = serde_json::from_reader(File::open(galaxy_dir.join("manifest.json")).unwrap()).unwrap();
        let segment = &manifest.segments[0];
        let (_, dictionary_descriptor) = dictionary_from_manifest(&galaxy_dir, Some(&manifest)).unwrap().unwrap();
        assert_eq!(segment.dictionary.as_ref().unwrap().dict_id, dictionary_descriptor.dict_id);
        assert!(!pack_path.exists());
        let (dictionary, _) = dictionary_from_manifest(&galaxy_dir, Some(&manifest)).unwrap().unwrap();
        let mut index = BufReader::new(File::open(galaxy_dir.join(&segment.index_file)).unwrap());
        let (_, count) = read_index_header(&mut index, &galaxy_dir.join(&segment.index_file)).unwrap();
        assert_eq!(count, 512);
        let mut record = [0u8; INDEX_RECORD_BYTES as usize];
        index.read_exact(&mut record).unwrap();
        let entry = read_index_entry(&record);
        let mut pack = BufReader::new(File::open(galaxy_dir.join(&segment.data_file)).unwrap());
        validate_data_header(&mut pack, &galaxy_dir.join(&segment.data_file)).unwrap();
        pack.seek(SeekFrom::Start(entry.offset)).unwrap();
        let mut compressed = vec![0u8; entry.compressed_len as usize];
        pack.read_exact(&mut compressed).unwrap();
        let raw = zstd::bulk::Decompressor::with_dictionary(&dictionary).unwrap()
            .decompress(&compressed, entry.raw_len as usize).unwrap();
        assert_eq!(raw, expected[&entry.id64]);
        fs::remove_dir_all(root).unwrap();
    }
}
