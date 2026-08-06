# Phase 7 修复报告（2026-08-06）—— 用户反馈 Bug 修复

## B1 时长错误（已修复）

- 根因：展示的是“去首尾静音后的时长”（Wet&Wild 180.1s），不是原文件时长（182.6s=3:02）
- 修复：`duration_seconds` 改为 ffprobe 原始时长；新增 `trimmed_duration_seconds` 单独保留
- 测试：Camera 151.48s、Wet&Wild 182.6s 断言 ✅

## B3 songbpm ✕ 失败（已修复）

- 根因：`querySongBPMByUrl` 从未被导出，/api/songbpm-url 一直返回
  “querySongBPMByUrl is not a function”
- 修复：导出函数 + 换浏览器 UA；实测返回 128 BPM / A minor ✅

## B4/B5 网易云数据与封面错误（已修复）

- 根因1：网易云专辑搜索取 results[0]，把 “A Little Louder, Please (Deluxe)”
  （评论164/收藏3232）当主专辑
- 根因2：iTunes 无此专辑（返回 0 结果）→ artwork null → 前端回退用了 Deluxe 封面
- 修复：
  - 标题归一化排名（精确匹配+60，Deluxe/Bonus 扣 25），网易云现在选中
    “Louder, Please”（评论413/收藏9995），并返回 candidates 供手动挑选
  - MusicBrainz release-group 封面（coverartarchive 307 → archive.org URL）
    作为第一优先级；前端封面预览与卡片统一走 /api/proxy-image
  - /api/proxy-image 修复：全局 fetch 不认 agent + 共享已中止 signal 的 bug，
    现在直连失败会自动走 GEJUESHI_PROXY_URL 代理（实测 archive.org 封面 200）
- 乐评表格解析增加出版物链接（Pitchfork/Metacritic/Clash 等带 Wikipedia 链接）

## 其余修复

- 网易云接口重做：netease（主专辑+候选）、neteaseSong（单曲评论+所属专辑评论/收藏）、
  QQ 评论失败返回 null（不再伪装成 0）
- 热度模型扩展：网易云专辑/单曲评论与收藏、QQ、RYM 人数、Last.fm、
  Spotify/Apple/YouTube 手动输入；空值=不计入（不再是 0）
- Step2 → Step4 自动带出：所属专辑默认填 agg.title；音频文件名自动生成“联网检索名”
  （可手动改，Step4 沿用）；新增候选封面点选器
- Step4 手动平台区新增 Spotify/Apple/YouTube 输入框 + 各平台搜索链接（↗）
- Step2 搜索错误信息在评分条显示（已有）

## 验证

- npm test：12 项通过（新增 heat/rank/songbpm-export 回归）
- pytest：9 项通过（含时长断言）
- 实测：songbpm-url 128/A minor；网易云主专辑 413 评论/9995 收藏；
  MB 封面 archive.org；proxy-image 直连/代理双通道 200
