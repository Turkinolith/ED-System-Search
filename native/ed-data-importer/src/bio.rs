//! High-value exobiology per boxel.
//!
//! Scans the rich galaxy pack and, for every landable planet with an
//! atmosphere, works out which high-value species its conditions allow and
//! each one's share of its genus. The species model (data/bio-model.json,
//! built by scripts/build-bio-model.js) and the evaluation rules match
//! public/bio-model.js; scripts/fixtures/bio-cases.json keeps them in step.
//!
//! Per 320 ly cell (the ID64 "f" boxel grid) and target species:
//!   M = shares on DSS-mapped bodies (the genus list is known),
//!   E = shares on mapped bodies where the genus was found,
//!   U = shares on bodies that were never mapped.
//! The same sums are kept again for complete systems only (every body the
//! FSS counted has a record): elsewhere the dump tends to hold just the bodies
//! someone found worth scanning, which inflates per-system values.
//! The server turns these into per-boxel chances and expected finds.

use anyhow::{Context, Result, bail};
use rayon::prelude::*;
use rustc_hash::{FxHashMap, FxHashSet};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

const DATA_MAGIC: &[u8; 8] = b"EDGRDAT1";
const INDEX_MAGIC: &[u8; 8] = b"EDGRIDX1";
const DATA_HEADER_BYTES: u64 = 16;
const INDEX_HEADER_BYTES: u64 = 32;
const BIO_MAGIC: &[u8; 8] = b"EDBIOT01";
const BIO_HEADER_BYTES: usize = 32;
const BIO_VERSION: u32 = 3;
const CELL_LY: f64 = 320.0;
const GALAXY_ORIGIN: [f64; 3] = [49985.0, 40985.0, 24105.0];
const BIO_SIGNAL: &str = "$SAA_SignalType_Biological;";

pub(crate) struct BioImportConfig<'a> {
    pub data_dir: &'a Path,
    pub threads: usize,
    pub batch_size: usize,
}

// ---------- species model ----------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BioModel {
    version: u32,
    generated_at: String,
    genera: Vec<Genus>,
}

#[derive(Deserialize)]
pub(crate) struct Genus {
    key: String,
    name: String,
    species: Vec<Species>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Species {
    key: String,
    name: String,
    value: u64,
    target: bool,
    rulesets: Vec<Ruleset>,
    count: f64,
    variant_kind: String,
    #[serde(default)]
    variants: Option<HashMap<String, f64>>,
    #[serde(default)]
    regions: Option<Vec<u8>>,
    #[serde(default)]
    hist: Hist,
}

#[derive(Default, Deserialize)]
struct Hist {
    #[serde(default)]
    temperature: Option<Histogram>,
    #[serde(default)]
    gravity: Option<Histogram>,
    #[serde(default)]
    pressure: Option<Histogram>,
}

#[derive(Deserialize)]
struct Histogram {
    min: f64,
    step: f64,
    density: Vec<f64>,
    floor: f64,
}

/// Either a list of atmospheres or "Any" (any atmosphere at all).
#[derive(Deserialize)]
#[serde(untagged)]
enum AtmosphereRule {
    List(Vec<String>),
    Any(serde::de::IgnoredAny),
}

#[derive(Deserialize)]
struct VolcanismRule {
    mode: String,
    #[serde(default)]
    values: Vec<String>,
    #[serde(default)]
    exact: Vec<String>,
}

#[derive(Deserialize)]
struct RegionRule {
    include: Vec<u8>,
    exclude: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Ruleset {
    #[serde(default)]
    atmosphere: Option<AtmosphereRule>,
    #[serde(default)]
    body_types: Option<Vec<String>>,
    #[serde(default)]
    min_gravity: Option<f64>,
    #[serde(default)]
    max_gravity: Option<f64>,
    #[serde(default)]
    min_temperature: Option<f64>,
    #[serde(default)]
    max_temperature: Option<f64>,
    #[serde(default)]
    min_pressure: Option<f64>,
    #[serde(default)]
    max_pressure: Option<f64>,
    #[serde(default)]
    min_distance: Option<f64>,
    #[serde(default)]
    atmosphere_components: Option<HashMap<String, f64>>,
    #[serde(default)]
    volcanism: Option<VolcanismRule>,
    #[serde(default)]
    regions: Option<RegionRule>,
}

// ---------- Spansh rich records ----------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RichSystem {
    #[serde(default)]
    coords: Option<Coords>,
    #[serde(default)]
    body_count: Option<u32>,
    #[serde(default)]
    bodies: Vec<RichBody>,
}

#[derive(Clone, Copy, Deserialize)]
struct Coords {
    x: f64,
    y: f64,
    z: f64,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RichBody {
    #[serde(default)]
    body_id: Option<u32>,
    #[serde(default, rename = "type")]
    body_type: Option<String>,
    #[serde(default)]
    sub_type: Option<String>,
    #[serde(default)]
    is_landable: Option<bool>,
    #[serde(default)]
    main_star: Option<bool>,
    #[serde(default)]
    gravity: Option<f64>,
    #[serde(default)]
    surface_temperature: Option<f64>,
    #[serde(default)]
    surface_pressure: Option<f64>,
    #[serde(default)]
    atmosphere_type: Option<String>,
    #[serde(default)]
    atmosphere_composition: Option<HashMap<String, f64>>,
    #[serde(default)]
    volcanism_type: Option<String>,
    #[serde(default)]
    distance_to_arrival: Option<f64>,
    #[serde(default)]
    materials: Option<HashMap<String, f64>>,
    #[serde(default)]
    parents: Option<Vec<HashMap<String, u32>>>,
    #[serde(default)]
    signals: Option<RichSignals>,
}

#[derive(Default, Deserialize)]
struct RichSignals {
    #[serde(default)]
    signals: Option<HashMap<String, f64>>,
    #[serde(default)]
    genuses: Option<Vec<String>>,
}

// ---------- normalised body ----------

pub(crate) struct Body {
    landable: bool,
    body_type: String,
    atmosphere: String,
    components: HashMap<String, f64>,
    gravity: Option<f64>,
    temperature: Option<f64>,
    pressure: Option<f64>,
    volcanism: String,
    distance: Option<f64>,
    materials: Vec<String>,
    star_codes: Vec<&'static str>,
    region: Option<u8>,
    genuses: Option<Vec<String>>,
}

pub(crate) fn atmosphere_key(value: &str) -> String {
    let text = value.trim();
    let lower = text.to_ascii_lowercase();
    if text.is_empty() || lower == "none" || lower == "no atmosphere" {
        return String::new();
    }
    if !text.contains(' ') && !text.contains('-') {
        return text.to_string();
    }
    let mut rest = text;
    for prefix in ["hot ", "thin ", "thick "] {
        if rest.len() >= prefix.len() && rest[..prefix.len()].eq_ignore_ascii_case(prefix) {
            rest = &rest[prefix.len()..];
        }
    }
    rest.split(|ch: char| ch == ' ' || ch == '-')
        .filter(|word| !word.is_empty())
        .map(|word| {
            let lower = word.to_ascii_lowercase();
            let mut chars = lower.chars();
            match chars.next() {
                Some(first) => first.to_ascii_uppercase().to_string() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect()
}

pub(crate) fn body_type_key(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "high metal content world" | "high metal content body" => "High metal content body".into(),
        "rocky ice world" | "rocky ice body" => "Rocky ice body".into(),
        "metal-rich body" | "metal rich body" => "Metal rich body".into(),
        "rocky body" => "Rocky body".into(),
        "icy body" => "Icy body".into(),
        _ => value.trim().to_string(),
    }
}

fn volcanism_key(value: Option<&str>) -> String {
    let text = value.unwrap_or("").trim().to_ascii_lowercase();
    if text == "no volcanism" { String::new() } else { text }
}

fn capitalise(value: &str) -> String {
    let lower = value.to_ascii_lowercase();
    let mut chars = lower.chars();
    match chars.next() {
        Some(first) => first.to_ascii_uppercase().to_string() + chars.as_str(),
        None => String::new(),
    }
}

/// Star class code used by the Bioforge colour variants (Spansh subType form).
pub(crate) fn star_code(value: &str) -> Option<&'static str> {
    let text = value.trim();
    let lower = text.to_ascii_lowercase();
    if lower.starts_with("white dwarf") {
        return Some("D");
    }
    if lower.starts_with("wolf-rayet") {
        return Some("W");
    }
    if lower.starts_with("neutron") {
        return Some("N");
    }
    if lower.starts_with("t tauri") {
        return Some("TTS");
    }
    if lower.starts_with("herbig") {
        return Some("Ae");
    }
    if lower.starts_with("black hole") {
        return None;
    }
    let mut chars = text.chars();
    let first = chars.next()?;
    let next = chars.next();
    if !matches!(next, None | Some(' ') | Some('(') | Some('_')) {
        return None;
    }
    match first {
        'O' => Some("O"),
        'B' => Some("B"),
        'A' => Some("A"),
        'F' => Some("F"),
        'G' => Some("G"),
        'K' => Some("K"),
        'M' => Some("M"),
        'L' => Some("L"),
        'T' => Some("T"),
        'Y' => Some("Y"),
        _ => None,
    }
}

pub(crate) fn normalise_body(body: &RichBody, stars: &[(u32, &'static str, bool)], region: Option<u8>) -> Body {
    let parent_stars = body
        .parents
        .iter()
        .flatten()
        .filter_map(|parent| parent.get("Star").copied())
        .collect::<Vec<_>>();
    let mut star_codes = Vec::new();
    for &(id, code, arrival) in stars {
        if (arrival || parent_stars.contains(&id)) && !star_codes.contains(&code) {
            star_codes.push(code);
        }
    }
    let components = body
        .atmosphere_composition
        .iter()
        .flatten()
        .map(|(name, percent)| (atmosphere_key(name), *percent))
        .collect();
    let mut materials = body
        .materials
        .iter()
        .flatten()
        .map(|(name, _)| capitalise(name))
        .collect::<Vec<_>>();
    materials.sort_unstable();
    Body {
        landable: body.is_landable == Some(true),
        body_type: body_type_key(body.sub_type.as_deref().unwrap_or("")),
        atmosphere: atmosphere_key(body.atmosphere_type.as_deref().unwrap_or("")),
        components,
        gravity: body.gravity.filter(|value| value.is_finite()),
        temperature: body.surface_temperature.filter(|value| value.is_finite()),
        pressure: body.surface_pressure.filter(|value| value.is_finite()),
        volcanism: volcanism_key(body.volcanism_type.as_deref()),
        distance: body.distance_to_arrival.filter(|value| value.is_finite()),
        materials,
        star_codes,
        region,
        genuses: body.signals.as_ref().and_then(|signals| signals.genuses.clone()),
    }
}

fn ruleset_matches(rule: &Ruleset, body: &Body) -> bool {
    match &rule.atmosphere {
        Some(AtmosphereRule::Any(_)) if body.atmosphere.is_empty() => return false,
        Some(AtmosphereRule::List(list)) if !list.iter().any(|item| *item == body.atmosphere) => return false,
        _ => {}
    }
    if let Some(types) = &rule.body_types {
        if !types.iter().any(|item| *item == body.body_type) {
            return false;
        }
    }
    if let Some(components) = &rule.atmosphere_components {
        for (gas, percent) in components {
            if body.components.get(gas).copied().unwrap_or(0.0) < *percent {
                return false;
            }
        }
    }
    if let Some(gravity) = body.gravity {
        if rule.max_gravity.is_some_and(|max| gravity > max) || rule.min_gravity.is_some_and(|min| gravity < min) {
            return false;
        }
    }
    if let Some(temperature) = body.temperature.filter(|value| *value != 0.0) {
        if rule.max_temperature.is_some_and(|max| temperature > max)
            || rule.min_temperature.is_some_and(|min| temperature < min)
        {
            return false;
        }
    }
    if let Some(pressure) = body.pressure.filter(|value| *value != 0.0) {
        if rule.min_pressure.is_some_and(|min| pressure < min) || rule.max_pressure.is_some_and(|max| pressure >= max) {
            return false;
        }
    }
    if let Some(volcanism) = &rule.volcanism {
        let actual = body.volcanism.as_str();
        let ok = match volcanism.mode.as_str() {
            "none" => actual.is_empty(),
            "any" => !actual.is_empty(),
            "not" => !actual.is_empty() && !volcanism.values.iter().any(|value| actual.contains(value.as_str())),
            "list" => {
                volcanism.exact.iter().any(|value| value == actual)
                    || volcanism.values.iter().any(|value| actual.contains(value.as_str()))
            }
            _ => true,
        };
        if !ok {
            return false;
        }
    }
    if let (Some(min), Some(distance)) = (rule.min_distance, body.distance) {
        if distance < min {
            return false;
        }
    }
    if let (Some(regions), Some(region)) = (&rule.regions, body.region) {
        if regions.exclude.contains(&region) || (!regions.include.is_empty() && !regions.include.contains(&region)) {
            return false;
        }
    }
    true
}

fn density(hist: &Option<Histogram>, value: Option<f64>) -> f64 {
    let (Some(hist), Some(value)) = (hist, value) else { return 1.0 };
    let index = ((value - hist.min) / hist.step).floor();
    if index < 0.0 || index >= hist.density.len() as f64 {
        hist.floor
    } else {
        hist.density[index as usize]
    }
}

pub(crate) fn species_weight(species: &Species, body: &Body) -> f64 {
    if !species.rulesets.iter().any(|rule| ruleset_matches(rule, body)) {
        return 0.0;
    }
    if let (Some(regions), Some(region)) = (&species.regions, body.region) {
        if !regions.contains(&region) {
            return 0.0;
        }
    }
    let mut finds = species.count.max(1.0);
    if let Some(variants) = &species.variants {
        let keys: Vec<&str> = if species.variant_kind == "material" {
            body.materials.iter().map(String::as_str).collect()
        } else {
            body.star_codes.clone()
        };
        if !keys.is_empty() {
            finds = keys.iter().map(|key| variants.get(*key).copied().unwrap_or(0.0)).sum();
            if finds == 0.0 {
                return 0.0;
            }
        }
    }
    finds
        * density(&species.hist.temperature, body.temperature)
        * density(&species.hist.gravity, body.gravity)
        * density(&species.hist.pressure, body.pressure)
}

/// Shares of each species within its genus; (genus index, species index, share).
pub(crate) fn species_shares(model: &BioModel, body: &Body) -> Vec<(usize, usize, f64)> {
    let mut out = Vec::new();
    if !body.landable || body.atmosphere.is_empty() {
        return out;
    }
    for (genus_index, genus) in model.genera.iter().enumerate() {
        let weights = genus.species.iter().map(|species| species_weight(species, body)).collect::<Vec<_>>();
        let total: f64 = weights.iter().sum();
        if total <= 0.0 {
            continue;
        }
        for (species_index, weight) in weights.into_iter().enumerate() {
            if weight > 0.0 {
                out.push((genus_index, species_index, weight / total));
            }
        }
    }
    out
}

// ---------- region raster ----------

pub(crate) struct RegionRaster {
    width: usize,
    height: usize,
    x0: f64,
    z0: f64,
    cell: f64,
    cells: Vec<u8>,
}

impl RegionRaster {
    fn load(path: &Path) -> Result<Self> {
        let bytes = fs::read(path).with_context(|| format!("Cannot read {}", path.display()))?;
        if bytes.len() < 32 || &bytes[0..8] != b"EDREGR01" {
            bail!("{} is not a region raster", path.display());
        }
        let width = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
        let height = u32::from_le_bytes(bytes[16..20].try_into().unwrap()) as usize;
        if bytes.len() < 32 + width * height {
            bail!("{} is truncated", path.display());
        }
        Ok(Self {
            width,
            height,
            x0: f32::from_le_bytes(bytes[20..24].try_into().unwrap()) as f64,
            z0: f32::from_le_bytes(bytes[24..28].try_into().unwrap()) as f64,
            cell: f32::from_le_bytes(bytes[28..32].try_into().unwrap()) as f64,
            cells: bytes[32..32 + width * height].to_vec(),
        })
    }

    fn region_at(&self, x: f64, z: f64) -> Option<u8> {
        let i = ((x - self.x0) / self.cell).round();
        let j = ((z - self.z0) / self.cell).round();
        if i < 0.0 || j < 0.0 || i >= self.width as f64 || j >= self.height as f64 {
            return None;
        }
        let region = self.cells[j as usize * self.width + i as usize];
        (region != 0).then_some(region)
    }
}

// ---------- scan ----------

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
    #[serde(default)]
    dictionary: Option<Dictionary>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Dictionary {
    file: String,
    bytes: u64,
    dict_id: u32,
}

#[derive(Clone, Copy)]
struct PackEntry {
    id64: u64,
    offset: u64,
    compressed_len: u32,
    raw_len: u32,
}

/// One system's contribution: its cell plus E/M/U per target species.
struct SystemContribution {
    cell: u64,
    complete: bool,
    eligible: u32,
    mapped: u32,
    sums: Vec<(usize, f32, f32, f32)>,
}

struct CellCounts {
    systems: u32,
    complete: u32,
    eligible: u32,
    mapped: u32,
    /// E, M, U over all systems, then over complete systems.
    sums: Vec<[f32; 6]>,
}

struct Targets {
    /// (genus index, species index) for each target species, in output order.
    list: Vec<(usize, usize)>,
    lookup: FxHashMap<(usize, usize), usize>,
}

fn targets(model: &BioModel) -> Targets {
    let mut list = Vec::new();
    for (genus_index, genus) in model.genera.iter().enumerate() {
        for (species_index, species) in genus.species.iter().enumerate() {
            if species.target {
                list.push((genus_index, species_index));
            }
        }
    }
    let lookup = list.iter().enumerate().map(|(index, key)| (*key, index)).collect();
    Targets { list, lookup }
}

fn cell_key(coords: Coords) -> Option<u64> {
    let cell = |value: f64, origin: f64| -> Option<u64> {
        let index = ((value + origin) / CELL_LY).floor();
        (0.0..65535.0).contains(&index).then_some(index as u64)
    };
    Some((cell(coords.x, GALAXY_ORIGIN[0])? << 32) | (cell(coords.y, GALAXY_ORIGIN[1])? << 16) | cell(coords.z, GALAXY_ORIGIN[2])?)
}

fn system_contribution(
    system: RichSystem,
    model: &BioModel,
    targets: &Targets,
    raster: &RegionRaster,
) -> Option<SystemContribution> {
    let coords = system.coords?;
    if system.bodies.is_empty() || !coords.x.is_finite() || !coords.y.is_finite() || !coords.z.is_finite() {
        return None;
    }
    let cell = cell_key(coords)?;
    let region = raster.region_at(coords.x, coords.z);
    let stars = system
        .bodies
        .iter()
        .filter(|body| body.body_type.as_deref() == Some("Star"))
        .filter_map(|body| {
            let code = star_code(body.sub_type.as_deref()?)?;
            let arrival = body.main_star == Some(true) || body.distance_to_arrival == Some(0.0);
            Some((body.body_id?, code, arrival))
        })
        .collect::<Vec<_>>();
    // Complete when every body the FSS counted has a record.
    let complete = system.body_count.is_some_and(|count| count > 0 && system.bodies.len() >= count as usize);
    let mut contribution = SystemContribution { cell, complete, eligible: 0, mapped: 0, sums: Vec::new() };
    for raw in &system.bodies {
        if raw.body_type.as_deref() != Some("Planet") || raw.is_landable != Some(true) {
            continue;
        }
        let body = normalise_body(raw, &stars, region);
        if body.atmosphere.is_empty() {
            continue;
        }
        contribution.eligible += 1;
        let mapped = body.genuses.is_some();
        if mapped {
            contribution.mapped += 1;
        }
        // A body scanned by the FSS with no biological signals rules everything out.
        let no_bio = raw
            .signals
            .as_ref()
            .and_then(|signals| signals.signals.as_ref())
            .is_some_and(|signals| !signals.contains_key(BIO_SIGNAL) && !mapped);
        for (genus_index, species_index, share) in species_shares(model, &body) {
            let Some(&target) = targets.lookup.get(&(genus_index, species_index)) else { continue };
            let share = share as f32;
            let (e, m, u) = match &body.genuses {
                Some(genuses) => {
                    let found = genuses.iter().any(|genus| *genus == model.genera[genus_index].key);
                    (if found { share } else { 0.0 }, share, 0.0)
                }
                None if no_bio => (0.0, 0.0, 0.0),
                None => (0.0, 0.0, share),
            };
            if e + m + u > 0.0 {
                contribution.sums.push((target, e, m, u));
            }
        }
    }
    Some(contribution)
}

pub(crate) fn load_model(path: &Path) -> Result<BioModel> {
    let model: BioModel = serde_json::from_reader(BufReader::new(
        File::open(path).with_context(|| format!("Cannot open {}. Run npm run import:bio-model first.", path.display()))?,
    ))
    .context("Could not parse the bio model")?;
    if model.version != 1 {
        bail!("Unsupported bio model version {}", model.version);
    }
    Ok(model)
}

pub(crate) fn run(config: BioImportConfig<'_>) -> Result<()> {
    let galaxy_dir = config.data_dir.join("galaxy");
    let manifest_path = galaxy_dir.join("manifest.json");
    if !manifest_path.exists() {
        bail!("Full galaxy data is not installed. Import galaxy data before building the high-value bio map.");
    }
    let manifest: Manifest = serde_json::from_reader(File::open(&manifest_path)?)
        .context("Could not read the rich galaxy manifest")?;
    let model = load_model(&config.data_dir.join("bio-model.json"))?;
    let raster = RegionRaster::load(&config.data_dir.join("region-raster.bin"))?;
    let targets = targets(&model);
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(config.threads)
        .build()
        .context("Could not create the bio worker pool")?;
    let started = Instant::now();
    let mut cells = FxHashMap::<u64, CellCounts>::default();
    let mut seen = FxHashSet::<u64>::default();

    println!(
        "Scanning {} rich galaxy segment(s) for {} high-value species...",
        manifest.segments.len(),
        targets.list.len()
    );
    // Newest segment first; a system already counted from a newer segment is skipped.
    let segment_count = manifest.segments.len();
    for (position, segment) in manifest.segments.iter().rev().enumerate() {
        let remember = position + 1 < segment_count;
        scan_segment(&galaxy_dir, segment, &pool, config.batch_size, &model, &targets, &raster, &mut seen, remember, &mut cells)?;
    }

    let generated_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    write_outputs(config.data_dir, &generated_at, &manifest.updated_at, &model, &targets, &cells)?;
    println!(
        "Bio targets complete: {} boxels with scanned systems in {} seconds.",
        format_count(cells.len() as u64),
        started.elapsed().as_secs()
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn scan_segment(
    galaxy_dir: &Path,
    segment: &ManifestSegment,
    pool: &rayon::ThreadPool,
    batch_size: usize,
    model: &BioModel,
    targets: &Targets,
    raster: &RegionRaster,
    seen: &mut FxHashSet<u64>,
    remember: bool,
    cells: &mut FxHashMap<u64, CellCounts>,
) -> Result<()> {
    let mut entries = read_index(&galaxy_dir.join(&segment.index_file))?;
    println!(
        "Loading {} segment: sorting {} pack offsets for sequential reading...",
        segment.kind,
        format_count(entries.len() as u64)
    );
    pool.install(|| entries.par_sort_unstable_by_key(|entry| entry.offset));

    let pack_path = galaxy_dir.join(&segment.data_file);
    let file = File::open(&pack_path).with_context(|| format!("Cannot open {}", pack_path.display()))?;
    let mut reader = BufReader::with_capacity(32 * 1024 * 1024, file);
    validate_data_header(&mut reader)?;
    let dictionary = load_dictionary(galaxy_dir, segment)?;
    let mut position = DATA_HEADER_BYTES;
    let mut batch = Vec::with_capacity(batch_size);
    let mut scanned = 0u64;

    for entry in entries {
        if seen.contains(&entry.id64) {
            continue;
        }
        if remember {
            seen.insert(entry.id64);
        }
        if position != entry.offset {
            // Records without bodies were dropped from the index, so most reads
            // follow a small gap; seek_relative keeps the read buffer for those.
            if entry.offset > position {
                reader.seek_relative((entry.offset - position) as i64)?;
            } else {
                reader.seek(SeekFrom::Start(entry.offset))?;
            }
            position = entry.offset;
        }
        let mut compressed = vec![0u8; entry.compressed_len as usize];
        reader.read_exact(&mut compressed)?;
        position += entry.compressed_len as u64;
        batch.push((entry, compressed));
        if batch.len() >= batch_size {
            process_batch(pool, &mut batch, dictionary.as_deref(), model, targets, raster, cells)?;
        }
        scanned += 1;
        if scanned % 1_000_000 == 0 {
            println!(
                "Scanned {} systems; {} boxels with scanned systems...",
                format_count(scanned),
                format_count(cells.len() as u64)
            );
        }
    }
    if !batch.is_empty() {
        process_batch(pool, &mut batch, dictionary.as_deref(), model, targets, raster, cells)?;
    }
    Ok(())
}

fn process_batch(
    pool: &rayon::ThreadPool,
    batch: &mut Vec<(PackEntry, Vec<u8>)>,
    dictionary: Option<&[u8]>,
    model: &BioModel,
    targets: &Targets,
    raster: &RegionRaster,
    cells: &mut FxHashMap<u64, CellCounts>,
) -> Result<()> {
    let results = pool.install(|| {
        batch
            .par_iter()
            .map(|(entry, compressed)| -> Result<Option<SystemContribution>> {
                let raw = match dictionary {
                    Some(dictionary) => zstd::bulk::Decompressor::with_dictionary(dictionary)
                        .context("Could not load the rich galaxy dictionary")?
                        .decompress(compressed, entry.raw_len as usize),
                    None => zstd::bulk::decompress(compressed, entry.raw_len as usize),
                }
                .context("Could not decompress a rich galaxy record")?;
                let system: RichSystem =
                    serde_json::from_slice(&raw).context("Could not parse a rich galaxy record")?;
                Ok(system_contribution(system, model, targets, raster))
            })
            .collect::<Vec<_>>()
    });
    let species_count = targets.list.len();
    for result in results {
        let Some(contribution) = result? else { continue };
        let cell = cells.entry(contribution.cell).or_insert_with(|| CellCounts {
            systems: 0,
            complete: 0,
            eligible: 0,
            mapped: 0,
            sums: vec![[0.0; 6]; species_count],
        });
        cell.systems += 1;
        cell.complete += contribution.complete as u32;
        cell.eligible += contribution.eligible;
        cell.mapped += contribution.mapped;
        for (target, e, m, u) in contribution.sums {
            let sums = &mut cell.sums[target];
            sums[0] += e;
            sums[1] += m;
            sums[2] += u;
            if contribution.complete {
                sums[3] += e;
                sums[4] += m;
                sums[5] += u;
            }
        }
    }
    batch.clear();
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpeciesMeta {
    key: String,
    name: String,
    genus: String,
    genus_key: String,
    value: u64,
    found: f64,
    mapped: f64,
    unmapped: f64,
    rate: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BioMeta {
    format: &'static str,
    version: u32,
    generated_at: String,
    galaxy_updated_at: String,
    model_generated_at: String,
    cell_ly: f64,
    galaxy_origin: [f64; 3],
    cell_count: usize,
    systems: u64,
    complete_systems: u64,
    eligible_bodies: u64,
    mapped_bodies: u64,
    species: Vec<SpeciesMeta>,
}

fn write_outputs(
    data_dir: &Path,
    generated_at: &str,
    galaxy_updated_at: &str,
    model: &BioModel,
    targets: &Targets,
    cells: &FxHashMap<u64, CellCounts>,
) -> Result<()> {
    let data_path = data_dir.join("bio-targets.bin");
    let meta_path = data_dir.join("bio-targets-meta.json");
    let data_temp = PathBuf::from(format!("{}.tmp", data_path.display()));
    let meta_temp = PathBuf::from(format!("{}.tmp", meta_path.display()));
    let species_count = targets.list.len();

    let mut keys = cells.keys().copied().collect::<Vec<_>>();
    keys.sort_unstable();
    let mut totals = vec![[0f64; 3]; species_count];
    let (mut systems, mut complete_systems, mut eligible, mut mapped) = (0u64, 0u64, 0u64, 0u64);

    let mut writer = BufWriter::with_capacity(8 * 1024 * 1024, File::create(&data_temp)?);
    // Header: magic, version, species count, cell count, cell size. Each cell
    // is 24 bytes (x/y/z cell, entry count, systems, complete systems,
    // eligible and mapped bodies) followed by one 28-byte entry (species
    // index, padding, E/M/U over all systems, E/M/U over complete systems) for
    // each species with any data there.
    let mut header = [0u8; BIO_HEADER_BYTES];
    header[0..8].copy_from_slice(BIO_MAGIC);
    header[8..12].copy_from_slice(&BIO_VERSION.to_le_bytes());
    header[12..16].copy_from_slice(&(species_count as u32).to_le_bytes());
    header[16..24].copy_from_slice(&(keys.len() as u64).to_le_bytes());
    header[24..28].copy_from_slice(&(CELL_LY as f32).to_le_bytes());
    writer.write_all(&header)?;
    for key in &keys {
        let cell = &cells[key];
        let entries = cell
            .sums
            .iter()
            .enumerate()
            .filter(|(_, sums)| sums.iter().any(|value| *value > 0.0))
            .collect::<Vec<_>>();
        let mut row = [0u8; 24];
        row[0..2].copy_from_slice(&((key >> 32) as u16).to_le_bytes());
        row[2..4].copy_from_slice(&((key >> 16) as u16).to_le_bytes());
        row[4..6].copy_from_slice(&(*key as u16).to_le_bytes());
        row[6..8].copy_from_slice(&(entries.len() as u16).to_le_bytes());
        row[8..12].copy_from_slice(&cell.systems.to_le_bytes());
        row[12..16].copy_from_slice(&cell.complete.to_le_bytes());
        row[16..20].copy_from_slice(&cell.eligible.to_le_bytes());
        row[20..24].copy_from_slice(&cell.mapped.to_le_bytes());
        writer.write_all(&row)?;
        for (index, sums) in entries {
            let mut entry = [0u8; 28];
            entry[0..2].copy_from_slice(&(index as u16).to_le_bytes());
            for (part, value) in sums.iter().enumerate() {
                entry[4 + part * 4..8 + part * 4].copy_from_slice(&value.to_le_bytes());
                if part < 3 {
                    totals[index][part] += *value as f64;
                }
            }
            writer.write_all(&entry)?;
        }
        complete_systems += cell.complete as u64;
        systems += cell.systems as u64;
        eligible += cell.eligible as u64;
        mapped += cell.mapped as u64;
    }
    writer.flush()?;
    drop(writer);
    replace_file(&data_temp, &data_path)?;

    let species = targets
        .list
        .iter()
        .enumerate()
        .map(|(index, &(genus_index, species_index))| {
            let genus = &model.genera[genus_index];
            let item = &genus.species[species_index];
            let [found, mapped, unmapped] = totals[index];
            SpeciesMeta {
                key: item.key.clone(),
                name: item.name.clone(),
                genus: genus.name.clone(),
                genus_key: genus.key.clone(),
                value: item.value,
                found,
                mapped,
                unmapped,
                rate: if mapped > 0.0 { found / mapped } else { 0.0 },
            }
        })
        .collect();
    let meta = BioMeta {
        format: "EDBIOT01",
        version: BIO_VERSION,
        generated_at: generated_at.to_string(),
        galaxy_updated_at: galaxy_updated_at.to_string(),
        model_generated_at: model.generated_at.clone(),
        cell_ly: CELL_LY,
        galaxy_origin: GALAXY_ORIGIN,
        cell_count: keys.len(),
        systems,
        complete_systems,
        eligible_bodies: eligible,
        mapped_bodies: mapped,
        species,
    };
    let mut meta_writer = BufWriter::new(File::create(&meta_temp)?);
    serde_json::to_writer_pretty(&mut meta_writer, &meta)?;
    meta_writer.flush()?;
    drop(meta_writer);
    replace_file(&meta_temp, &meta_path)?;
    Ok(())
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
    if version != 1 || record_bytes < 32 {
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
        // Systems without bodies cannot contribute; skip their records entirely.
        if u32::from_le_bytes(row[28..32].try_into().unwrap()) == 0 {
            continue;
        }
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

fn load_dictionary(galaxy_dir: &Path, segment: &ManifestSegment) -> Result<Option<Vec<u8>>> {
    let Some(descriptor) = &segment.dictionary else { return Ok(None) };
    if Path::new(&descriptor.file).file_name().is_none() {
        bail!("Invalid rich galaxy dictionary filename.");
    }
    let path = galaxy_dir.join(&descriptor.file);
    let dictionary = fs::read(&path).with_context(|| format!("Could not read {}", path.display()))?;
    if dictionary.len() as u64 != descriptor.bytes {
        bail!("Rich galaxy dictionary has an unexpected size.");
    }
    if zstd::zstd_safe::get_dict_id_from_dict(&dictionary).map(|id| id.get()) != Some(descriptor.dict_id) {
        bail!("Rich galaxy dictionary has an unexpected dictionary ID.");
    }
    Ok(Some(dictionary))
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

    #[derive(Deserialize)]
    struct FixtureSystem {
        region: Option<u8>,
        bodies: Vec<RichBody>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct FixtureCase {
        name: String,
        system: FixtureSystem,
        body_index: usize,
        expected: Vec<(String, f64)>,
    }

    #[derive(Deserialize)]
    struct Fixture {
        model: BioModel,
        cases: Vec<FixtureCase>,
    }

    #[test]
    fn normalises_spansh_spellings() {
        assert_eq!(atmosphere_key("Thin Sulphur dioxide"), "SulphurDioxide");
        assert_eq!(atmosphere_key("Thin Carbon dioxide-rich"), "CarbonDioxideRich");
        assert_eq!(atmosphere_key("Hot thin Neon-rich"), "NeonRich");
        assert_eq!(atmosphere_key("No atmosphere"), "");
        assert_eq!(atmosphere_key("CarbonDioxide"), "CarbonDioxide");
        assert_eq!(body_type_key("High metal content world"), "High metal content body");
        assert_eq!(body_type_key("Rocky Ice world"), "Rocky ice body");
        assert_eq!(star_code("K (Yellow-Orange) Star"), Some("K"));
        assert_eq!(star_code("White Dwarf (DA) Star"), Some("D"));
        assert_eq!(star_code("T Tauri Star"), Some("TTS"));
        assert_eq!(star_code("T (Brown dwarf) Star"), Some("T"));
        assert_eq!(star_code("Herbig Ae/Be Star"), Some("Ae"));
        assert_eq!(star_code("Black Hole"), None);
    }

    #[test]
    fn matches_the_shared_fixture() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../scripts/fixtures/bio-cases.json");
        let fixture: Fixture = serde_json::from_reader(File::open(path).unwrap()).unwrap();
        for case in &fixture.cases {
            let stars = case
                .system
                .bodies
                .iter()
                .filter(|body| body.body_type.as_deref() == Some("Star"))
                .filter_map(|body| {
                    let code = star_code(body.sub_type.as_deref()?)?;
                    Some((body.body_id?, code, body.main_star == Some(true) || body.distance_to_arrival == Some(0.0)))
                })
                .collect::<Vec<_>>();
            let body = normalise_body(&case.system.bodies[case.body_index], &stars, case.system.region);
            let shares = species_shares(&fixture.model, &body);
            let mut actual = shares
                .iter()
                .map(|&(g, s, share)| (fixture.model.genera[g].species[s].name.clone(), share))
                .collect::<Vec<_>>();
            actual.sort_by(|a, b| a.0.cmp(&b.0));
            assert_eq!(actual.len(), case.expected.len(), "{}: species {:?}", case.name, actual);
            for ((name, share), (expected_name, expected_share)) in actual.iter().zip(&case.expected) {
                assert_eq!(name, expected_name, "{}", case.name);
                assert!((share - expected_share).abs() < 1e-9, "{}: {} {} vs {}", case.name, name, share, expected_share);
            }
        }
    }

    #[test]
    fn cell_keys_follow_the_f_boxel_grid() {
        let sol = cell_key(Coords { x: 0.0, y: 0.0, z: 0.0 }).unwrap();
        assert_eq!(sol >> 32, (49985.0f64 / 320.0).floor() as u64);
        assert_eq!((sol >> 16) & 0xffff, (40985.0f64 / 320.0).floor() as u64);
        assert_eq!(sol & 0xffff, (24105.0f64 / 320.0).floor() as u64);
    }
}
