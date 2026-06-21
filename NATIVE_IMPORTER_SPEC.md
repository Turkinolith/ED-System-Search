# Native Importer Spec

The web app stays JavaScript. Large Spansh preprocessing moves to a Rust helper that writes the same generated files the app already reads.

## Current Contract

The native importer must preserve these files in `data/`:

- `systems.bin`: 32-byte little-endian records.
- `systems-names.txt`: concatenated UTF-8 names.
- `systems-search.tsv`: `lowerName<TAB>name<TAB>index<TAB>typeCode<TAB>x<TAB>y<TAB>z`.
- `systems-updates.u32`: one little-endian update timestamp per system, seconds since `2000-01-01T00:00:00.000Z`.
- `systems-lod-0.bin` through `systems-lod-6.bin`: 20-byte point records.
- `systems-meta.json` and `systems-updates-meta.json`.

Record layout remains:

| Bytes | Type | Meaning |
| --- | --- | --- |
| 0..4 | f32 | x |
| 4..8 | f32 | y |
| 8..12 | f32 | z |
| 12..14 | u16 | type code |
| 14..16 | u16 | flags |
| 16..20 | u32 | name offset |
| 20..22 | u16 | name byte length |
| 22..24 | u16 | reserved |
| 24..32 | u64 | id64 |

Flags:

- `1`: permit required.
- `2`: non-standard primary star.

## Commands

Full systems import:

```powershell
npm run native:build
npm run import:systems:native -- --source D:\path\systems.json.gz
```

Delta systems import:

```powershell
npm run import:systems-delta:1month
```

The JS launcher uses the Rust executable when present and falls back to the existing JS importer when it has not been built.

## Delta Strategy

The Rust delta importer does not build a 190M-entry all-system name map.

1. Load only the delta dump into memory by normalized system name.
2. Scan `systems-search.tsv` once to find existing indexes for those names.
3. Rebuild the binary/search/update/LOD outputs sequentially.
4. Append delta systems that were not found in the existing index.
5. Maintain `data/name-lookup-overlay.tsv` with exact-name rows for systems changed or added since the last full lookup rebuild.
6. Maintain `data/suggest-overlay.tsv` with search/typeahead rows for systems changed or added since the last full suggestion rebuild.

Memory is proportional to the update dump, not the full galaxy.

The overlays let journal, carrier, and search/typeahead matching find freshly merged systems without running full `npm run import:name-lookup` or `npm run import:suggestions` compactions after every delta. Full rebuilds still rewrite `data/name-lookup/` or `data/suggest/` and clear the matching overlay.

## Future 105 GB Dump

The first Rust version intentionally extracts only system-level fields:

- `id64`
- `name`
- `mainStar`
- `coords`
- `needsPermit`
- `updateTime`

Serde ignores bodies, stations, factions, and other richer fields. That means the 105 GB dump can be streamed for system-level indexes first. Later passes can add new output families without changing the map files:

- `bodies-*` summaries.
- `stations-*` summaries.
- optional per-system detail stores keyed by system index or id64.

If `systems-names.txt` ever exceeds the current `u32` name-offset capacity, introduce a v2 record format instead of stretching the current binary contract.
