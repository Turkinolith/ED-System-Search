use anyhow::{Context, Result, anyhow, bail};
use chrono::{DateTime, NaiveDate, Utc};
use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::env;
use std::fs::{self, File};
use std::io::{self, BufRead, BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

mod rich;
mod murder;
mod spatial;

const RECORD_BYTES: u64 = 32;
const LOD_BYTES: usize = 20;
const UNKNOWN_UPDATE_SECONDS: u32 = u32::MAX;
const EPOCH: &str = "2000-01-01T00:00:00.000Z";

const LODS: [LodDef; 7] = [
    LodDef {
        level: 0,
        divisor: 4096,
        file: "systems-lod-0.bin",
    },
    LodDef {
        level: 1,
        divisor: 1024,
        file: "systems-lod-1.bin",
    },
    LodDef {
        level: 2,
        divisor: 256,
        file: "systems-lod-2.bin",
    },
    LodDef {
        level: 3,
        divisor: 64,
        file: "systems-lod-3.bin",
    },
    LodDef {
        level: 4,
        divisor: 16,
        file: "systems-lod-4.bin",
    },
    LodDef {
        level: 5,
        divisor: 4,
        file: "systems-lod-5.bin",
    },
    LodDef {
        level: 6,
        divisor: 1,
        file: "systems-lod-6.bin",
    },
];

#[derive(Clone, Copy)]
struct LodDef {
    level: u8,
    divisor: u32,
    file: &'static str,
}

#[derive(Clone, Debug, Deserialize)]
struct Coords {
    x: f64,
    y: f64,
    z: f64,
}

#[derive(Clone, Debug, Deserialize)]
struct SystemRecord {
    id64: Option<Value>,
    name: Option<String>,
    #[serde(rename = "mainStar")]
    main_star: Option<String>,
    coords: Option<Coords>,
    #[serde(rename = "needsPermit")]
    needs_permit: Option<bool>,
    #[serde(rename = "updateTime")]
    update_time: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
struct ExistingMeta {
    #[serde(default)]
    #[serde(rename = "sourcePath")]
    source_path: Option<String>,
    #[serde(rename = "importedAt")]
    imported_at: String,
    count: usize,
    #[serde(default)]
    #[serde(rename = "typeNames")]
    type_names: Vec<String>,
    #[serde(default)]
    sol: Option<Value>,
}

#[derive(Default, Clone, Copy, Serialize)]
struct AxisBounds {
    x: f32,
    y: f32,
    z: f32,
}

#[derive(Clone, Copy, Serialize)]
struct Bounds {
    min: AxisBounds,
    max: AxisBounds,
}

impl Default for Bounds {
    fn default() -> Self {
        Self {
            min: AxisBounds {
                x: f32::INFINITY,
                y: f32::INFINITY,
                z: f32::INFINITY,
            },
            max: AxisBounds {
                x: f32::NEG_INFINITY,
                y: f32::NEG_INFINITY,
                z: f32::NEG_INFINITY,
            },
        }
    }
}

#[derive(Clone, Copy)]
struct OldRecord {
    x: f32,
    y: f32,
    z: f32,
    type_code: u16,
    flags: u16,
    name_offset: u32,
    name_len: u16,
    id64: u64,
}

enum OutputSystem<'a> {
    New(&'a SystemRecord),
    Existing {
        record: OldRecord,
        name: String,
        update_seconds: u32,
        main_star: String,
    },
}

struct Paths {
    data_dir: PathBuf,
    meta: PathBuf,
    records: PathBuf,
    names: PathBuf,
    search: PathBuf,
    updates: PathBuf,
    updates_meta: PathBuf,
    lookup_overlay: PathBuf,
    lookup_overlay_meta: PathBuf,
    suggest_overlay: PathBuf,
    suggest_overlay_meta: PathBuf,
}

impl Paths {
    fn new(data_dir: PathBuf) -> Self {
        Self {
            meta: data_dir.join("systems-meta.json"),
            records: data_dir.join("systems.bin"),
            names: data_dir.join("systems-names.txt"),
            search: data_dir.join("systems-search.tsv"),
            updates: data_dir.join("systems-updates.u32"),
            updates_meta: data_dir.join("systems-updates-meta.json"),
            lookup_overlay: data_dir.join("name-lookup-overlay.tsv"),
            lookup_overlay_meta: data_dir.join("name-lookup-overlay-meta.json"),
            suggest_overlay: data_dir.join("suggest-overlay.tsv"),
            suggest_overlay_meta: data_dir.join("suggest-overlay-meta.json"),
            data_dir,
        }
    }
}

struct Writers {
    records: BufWriter<File>,
    names: BufWriter<File>,
    search: BufWriter<File>,
    updates: BufWriter<File>,
    lods: Vec<BufWriter<File>>,
}

struct LookupRow {
    key: String,
    name_lookup_line: String,
    suggest_line: String,
}

struct TypeState {
    names: Vec<String>,
    codes: HashMap<String, u16>,
    counts: Vec<u64>,
}

impl TypeState {
    fn new() -> Self {
        Self {
            names: Vec::new(),
            codes: HashMap::new(),
            counts: Vec::new(),
        }
    }

    fn seed(names: &[String]) -> Self {
        let mut state = Self::new();
        for name in names {
            state.code_for(name);
        }
        state.counts.fill(0);
        state
    }

    fn code_for(&mut self, name: &str) -> u16 {
        let key = if name.is_empty() { "Unknown" } else { name };
        if let Some(code) = self.codes.get(key) {
            return *code;
        }
        let code = self.names.len() as u16;
        self.codes.insert(key.to_string(), code);
        self.names.push(key.to_string());
        self.counts.push(0);
        code
    }

    fn observe(&mut self, code: u16) {
        let index = code as usize;
        if index >= self.counts.len() {
            self.counts.resize(index + 1, 0);
        }
        self.counts[index] += 1;
    }
}

struct ImportState {
    types: TypeState,
    lod_counts: Vec<u64>,
    name_bytes: u64,
    min_update_seconds: u32,
    max_update_seconds: u32,
}

impl ImportState {
    fn new(types: TypeState) -> Self {
        Self {
            types,
            lod_counts: vec![0; LODS.len()],
            name_bytes: 0,
            min_update_seconds: UNKNOWN_UPDATE_SECONDS,
            max_update_seconds: 0,
        }
    }

    fn observe_update(&mut self, seconds: u32) {
        if seconds == UNKNOWN_UPDATE_SECONDS {
            return;
        }
        self.min_update_seconds = self.min_update_seconds.min(seconds);
        self.max_update_seconds = self.max_update_seconds.max(seconds);
    }
}

struct NameReader {
    file: File,
    pos: u64,
}

impl NameReader {
    fn new(file: File) -> Self {
        Self { file, pos: 0 }
    }

    fn read_name(&mut self, offset: u32, len: u16) -> Result<String> {
        let offset = offset as u64;
        if self.pos != offset {
            self.file.seek(SeekFrom::Start(offset))?;
            self.pos = offset;
        }
        let mut bytes = vec![0; len as usize];
        self.file.read_exact(&mut bytes)?;
        self.pos += len as u64;
        Ok(String::from_utf8_lossy(&bytes).to_string())
    }
}

fn main() -> Result<()> {
    let config = Config::parse()?;
    match config.mode.as_str() {
        "full" => run_full(&config),
        "delta" => run_delta(&config),
        "galaxy" => rich::run(rich::RichImportConfig {
            source: &config.source,
            data_dir: &config.data_dir,
            delta: false,
            threads: config.threads,
            compression_level: config.compression_level,
            batch_size: config.batch_size,
        }),
        "galaxy-delta" => rich::run(rich::RichImportConfig {
            source: &config.source,
            data_dir: &config.data_dir,
            delta: true,
            threads: config.threads,
            compression_level: config.compression_level,
            batch_size: config.batch_size,
        }),
        "murder-binaries" => murder::run(murder::MurderImportConfig {
            data_dir: &config.data_dir,
            threads: config.threads,
            batch_size: config.batch_size,
        }),
        "murder-index" => murder::build_index(&config.data_dir),
        "spatial-index" => spatial::run(spatial::SpatialConfig {
            data_dir: &config.data_dir,
            threads: config.threads,
        }),
        _ => bail!(
            "Unknown mode '{}'. Use full, delta, galaxy, galaxy-delta, murder-binaries, murder-index, or spatial-index.",
            config.mode
        ),
    }
}

struct Config {
    mode: String,
    source: String,
    data_dir: PathBuf,
    threads: usize,
    compression_level: i32,
    batch_size: usize,
}

impl Config {
    fn parse() -> Result<Self> {
        let mut args = env::args().skip(1);
        let mode = args.next().ok_or_else(|| {
            anyhow!(
                "Usage: ed-data-importer <full|delta|galaxy|galaxy-delta|murder-binaries|murder-index|spatial-index> [--source <path-or-url>] [--data-dir data] [--threads N] [--compression-level 1-19] [--batch-size N]"
            )
        })?;
        let mut source = None;
        let mut data_dir = PathBuf::from("data");
        let mut threads = std::thread::available_parallelism()
            .map(|value| value.get())
            .unwrap_or(1);
        let mut compression_level = 3;
        let mut batch_size = 1024;

        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--source" => source = args.next(),
                "--data-dir" => {
                    data_dir = PathBuf::from(
                        args.next()
                            .ok_or_else(|| anyhow!("--data-dir requires a value"))?,
                    )
                }
                "--threads" => {
                    threads = args
                        .next()
                        .ok_or_else(|| anyhow!("--threads requires a value"))?
                        .parse()
                        .context("--threads must be a positive integer")?;
                }
                "--compression-level" => {
                    compression_level = args
                        .next()
                        .ok_or_else(|| anyhow!("--compression-level requires a value"))?
                        .parse()
                        .context("--compression-level must be an integer")?;
                }
                "--batch-size" => {
                    batch_size = args
                        .next()
                        .ok_or_else(|| anyhow!("--batch-size requires a value"))?
                        .parse()
                        .context("--batch-size must be a positive integer")?;
                }
                _ => bail!("Unknown argument '{}'.", arg),
            }
        }
        if threads == 0 {
            bail!("--threads must be at least 1");
        }
        if batch_size == 0 {
            bail!("--batch-size must be at least 1");
        }
        if !(1..=19).contains(&compression_level) {
            bail!("--compression-level must be between 1 and 19");
        }

        let source = if mode == "murder-binaries" || mode == "murder-index" || mode == "spatial-index" {
            source.unwrap_or_default()
        } else {
            source.ok_or_else(|| anyhow!("--source is required"))?
        };
        Ok(Self {
            mode,
            source,
            data_dir,
            threads,
            compression_level,
            batch_size,
        })
    }
}

fn run_full(config: &Config) -> Result<()> {
    fs::create_dir_all(&config.data_dir)?;
    let paths = Paths::new(config.data_dir.clone());
    let started = Instant::now();
    let mut state = ImportState::new(TypeState::new());
    let mut writers = open_writers(&paths, None)?;
    let mut bounds = Bounds::default();
    let mut index = 0usize;

    println!("Importing {}", config.source);
    for system in read_systems(&config.source)? {
        let _ = write_output_system(
            &mut writers,
            &mut state,
            &mut bounds,
            OutputSystem::New(&system),
            index,
        )?;
        index += 1;
        if index % 1_000_000 == 0 {
            println!("Imported {} systems...", format_count(index));
        }
    }
    flush_writers(writers)?;
    write_meta(
        &paths,
        None,
        &config.source,
        started,
        index,
        bounds,
        &state,
        None,
    )?;
    clear_lookup_overlay(&paths)?;
    clear_suggest_overlay(&paths)?;
    println!("Imported {} systems.", format_count(index));
    Ok(())
}

fn run_delta(config: &Config) -> Result<()> {
    let paths = Paths::new(config.data_dir.clone());
    for required in [
        &paths.meta,
        &paths.records,
        &paths.names,
        &paths.search,
        &paths.updates,
    ] {
        if !required.exists() {
            bail!(
                "Cannot find {}. Run a full systems import first.",
                required.display()
            );
        }
    }

    let started = Instant::now();
    let meta: ExistingMeta = serde_json::from_reader(File::open(&paths.meta)?)?;
    let mut state = ImportState::new(TypeState::seed(&meta.type_names));
    let temp_suffix = format!(
        ".native-delta-{}.tmp",
        chrono::Utc::now().timestamp_millis()
    );
    let mut writers = open_writers(&paths, Some(&temp_suffix))?;
    let mut bounds = Bounds::default();
    let mut lookup_overlay = load_lookup_overlay(&paths)?;
    let mut suggest_overlay = load_suggest_overlay(&paths)?;

    println!("Reading delta dump {}", config.source);
    let mut delta_by_name = HashMap::<String, SystemRecord>::new();
    let mut delta_count = 0usize;
    for system in read_systems(&config.source)? {
        if let Some(name) = &system.name {
            delta_by_name.insert(system_key(name), system);
            delta_count += 1;
            if delta_count % 250_000 == 0 {
                println!("Read {} delta systems...", format_count(delta_count));
            }
        }
    }

    println!("Matching delta systems against {}", paths.search.display());
    let mut updates = HashMap::<usize, SystemRecord>::new();
    let mut matched = 0usize;
    scan_search_for_updates(
        &paths.search,
        meta.count,
        &mut delta_by_name,
        &mut updates,
        &mut matched,
    )?;
    println!(
        "Delta rows: {}, updates: {}, new: {}",
        format_count(delta_count),
        format_count(updates.len()),
        format_count(delta_by_name.len())
    );

    let result = (|| -> Result<usize> {
        rebuild_existing(
            &paths,
            &meta,
            &updates,
            &mut writers,
            &mut state,
            &mut bounds,
            &mut lookup_overlay,
            &mut suggest_overlay,
        )?;
        let mut appended = 0usize;
        for system in delta_by_name.values() {
            let lookup_row = write_output_system(
                &mut writers,
                &mut state,
                &mut bounds,
                OutputSystem::New(system),
                meta.count + appended,
            )?;
            lookup_overlay.insert(lookup_row.key.clone(), lookup_row.name_lookup_line);
            suggest_overlay.insert(lookup_row.key, lookup_row.suggest_line);
            appended += 1;
            if appended % 100_000 == 0 {
                println!("Appended {} new systems...", format_count(appended));
            }
        }
        flush_writers(writers)?;
        Ok(meta.count + delta_by_name.len())
    })();

    match result {
        Ok(count) => {
            replace_temp_files(&paths, &temp_suffix)?;
            write_lookup_overlay(&paths, &lookup_overlay)?;
            write_suggest_overlay(&paths, &suggest_overlay)?;
            let last_delta = json!({
                "sourcePath": config.source,
                "importedAt": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                "durationSeconds": started.elapsed().as_secs(),
                "inputCount": delta_count,
                "updatedCount": updates.len(),
                "addedCount": count - meta.count,
            });
            write_meta(
                &paths,
                Some(&meta),
                &config.source,
                started,
                count,
                bounds,
                &state,
                Some(last_delta),
            )?;
            println!("Merged delta into {} systems.", format_count(count));
            println!(
                "Next step: npm run import:journals. Full exact-name and suggestion rebuilds are optional compactions."
            );
            Ok(())
        }
        Err(error) => {
            remove_temp_files(&paths, &temp_suffix);
            Err(error)
        }
    }
}

fn read_systems(source: &str) -> Result<impl Iterator<Item = SystemRecord>> {
    let reader = open_source(source)?;
    Ok(SystemLineIterator {
        reader,
        line: String::new(),
    })
}

struct SystemLineIterator {
    reader: Box<dyn BufRead>,
    line: String,
}

impl Iterator for SystemLineIterator {
    type Item = SystemRecord;

    fn next(&mut self) -> Option<Self::Item> {
        loop {
            self.line.clear();
            let read = self.reader.read_line(&mut self.line).ok()?;
            if read == 0 {
                return None;
            }
            let Some(cleaned) = clean_json_line(&self.line) else {
                continue;
            };
            match serde_json::from_str::<SystemRecord>(cleaned) {
                Ok(system) => return Some(system),
                Err(error) => {
                    eprintln!("Skipped malformed JSON row: {}", error);
                    continue;
                }
            }
        }
    }
}

fn open_source(source: &str) -> Result<Box<dyn BufRead>> {
    let input: Box<dyn Read> = if is_url(source) {
        println!("Downloading {}", source);
        let response = reqwest::blocking::get(source)?.error_for_status()?;
        Box::new(response)
    } else {
        Box::new(File::open(source).with_context(|| format!("Cannot open {}", source))?)
    };
    let decoder = GzDecoder::new(input);
    Ok(Box::new(BufReader::with_capacity(8 * 1024 * 1024, decoder)))
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

fn scan_search_for_updates(
    search_path: &Path,
    expected_count: usize,
    delta_by_name: &mut HashMap<String, SystemRecord>,
    updates: &mut HashMap<usize, SystemRecord>,
    matched: &mut usize,
) -> Result<()> {
    let reader = BufReader::with_capacity(8 * 1024 * 1024, File::open(search_path)?);
    let mut valid = 0usize;
    let mut skipped = 0usize;
    for line in reader.lines() {
        let line = line?;
        let mut parts = line.split('\t');
        let lower = parts.next().unwrap_or_default();
        let _name = parts.next();
        let index = parts.next().and_then(|value| value.parse::<usize>().ok());
        let Some(index) = index else {
            skipped += 1;
            continue;
        };
        if lower.is_empty() || index >= expected_count {
            skipped += 1;
            continue;
        }
        valid += 1;
        if let Some(system) = delta_by_name.remove(lower) {
            updates.insert(index, system);
            *matched += 1;
        }
        if valid % 1_000_000 == 0 {
            println!("Scanned {} existing search rows...", format_count(valid));
        }
    }
    if skipped > 0 {
        eprintln!(
            "Skipped {} malformed or out-of-range search rows.",
            format_count(skipped)
        );
    }
    Ok(())
}

fn rebuild_existing(
    paths: &Paths,
    meta: &ExistingMeta,
    updates: &HashMap<usize, SystemRecord>,
    writers: &mut Writers,
    state: &mut ImportState,
    bounds: &mut Bounds,
    lookup_overlay: &mut HashMap<String, String>,
    suggest_overlay: &mut HashMap<String, String>,
) -> Result<()> {
    let mut records = BufReader::with_capacity(8 * 1024 * 1024, File::open(&paths.records)?);
    let mut update_reader = BufReader::with_capacity(8 * 1024 * 1024, File::open(&paths.updates)?);
    let mut names = NameReader::new(File::open(&paths.names)?);
    let mut record_buffer = [0u8; RECORD_BYTES as usize];
    let mut update_buffer = [0u8; 4];

    for index in 0..meta.count {
        records.read_exact(&mut record_buffer)?;
        let old = old_record_from_bytes(&record_buffer);
        let update_seconds = match update_reader.read_exact(&mut update_buffer) {
            Ok(()) => u32::from_le_bytes(update_buffer),
            Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => UNKNOWN_UPDATE_SECONDS,
            Err(error) => return Err(error.into()),
        };
        if let Some(system) = updates.get(&index) {
            let mut next = system.clone();
            if next.id64.is_none() {
                next.id64 = Some(Value::from(old.id64));
            }
            let lookup_row =
                write_output_system(writers, state, bounds, OutputSystem::New(&next), index)?;
            lookup_overlay.insert(lookup_row.key.clone(), lookup_row.name_lookup_line);
            suggest_overlay.insert(lookup_row.key, lookup_row.suggest_line);
        } else {
            let name = names.read_name(old.name_offset, old.name_len)?;
            let main_star = meta
                .type_names
                .get(old.type_code as usize)
                .cloned()
                .unwrap_or_else(|| "Unknown".to_string());
            let _ = write_output_system(
                writers,
                state,
                bounds,
                OutputSystem::Existing {
                    record: old,
                    name,
                    update_seconds,
                    main_star,
                },
                index,
            )?;
        }
        if (index + 1) % 1_000_000 == 0 {
            println!("Rebuilt {} existing systems...", format_count(index + 1));
        }
    }
    Ok(())
}

fn write_output_system(
    writers: &mut Writers,
    state: &mut ImportState,
    bounds: &mut Bounds,
    system: OutputSystem,
    index: usize,
) -> Result<LookupRow> {
    let (name, star, x, y, z, flags, id64, update_seconds, maybe_type_code) = match system {
        OutputSystem::New(system) => {
            let name = system
                .name
                .clone()
                .unwrap_or_else(|| format!("Unknown {}", index));
            let star = system
                .main_star
                .clone()
                .unwrap_or_else(|| "Unknown".to_string());
            let coords = system.coords.clone().unwrap_or(Coords {
                x: 0.0,
                y: 0.0,
                z: 0.0,
            });
            let flags = (if system.needs_permit.unwrap_or(false) {
                1
            } else {
                0
            }) | if non_standard(&star) { 2 } else { 0 };
            (
                name,
                star,
                coords.x as f32,
                coords.y as f32,
                coords.z as f32,
                flags,
                parse_id64(system.id64.as_ref()),
                parse_update_seconds(system.update_time.as_deref()),
                None,
            )
        }
        OutputSystem::Existing {
            record,
            name,
            update_seconds,
            main_star,
        } => (
            name,
            main_star,
            record.x,
            record.y,
            record.z,
            record.flags,
            record.id64,
            update_seconds,
            Some(record.type_code),
        ),
    };

    let type_code = maybe_type_code.unwrap_or_else(|| state.types.code_for(&star));
    state.types.observe(type_code);

    let name_bytes = name.as_bytes();
    if state.name_bytes > u32::MAX as u64 {
        bail!(
            "systems-names.txt exceeded the current u32 name-offset format. Native v2 records are needed before importing more names."
        );
    }
    let name_offset = state.name_bytes as u32;
    state.name_bytes += name_bytes.len() as u64;
    writers.names.write_all(name_bytes)?;

    let mut record = [0u8; RECORD_BYTES as usize];
    record[0..4].copy_from_slice(&x.to_le_bytes());
    record[4..8].copy_from_slice(&y.to_le_bytes());
    record[8..12].copy_from_slice(&z.to_le_bytes());
    record[12..14].copy_from_slice(&type_code.to_le_bytes());
    record[14..16].copy_from_slice(&(flags as u16).to_le_bytes());
    record[16..20].copy_from_slice(&name_offset.to_le_bytes());
    record[20..22].copy_from_slice(&(name_bytes.len().min(u16::MAX as usize) as u16).to_le_bytes());
    record[22..24].copy_from_slice(&0u16.to_le_bytes());
    record[24..32].copy_from_slice(&id64.to_le_bytes());
    writers.records.write_all(&record)?;

    writers.updates.write_all(&update_seconds.to_le_bytes())?;
    state.observe_update(update_seconds);
    update_bounds(bounds, x, y, z);

    let lower_name = system_key(&name);
    let search_line = format!(
        "{}\t{}\t{}\t{}\t{}\t{}\t{}",
        lower_name, name, index, type_code, x, y, z
    );
    writeln!(writers.search, "{}", search_line)?;

    let mut point = [0u8; LOD_BYTES];
    point[0..4].copy_from_slice(&x.to_le_bytes());
    point[4..8].copy_from_slice(&y.to_le_bytes());
    point[8..12].copy_from_slice(&z.to_le_bytes());
    point[12..14].copy_from_slice(&type_code.to_le_bytes());
    point[14..16].copy_from_slice(&(flags as u16).to_le_bytes());
    point[16..20].copy_from_slice(&(index as u32).to_le_bytes());
    let hash = hash_index(id64, index);
    for (lod_index, lod) in LODS.iter().enumerate() {
        if hash % lod.divisor == 0 {
            writers.lods[lod_index].write_all(&point)?;
            state.lod_counts[lod_index] += 1;
        }
    }
    Ok(LookupRow {
        key: lower_name.clone(),
        name_lookup_line: format!("{}\t{}\n", lower_name, index),
        suggest_line: format!("{}\n", search_line),
    })
}

fn open_writers(paths: &Paths, temp_suffix: Option<&str>) -> Result<Writers> {
    fs::create_dir_all(&paths.data_dir)?;
    let path_for = |path: &Path| match temp_suffix {
        Some(suffix) => PathBuf::from(format!("{}{}", path.display(), suffix)),
        None => path.to_path_buf(),
    };
    Ok(Writers {
        records: BufWriter::with_capacity(8 * 1024 * 1024, File::create(path_for(&paths.records))?),
        names: BufWriter::with_capacity(8 * 1024 * 1024, File::create(path_for(&paths.names))?),
        search: BufWriter::with_capacity(8 * 1024 * 1024, File::create(path_for(&paths.search))?),
        updates: BufWriter::with_capacity(8 * 1024 * 1024, File::create(path_for(&paths.updates))?),
        lods: LODS
            .iter()
            .map(|lod| {
                File::create(path_for(&paths.data_dir.join(lod.file)))
                    .map(|file| BufWriter::with_capacity(8 * 1024 * 1024, file))
            })
            .collect::<io::Result<Vec<_>>>()?,
    })
}

fn flush_writers(mut writers: Writers) -> Result<()> {
    writers.records.flush()?;
    writers.names.flush()?;
    writers.search.flush()?;
    writers.updates.flush()?;
    for writer in &mut writers.lods {
        writer.flush()?;
    }
    Ok(())
}

fn replace_temp_files(paths: &Paths, suffix: &str) -> Result<()> {
    for path in generated_files(paths) {
        fs::rename(format!("{}{}", path.display(), suffix), path)?;
    }
    Ok(())
}

fn remove_temp_files(paths: &Paths, suffix: &str) {
    for path in generated_files(paths) {
        let _ = fs::remove_file(format!("{}{}", path.display(), suffix));
    }
}

fn load_lookup_overlay(paths: &Paths) -> Result<HashMap<String, String>> {
    let mut rows = HashMap::new();
    if !paths.lookup_overlay.exists() {
        return Ok(rows);
    }
    let reader = BufReader::with_capacity(1024 * 1024, File::open(&paths.lookup_overlay)?);
    for line in reader.lines() {
        let line = line?;
        let Some((key, _)) = line.split_once('\t') else {
            continue;
        };
        if key.is_empty() {
            continue;
        }
        rows.insert(key.to_string(), format!("{}\n", line));
    }
    println!(
        "Loaded {} exact-name overlay rows.",
        format_count(rows.len())
    );
    Ok(rows)
}

fn load_suggest_overlay(paths: &Paths) -> Result<HashMap<String, String>> {
    let mut rows = HashMap::new();
    if !paths.suggest_overlay.exists() {
        return Ok(rows);
    }
    let reader = BufReader::with_capacity(1024 * 1024, File::open(&paths.suggest_overlay)?);
    for line in reader.lines() {
        let line = line?;
        let Some((key, _)) = line.split_once('\t') else {
            continue;
        };
        if key.is_empty() {
            continue;
        }
        rows.insert(key.to_string(), format!("{}\n", line));
    }
    println!(
        "Loaded {} suggestion overlay rows.",
        format_count(rows.len())
    );
    Ok(rows)
}

fn write_lookup_overlay(paths: &Paths, rows: &HashMap<String, String>) -> Result<()> {
    if rows.is_empty() {
        clear_lookup_overlay(paths)?;
        return Ok(());
    }
    let temp_suffix = format!(
        ".native-overlay-{}.tmp",
        chrono::Utc::now().timestamp_millis()
    );
    let temp_path = PathBuf::from(format!("{}{}", paths.lookup_overlay.display(), temp_suffix));
    {
        let mut writer = BufWriter::with_capacity(1024 * 1024, File::create(&temp_path)?);
        for line in rows.values() {
            writer.write_all(line.as_bytes())?;
        }
        writer.flush()?;
    }
    fs::rename(temp_path, &paths.lookup_overlay)?;

    let meta = json!({
        "updatedAt": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "count": rows.len(),
        "purpose": "Exact-name lookup overlay for systems added or updated after the last full name-lookup rebuild."
    });
    fs::write(
        &paths.lookup_overlay_meta,
        serde_json::to_string_pretty(&meta)?,
    )?;
    println!(
        "Wrote {} exact-name overlay rows.",
        format_count(rows.len())
    );
    Ok(())
}

fn write_suggest_overlay(paths: &Paths, rows: &HashMap<String, String>) -> Result<()> {
    if rows.is_empty() {
        clear_suggest_overlay(paths)?;
        return Ok(());
    }
    let temp_suffix = format!(
        ".native-suggest-overlay-{}.tmp",
        chrono::Utc::now().timestamp_millis()
    );
    let temp_path = PathBuf::from(format!(
        "{}{}",
        paths.suggest_overlay.display(),
        temp_suffix
    ));
    {
        let mut writer = BufWriter::with_capacity(1024 * 1024, File::create(&temp_path)?);
        for line in rows.values() {
            writer.write_all(line.as_bytes())?;
        }
        writer.flush()?;
    }
    fs::rename(temp_path, &paths.suggest_overlay)?;

    let meta = json!({
        "updatedAt": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "count": rows.len(),
        "purpose": "Typeahead/search overlay for systems added or updated after the last full suggestion rebuild."
    });
    fs::write(
        &paths.suggest_overlay_meta,
        serde_json::to_string_pretty(&meta)?,
    )?;
    println!(
        "Wrote {} suggestion overlay rows.",
        format_count(rows.len())
    );
    Ok(())
}

fn clear_lookup_overlay(paths: &Paths) -> Result<()> {
    if paths.lookup_overlay.exists() {
        fs::remove_file(&paths.lookup_overlay)?;
    }
    if paths.lookup_overlay_meta.exists() {
        fs::remove_file(&paths.lookup_overlay_meta)?;
    }
    Ok(())
}

fn clear_suggest_overlay(paths: &Paths) -> Result<()> {
    if paths.suggest_overlay.exists() {
        fs::remove_file(&paths.suggest_overlay)?;
    }
    if paths.suggest_overlay_meta.exists() {
        fs::remove_file(&paths.suggest_overlay_meta)?;
    }
    Ok(())
}

fn generated_files(paths: &Paths) -> Vec<PathBuf> {
    let mut files = vec![
        paths.records.clone(),
        paths.names.clone(),
        paths.search.clone(),
        paths.updates.clone(),
    ];
    files.extend(LODS.iter().map(|lod| paths.data_dir.join(lod.file)));
    files
}

fn write_meta(
    paths: &Paths,
    existing: Option<&ExistingMeta>,
    source: &str,
    started: Instant,
    count: usize,
    bounds: Bounds,
    state: &ImportState,
    last_delta: Option<Value>,
) -> Result<()> {
    let imported_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let type_counts: serde_json::Map<String, Value> = state
        .types
        .counts
        .iter()
        .enumerate()
        .map(|(index, count)| (index.to_string(), Value::from(*count)))
        .collect();
    let base_types: serde_json::Map<String, Value> = state
        .types
        .names
        .iter()
        .enumerate()
        .map(|(index, name)| (index.to_string(), Value::from(base_type(name))))
        .collect();
    let update_range = update_time_range(state);
    let mut meta = json!({
        "sourcePath": existing.and_then(|m| m.source_path.clone()).unwrap_or_else(|| source.to_string()),
        "importedAt": existing.map(|m| m.imported_at.clone()).unwrap_or_else(|| imported_at.clone()),
        "durationSeconds": started.elapsed().as_secs(),
        "count": count,
        "bounds": bounds,
        "typeNames": state.types.names,
        "typeCounts": type_counts,
        "baseTypes": base_types,
        "lodLevels": LODS.iter().enumerate().map(|(i, lod)| json!({
            "level": lod.level,
            "divisor": lod.divisor,
            "file": lod.file,
            "count": state.lod_counts[i],
        })).collect::<Vec<_>>(),
        "updateTimeRange": update_range,
        "sol": existing.and_then(|m| m.sol.clone()).unwrap_or_else(|| json!({ "name": "Sol", "coords": { "x": 0, "y": 0, "z": 0 } })),
    });
    if let Some(last_delta) = last_delta.clone() {
        meta["lastDeltaImport"] = last_delta;
    }
    serde_json::to_writer_pretty(File::create(&paths.meta)?, &meta)?;

    let updates_meta = json!({
        "sourcePath": paths.updates,
        "importedAt": imported_at,
        "count": count,
        "bytesPerRecord": 4,
        "epoch": EPOCH,
        "unknownValue": UNKNOWN_UPDATE_SECONDS,
        "minSeconds": if state.min_update_seconds == UNKNOWN_UPDATE_SECONDS { Value::Null } else { Value::from(state.min_update_seconds) },
        "maxSeconds": if state.max_update_seconds == 0 { Value::Null } else { Value::from(state.max_update_seconds) },
        "minUpdateTime": seconds_to_iso(state.min_update_seconds),
        "maxUpdateTime": if state.max_update_seconds == 0 { Value::Null } else { seconds_to_iso(state.max_update_seconds) },
        "lastDeltaImport": last_delta,
    });
    serde_json::to_writer_pretty(File::create(&paths.updates_meta)?, &updates_meta)?;
    Ok(())
}

fn update_time_range(state: &ImportState) -> Value {
    json!({
        "available": state.min_update_seconds != UNKNOWN_UPDATE_SECONDS,
        "minUpdateTime": seconds_to_iso(state.min_update_seconds),
        "maxUpdateTime": if state.max_update_seconds == 0 { Value::Null } else { seconds_to_iso(state.max_update_seconds) },
    })
}

fn old_record_from_bytes(bytes: &[u8; RECORD_BYTES as usize]) -> OldRecord {
    OldRecord {
        x: f32::from_le_bytes(bytes[0..4].try_into().unwrap()),
        y: f32::from_le_bytes(bytes[4..8].try_into().unwrap()),
        z: f32::from_le_bytes(bytes[8..12].try_into().unwrap()),
        type_code: u16::from_le_bytes(bytes[12..14].try_into().unwrap()),
        flags: u16::from_le_bytes(bytes[14..16].try_into().unwrap()),
        name_offset: u32::from_le_bytes(bytes[16..20].try_into().unwrap()),
        name_len: u16::from_le_bytes(bytes[20..22].try_into().unwrap()),
        id64: u64::from_le_bytes(bytes[24..32].try_into().unwrap()),
    }
}

fn parse_id64(value: Option<&Value>) -> u64 {
    match value {
        Some(Value::Number(number)) => number.as_u64().unwrap_or(0),
        Some(Value::String(text)) => text.parse::<u64>().unwrap_or(0),
        _ => 0,
    }
}

fn parse_update_seconds(value: Option<&str>) -> u32 {
    let Some(value) = value else {
        return UNKNOWN_UPDATE_SECONDS;
    };
    let normalized = value.replace(' ', "T").replace("+00", "Z");
    let Ok(date) = DateTime::parse_from_rfc3339(&normalized) else {
        return UNKNOWN_UPDATE_SECONDS;
    };
    let epoch = NaiveDate::from_ymd_opt(2000, 1, 1)
        .unwrap()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc();
    let seconds = date
        .with_timezone(&Utc)
        .signed_duration_since(epoch)
        .num_seconds();
    seconds.clamp(0, UNKNOWN_UPDATE_SECONDS as i64 - 1) as u32
}

fn seconds_to_iso(seconds: u32) -> Value {
    if seconds == UNKNOWN_UPDATE_SECONDS {
        return Value::Null;
    }
    let epoch = NaiveDate::from_ymd_opt(2000, 1, 1)
        .unwrap()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc();
    Value::from(
        (epoch + chrono::Duration::seconds(seconds as i64))
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    )
}

fn base_type(star: &str) -> String {
    if star.is_empty() {
        return "Unknown".to_string();
    }
    for (needle, label) in [
        ("Black Hole", "Black Hole"),
        ("Neutron", "Neutron Star"),
        ("White Dwarf", "White Dwarf"),
        ("T Tauri", "T Tauri"),
        ("Wolf-Rayet", "Wolf-Rayet"),
        ("Herbig", "Herbig Ae/Be"),
    ] {
        if star.contains(needle) {
            return label.to_string();
        }
    }
    for prefix in ["CJ", "CN", "MS"] {
        if star.starts_with(prefix) {
            return prefix.to_string();
        }
    }
    star.chars()
        .next()
        .map(|c| c.to_string())
        .unwrap_or_else(|| star.to_string())
}

fn non_standard(star: &str) -> bool {
    if star.is_empty() {
        return true;
    }
    let special = [
        "Black Hole",
        "Neutron",
        "White Dwarf",
        "T Tauri",
        "Wolf-Rayet",
        "Herbig",
        "giant",
        "super giant",
        "C Star",
        "CJ Star",
        "CN Star",
        "S-type",
        "MS-type",
    ];
    special.iter().any(|item| star.contains(item)) || !star.ends_with("Star")
}

fn update_bounds(bounds: &mut Bounds, x: f32, y: f32, z: f32) {
    bounds.min.x = bounds.min.x.min(x);
    bounds.min.y = bounds.min.y.min(y);
    bounds.min.z = bounds.min.z.min(z);
    bounds.max.x = bounds.max.x.max(x);
    bounds.max.y = bounds.max.y.max(y);
    bounds.max.z = bounds.max.z.max(z);
}

fn hash_index(id64: u64, index: usize) -> u32 {
    let mut value = if id64 == 0 {
        index as u128
    } else {
        id64 as u128
    };
    value ^= value >> 33;
    value *= 0xff51afd7ed558ccd_u128;
    value ^= value >> 33;
    (value & 0xffff_ffff) as u32
}

fn system_key(name: &str) -> String {
    name.trim().to_lowercase()
}

fn is_url(value: &str) -> bool {
    value.starts_with("http://") || value.starts_with("https://")
}

fn format_count(value: usize) -> String {
    let text = value.to_string();
    let mut out = String::new();
    for (i, ch) in text.chars().rev().enumerate() {
        if i > 0 && i % 3 == 0 {
            out.push(',');
        }
        out.push(ch);
    }
    out.chars().rev().collect()
}
