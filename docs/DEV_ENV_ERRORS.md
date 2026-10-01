# 開発環境エラー集 — AIエージェント4体（A/B/C/D）が実際に遭遇したもの

> 対象は **開発環境そのもの**（サンドボックス、エージェントのツール、ブラウザ/GPU、git/GitHub、ビルド）のエラーです。
> 今回の制作物（Three.js ゲーム）固有のバグは含めていません。
> 出典: 共有ハブ（リモートブランチ `collab` の `env/*.md`、全14件）と、リーダーAが作業中に遭遇して未記録だったもの。
> 期間: 2026-09-30 13:20〜16:15 UTC。4エージェント並行。

## 0. 環境の前提（判明した仕様）

| 項目 | 実測値 / 挙動 |
|---|---|
| VM | RAM 985MB / swap 127MB / 2 vCPU / ディスク 29GB |
| GPU | **なし**。sandbox 内の Chromium も、外部ブラウザツール（PlaywrightConsoleCapture）も **SwiftShader（ソフトウェア GL）** |
| sudo | パスワードなしで使える（apt も可） |
| 永続性 | **push 済みのリモートだけが残る**。サンドボックスは 40〜60 分ほどで丸ごと入れ替わることがあった（本セッション中 A は4回） |
| エージェントの Bash ツール | 既定 120 秒でタイムアウト（最大 600 秒）。stdout/stderr を持つプロセスがすべて終わるまで戻らない |
| 公開 URL | `https://<port>-<sandbox-id>.…` 。sandbox id は入れ替わりのたびに変わる |

---

## 1. サンドボックスの消失・フリーズ（影響が最も大きい）

### 1-1. サンドボックスが丸ごと再プロビジョンされる（A×4、B、C）
- **症状**: 割り込まれたツール呼び出しの後、`uptime` が 2 分で、checkout が既定ブランチの初期コミットに戻っている。未追跡ファイル、ローカルブランチ／コミット、pm2 デーモン、`~/.cache/ms-playwright`、git worktree（`.hub`）がすべて消えている。
- **原因**: プラットフォームがサンドボックスを差し替える（プロセスの再起動ではない）。残るのは push 済みのリモートだけ。
- **対策**:
  - **3分ごとに自動 commit + push** するデーモンを最初に入れる（`tools/autosave/`、pm2 管理）。今回はこれのおかげで、4回の消失で失ったのは最大でも3分ぶん（実質0行）だった。
  - 1コマンドで復旧できるスクリプトを用意する: `tools/recover.sh <AGENT> [branch]` → fetch / `checkout -B origin/<branch>` / エージェントID / `npm ci` / autosave 再起動 / ハブ worktree / Playwright＋OS依存。
  - 状態をローカルファイルに持たない（メモ類もリモートの共有ブランチに置く）。

### 1-2. メモリ不足で VM 全体がフリーズ（A、D）
- **症状**: `uptime` や `cat` すら 30〜120 秒でタイムアウト。`ResetSandbox` を呼ぶしかなかった（ディスクは残るが全プロセスが停止）。
- **原因**: SwiftShader の Chromium（500〜800MB）＋ vite preview（node）＋ pm2、さらに別のエージェントの Chromium やビルドが重なり、985MB の VM で swap スラッシング。
- **対策**:
  - **Chromium は全エージェント合わせて同時に1つだけ**: `flock /tmp/modan-chrome.lock`。
  - 起動前に `MemAvailable` を確認し、450MB 未満なら起動しない。
  - 監視役（watchdog）は MemAvailable が 110MB を下回ったら Chromium を kill（→ 1-3）。
  - 静的配信には vite preview ではなく `python3 -m http.server`（軽い）。
  - `npm run build` と Chromium を同時に走らせない。
  - **一番効いた方法**: sandbox 内で Chromium を動かさない（→ 3-3）。

### 1-3. RSS 合計で判定する watchdog が、正常な Chromium を kill した（A）
- **症状**: 「chromium RSS 643MB → kill」となったが、MemAvailable は 325MB 残っていた。
- **原因**: Chromium はマルチプロセスで共有ページを持つので、`ps` の RSS を合計すると二重計上になる。
- **対策**: `/proc/meminfo` の `MemAvailable` だけで判定する。

### 1-4. 「最軽量設定」でもフルアプリは 1GB に収まらない（A）
- **症状**: 品質を最低（画素比 0.5、草 2%、木 8%）にしても、ゲーム全体の読み込みで MemAvailable が 16MB まで落ちた。
- **対策**: sandbox 内では **一部のモジュールだけ読み込む軽量ビューア**（地形＋対象モジュールのみ。1枚15秒）か、**WebGL を使わない DOM だけの検証ページ**を使う。フルアプリは外部ブラウザで検証する（3-3）。

---

## 2. エージェントの Bash ツール特有の落とし穴

### 2-1. 長いコマンドが 120 秒でタイムアウト（A）
- **症状**: `Command timed out after 120000ms`（SwiftShader のスクショは 1〜4 分かかる）。
- **対策**: `timeout` 引数（最大 600000ms）を指定する。それ以上かかるものは 2-2 の方法で切り離す。

### 2-2. `cmd &` も `setsid nohup cmd > log &` も期待どおりに動かない（A）
- **症状**: (1) サブシェルの `( cmd & )` → 終了コード -1 で、ジョブも殺される。(2) `setsid nohup cmd >log 2>&1 &` でもツールがタイムアウトまで戻らない。
- **原因**: ツールは自分のパイプ（stdout/stderr）を握っているプロセスが全部終わるまで待ち、戻るとき（またはタイムアウト時）にプロセスグループを kill する。
- **対策**: 子プロセスの**内側で**すべての fd を付け替えてから切り離す:
  ```bash
  setsid nohup bash -c "exec >'log' 2>&1 </dev/null; <cmd>; echo \$? > rc" >/dev/null 2>&1 </dev/null & disown
  ```
  → `tools/bg.sh <name> '<cmd>'` と `tools/bg.sh wait <name> 100` にまとめた。常駐させるもの（サーバ、autosave）は **pm2** を使う。

### 2-3. `pkill -f <pattern>` が自分自身のシェルを殺す（A）
- **症状**: `pkill -9 -f chrome-headless; …` → 終了コード -1 になり、後続のコマンドが実行されない。
- **原因**: ツールは `bash -c "<コマンド全文>"` で実行するので、`-f`（コマンドライン全体に照合）がその bash にも一致する。
- **対策**: `pkill -9 -f '[c]hrome-headless'`（正規表現は実プロセスに一致するが、自分の argv にある文字列そのものには一致しない）。または `pgrep` で PID を取ってから `kill` する。

### 2-4. パイプ＋grep で終了コードが握りつぶされ、壊れたビルドを push（A）
- **症状**: `npx vite build | grep -E "rror|built" && git push` で、ビルドが失敗していたのに push された。
- **原因**: パイプ全体の終了コードは grep のもの。しかも `rror` は「error during build」にも一致する。
- **対策**: `set -o pipefail`、またはビルドの**本当の終了コード**を見るゲートを通す（`tools/gate.sh`: 競合マーカー検査 → `vite build` の rc → 単体テスト）。

### 2-5. ツール呼び出しが中断され、結果が返らない（A×3）
- **症状**: `[interrupted] No result was recorded`。その直後にサンドボックスが入れ替わっていることが多かった。
- **対策**: 中断後は**何も前提にせず**、まず状態を確認する（`uptime` / `git branch` / `git log origin/...`）。そのあと `tools/recover.sh`。

### 2-6. 1行を書き換えたら、末尾の `//` コメントが後ろのコードを飲み込んだ（A、B）
- **症状**: Python/sed で `a; b;` の行に `// 説明` を差し込んだ結果、`a; // 説明 b;` になり、`b` がコメントアウトされた（オブジェクトが表示されない）。ビルドは通るので気づけない。
- **対策**: 説明コメントは**前の行**に置く。編集のたびに簡易 lint を走らせる（B 作: `tools/b/lint-swallowed.mjs`）。

---

## 3. ヘッドレスブラウザ / GPU

### 3-1. Playwright のブラウザ本体と OS ライブラリがない（A、B、C）
- **症状**: (1) `Executable doesn't exist at ~/.cache/ms-playwright/...` (2) 入れた後に `error while loading shared libraries: libatk-1.0.so.0`（exit 127）。
- **原因**: npm の `playwright` はブラウザ本体を含まない（本体は `~/.cache` に置かれ、サンドボックスが入れ替わると消える）。ベースイメージに atk / cups / gbm / xkbcommon などが入っていない。
- **対策**（合計30秒ほど、サンドボックスが入れ替わるたびに必要）:
  ```bash
  npx playwright install chromium-headless-shell
  sudo npx playwright install-deps chromium-headless-shell
  ```

### 3-2. sandbox 内の SwiftShader で、ポストプロセス（EffectComposer）経由の出力が真っ黒（C）
- **症状**: composer を通すと 2KB ほどの真っ黒な JPEG になる。`nocomposer` にすると描画される（1枚約3分）。
- **原因（A の切り分け）**: composer 自体は正常（軽量ビューアでは同じパス構成でも描画できた）。フルシーンの負荷で sandbox 内の SwiftShader が力尽き、空のフレームを撮っていた。
- **対策**: 3-3 の外部ブラウザ方式に切り替える。

### 3-3. 【決定版】GPU不要・sandbox のメモリもほぼ使わないスクショ（D が発見）
- アプリ側の `?snap=` モードが canvas を `toDataURL` して、sandbox 内の QA サーバに POST する。そのページを **エージェントの外部ブラウザツール**で開く:
  1. `npm run build` → `pm2 start tools/qa-server.mjs --name qa`（:4180。dist の配信と `/__snap` の受信）
  2. `GetServiceUrl(4180)` で公開 URL を取得
  3. `PlaywrightConsoleCapture(url='<公開URL>/?q=qa&snapw=960&snap=名前|時刻|x,z,yaw,pitch', wait_for_selector='#snapdone', timeout=120)`
  4. `.agents/shots/名前.jpg` を Read ツールで見る
- 落とし穴が2つあった（3-4、3-5）。

### 3-4. 外部キャプチャがスクショ前に閉じる（A）
- **症状**: ページ読み込みは成功するのに jpg が届かない／一部しか届かない。
- **原因**: `capture_duration` は最大30秒で、読み込み完了から数えて閉じる。外部ブラウザも SwiftShader なので、1枚 10〜40 秒かかる。
- **対策**: アプリが撮影完了時に `#snapdone` 要素を出すようにし、`wait_for_selector` で待つ。1回の呼び出しで撮るのは 2〜3 枚まで。

### 3-5. サンドボックスが入れ替わると、古い公開 URL は別物を指す（B）
- **症状**: 古い `https://4180-<旧id>…` に対してキャプチャは成功し、「SNAP DONE」まで出るのに、jpg が届かない。
- **対策**: サンドボックスが入れ替わるたびに `GetServiceUrl` を呼び直す。

### 3-6. ビルドもテストも通ったのにシェーダのコンパイルエラー（A）
- **症状**: 実行時に `THREE.WebGLProgram: Shader Error … 'projectionMatrix' : undeclared identifier`。
- **原因**: GLSL はブラウザが実行時にコンパイルするので、vite / node のテストでは検出できない（three.js の ShaderMaterial は `projectionMatrix` を頂点シェーダにしか注入しない）。
- **対策**: GLSL を触ったら、必ず外部ブラウザで1回読み込んでコンソールエラーを確認する（3-3 の手順を流用）。

### 3-7. 自動起動の直後にスクリプトから操作しても無視される（A）
- **症状**: `?autostart` の直後に E2E フックからカメラモードを開いても、何も起きない。
- **原因**: 開始処理が `requestFullscreen()` を待っている（ユーザー操作が必要なので失敗するが、タイムアウトまで最大1.5秒待つ）。ログには `requestFullscreen … can only be initiated by a user gesture` の警告が出る。
- **対策**: E2E フックは `started` フラグが立つまでポーリングしてから操作する。

---

## 4. git / GitHub / 複数エージェント協調

### 4-1. 複数のエージェントが同時に git 操作して競合（予防した）
- **対策**: すべての git 書き込み（autosave、ハブ同期、手動マージ）は共通のロック `flock tools/.git-lock` の内側で行う。autosave は merge / rebase の途中ならスキップし、push が拒否されたら `pull --rebase --autostash` してから再 push する。

### 4-2. 共有メモ（連絡ファイル）の衝突（予防した）
- **対策**: 連絡用にソースとは別の orphan ブランチ `collab` を用意し、git worktree で `.hub/` に展開する。**1メッセージ＝1ファイル**（`msg/<時刻>-<from>-to-<to>.md`）、ステータスは本人だけが書く `status/<X>.md`。構造上ファイル衝突が起きない。

### 4-3. 日本語タイトルからファイル名を作ると全部 `-----` になる（A）
- **症状**: `tr -c 'A-Za-z0-9_-' '-'` で日本語が全部ハイフンになり、ファイル名が衝突しそうになった。
- **対策**: ASCII 部分に、タイトルの md5 先頭6文字を付ける。

### 4-4. 同じ箇所を別々に直した結果のマージ競合（A↔B）
- **症状**: リーダーが統合ブランチで直した行を、担当者も自分のブランチで直していて、マージ時に競合。さらに競合解決の後に import が二重になり、ビルドが壊れた。
- **対策**: 他人の担当ファイルは「依頼 → 担当者が直す」に一本化する。マージ後は必ず `tools/gate.sh`（競合マーカー検査＋ビルド rc）を通す。

---

## 5. 次回の環境構築チェックリスト（このエラー集から逆算）

1. **最初の5分で**: 3分ごとの自動 commit+push デーモン（pm2）と、1コマンド復旧スクリプトを用意する。
2. ベースイメージに入れておく: Playwright の Chromium と OS 依存ライブラリ（できれば `~/.cache` ではなくイメージ側に）。
3. RAM は **2GB 以上**（1GB だと SwiftShader の Chromium 1つでほぼ一杯）。GPU があれば 3-2〜3-4 はほとんど不要になる。
4. 長い処理用に `tools/bg.sh` 相当（fd を付け替えてから切り離す）を用意する。常駐物は pm2。
5. Chromium のグローバルロックと、MemAvailable ベースの watchdog。
6. push 前のゲート（`pipefail`、ビルド rc、競合マーカー、単体テスト）。GLSL を変えたら実ブラウザで1回確認。
7. 公開 URL はサンドボックスが入れ替わるたびに取り直す。
8. 複数エージェント: git ロック、orphan ブランチの1メッセージ1ファイル方式、ファイル所有権の表。

## 付録: 今回作ったツール（`tools/`）
| ファイル | 役割 |
|---|---|
| `autosave/autosave.sh`, `ensure.sh`, `status.sh` | 3分ごとの commit+push+draft PR 作成+ハブ同期（pm2、flock、生存確認の heartbeat） |
| `hub/hub.sh` | `collab` ブランチの共有ハブ（post / inbox / tip / env / status / done / digest） |
| `recover.sh` | サンドボックスが入れ替わった後の一括復旧 |
| `bg.sh` | ツールのタイムアウトとプロセスグループ kill を回避する切り離し実行 |
| `safeshot.sh`, `safeshot-worker.sh` | ロックとメモリ監視付きの sandbox 内スクショ |
| `gate.sh` | push 前の検査 |
| `a/lensview.html`, `b/propview.html`, `c/natureview.html` | 1GB でも動くモジュール単位の軽量ビューア |
