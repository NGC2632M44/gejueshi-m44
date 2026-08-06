# Phase 8 报告（2026-08-06）—— GitHub 同步 + 封面残留修复

## GitHub 同步

- 用 git-filter-repo 清理历史：移除旧版 启动M44.vbs（含明文 Key），
  全历史扫描 `sk-6810` 无残留
- 重新加入无 Key 的启动脚本；新增 README（含 GetSongBPM 致谢回链）
- 公开仓库：https://github.com/NGC2632M44/gejueshi-m44
  - Website URL / Backlink URL 都填该仓库地址（README 已含回链）
- git 已为 github.com 配置代理（127.0.0.1:1001），推送验证 HEAD=24e602e

## 封面仍错的根因（双重修复）

1. localStorage 旧草稿恢复：restoreDraft 会把上一轮的 Deluxe 封面
   （_manualCoverUrl/_originalCoverUrl）套回来 → 草稿封面加 coverVersion=2，
   旧草稿忽略封面字段；新搜索会重置未手动选择的封面
2. 用户环境 MusicBrainz 直连失败（run 里 musicbrainz ✕ 失败）→ 无 MB 封面，
   回退到旧网易云逻辑 → researcher.js 的 MusicBrainz/coverartarchive 请求
   改为 smartFetch（直连失败自动走 GEJUESHI_PROXY_URL 代理）

## 时长显示

- 182.6s 之前显示 3:03（Math.round），改为 Math.floor → 3:02

## 验证

- npm test 13 项通过；node --check 通过；仓库推送成功
