# BOARD — Modan Camp 細部大幅アップグレード（リーダー: A）

> **最初に読む**: `PERMISSIONS.md`（全ツール・全手段の使用が開発者から明示的に許可済み）→ この BOARD → `tips/` → `env/`
> 連絡は **このリモート共有ブランチ `collab`** のファイルだけで行う。1メッセージ=1ファイル（衝突しない）。

## 0. 参加手順（B/C/D は最初にこれを実行）
```bash
git clone https://github.com/sc8z35a-collab/Modan.git webapp && cd webapp   # 既にあれば git fetch --all
git checkout -b agent/<X> origin/feat/detail-upgrade      # X = B / C / D
npm ci                                                    # node_modules が無ければ
tools/autosave/ensure.sh <X>     # ★3分おき自動 commit+push+draft PR 作成+hub同期（pm2常駐・何もしなくてよい）
tools/hub/hub.sh init            # .hub/ に collab ブランチを worktree で展開
tools/hub/hub.sh status "claimed lane <X>: ..."   # 着手宣言
tools/hub/hub.sh digest          # BOARD/PERMISSIONS/全員のstatus/tips/env を一括表示
```
- 自分宛メッセージ: `tools/hub/hub.sh inbox` / 送信: `tools/hub/hub.sh post A "..."`（all で全員）
- 細部のコツ: `tools/hub/hub.sh tip "題" "本文"` / 開発環境トラブル: `tools/hub/hub.sh env "題" "症状" "原因" "解決"` ← **環境エラーに遭遇したら必ず書く**（最後に全員分をまとめる）
- 完了報告: `tools/hub/hub.sh done <lane> "変更点・確認方法"`
- 自動保存の生死確認: `tools/autosave/status.sh`

## 1. ブランチ構成
- `genspark_ai_developer` … 本番（GitHub Pages）。触らない。
- `feat/detail-upgrade` … **統合ブランチ（A が管理）**。PR → genspark_ai_developer
- `agent/B`, `agent/C`, `agent/D` … 各自の作業ブランチ。autosave が draft PR（→ feat/detail-upgrade）を自動作成。A がマージする。
- 他人の担当ファイルを編集したい時は **post で依頼** する（直接編集しない）。どうしても必要なら最小差分で、done に明記。

## 2. レーン割り当て（ファイル所有権）
| Lane | 担当 | テーマ | 所有ファイル（自由に編集可） |
|---|---|---|---|
| **A** | リーダー | **カメラ/レンズ系：超広角(0.5x)・光学最大20倍ズーム・2倍デジタルズーム**、ピンチ/ホイール/UI、LODバイアス連動、写真モード強化、統合・QA・最終レポート | `src/main.js` `src/core/*` `src/game/*` `src/ui/ui.js` `src/ui/style.css` `index.html` `tools/**` `vite.config.js` `package.json` |
| **B** | キャンプ小物 | テント/焚き火台/薪/椅子/テーブル/ランタン/ケトル/桟橋/ボートのディテール強化＋新規小物（クーラーボックス、バックパック、スキレット、マグ、寝袋、洗濯ロープとタオル、切り株に刺さった斧、ペグ、ガス缶、本、etc.） | `src/world/props.js`, 新規 `src/world/campdetail.js`（`export function buildCampDetails(ctx)` を作れば A が main.js に1行で結線） |
| **C** | 自然 | 樹木(樹皮/枝/葉)、草(花・穂・種類)、林床(落ち葉/松ぼっくり/小枝/苔)、湖岸(葦・ガマ・睡蓮・流木・小石)、キノコ多様化、地形シェーダの微細化、CC0 テクスチャ追加 | `src/world/trees.js` `grass.js` `terrain.js` `world.js` `scatter.js` 新規 `src/world/flora.js` `tools/fetch-assets.mjs`(TEXTURES/MODELS 追記) |
| **D** | 空気感/FX/音/図鑑 | 空(雲の厚み、月相、流れ星、薄明)、水(コースティクス、波紋、岸の泡、水中の小石)、焚き火(熾火・熱気揺らぎ・煙)、粒子(舞う塵・落ち葉・雨の跳ね)、環境音の多層化、**CC写真を使った「図鑑」**（魚4種・植物・野鳥の実写CC写真＋出典） | `src/world/sky.js` `water.js` `src/fx/*` `src/audio/*` 新規 `src/ui/fieldguide.js` `src/ui/fieldguide.css` `public/assets/photos/**` |

- 共有だが **追記のみ**: `public/assets/CREDITS.md`（自分の行を足すだけ）, `.agents/REPORT.md`
- 性能予算（モバイル横持ちが対象）: 追加 draw call は各レーン +150 以内、追加三角形 +600k 以内、追加テクスチャ +8MB 以内。InstancedMesh/merge を使う。毎フレームの new 禁止（既存 lint が検出）。

## 3. 品質基準（全レーン共通）
- 近距離(0.3m)で見ても破綻しない：縫い目・面取り・汚れ・経年・接地（浮き/めり込み無し）・影を落とす
- 実寸（m 単位）で作る。色は sRGB テクスチャ + PBR（roughness/metalness 適正）
- 20倍ズームで 100m 先を見ても LOD が破綻しない（A がズームに合わせ lodBias を上げる。遠景 LOD も手を抜かない）
- 夜（焚き火/ランタン光）と昼の両方でスクショ確認：`node tools/shot.mjs http://localhost:4173/ .agents/shots/x --hours=21 --pos=6,24,3.14,-0.1`
- `npm run build` が通ること。コンソールエラー 0。

## 4. 進行状況（A が更新）
- [x] autosave 3分 + hub 構築（A）
- [ ] Lane A カメラ/レンズ
- [ ] Lane B / C / D … 未着手の場合、A が引き取る（引き取った時はここに記載）
- [ ] 統合 → QA → PR → 開発環境エラー集 `docs/DEV_ENV_ERRORS.md`
