use anyhow::{Context, Result, bail};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

const POINT_BYTES: usize = 20;
const HEADER_BYTES: usize = 32;
const INDEX_RECORD_BYTES: usize = 24;
const CELL_SIZE_LY: f32 = 100.0;
const CELL_BIAS: i64 = 1 << 20;
const CELL_MASK: u64 = (1 << 21) - 1;
const DATA_MAGIC: &[u8; 8] = b"EDSPLDAT";
const INDEX_MAGIC: &[u8; 8] = b"EDSPLIDX";

pub(crate) struct SpatialConfig<'a> {
    pub data_dir: &'a Path,
    pub threads: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SystemsMeta {
    lod_levels: Vec<LodLevel>,
}

#[derive(Deserialize)]
struct LodLevel {
    level: u32,
    count: u64,
    file: String,
}

#[derive(Clone)]
struct SpatialPoint {
    key: u64,
    record: [u8; POINT_BYTES],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpatialMeta {
    built_at: String,
    source_file: String,
    count: usize,
    cell_count: usize,
    cell_size_ly: f32,
    data_file: &'static str,
    index_file: &'static str,
    data_header_bytes: usize,
    point_bytes: usize,
    index_header_bytes: usize,
    index_record_bytes: usize,
}

pub(crate) fn run(config: SpatialConfig<'_>) -> Result<()> {
    let started = Instant::now();
    let meta_path = config.data_dir.join("systems-meta.json");
    let meta: SystemsMeta = serde_json::from_reader(File::open(&meta_path)?)
        .context("Could not read systems metadata")?;
    let source_level = meta
        .lod_levels
        .iter()
        .max_by_key(|level| (level.count, level.level))
        .context("No system LOD files are available")?;
    let source_path = config.data_dir.join(&source_level.file);
    println!(
        "Reading {} full-resolution points from {}...",
        format_count(source_level.count),
        source_path.display()
    );
    let raw = fs::read(&source_path)
        .with_context(|| format!("Could not read {}", source_path.display()))?;
    if raw.len() % POINT_BYTES != 0 {
        bail!("{} is not aligned to {}-byte point records", source_path.display(), POINT_BYTES);
    }
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(config.threads)
        .build()
        .context("Could not create spatial-index worker pool")?;
    let mut points = pool.install(|| {
        raw.par_chunks_exact(POINT_BYTES)
            .map(|bytes| {
                let mut record = [0u8; POINT_BYTES];
                record.copy_from_slice(bytes);
                let x = f32::from_le_bytes(record[0..4].try_into().unwrap());
                let y = f32::from_le_bytes(record[4..8].try_into().unwrap());
                let z = f32::from_le_bytes(record[8..12].try_into().unwrap());
                SpatialPoint {
                    key: cell_key(x, y, z),
                    record,
                }
            })
            .collect::<Vec<_>>()
    });
    drop(raw);
    println!(
        "Sorting {} points into {:.0} ly spatial cells using {} threads...",
        format_count(points.len() as u64),
        CELL_SIZE_LY,
        config.threads
    );
    pool.install(|| points.par_sort_unstable_by_key(|point| point.key));

    let data_path = config.data_dir.join("systems-spatial.bin");
    let index_path = config.data_dir.join("systems-spatial.idx");
    let output_meta_path = config.data_dir.join("systems-spatial-meta.json");
    let data_temp = temp_path(&data_path);
    let index_temp = temp_path(&index_path);
    let meta_temp = temp_path(&output_meta_path);
    let mut data_writer = BufWriter::with_capacity(32 * 1024 * 1024, File::create(&data_temp)?);
    data_writer.write_all(&header(DATA_MAGIC, POINT_BYTES as u32, points.len() as u64))?;
    let mut cells = Vec::<(u64, u64, u32)>::new();
    let mut active_key = None;
    let mut active_offset = HEADER_BYTES as u64;
    let mut active_count = 0u32;
    let mut data_offset = HEADER_BYTES as u64;
    for point in &points {
        if active_key != Some(point.key) {
            if let Some(key) = active_key {
                cells.push((key, active_offset, active_count));
            }
            active_key = Some(point.key);
            active_offset = data_offset;
            active_count = 0;
        }
        data_writer.write_all(&point.record)?;
        active_count = active_count.saturating_add(1);
        data_offset += POINT_BYTES as u64;
    }
    if let Some(key) = active_key {
        cells.push((key, active_offset, active_count));
    }
    data_writer.flush()?;
    drop(data_writer);
    drop(points);

    let mut index_writer = BufWriter::with_capacity(8 * 1024 * 1024, File::create(&index_temp)?);
    index_writer.write_all(&header(INDEX_MAGIC, INDEX_RECORD_BYTES as u32, cells.len() as u64))?;
    for (key, offset, count) in &cells {
        let mut row = [0u8; INDEX_RECORD_BYTES];
        row[0..8].copy_from_slice(&key.to_le_bytes());
        row[8..16].copy_from_slice(&offset.to_le_bytes());
        row[16..20].copy_from_slice(&count.to_le_bytes());
        index_writer.write_all(&row)?;
    }
    index_writer.flush()?;
    drop(index_writer);

    let output_meta = SpatialMeta {
        built_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        source_file: source_level.file.clone(),
        count: source_level.count as usize,
        cell_count: cells.len(),
        cell_size_ly: CELL_SIZE_LY,
        data_file: "systems-spatial.bin",
        index_file: "systems-spatial.idx",
        data_header_bytes: HEADER_BYTES,
        point_bytes: POINT_BYTES,
        index_header_bytes: HEADER_BYTES,
        index_record_bytes: INDEX_RECORD_BYTES,
    };
    let mut meta_writer = BufWriter::new(File::create(&meta_temp)?);
    serde_json::to_writer_pretty(&mut meta_writer, &output_meta)?;
    meta_writer.flush()?;
    replace_file(&data_temp, &data_path)?;
    replace_file(&index_temp, &index_path)?;
    replace_file(&meta_temp, &output_meta_path)?;
    println!(
        "Spatial index complete: {} points in {} cells, built in {} seconds.",
        format_count(source_level.count),
        format_count(cells.len() as u64),
        started.elapsed().as_secs()
    );
    Ok(())
}

fn cell_key(x: f32, y: f32, z: f32) -> u64 {
    let component = |value: f32| -> u64 {
        let cell = (value / CELL_SIZE_LY).floor() as i64;
        ((cell + CELL_BIAS) as u64) & CELL_MASK
    };
    (component(x) << 42) | (component(y) << 21) | component(z)
}

fn header(magic: &[u8; 8], record_bytes: u32, count: u64) -> [u8; HEADER_BYTES] {
    let mut header = [0u8; HEADER_BYTES];
    header[0..8].copy_from_slice(magic);
    header[8..12].copy_from_slice(&1u32.to_le_bytes());
    header[12..16].copy_from_slice(&record_bytes.to_le_bytes());
    header[16..24].copy_from_slice(&count.to_le_bytes());
    header
}

fn temp_path(path: &Path) -> PathBuf {
    PathBuf::from(format!("{}.tmp", path.display()))
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
