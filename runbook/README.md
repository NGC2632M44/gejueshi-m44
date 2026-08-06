# 歌掘士 M44 重制 runbook

本目录用于记录“先验证、后落盘”执行过程中的全部事实、命令与阶段报告。
对话记忆不可靠，本目录 + git 提交历史才是唯一事实来源。

## 事实状态标记

- `verified` —— 本机实际跑过/实测过（记录命令与日期）
- `pending_user` —— 需要用户提供条件（凭据/Key/代理）后才能验证
- `out_of_scope` —— 明确不做

## 执行闭环（每一步必须遵守）

1. 探测（spike）：在 `Desktop\歌掘士_work\` 或临时目录验证，不碰项目
2. 记录：把结果写入 `facts.md` 或对应阶段报告
3. 落盘：只有验证通过才修改项目文件
4. 回归：跑对应测试，全绿
5. 提交：git commit 作为检查点

## 阶段

- Phase 0 —— 基线（备份 / git / runbook / 冒烟）
- Phase 1 —— 音频引擎（容器识别 / ffmpeg 归一化 / sonara 优先 / JSON 类型）
- Phase 2 —— 设置接线（callAI / Key 掩码）
- Phase 3 —— 外部源与 MIR 面板（SongBPM 解析 / 死代码清理 / 代理可配置）
- Phase 4 —— 五维评分证据管线
- Phase 5 —— 专辑模式与素材库
- Phase 6 —— 清理、测试、文档
