# Phase 24 — MIR 跨歌曲缓存串扰修复（v3.23.0 · 2026-08-07）

## 一、已核实事实（verified）

- 复现：query=“Rose Gray Louder, Please” + Wet & Wild 后，同一 query +
  Summer Fling/Leroy 命中旧缓存（chord=Am-Dm-Em、key=A minor）
- 修复后：同一 query + Leroy 不再命中缓存（fromCache=false），
  key=F major（本地），chord 为空；hooktheory/songbpm 均 no_data
- 前端 MIR 查询词改为优先 online-song/artist
- 本地高频和弦不再冒充主和弦；单独标注“仅参考，未外部验证”

## 二、落盘清单

- `services/mir-cross-ref.js`：mirCacheKeyFor(query+song+artist)；主和弦
  只采用外部已验证来源；新增 local_chord_progression
- `public/app-v5.html`：MIR 查询优先当前歌曲；本地和弦参考行
- `services/test_songbpm_parser.js`：缓存键身份测试

## 三、测试

- `npm test`：42 项全绿
- `python -m pytest scripts/ -q`：9 项全绿（未动音频引擎）
