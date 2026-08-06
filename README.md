# 歌掘士 M44 — 音乐五维分析工作台

单曲/专辑音乐分析工作台：输入音频 → 客观音频分析（BPM/调性/频谱/响度/编曲纹理）
→ 外部数据研究（Wikipedia / MusicBrainz / iTunes / AnyDecentMusic / 网易云 / QQ 音乐）
→ 五维评分（词 / 曲 / 编 / 唱 / 混）→ 生成可视化评分卡。

## 技术栈

- Node.js Express（ESM）+ Python 3.11 音频分析（sonara / librosa / pyloudnorm / ffmpeg）
- 原生 HTML/JS 前端（无框架）

## 快速开始

```bash
npm install
python -m pip install -r requirements.txt   # 见下
node server.js
```

打开 http://localhost:3001/app-v5.html ，首次使用在右上角设置面板填写
DeepSeek 的模型 / API 地址 / Key（也可用环境变量 `DEEPSEEK_API_KEY`）。

Python 依赖：`librosa pyloudnorm soundfile scipy mutagen sonara`（可选 `demucs` 分轨）。

## 测试

```bash
npm test
python -m pytest scripts/ -q
```

## 数据来源与致谢

BPM / Key 交叉验证数据部分来自 [GetSongBPM.com](https://getsongbpm.com)；
音频特征计算参考 ITU-R BS.1770-4、EBU R128、Lerch (2012) 与 Katz (2015)。
其余数据来源：Wikipedia、MusicBrainz、iTunes、AnyDecentMusic、网易云音乐、QQ 音乐。
