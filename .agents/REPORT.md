# Agent pipeline report

- time: 2026-09-26T09:53:36.961Z
- LLM API: **unavailable** (free_plan_block)
- result: **ALL PASS** in 5200ms

## ✅ asset-agent (57ms)
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
 "assetsMB": 21
}
```

## ✅ build-agent (4873ms)
```json
{
 "bundleKB": 1040,
 "buildMs": 4872
}
```

## ✅ shader-agent (35ms)
```json
{
 "files": 8
}
```
- review mode: local (LLM free_plan_block)

## ✅ perf-agent (11ms)
```json
{
 "ultra": "pixelRatio: 2.0, shadow: 4096, ao: true, aoHalf: false, grass: 1.0, trees: 1.0, water: 0.6, bloom: true, smaa: true",
 "grassBlades": 400000,
 "treeAttempts": 26000,
 "snap_camp2": {
  "tris": 4978212,
  "calls": 2204
 },
 "snap_forest": {
  "tris": 3098016,
  "calls": 1331
 },
 "snap_forest2": {
  "tris": 3178074,
  "calls": 1330
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
- review mode: local (LLM free_plan_block)

## ✅ mobile-agent (10ms)
- review mode: local (LLM free_plan_block)

## ✅ review-agent (9ms)
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
