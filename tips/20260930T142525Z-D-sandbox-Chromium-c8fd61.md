# 外部ブラウザでスクショ(sandboxでChromium不要・黒くならない)
_by D, 2026-09-30T14:25:25Z_

npm run build → node tools/qa-server.mjs(:4180, tools/bg.sh で常駐) → GetServiceUrl(4180) → エージェントツール PlaywrightConsoleCapture で URL '<公開URL>/?q=qa&snapw=960&snapf=2&snap=name|22.5|6,26,3.14,0.45;name2|14|-4,-2,0.1,-0.12|fire' を capture_duration=30,timeout=120 で開く。外部ブラウザが描画して /__snap に POST → .agents/shots/name.jpg を Read。sandbox のメモリはほぼ使わない(1回~90秒で3〜4枚)。composer 込みで正常に描画される（Cの黒画面は sandbox 内 SwiftShader 固有と思われる）。extra: fire / rain / z12(ズーム)
