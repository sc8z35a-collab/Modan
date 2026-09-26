# Agent pipeline report

- time: 2026-09-26T11:36:12.034Z
- LLM API: **unavailable** (free_plan_block)
- agents: 6 in parallel
- result: **ALL PASS** in 5344ms

## ✅ asset-agent (90ms)
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

## ✅ build-agent (4998ms)
```json
{
 "bundleKB": 1045,
 "buildMs": 4997,
 "lintedFiles": 21
}
```
- review: local (LLM free_plan_block)

## ✅ shader-agent (61ms)
```json
{
 "files": 8
}
```
- review: local (LLM free_plan_block)

## ✅ perf-agent (38ms)
```json
{
 "ultra": "pixelRatio: 2.0, shadow: 4096, ao: true, aoHalf: false, grass: 1.0, trees: 1.0, water: 0.6, bloom: true, smaa: true",
 "grassBlades": 400000,
 "treeAttempts": 26000,
 "pointLights": 6,
 "snap_lake": {
  "tris": 2286856,
  "calls": 1063
 },
 "snap_night": {
  "tris": 4924533,
  "calls": 2174
 },
 "snap_pcamp": {
  "tris": 5015032,
  "calls": 2217
 },
 "snap_tent": {
  "tris": 5693574,
  "calls": 2258
 }
}
```
- review: local (LLM free_plan_block)

## ✅ mobile-agent (14ms)
- review: local (LLM free_plan_block)

## ✅ visual-agent (335ms)
```json
{
 "lake.png": {
  "mean": 113.4,
  "contrast": 37.5,
  "clipHi": 0,
  "clipLo": 0.21,
  "sat": 0.299
 },
 "night.png": {
  "mean": 22.9,
  "contrast": 28,
  "clipHi": 0.06,
  "clipLo": 30.85,
  "sat": 0.611
 },
 "pcamp.png": {
  "mean": 92.6,
  "contrast": 38.5,
  "clipHi": 0.05,
  "clipLo": 0.1,
  "sat": 0.415
 },
 "tent.png": {
  "mean": 84.6,
  "contrast": 27.7,
  "clipHi": 0,
  "clipLo": 0.04,
  "sat": 0.27
 }
}
```
- review: local (LLM free_plan_block)
