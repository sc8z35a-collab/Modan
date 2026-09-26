# Agent pipeline report

- time: 2026-09-26T09:46:47.686Z
- LLM API: **unavailable** (free_plan_block)
- result: **ISSUES FOUND** in 5339ms

## ✅ asset-agent (91ms)
```json
{
 "boulder_01": 1965,
 "rock_moss_set_01": 3782,
 "tree_stump_01": 2460,
 "dead_tree_trunk": 5080,
 "fern_02": 2176,
 "shrub_01": 9225,
 "dry_branches_medium_01": 4197,
 "namaqualand_stones_01": 2800,
 "assetsMB": 35
}
```

## ✅ build-agent (4948ms)
```json
{
 "bundleKB": 1039,
 "buildMs": 4948
}
```

## ✅ shader-agent (60ms)
```json
{
 "files": 8
}
```
- review mode: local (LLM free_plan_block)

## ❌ perf-agent (31ms)
```json
{
 "ultra": "pixelRatio: 2.0, shadow: 4096, ao: true, aoHalf: false, grass: 1.0, trees: 1.0, water: 0.6, bloom: true, smaa: true",
 "grassBlades": 400000,
 "treeAttempts": 26000,
 "snap_camp_dusk": {
  "tris": 36525301,
  "calls": 2966
 },
 "snap_lake": {
  "tris": 4634059,
  "calls": 2096
 },
 "snap_night": {
  "tris": 4711311,
  "calls": 2070
 }
}
```
- snapshot camp_dusk.json: 36.5M tris > 12M budget
- review mode: local (LLM free_plan_block)

## ✅ mobile-agent (30ms)
- review mode: local (LLM free_plan_block)

## ✅ review-agent (29ms)
```json
{
 "changed": [
  "src/fx/fire.js",
  "src/main.js",
  "src/world/terrain.js",
  "src/world/trees.js",
  "src/world/world.js"
 ]
}
```
- review mode: local (LLM free_plan_block)
