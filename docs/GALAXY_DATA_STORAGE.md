# Full Galaxy Data Storage

The Spansh `galaxy.json.gz` dump is deliberately stored separately from the
existing map data.

## Why there are two stores

The map needs a small, fixed record for every system:

- coordinates
- primary-star type
- flags
- name offset
- ID64

Those records remain in `data/systems.bin` and the existing LOD files. Bodies,
stations, markets, factions, and other full-system data are variable-sized and
are only needed after opening a system. Mixing them into the map files would
make normal navigation and filtering much slower.

Full records are therefore written under `data/galaxy/`:

- `manifest.json`: format, source, segment order, counts, and summary metadata
- `base.pack`: independently Zstandard-compressed JSON records
- `base.idx`: sorted fixed-width ID64 lookup index
- `delta-*.pack` / `delta-*.idx`: newer incremental records
- `systems-lod-*-rich.bin`: fixed-width feature summaries aligned one-for-one
  with the existing map LOD point files

The server searches delta indexes newest-first and then the base index. This
allows a monthly rich-data update without rewriting the base pack. A future
compaction command can fold accumulated deltas into a new base.

## Index format

All integers are little-endian.

The 32-byte index header contains:

| Offset | Type | Meaning |
| --- | --- | --- |
| 0 | 8 bytes | ASCII `EDGRIDX1` |
| 8 | u32 | Format version |
| 12 | u32 | Bytes per index record |
| 16 | u64 | Record count |
| 24 | u64 | Reserved |

Each 68-byte index record contains:

| Offset | Type | Meaning |
| --- | --- | --- |
| 0 | u64 | System ID64 |
| 8 | u64 | Byte offset in the pack |
| 16 | u32 | Compressed JSON length |
| 20 | u32 | Original JSON length |
| 24 | u32 | Update timestamp, seconds after 2000-01-01 |
| 28 | u32 | Body count |
| 32 | u32 | Station count |
| 36 | u32 | Rich-data feature flags |
| 40 | u32 | Body-type bitmask |
| 44 | u32 | Atmosphere bitmask |
| 48 | u32 | Ring-material bitmask |
| 52 | u32 | Volcanism bitmask |
| 56 | u32 | Economy bitmask |
| 60 | u32 | Security bitmask |
| 64 | u32 | Government bitmask |

The index is sorted by ID64 and can be binary-searched without loading it into
Node memory. The Rust importer uses available RAM to sort efficiently, while
pack and index writes remain sequential.

## Map filter sidecars

The full JSON records are too large to open while drawing hundreds of thousands
of stars. A base galaxy import therefore creates a 40-byte summary beside every
available LOD record:

| Offset | Type | Meaning |
| --- | --- | --- |
| 0 | u32 | Feature flags |
| 4 | u32 | Body count |
| 8 | u32 | Station count |
| 12 | u32 | Body-type bitmask |
| 16 | u32 | Atmosphere bitmask |
| 20 | u32 | Ring-material bitmask |
| 24 | u32 | Volcanism bitmask |
| 28 | u32 | Economy bitmask |
| 32 | u32 | Security bitmask |
| 36 | u32 | Government bitmask |

Feature flags currently cover full-data availability, bodies, stations,
population, factions, powers, Thargoid-war data, markets, shipyards,
outfitting, body signals, and landable bodies.

The importer reads `systems.bin` once in system-index order and writes each
sidecar sequentially. This avoids random writes across the multi-gigabyte LOD
files. Sidecar space is 40 bytes per point in each LOD, or roughly 7.6 GB for a
190-million-point full LOD plus the smaller LOD levels.

Selections inside one category are represented as an OR bitmask, while
different categories combine with AND. The current interface exposes one value
per category, but the file and server formats already support multi-value
requests.

## Commands

Build the importer after Rust source changes:

```powershell
npm run native:build
```

Import an already-downloaded full dump named `galaxy.json.gz`:

```powershell
npm run import:galaxy
```

The same local import can be started from **Data > Update controls > Import full
data**. The app requires a confirmation because this is a long-running,
disk-intensive operation. Its progress messages appear in the existing update
status area.

Inspect a sample of the local dump without importing it:

```powershell
npm run inspect:galaxy
```

Download and stream the current full dump directly:

```powershell
npm run import:galaxy:download
```

Apply later rich-data deltas:

```powershell
npm run import:galaxy-delta:1day
npm run import:galaxy-delta:7days
npm run import:galaxy-delta:1month
```

Optional importer tuning arguments can be appended after `--`:

```powershell
npm run import:galaxy -- --threads 24 --compression-level 3 --batch-size 1024
```

Compression level `3` is the default and is intended to balance import time and
disk space. Increasing it will substantially increase CPU time on the full
dump.

Build the default-off **Murder Binaries** overlay from the installed rich-data
packs:

```powershell
npm run import:murder-binaries
```

This scans the rich pack sequentially and flags systems containing a secondary
star between 5 and 12 light-seconds from arrival, inclusive. It writes a compact
`data/murder-binaries.bin` coordinate index, `murder-binaries-names.txt`, and a
small `murder-binaries-meta.json` descriptor without modifying the galaxy
packs. The server returns only the nearest warnings around the current view.
The same analysis is available under **Data > Update controls > Build murder
binaries** with a confirmation because it reads the complete installed pack.

Results produced by the earlier JSON implementation can be converted without
rescanning the galaxy pack:

```powershell
npm run import:murder-binaries:index
```

## Server API

`GET /api/status` reports the installed rich-data segments.
Delta segment counts are reported separately because the same ID64 can occur in
the base and one or more deltas.

`GET /api/system-rich?id64=<unsigned-id64>` returns the complete preserved
Spansh system object plus the index summary for that record. All `id64` values
are returned as strings so JavaScript cannot round unsigned 64-bit identifiers.

`GET /api/points` accepts the optional rich summary filters `richData=1`,
`hasStations=1`, `populated=1`, `landable=1`, `markets=1`, `shipyards=1`,
`outfitting=1`, `signals=1`, and `minBodies=<count>`. Detailed filters use
`bodyType`, `atmosphere`, `ringType`, `volcanism`, `economy`, `security`, and
`government`; comma-separated values within one detailed filter are ORed.

The existing `/api/system`, search indexes, journal systems, and brief-system
delta imports remain separate from the full-data store. Search results continue
to override display filters.

## Local spatial detail

The whole-galaxy map uses heavily sampled LOD files, so a nearby system may not
exist in the global browser payload. Build `data/systems-spatial.bin` and
`data/systems-spatial.idx` from the full-resolution LOD with:

```powershell
npm run import:spatial-index
```

Points are grouped into 100 light-year cells after an in-memory parallel sort,
then written sequentially. The server normally merges systems within 1,000 ly
of the view target. Dense regions progressively contract to 500, 200, or 100
ly and return the nearest bounded set. Local request and draw budgets also
decrease as the camera zooms out. The global LOD remains visible for distant
context. System delta completion and in-app system updates rebuild this index
before journal refresh.

## Journal body overlay

Journal scans write discovered body details to `data/journal-bodies.json`.
Records are keyed by the journal's exact `SystemAddress` and body ID. Latest
journal scans merge into this file, while an all-journals scan rebuilds it from
the available logs.

`GET /api/system-rich` overlays journal fields onto the matching full-galaxy
record. Journal body data can also be returned on its own when a system has not
yet appeared in the Spansh full dump. A later full import therefore adds the
remaining system fields without discarding locally scanned bodies.
