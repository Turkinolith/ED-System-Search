use anyhow::{Context, Result, bail};
use serde::Deserialize;
use std::fs::{self, File};
use std::io::{BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

// A coarse top-down density image of every known system, drawn by the client
// as the galaxy glow behind the capped star layer (the in-game map does the
// same with its Milky Way impostors). Two bytes per texel: log-scaled system
// density and the local share of heavy (mass code e..h) systems, where 128
// means the galaxy-wide average.
pub(crate) const FILE_NAME: &str = "galaxy-density.bin";
const MAGIC: &[u8; 8] = b"EDGDENS1";
const VERSION: u32 = 1;
const HEADER_BYTES: usize = 32;
const POINT_BYTES: usize = 20;
const SIZE: usize = 1024;
// A 100,000 ly square centred on Sagittarius A* (25.2, -20.9, 25899.97).
const MIN_X: f32 = 25.0 - 50_000.0;
const MIN_Z: f32 = 25_900.0 - 50_000.0;
const CELL_LY: f32 = 100_000.0 / SIZE as f32;
const MASS_CODE_SHIFT: u16 = 8;
// Mass-code field values are code + 1, so 5 is class e.
const HEAVY_FIELD_MIN: u16 = 5;
// Pulls the heavy share of sparse texels toward the average so a handful of
// systems can't paint a strong tint.
const HEAVY_PRIOR_SYSTEMS: f32 = 24.0;

pub(crate) struct DensityGrid {
    total: Vec<f32>,
    heavy: Vec<f32>,
    with_mass_code: u64,
}

impl DensityGrid {
    pub(crate) fn new() -> Self {
        Self {
            total: vec![0.0; SIZE * SIZE],
            heavy: vec![0.0; SIZE * SIZE],
            with_mass_code: 0,
        }
    }

    pub(crate) fn add(&mut self, record: &[u8]) {
        let x = f32::from_le_bytes(record[0..4].try_into().unwrap());
        let z = f32::from_le_bytes(record[8..12].try_into().unwrap());
        let flags = u16::from_le_bytes(record[14..16].try_into().unwrap());
        let column = ((x - MIN_X) / CELL_LY).floor();
        let row = ((z - MIN_Z) / CELL_LY).floor();
        if !(0.0..SIZE as f32).contains(&column) || !(0.0..SIZE as f32).contains(&row) {
            return;
        }
        let texel = row as usize * SIZE + column as usize;
        self.total[texel] += 1.0;
        let field = (flags >> MASS_CODE_SHIFT) & 0x0f;
        if field > 0 {
            self.with_mass_code += 1;
        }
        if field >= HEAVY_FIELD_MIN {
            self.heavy[texel] += 1.0;
        }
    }

    fn encode(mut self) -> Vec<u8> {
        let total_systems: f64 = self.total.iter().map(|&value| value as f64).sum();
        let heavy_systems: f64 = self.heavy.iter().map(|&value| value as f64).sum();
        let average_heavy = if self.with_mass_code > 0 && total_systems > 0.0 {
            (heavy_systems / total_systems) as f32
        } else {
            0.0
        };
        for _ in 0..2 {
            box_blur(&mut self.total);
            box_blur(&mut self.heavy);
        }
        let peak = self.total.iter().copied().fold(0.0f32, f32::max).max(1.0);
        let log_peak = peak.ln_1p();
        let mut out = Vec::with_capacity(SIZE * SIZE * 2);
        for texel in 0..SIZE * SIZE {
            let total = self.total[texel];
            let density = (total.ln_1p() / log_peak).clamp(0.0, 1.0);
            let heavy_share = if average_heavy > 0.0 {
                let share = (self.heavy[texel] + HEAVY_PRIOR_SYSTEMS * average_heavy)
                    / (total + HEAVY_PRIOR_SYSTEMS);
                (share / (2.0 * average_heavy)).clamp(0.0, 1.0)
            } else {
                0.5
            };
            out.push((density * 255.0).round() as u8);
            out.push((heavy_share * 255.0).round() as u8);
        }
        out
    }

    pub(crate) fn write(self, data_dir: &Path) -> Result<()> {
        let final_path = data_dir.join(FILE_NAME);
        let temp = PathBuf::from(format!("{}.tmp", final_path.display()));
        let body = self.encode();
        let mut header = [0u8; HEADER_BYTES];
        header[0..8].copy_from_slice(MAGIC);
        header[8..12].copy_from_slice(&VERSION.to_le_bytes());
        header[12..16].copy_from_slice(&(SIZE as u32).to_le_bytes());
        header[16..20].copy_from_slice(&(SIZE as u32).to_le_bytes());
        header[20..24].copy_from_slice(&MIN_X.to_le_bytes());
        header[24..28].copy_from_slice(&MIN_Z.to_le_bytes());
        header[28..32].copy_from_slice(&CELL_LY.to_le_bytes());
        let mut writer = BufWriter::new(File::create(&temp)?);
        writer.write_all(&header)?;
        writer.write_all(&body)?;
        writer.flush()?;
        drop(writer);
        if final_path.exists() {
            fs::remove_file(&final_path)?;
        }
        fs::rename(&temp, &final_path)?;
        Ok(())
    }
}

// Two passes of this 3x3 box blur approximate a small Gaussian, which hides
// the texel grid when the image is stretched across the galaxy.
fn box_blur(values: &mut [f32]) {
    let mut scratch = vec![0.0f32; values.len()];
    for row in 0..SIZE {
        for column in 0..SIZE {
            let left = values[row * SIZE + column.saturating_sub(1)];
            let right = values[row * SIZE + (column + 1).min(SIZE - 1)];
            scratch[row * SIZE + column] = (left + values[row * SIZE + column] + right) / 3.0;
        }
    }
    for row in 0..SIZE {
        let up = row.saturating_sub(1);
        let down = (row + 1).min(SIZE - 1);
        for column in 0..SIZE {
            values[row * SIZE + column] = (scratch[up * SIZE + column]
                + scratch[row * SIZE + column]
                + scratch[down * SIZE + column])
                / 3.0;
        }
    }
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

// Standalone rebuild from the full-resolution LOD; the spatial-index step also
// writes this image from the points it already holds in memory.
pub(crate) fn run(data_dir: &Path) -> Result<()> {
    let started = Instant::now();
    let meta: SystemsMeta = serde_json::from_reader(File::open(data_dir.join("systems-meta.json"))?)
        .context("Could not read systems metadata")?;
    let source = meta
        .lod_levels
        .iter()
        .max_by_key(|level| (level.count, level.level))
        .context("No system LOD files are available")?;
    let source_path = data_dir.join(&source.file);
    println!("Building galaxy density image from {}...", source_path.display());
    let mut file = File::open(&source_path)
        .with_context(|| format!("Could not read {}", source_path.display()))?;
    let mut grid = DensityGrid::new();
    let mut buffer = vec![0u8; POINT_BYTES * 512 * 1024];
    let mut carry = 0usize;
    loop {
        let read = file.read(&mut buffer[carry..])?;
        if read == 0 {
            break;
        }
        let available = carry + read;
        let whole = available - available % POINT_BYTES;
        for record in buffer[..whole].chunks_exact(POINT_BYTES) {
            grid.add(record);
        }
        buffer.copy_within(whole..available, 0);
        carry = available - whole;
    }
    if carry != 0 {
        bail!("{} is not aligned to {}-byte point records", source_path.display(), POINT_BYTES);
    }
    grid.write(data_dir)?;
    println!(
        "Galaxy density image complete in {} seconds.",
        started.elapsed().as_secs()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(x: f32, z: f32, mass_field: u16) -> [u8; POINT_BYTES] {
        let mut record = [0u8; POINT_BYTES];
        record[0..4].copy_from_slice(&x.to_le_bytes());
        record[8..12].copy_from_slice(&z.to_le_bytes());
        record[14..16].copy_from_slice(&(mass_field << MASS_CODE_SHIFT).to_le_bytes());
        record
    }

    #[test]
    fn dense_and_heavy_regions_encode_brighter_and_bluer() {
        let mut grid = DensityGrid::new();
        for _ in 0..500 {
            grid.add(&record(0.0, 0.0, 2));
        }
        for _ in 0..500 {
            grid.add(&record(25.0, 25_900.0, 8));
        }
        grid.add(&record(1.0e9, 0.0, 8));
        let image = grid.encode();
        let texel = |x: f32, z: f32| {
            let column = ((x - MIN_X) / CELL_LY).floor() as usize;
            let row = ((z - MIN_Z) / CELL_LY).floor() as usize;
            (row * SIZE + column) * 2
        };
        let sol = texel(0.0, 0.0);
        let core = texel(25.0, 25_900.0);
        let empty = texel(-40_000.0, 60_000.0);
        assert!(image[sol] > 200 && image[core] > 200);
        assert_eq!(image[empty], 0);
        assert!(image[core + 1] > 200, "an all-heavy region should read as heavy");
        assert!(image[sol + 1] < 60, "an all-dwarf region should read as light");
        assert_eq!(image[empty + 1], 128, "empty texels fall back to the average");
    }

    #[test]
    fn data_without_mass_codes_stays_neutral() {
        let mut grid = DensityGrid::new();
        grid.add(&record(0.0, 0.0, 0));
        let image = grid.encode();
        assert!(image.chunks_exact(2).all(|texel| texel[1] == 128));
    }
}
