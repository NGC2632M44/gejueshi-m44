# Phase 0 报告（2026-08-06）

## 完成项

- 临时工作区：`C:\Users\29346\Desktop\歌掘士_work\`（已创建，空）
- 全新基线备份：`C:\Users\29346\Desktop\歌掘士_backup_v2_baseline_20260806\`
  - robocopy /E，排除 node_modules 与 .git，exit=1（复制成功）
  - 历史全量备份 `歌掘士_backup_20260806` 仍保留
- git 初始化：根提交 b9af628，22 个源码文件入库
  - .gitignore 覆盖 node_modules/audio/output/data/cover/backups/trash/__pycache__/.env 等
  - 注意：根提交包含 `启动M44.vbs`（内含明文 API Key）。本仓库目前仅本地、无远程；
    密钥将在 Phase 3 从脚本移除，推送前需轮换或清理历史。
- runbook：README.md（协议）+ facts.md（17 条已核验事实）
- 服务器冒烟：`node server.js` 启动成功，`GET /api/status` 返回 200
  - version=3.3.0，model=deepseek-v4-flash，deepseekKey=true，library.tracks=0

## 落盘门槛

✅ 全部通过，进入 Phase 1。
