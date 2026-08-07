# Phase 15 — 清理冗余字段 + 卡片版式重排（v3.12.0 · 2026-08-07）

## 一、已核实改动（verified）

- 删除百度指数 / Google Trends / Chartmetric：`/api/heat` 传入这三个 key
  实测被忽略，legend 与详情不再包含；Step2 手动输入区已无对应字段
- 删除 QQ 评分输入；`plat-qq-comments` 保留并进入国内热度（与网易云单曲评论
  取更高平台）
- Step2 不再输出 Genius 链接徽标；`/api/lyrics` 的 LRCLIB → Genius → 网易云
  链不变
- 英文总评：sanitize 上限 90 字符，优先完整句号截断，不追加省略号；prompt
  要求完整句子
- 数据页：3×5 网格（13 项参数 + DOMESTIC HEAT + OVERSEAS HEAT），
  Charts/Year-end/Ratings/Credits 压缩为紧凑分行；全部内容在 750px 页面内
- 第一页：sleeve 216px、score 与 heat 上下布局、英文 HEAT 标签
- 最后一页：删除 note 行，仅保留 `M44 SOUND ANATOMY · GENERATED 日期`

## 二、测试

- `npm test`：35 项全绿
- `python -m pytest scripts/ -q`：9 项全绿（音频引擎未改动）

## 三、说明

- Chartmetric 申请未批复前不接入，等 API 可用后再评估
- 热度卡片文案统一英文（DOMESTIC/OVERSEAS），工作台徽标仍用中文便于自用
