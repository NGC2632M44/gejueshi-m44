# Phase 7 问题与需求清单（2026-08-06 用户反馈）

## 用户反馈的 Bug

- B1 Wet&Wild：时长显示 3:00，实际（官方）3:02；需核对文件真实时长与裁剪逻辑
- B2 Wet&Wild：调性显示 E minor，官方 A minor（本地单算法限制，需多引擎+外部源）
- B3 songbpm 状态 ✕ 失败：需确认是 UA 被拦还是解析/网络问题
- B4 Step2 网易云专辑评论数错误，来源不明
- B5 Step2 封面选错专辑（Louder, Please 显示成 A Little Louder, Please Bonus Tracks）
- B6 Step4 所属专辑/歌曲/艺人不能从 Step2 自动带出；音频文件名不规范时需要手动输入联网检索名

## 用户提出的增强

- E1 专辑评分源扩充：Pitchfork/MC/ADM/Clash/Dork/Guardian/NME 等 + 官网链接
- E2 热度维度扩充：网易云专辑+单曲评论数/收藏数、RYM 评论数、QQ 评论数、
  Spotify/AppleMusic 社区评论/收藏（找不到则手动输入+链接；无数据≠0，不算该维度）
- E3 评分/热度信息按“专辑”与“单曲”分开，但两个模式都尽量同时填写
- E4 平台一句话评价辅助卡片文案
- E5 唱片/厂牌信息强化
- E6 getsongbpm API 申请表单怎么填（答复 + 待 Key 接入）
- E7 头脑风暴：Discogs 实体评分、Wiki 榜单/全球销量等

## 执行顺序

1. 复现验证 B1-B6（本机跑 + 实测网络）
2. 修复并补回归测试
3. 实现 E1/E2/E4/E5 可行部分（接口有则自动、无则手动+链接）
4. 答复 E6，brainstorm 输出 E7
