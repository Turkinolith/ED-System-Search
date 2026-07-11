use anyhow::{Context, Result, bail};
use rayon::prelude::*;
use rustc_hash::FxHashMap;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::time::Instant;

const DATA_MAGIC: &[u8; 8] = b"EDGRDAT1";
const INDEX_MAGIC: &[u8; 8] = b"EDGRIDX1";
const DATA_HEADER_BYTES: u64 = 16;
const INDEX_HEADER_BYTES: u64 = 32;
const INDEX_RECORD_BYTES: usize = 68;
const TARGET_TEMPERATURE_K: f64 = 158.0;
const TEMPERATURE_EPSILON_K: f64 = 0.0005;

pub(crate) struct GreenGasGiantConfig<'a> {
    pub data_dir: &'a Path,
    pub threads: usize,
    pub batch_size: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest { updated_at: String, segments: Vec<Segment> }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Segment { kind: String, data_file: String, index_file: String }

#[derive(Clone, Copy)]
struct Entry { id64: u64, offset: u64, compressed_len: u32, raw_len: u32 }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlacesPayload { #[serde(default)] source_url: Option<String>, #[serde(default)] places: Vec<Poi> }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Poi { #[serde(default)] name: Option<String>, #[serde(default)] system_name: Option<String>, #[serde(default)] r#type: Option<String>, #[serde(default)] coords: Option<Coords> }

#[derive(Clone, Copy, Deserialize, Serialize)]
struct Coords { x: f64, y: f64, z: f64 }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RichSystem { name: String, coords: Coords, #[serde(default)] bodies: Vec<Body> }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Body { #[serde(default)] name: Option<String>, #[serde(default)] sub_type: Option<String>, #[serde(default)] surface_temperature: Option<f64> }

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    id64: Option<String>, name: String, coords: Coords, classification: &'static str,
    known: bool, confidence: &'static str, bodies: Vec<BodyMatch>, #[serde(skip_serializing_if = "Option::is_none")]
    poi_names: Option<Vec<String>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BodyMatch { name: String, sub_type: String, surface_temperature: f64, rule: &'static str }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Output { imported_at: String, galaxy_updated_at: String, known_source: String, known_system_count: usize, high_candidate_count: usize, criteria: Criteria, systems: Vec<Record> }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Criteria { water_giant_or_water_life_gas_giant: bool, target_surface_temperature_k: f64, temperature_epsilon_k: f64, note: &'static str }

pub(crate) fn run(config: GreenGasGiantConfig<'_>) -> Result<()> {
    let galaxy_dir = config.data_dir.join("galaxy");
    let manifest_path = galaxy_dir.join("manifest.json");
    if !manifest_path.exists() { bail!("Full galaxy data is not installed. Import galaxy data before building Green Gas Giant candidates."); }
    let manifest: Manifest = serde_json::from_reader(File::open(&manifest_path)?).context("Could not read the rich galaxy manifest")?;
    let known_source_path = config.data_dir.join("places.json");
    if !known_source_path.exists() { bail!("Cannot find {}. Run npm run import:places first to obtain the EDAstro known GGG list.", known_source_path.display()); }
    let places: PlacesPayload = serde_json::from_reader(File::open(&known_source_path)?).context("Could not read EDAstro POI cache")?;
    let mut known = known_systems(places.places);
    if known.is_empty() { bail!("The EDAstro POI cache has no Green Gas Giant entries."); }
    let pool = rayon::ThreadPoolBuilder::new().num_threads(config.threads).build().context("Could not create Green Gas Giant worker pool")?;
    let started = Instant::now();
    let mut candidates = FxHashMap::<u64, Record>::default();
    println!("Scanning {} rich galaxy segment(s) for strict Green Gas Giant candidates...", manifest.segments.len());
    for segment in manifest.segments.iter().rev() {
        scan_segment(&galaxy_dir, segment, &pool, config.batch_size, &mut candidates, &mut known)?;
    }
    let mut systems = candidates.into_values().collect::<Vec<_>>();
    for (_, item) in known.drain() { systems.push(item); }
    systems.sort_unstable_by(|a, b| a.name.cmp(&b.name));
    let high_candidate_count = systems.iter().filter(|item| item.classification == "candidate").count();
    let output = Output {
        imported_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true), galaxy_updated_at: manifest.updated_at,
        known_source: places.source_url.unwrap_or_else(|| "data/places.json (EDAstro Combined POI)".to_string()), known_system_count: systems.iter().filter(|item| item.known).count(), high_candidate_count,
        criteria: Criteria { water_giant_or_water_life_gas_giant: true, target_surface_temperature_k: TARGET_TEMPERATURE_K, temperature_epsilon_k: TEMPERATURE_EPSILON_K, note: "Strict V1: only the confirmed 158 K water-giant / water-life gas-giant temperature relationship." }, systems,
    };
    let output_path = config.data_dir.join("green-gas-giants.json");
    let temp_path = output_path.with_extension("json.tmp");
    let mut writer = BufWriter::new(File::create(&temp_path)?);
    serde_json::to_writer_pretty(&mut writer, &output)?; writer.flush()?;
    if output_path.exists() { fs::remove_file(&output_path)?; }
    fs::rename(&temp_path, &output_path)?;
    println!("Green Gas Giant database complete: {} known systems and {} strict candidates in {} seconds.", output.known_system_count, output.high_candidate_count, started.elapsed().as_secs());
    Ok(())
}

fn known_systems(places: Vec<Poi>) -> FxHashMap<String, Record> {
    let mut known = FxHashMap::default();
    for poi in places {
        let is_green_gas_giant = matches!(poi.r#type.as_deref().map(str::trim), Some("GGG" | "Green Gas Giants"));
        if !is_green_gas_giant { continue; }
        let system_name = poi.system_name.unwrap_or_default();
        let key = normalize(&system_name); if key.is_empty() { continue; }
        let Some(coords) = poi.coords else { continue; };
        let entry = known.entry(key).or_insert_with(|| Record { id64: None, name: system_name, coords, classification: "known", known: true, confidence: "confirmed", bodies: Vec::new(), poi_names: Some(Vec::new()) });
        if let Some(names) = &mut entry.poi_names {
            if let Some(name) = poi.name.filter(|value| !value.trim().is_empty()) {
                if !names.contains(&name) { names.push(name); }
            }
        }
    }
    known
}

fn scan_segment(galaxy_dir: &Path, segment: &Segment, pool: &rayon::ThreadPool, batch_size: usize, candidates: &mut FxHashMap<u64, Record>, known: &mut FxHashMap<String, Record>) -> Result<()> {
    let mut entries = read_index(&galaxy_dir.join(&segment.index_file))?;
    println!("Loading {} segment: sorting {} pack offsets for sequential reading...", segment.kind, entries.len());
    pool.install(|| entries.par_sort_unstable_by_key(|entry| entry.offset));
    let mut reader = BufReader::with_capacity(32 * 1024 * 1024, File::open(galaxy_dir.join(&segment.data_file))?);
    validate_data_header(&mut reader)?;
    let mut position = DATA_HEADER_BYTES; let mut batch = Vec::with_capacity(batch_size); let mut scanned = 0u64;
    for entry in entries {
        if position != entry.offset { reader.seek(SeekFrom::Start(entry.offset))?; position = entry.offset; }
        let mut compressed = vec![0; entry.compressed_len as usize]; reader.read_exact(&mut compressed)?; position += entry.compressed_len as u64;
        batch.push((entry, compressed)); scanned += 1;
        if batch.len() >= batch_size { process_batch(pool, &mut batch, candidates, known)?; }
        if scanned % 1_000_000 == 0 { println!("Scanned {} systems; {} strict candidates...", scanned, candidates.len()); }
    }
    if !batch.is_empty() { process_batch(pool, &mut batch, candidates, known)?; }
    Ok(())
}

fn process_batch(pool: &rayon::ThreadPool, batch: &mut Vec<(Entry, Vec<u8>)>, candidates: &mut FxHashMap<u64, Record>, known: &mut FxHashMap<String, Record>) -> Result<()> {
    let results = pool.install(|| batch.par_iter().map(|(entry, compressed)| -> Result<(u64, RichSystem)> {
        let raw = zstd::bulk::decompress(compressed, entry.raw_len as usize).context("Could not decompress a rich galaxy record")?;
        Ok((entry.id64, serde_json::from_slice(&raw).context("Could not parse a rich galaxy record")?))
    }).collect::<Vec<_>>());
    for result in results {
        let (id64, system) = result?; let key = normalize(&system.name); let matches = matched_bodies(&system.bodies);
        let known_record = known.remove(&key);
        if matches.is_empty() { candidates.remove(&id64); if let Some(record) = known_record { known.insert(key, record); } continue; }
        candidates.insert(id64, Record { id64: Some(id64.to_string()), name: system.name, coords: system.coords, classification: "candidate", known: known_record.is_some(), confidence: "very-high", bodies: matches, poi_names: known_record.and_then(|item| item.poi_names) });
    }
    batch.clear(); Ok(())
}

fn matched_bodies(bodies: &[Body]) -> Vec<BodyMatch> {
    bodies.iter().filter_map(|body| {
        let subtype = body.sub_type.as_deref()?.trim(); let temperature = body.surface_temperature?;
        let lower = subtype.to_ascii_lowercase();
        if !(lower == "water giant" || lower.contains("gas giant with water-based life")) || (temperature - TARGET_TEMPERATURE_K).abs() > TEMPERATURE_EPSILON_K { return None; }
        Some(BodyMatch { name: body.name.clone().unwrap_or_else(|| "Unnamed body".to_string()), sub_type: subtype.to_string(), surface_temperature: temperature, rule: "water giant or gas giant with water-based life at 158 K" })
    }).collect()
}

fn normalize(value: &str) -> String { value.trim().to_ascii_lowercase() }

fn validate_data_header(reader: &mut BufReader<File>) -> Result<()> { let mut header = [0; DATA_HEADER_BYTES as usize]; reader.read_exact(&mut header)?; if &header[0..8] != DATA_MAGIC { bail!("Invalid rich galaxy pack header"); } Ok(()) }

fn read_index(path: &Path) -> Result<Vec<Entry>> {
    let mut reader = BufReader::with_capacity(32 * 1024 * 1024, File::open(path)?); let mut header = [0; INDEX_HEADER_BYTES as usize]; reader.read_exact(&mut header)?;
    if &header[0..8] != INDEX_MAGIC { bail!("Invalid rich index magic in {}", path.display()); }
    let bytes = u32::from_le_bytes(header[12..16].try_into().unwrap()) as usize; if bytes != INDEX_RECORD_BYTES { bail!("Unsupported rich index format in {}", path.display()); }
    let count = u64::from_le_bytes(header[16..24].try_into().unwrap()) as usize; let mut records = vec![0; count * bytes]; reader.read_exact(&mut records)?;
    Ok(records.chunks_exact(bytes).map(|record| Entry { id64: u64::from_le_bytes(record[0..8].try_into().unwrap()), offset: u64::from_le_bytes(record[8..16].try_into().unwrap()), compressed_len: u32::from_le_bytes(record[16..20].try_into().unwrap()), raw_len: u32::from_le_bytes(record[20..24].try_into().unwrap()) }).collect())
}
