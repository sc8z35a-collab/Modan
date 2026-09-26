# Agent pipeline report

- time: 2026-09-26T11:18:49.563Z
- LLM API: **unavailable** (free_plan_block)
- agents: 6 in parallel
- result: **ALL PASS** in 5151ms

## ✅ asset-agent (100ms)
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

## ✅ build-agent (4797ms)
```json
{
 "bundleKB": 1040,
 "buildMs": 4797,
 "lintedFiles": 21
}
```
- review: local (LLM free_plan_block)

## ✅ shader-agent (74ms)
```json
{
 "files": 8
}
```
- review: local (LLM free_plan_block)

## ✅ perf-agent (48ms)
```json
{
 "ultra": "pixelRatio: 2.0, shadow: 4096, ao: true, aoHalf: false, grass: 1.0, trees: 1.0, water: 0.6, bloom: true, smaa: true",
 "grassBlades": 400000,
 "treeAttempts": 26000,
 "pointLights": 6,
 "snap_camp": {
  "tris": 4976436,
  "calls": 2238
 },
 "snap_lake": {
  "tris": 4896662,
  "calls": 2146
 },
 "snap_night": {
  "tris": 4841485,
  "calls": 2119
 },
 "snap_pcamp": {
  "tris": 5015032,
  "calls": 2217
 }
}
```
- review: local (LLM free_plan_block)

## ✅ mobile-agent (13ms)
- review: local (LLM free_plan_block)

## ✅ visual-agent (367ms)
```json
{
 "camp.png": {
  "mean": 91.2,
  "contrast": 41.8,
  "clipHi": 0.02,
  "clipLo": 0.12,
  "sat": 0.373
 },
 "lake.png": {
  "mean": 99.7,
  "contrast": 41.6,
  "clipHi": 0,
  "clipLo": 0.09,
  "sat": 0.254
 },
 "night.png": {
  "mean": 24.8,
  "contrast": 30.5,
  "clipHi": 0.04,
  "clipLo": 28.63,
  "sat": 0.682
 },
 "pcamp.png": {
  "mean": 92.6,
  "contrast": 38.5,
  "clipHi": 0.05,
  "clipLo": 0.1,
  "sat": 0.415
 }
}
```
- review: local (LLM free_plan_block)
