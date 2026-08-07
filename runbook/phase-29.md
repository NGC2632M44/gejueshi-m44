# Phase 29 — 榜单影响力排序 + ADM 专业评分全量接入（v3.29.0）

日期：2026-08-08

## 问题

1. Charli XCX《Music, Fashion, Film》Wikipedia 有 29 条榜单，卡片只显示 3 条
   （card-v6.html 写死 `slice(0,3)`），且顺序是字母序。
2. 用户问能否直接抓 ADM review 页获取 PROFESSIONAL RATINGS。

## 实测

- Wikipedia 原文 Charts 节：29 条（ARIA/Austria/Belgium×2/Canada/Denmark/
  Netherlands/Finland/France/Germany/Greece/Hungary/Ireland/Italy/Japan×2/
  Lithuania/NZ/Norway/Poland/Portugal/Scotland/Spain/UK/US/…）
- 研究管线解析出 29 条（无丢失），但卡片截断为 3。
- ADM review/14677 可直接抓取：聚合 8.0/10 + 14 条媒体评分（此前解析上限 8）。

## 改动

1. `services/researcher.js`：
   - `sortChartsByInfluence`：市场权重 + 细分榜惩罚 + 同权保序；
     修复 “Australian/Austrian 含 us 被误判美国”“Irish/Scottish 含
     Official Charts 被误判英国”。
   - `parseAnyDecentMusicPage` 导出；`fetchAnyDecentMusicByUrl` 支持手动 URL；
     `researchAlbum` 接受 `opts.admUrl`。
2. `server.js`：`/api/research` 接受 `admUrl` 参数。
3. `public/app-v5.html`：Step 2 新增 ADM review URL 输入；
   `buildDataPage` 合并 Wikipedia 乐评表 + ADM（聚合 + 全部媒体评分），按媒体去重。
4. `public/card-v6.html`：数据页拆分（页1：参数+热度+Top18 榜单；
   页2：剩余榜单+年终榜+ADM 聚合+全部媒体评分；溢出进页3），全部展示不截断；
   评分来源带原链接；导出雷达图按 `.p-radar` 定位。

## 实测排序结果（真实数据）

1. US Billboard 200 #3
2. UK Albums #1
3. US Top Rock & Alternative #2
4. German Albums #6
5. French Albums #15
6. Australian Albums #1
7. Canadian Albums #6
… 区域性榜（苏格兰）最后。

## 测试

- npm test 54 项全绿（新增榜单排序 2 项、ADM 解析 1 项）
- pytest 12 项全绿
- app-v5.html / card-v6.html JS 语法检查通过

## 版本

- 3.28.0 → 3.29.0

## 3.29.1 修正（2026-08-08）

用户反馈：PROFESSIONAL RATINGS 被榜单挤压到页面外。

修正：数据页 1 = 参数 + 热度 + 专业评分（聚合 + 全部媒体评分，优先完整显示）；
数据页 2 = 溢出评分 + 影响力 Top18 榜单 + 年终榜；
数据页 3 = 剩余榜单/年终榜。榜单“能放多少放多少”，评分永不截断。

实测《Music, Fashion, Film》：页 1 = 参数 + ADM 8.0 + 14 条媒体评分；
页 2 = 前 18 条榜单；页 3 = 剩余 11 条榜单。全部页面 < 750px，无溢出。

## 3.29.2 修正（2026-08-08）

用户反馈：数据页上看不到任何 charts；REVIEWS 应该两列。

修正：
- REVIEWS 固定两列（去掉按媒体名长度退化成单列的逻辑）；
- 数据页 1 新增 “CHARTS · TOP”，固定展示影响力前 6 条
  （US Billboard 200、UK Albums、US Top Rock/Alt、Germany、France、Australia）；
- 其余榜单仍按影响力排序分页放数据页 2/3，全部展示。

实测《Music, Fashion, Film》：
页 1 = 参数 + ADM 8.0 + 14 条媒体评分（两列）+ TOP 6 榜单（两列）；
页 2 = 其余 18 条榜单；页 3 = 剩余 5 条榜单。均 < 750px。

## 3.29.3 修正（2026-08-08）

用户仍看到字母序（Australian/Austrian/Belgian/Canadian/Danish），
原因：卡片使用了旧服务/旧研究数据。

修正：前端 `buildDataPage` 增加 `sortChartsByInfluence` 兜底，
生成卡片前强制按影响力重排（与服务端同一套权重）。
即使不重启服务、不重新研究，刷新页面后重新生成卡片也会是影响力顺序。
