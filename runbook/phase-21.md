# Phase 21 — 英文总评误判截断修复（v3.20.0 · 2026-08-07）

## 一、已核实改动（verified）

- 根因：sanitizeOneLiner 原先 `/\p{CJK}/.test(text)` 判断语言，英文总评混入
  中文字符 → 被当中文按 20 字截断（Warm rain, wet stree）
- 修复：中文占比 >30% 才算中文；英文上限 60 字符、完整短句、禁止混中文
- 实测：`Warm rain, wet streets, and a chorus that makes you chase. 副歌…`
  → 保留完整英文句 “Warm rain, wet streets, and a chorus that makes you chase.”
- 封面标签 6→5，保证单行

## 二、测试

- `npm test`：41 项全绿（新增主体语言判断用例）
- `python -m pytest scripts/ -q`：9 项全绿（未动音频引擎）
