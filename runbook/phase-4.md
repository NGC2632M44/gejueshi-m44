# Phase 4 报告（2026-08-06）—— 五维评分证据管线

## Schema

- `runbook/evidence-schema.md` 定稿：audioFeatures.evidence 按 词/曲/编/唱/混 五维组织
- 原则：只描述事实、不下结论；AI rationale 必须引用证据键或注明证据不足

## 落盘改动

- `scripts/analyze_audio.py`：新增 `_build_evidence()`，analyze 输出 `evidence` 块
  - sonara 调用改为显式请求全部特征（key_candidates/vocalness/loudness/structure/
    energy/danceability/valence/acousticness/chords/dissonance）
  - 实测发现：sonara 指定 features 后不再返回 playlist 默认特征，必须全列；
    dissonance 也必须显式列出，否则为 null
- `services/audio-analyzer.js`：buildScoringPrompt 注入“Step1 五维证据包”段落，
  强制引用证据键或声明证据不足
- `server.js`：verify-card 把证据包 JSON 一并交给 AI 核实
- 测试：services/test_scoring_prompt.js（2 项）；Python 测试扩展 evidence 断言

## 验证

- npm test：6 项通过；pytest：9 项通过
- Camera 实测 evidence：bpm=126、chord_rate=1.51、dissonance=0.012、
  energy=0.476、vocalness=0.62、LUFS=-7.75、clipping_risk=true
- 已知问题（不阻塞）：本地调性仍可能错（Camera 判 E major，真值 B major），
  依赖外部交叉验证纠正；证据包如实呈现候选与歧义
