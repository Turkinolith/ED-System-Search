# Elite Dangerous System Search

A local desktop web application for exploring the Elite Dangerous galaxy. It
turns Spansh system dumps into compact local indexes, renders the galaxy as an
interactive 3D map, and enriches it with player journals, full body and station
records, notes, points of interest, and exploration overlays.

The application runs entirely on your computer. Generated databases, journal
history, and notes stay under `data/` and are excluded from Git.

## Highlights

- Interactive 3D galaxy map with orbit, pan, vertical movement, rotation,
  adaptive grids, distance guides, focus controls, and landmark bearings.
- Full-resolution local spatial detail merged with the sampled global LOD,
  using a 1,000 ly radius normally and adaptive 500/200/100 ly radii in dense
  regions.
- Fast fuzzy system search with suggestions and filter-overriding results.
- Star colors and sprites based on primary-star class, including distinct
  treatment for black holes, neutron stars, white dwarfs, protostars, giants,
  and supergiants.
- Automatic star-marker scaling from a clear local view to an uncluttered
  whole-galaxy view, plus a manual scale control.
- Persistent visited-system rings, latest-journal focus, carrier tracking, and
  incremental or full journal rescans.
- Journal-only systems and discovered body data are preserved even when the
  system is absent from the current Spansh dataset.
- Per-system notes with tooltip display, an all-notes view, and keyword search.
- EDAstro POIs and discovery overlays for nebulae, carriers, stellar features,
  stations, sightseeing locations, AA-A h sectors, rare valuable worlds, and
  Explorarium categories.
- Optional full-galaxy records for bodies, stations, economies, security,
  government, atmospheres, volcanism, rings, signals, and other system details.
- Rich map filters for stations, population, body counts, body types,
  atmospheres, ring materials, volcanism, economies, security, and government.
- Default-off **Murder Binaries** caution overlay for systems with a secondary
  star between 5 and 12 light-seconds from arrival.
- In-app controls for system deltas, full-data imports, places, discoveries,
  journals, and long-running update progress.

## Requirements

- Windows 11
- A current Node.js LTS release
- Stable Rust toolchain with `cargo`
- Substantial free disk space for Elite Dangerous dump data

The source tree is small, but generated datasets are not. A complete rich
galaxy installation can require hundreds of gigabytes. At least 32 GB of RAM is
recommended for large imports; more memory improves the native import path.

## Quick Start

### 1. Clone and build

```powershell
git clone <repository-url>
cd <repository-folder>
npm run native:build
```

This project currently uses only Node.js built-in modules, so there are no npm
packages to install. The Rust build creates the high-throughput importer used
for large system and galaxy dumps.

### 2. Import the base system map

Download `systems.json.gz` from [Spansh Dumps](https://spansh.co.uk/dumps) and
place it in the project root, then run:

```powershell
npm run import:systems
npm run import:updates
npm run import:name-lookup
npm run import:suggestions
npm run import:spatial-index
```

These commands create the compact binary map, update-time index, exact-name
lookup, search suggestions, and a 100 ly-cell spatial index under `data/`. The
spatial index lets close views merge full local system detail with the sampled
whole-galaxy LOD. The downloaded dump can be deleted after a successful import.

### 3. Add optional overlays

```powershell
npm run import:places
npm run import:discoveries
npm run import:journals
```

Journal files are detected from the standard Windows location:

```text
%USERPROFILE%\Saved Games\Frontier Developments\Elite Dangerous
```

Set `EDSS_JOURNAL_DIR` before starting or importing to use another location.
Set `EDSS_DATA_DIR` to store generated data outside the project.

### Optional local carrier tracking

Personal settings are kept outside the Git-tracked source. Copy
`config.example.json` to `config.local.json`, then fill in only the values you
want to use. The local file is ignored by Git.

The `trackedCarrier` settings enable carrier journal matching, the persistent
map landmark, and the optional 500 ly range bubble. `fallbackCoords` may be
left as `null`. You can also point to a configuration file elsewhere by setting
`EDSS_CONFIG` to its path before importing journals or starting the server.

### 4. Start the application

Double-click `Start ED System Search.bat`, or run:

```powershell
npm start
```

Open [http://localhost:5177](http://localhost:5177).

## Full Galaxy Details

The regular systems dump provides names, coordinates, primary-star classes, and
basic system metadata. Bodies, stations, factions, markets, and detailed
properties come from Spansh `galaxy.json.gz`.

After importing the base system map, place `galaxy.json.gz` in the project root
and run:

```powershell
npm run import:galaxy
```

Alternatively, stream the current dump directly:

```powershell
npm run import:galaxy:download
```

Rich records are stored separately under `data/galaxy/`, keeping ordinary map
navigation fast. See [Full Galaxy Data Storage](docs/GALAXY_DATA_STORAGE.md) for
the pack/index format, filtering sidecars, and delta behavior.

Once rich data is installed, build the Murder Binaries overlay with:

```powershell
npm run import:murder-binaries
```

The scanner reads the rich pack sequentially, performs minimal writes, and
creates a compact binary coordinate index plus a small metadata file. The map
queries only the nearest 50 warnings around the current view, so nearly a
million caution systems do not have to be sent to the browser. It does not
alter the rich database.

## Updating Data

The Data panel exposes the normal update workflows with progress and safeguards
for large downloads. Equivalent command-line updates are:

```powershell
npm run import:systems-delta:1day
npm run import:systems-delta:1week
npm run import:systems-delta:2weeks
npm run import:systems-delta:1month
npm run import:systems-delta:6months
npm run import:systems-delta:finish
```

Rich-data deltas can be added without replacing the base pack:

```powershell
npm run import:galaxy-delta:1day
npm run import:galaxy-delta:7days
npm run import:galaxy-delta:1month
```

System-only updates preserve local journal systems and notes. Rich-data deltas
are searched newest-first when a system appears in multiple segments.

## Map Controls

| Input | Action |
| --- | --- |
| Left drag | Orbit around the current target |
| Right drag | Move the orbit point across the X/Z plane |
| Ctrl + right drag | Move the orbit point along the Y axis |
| Mouse wheel | Zoom |
| `W` / `S` | Move forward / backward |
| `A` / `D` | Move left / right |
| `R` / `F` | Move up / down |
| `Q` / `E` | Rotate counterclockwise / clockwise |

Keyboard movement is suspended while typing in search or another text control.
The rendered X axis is mirrored to align more closely with the in-game galaxy
map; stored and displayed coordinates are not modified.

## Data Sources

- [Spansh Dumps](https://spansh.co.uk/dumps): systems and full galaxy records
- [EDAstro Map Files](https://edastro.com/mapcharts/files.html): POIs and
  exploration overlays
- [Explorarium](https://github.com/CMDRRegza/Explorarium): public discovery
  categories
- Local Elite Dangerous player journal files

Third-party data remains subject to its source's terms and attribution
requirements. Explorarium data used with permission.
Elite Dangerous is a trademark of Frontier Developments plc.
This project is an unofficial community tool and is not affiliated with or
endorsed by Frontier Developments, EDAstro, Spansh, or Explorarium.

## Tests

```powershell
npm run test:galaxy
npm run test:journals
npm run test:stars
```

`test:galaxy` builds a small temporary rich-data fixture and verifies imports,
map filters, system details, Places integration.
## Repository Hygiene

The following are intentionally excluded from Git:

- Generated files under `data/`
- Downloaded `.json.gz` and `.csv.gz` dumps
- Player journals, visited history, notes, and carrier state
- Rust build output, logs, and local development metadata

Do not force-add these files. GitHub is for source code and documentation; dump
data should be downloaded directly from its original provider.
