# Phase 28 — 最终文案审阅（v3.28.0）

日期：2026-08-08

## 问题

用户在听感笔记里详细写明了采样事实（宇多田光 DISTANCE 的背景和声、
原曲里挂在 "I wanna be with you" 之后），但卡片详情页把 "I wanna be with you"
这句辛苦求证的信息吞掉了，只剩泛泛的“某个和声被加速垫进来”。

## 根因

`services/sanitize.js` 的“歌词引用核验”会把当前歌曲歌词中找不到的
「…」引用直接删除。跨歌曲采样引用（来自其它歌的歌词）不属于当前歌词，
被误判为“错误歌词引用”清掉。AI 自查 prompt 也没有把“用户笔记中的
跨歌曲引用是权威事实”列为保护项。

## 方案（用户提出）

AI 生成的最终文字必须经过用户编辑窗口后才能生成卡片；用户可以不编辑，
但拥有最终编辑权。

## 改动

1. `public/app-v5.html`：
   - Step 4 新增“📝 最终文案审阅”窗口：五维 rationale 文本框 +
     一句话总评 + 标签；
   - `runScoring()` 在 AI 评分 + AI 自查后不再直接渲染卡片，改为
     填充审阅窗口并等待用户“确认文案并生成卡片”；
   - 新增 `openFinalCopyEditor / collectEditedScores / reloadAiCopy /
     confirmCopyAndGenerate / generateCardFromDraft`；
   - “恢复 AI 原文”可一键回到 AI 初稿；确认后生成的卡片与素材库
     保存的都是用户确认/修改后的文案，且不再被 AI 自查覆盖。
2. `services/sanitize.js`：`sanitizeScores(scores, lyrics, userNotes)`
   新增用户笔记权威引用白名单，跨歌曲引用不再被删除。
3. `server.js`：评分 prompt 与 AI 自查 prompt 新增规则——用户点名写出的
   采样/原曲/歌词引用必须原样保留并写明来源。
4. `services/audio-analyzer.js`：`buildScoringPrompt` 的用户笔记区块新增
   同样约束。
5. 测试：`services/test_sanitize.js` 新增 2 项（用户笔记引用保留、
   无来源引用仍删除）；npm test 51 项 / pytest 12 项全绿。

## 验证

- 前端 JS 语法检查通过；
- 单曲流程：评分 → 自查 → 审阅窗口 → （可编辑）→ 生成卡片；
- 跨歌曲引用（"I wanna be with you" + DISTANCE）在用户笔记存在时
  不会被净化器删除（有单测覆盖）。

## 版本

- 3.27.0 → 3.28.0
