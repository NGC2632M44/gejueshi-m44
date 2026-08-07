# Phase 23 — 乐评数据使用规则修正（v3.22.0 · 2026-08-07）

## 一、已核实改动（verified）

- 撤销 stripTechTokens 对 dB/LUFS/Hz 等数值的一刀切删除；数值可以保留，
  但必须转化为听感判断
- prompt 与 AI 自查改为：禁止“无信息量陈述”（如“峰值顶破 0 dB”=“有声音”、
  单独报 BPM/LUFS 不解释）；数据要么解释意义，要么不写
- sanitize 只删除“顶破 0 dB / 峰值顶破 0 dB / 顶破0dB”这类废话短语，
  不再删其他数值

## 二、测试

- `npm test`：41 项全绿
- `python -m pytest scripts/ -q`：9 项全绿（未动音频引擎）
