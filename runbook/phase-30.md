# Phase 30 — SongBPM 解析容错 + RYM 流派优先级（v3.29.7）

日期：2026-08-08

## SongBPM 解析失败

实测：
- `@rose-gray/wet-wild-njwcb`（正确详情页）→ 128 / A minor ✅
- `songbpm.com/song/.../MwoAGR` → 404 → 之前笼统报“无法解析该页面”
- `getsongbpm.com/search` → 403 Cloudflare

修复：
- `parseSongBPMHtml` 增加 JSON-LD、`span.bpm` 等结构兜底；
- `querySongBPMByUrl` 返回结构化错误（no_data / fetch_failed + detail）；
- 服务端把错误翻译成可读提示（404 / 非详情页 / 被拦截）。

## Step 4 流派

修复前：自动搜索的流派先填，RYM 流派后填不会覆盖。

修复后：
- RYM 流派（Step 2）优先自动填入 Step 4 流派；
- RYM 留空 → 使用自动搜索的流派（保存于 `window._autoGenre`）；
- 修改 RYM 输入框实时同步到 Step 4。

## 测试

- npm test 56 项全绿（新增 SongBPM JSON-LD / span.bpm 解析 2 项）
- app-v5 JS 语法检查通过
