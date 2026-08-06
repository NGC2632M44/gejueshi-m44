# Phase 3 报告（2026-08-06）—— 外部源与 MIR 面板

## SongBPM 解析器（已单独提交）

- fixture：`scripts/fixtures/songbpm-wet-wild.html`（2026-08-06 实测抓取）
- `parseSongBPMHtml()`：适配当前页面结构（BPM span + Key <dd> + 正文 mode）
- 单测：services/test_songbpm_parser.js → 128 BPM / A minor ✅
- 仅支持手动 URL（搜索页 URL 带随机后缀，自动定位不可行，用户已确认）

## MIR 面板透明化（app-v5.html）

- 逐源显示状态 chip：✅ 可用 / ○ 无数据 / △ 未配置 / ✕ 失败 / ⊘ 已下线
- 零外部源时显示横幅，不再把本地单源结果标成 network_mir_calibrated
- MIR 请求失败时状态栏明确提示；重复分析不再累加“→ 推荐”文本
- 研究接口 errors 在前端评分条显示（代理未开等不再静默）

## 代理可配置

- `GEJUESHI_PROXY_URL` 环境变量，默认 127.0.0.1:1001
- 覆盖：researcher.js、mir-cross-ref.js、server.js 全部 4 处 HttpsProxyAgent

## 死代码清理（已确认零引用后删除）

- AcousticBrainz：/api/song-lookup、/api/mir-lookup 中的调用分支已删（服务已下线）
- DDG/RYM/AOTY：researcher.js 中 searchDDG/parseRYM/parseAOTY/parseDiscogs/
  extractDDGLinks/decodeURL 全部删除
- script-generator.js + /api/generate：删除；public/index.html 改为跳转 app-v5.html
- /api/publish、/api/publish/stats：删除（前端无引用）
- scripts/scrape_rym.py：删除（零引用）

## 未做（按方案等待用户条件）

- getsongbpm 官方 API：等你提供 Key 后先冒烟再接入
- Genius API：等你提供 Token
- Spotify：默认不可用（2024-11-27 起新应用受限 + Developer Mode 需 Premium）

## 验证

- node --check 全部通过；4 项 JS 单测通过
- 冒烟（PORT 3101 + mock AI）：SMOKE PASS；/api/generate 404；/ 重定向 app-v5.html ✅
