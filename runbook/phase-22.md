# Phase 22 — 专辑模式曲目删除/时间/隐藏歌词（v3.21.0 · 2026-08-07）

## 一、已核实改动（verified）

- `DELETE /api/library/tracks/:id` 实测：创建临时曲目 → 删除成功
  （remaining 11→10），再次查询不存在
- 曲目列表显示入库时间（createdAt，旧数据可从 track_<时间戳> 推导）
- 专辑模式下 `#lyrics-section` 隐藏，切回单曲模式恢复

## 二、落盘清单

- `server.js`：DELETE /api/library/tracks/:id
- `public/app-v5.html`：曲目行 ✕ 删除按钮 + deleteLibraryTrack()；
  info 追加时间；toggleAlbumMode 隐藏/恢复歌词模块

## 三、测试

- `npm test`：41 项全绿
- `python -m pytest scripts/ -q`：9 项全绿（未动音频引擎）
