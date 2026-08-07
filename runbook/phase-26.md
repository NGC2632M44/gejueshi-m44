# Phase 26 — Summer Fling 数据验证 + Hooktheory/SongBPM 修复 + 防串歌（v3.26.0）

## 一、已验证事实（verified，本机实跑）

- Summer Fling（leroy - Summer Fling.mp3）：
  - 项目管线：BPM 127.4、本地 Key F major、时长 245s（4:05）、
    质心 4260Hz、滚降 12468Hz、带宽 4218Hz、LUFS -8.86、LRA 8.3、
    立体声 45.2%
  - 独立 librosa/pyloudnorm：BPM 126.0、**Key=G major（K-S 相关 0.893）**、
    时长 245s、LUFS -8.9、LRA 8.1、立体声 45.2%；频谱参数在正常帧配置差内
  - 结论：显示值真实；G major 有独立强支持，本地 F major 反而是较弱候选
- Hooktheory：`/theorytab/view/leroy/summer-fling` 实测 404（无 Tab），
  修复后快速返回 no_data（不再超时/误报）
- SongBPM API：当前直连与代理均 403（Cloudflare），修复后如实标记 error
- MIR（Summer Fling/Leroy）：hooktheory no_data | songbpm no_data |
  musicbrainz found（230s ≠ 本地 245s，如实提示）；和弦为空

## 二、落盘清单

- `services/mir-cross-ref.js`：Hooktheory 15s+重试+404→no_data；
  SongBPM 非 JSON/403→error；_songIdentityMatches 身份过滤 + 导出
- `services/test_songbpm_parser.js`：身份过滤测试

## 三、测试

- `npm test`：43 项全绿
- `python -m pytest scripts/ -q`：9 项全绿（未动音频引擎）
