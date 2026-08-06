# Phase 5 报告（2026-08-06）—— 专辑模式与素材库

## 落盘改动

### server.js
- `LIBRARY_PATH` / `outputDir()` 支持 `GEJUESHI_LIBRARY_PATH` / `GEJUESHI_OUTPUT_DIR`
  环境变量覆盖（测试隔离，不污染真实数据）
- 修复素材库入库顺序 bug：autoOrganizeAlbum 先于 push 执行，
  albumId 现在能正确写入曲目 → 专辑分组生效
- autoOrganizeAlbum 改用 `albumName || albumTitle`；库接口同样兼容两者
- `/api/save-export` 支持 `contentType: "text/html"`（卡片 HTML 落盘）
- `/api/library/album-dirs` 同时统计 .html 与 .png

### public/app-v5.html
- Step4 新增“所属专辑”输入框（meta-album，留空=未分组）
- 单曲卡生成后：HTML 写入 `output/{所属专辑}/{艺人}_{歌名}.html`；
  素材库 track 带 `songTitle` + `albumName`，不再用歌名当专辑名
- 专辑卡生成后同样落盘 `output/{专辑}/{专辑}_album_card.html`
- 修复 `cardHTML.includes("error")` 误判 → 改用 HTTP 状态码
- 专辑模式分组/占位/自动填充改用 albumName

## 验证

- 新增 `services/test_album_flow.js`（集成测试，临时库+临时输出目录）：
  入库 albumName → 专辑分组 → HTML 落盘 → album-dirs 可见 → 专辑卡渲染 ✅
- npm test：7 项通过；node --check 通过
- 顺带修复了历史遗留 bug：素材库曲目 albumId 从未写入（albums.tracks 恒空）

## 说明

- 旧数据兼容：`albumTitle` 仍被接受（读路径回退）
- 单曲模式分析后若“所属专辑”留空，卡片归入 output/未分组/
