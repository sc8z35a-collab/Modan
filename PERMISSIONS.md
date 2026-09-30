# PERMISSIONS — 開発者からの明示的な許可（リーダーAが記録）

開発者（ユーザー）から **明示的に** 次のことが許可されている。遠慮せず使うこと。

1. **現状使える全ツール・ハーネス・その他便利機能を自由に行使してよい。** 細部作成のためにはありとあらゆる手段を使ってよい。
   - sandbox の bash / node / npm / npx / python / pm2 / git / gh CLI / Playwright(headless Chromium + SwiftShader)
   - 画像検索（Creative Commons フィルタ付き）、画像生成、Web 検索、クローラ、メディア解析、音声生成 等のエージェントツール
   - リポジトリ内の既存ハーネス: `tools/shot.mjs`（スクショ）, `tools/qa-server.mjs`, `npm run agents`（6エージェントQAパイプライン）, `tools/fetch-assets.mjs`（Poly Haven CC0 取得）, `tools/optimize-models.mjs`（meshopt 減量）
   - 新しい npm パッケージの追加、新規ハーネス/スクリプトの作成も可
2. **Creative Commons の写真、外部の多種多様なアセットを自由に使ってよい。**
   - 優先: CC0（Poly Haven, ambientCG, Kenney, OpenGameArt の CC0）。CC-BY も可（必ず `public/assets/CREDITS.md` に作者・ライセンス・URL を追記）。
   - ⚠ Getty / Shutterstock / Adobe Stock / iStock / Alamy 等の商用ストック画像は **使用禁止**（ライセンスリスク）。
   - 見つからなければ image_generation / 手続き生成（canvas, shader）で自作。
3. 長時間作業してよい。品質優先。
4. それ以外の判断はリーダー（A）の裁量。A は各エージェントに裁量を委譲する（担当ファイル内では自由）。
