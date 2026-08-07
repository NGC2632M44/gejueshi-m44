# Phase 16 — 服务恢复 + SongBPM 加固 + ADM 修复（v3.13.0 · 2026-08-07）

## 一、已核实事实（verified）

- “Failed to fetch”：node 服务进程已退出（所有接口同时失败）；重启后
  /api/status、/api/songbpm-url、/api/research 均恢复 200
- SongBPM：`https://songbpm.com/@rose-gray/wet-wild-njwcb` → 128 BPM /
  A minor；直连失败时走 smartFetch（直连→代理）重试
- AnyDecentMusic：原 `/review/14180.aspx` 返回 404（缺 slug）；
  改用 `/review/14180/Rose-Gray-Louder-Please.aspx` 返回 200，解析：
  title=Louder, Please / artist=Rose Gray / ADM 7.2/10 /
  Play It Again Sam / 17/01/2025 / The Guardian 8 / NME 8 /
  God Is In The TV 7
- ADM 搜索：全查询“专辑+艺人”无结果，改用解析后的专辑名
  “Louder, Please” 后命中

## 二、落盘清单

- `services/mir-cross-ref.js`：querySongBPMByUrl 直连→代理重试
- `services/researcher.js`：fetchAnyDecentMusic 完整 slug URL + 结果按
  查询词打分排序 + data_rating/h4 出版方正则 + 专辑信息解析；
  researchAlbum 用 resolvedAlbum 搜索 ADM
- `public/app-v5.html`：SongBPM 官网链接；验证失败时显示服务端错误与
  “请确认本地服务已启动”

## 三、测试

- `npm test`：35 项全绿
- `python -m pytest scripts/ -q`：9 项全绿
