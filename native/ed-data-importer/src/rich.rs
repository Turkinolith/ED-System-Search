use anyhow::{Context, Result, anyhow, bail};
use chrono::{DateTime, NaiveDate, Utc};
use flate2::read::GzDecoder;
use rayon::prelude::*;
use rustc_hash::FxHashMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{self, File};
use std::io::{self, BufRead, BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

const FORMAT_VERSION: u32 = 1;
const DATA_MAGIC: &[u8; 8] = b"EDGRDAT1";
const INDEX_MAGIC: &[u8; 8] = b"EDGRIDX1";
const DATA_HEADER_BYTES: u64 = 16;
const INDEX_HEADER_BYTES: u64 = 32;
const INDEX_RECORD_BYTES: u32 = 68;
const FILTER_RECORD_BYTES: u32 = 40;
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
    min_update_time: Option<String>,
    #[serde(default)]
    max_update_time: Option<String>,
    #[serde(default)]
    summary: Value,
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
        .flat_map(|segment| [&segment.data_file, &segment.index_file])
        .collect::<std::collections::HashSet<_>>();
    for filename in previous
        .segments
        .iter()
        .flat_map(|segment| [&segment.data_file, &segment.index_file])
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
) -> Result<()> {
    let compressed = pool.install(|| {
        batch
            .par_iter()
            .map(|record| {
                zstd::bulk::compress(&record.raw, compression_level)
                    .context("Could not compress rich galaxy record")
            })
            .collect::<Vec<_>>()
    });
    for (record, compressed) in batch.iter().zip(compressed) {
        let compressed = compressed?;
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

fn build_map_filter_files(
    data_dir: &Path,
    rich_dir: &Path,
    entries: &[IndexEntry],
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
        format_count(entries.len() as u64)
    );
    let mut summaries = FxHashMap::default();
    summaries
        .try_reserve(entries.len())
        .context("Not enough memory to allocate rich map summaries")?;
    for entry in entries {
        summaries.insert(
            entry.id64,
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
            },
        );
    }

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
}
