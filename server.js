// M44 v3.1 — 五维评分 + AI音频分析
// 基于 v2.1，新增: /api/analyze /api/card/v3 /api/library /api/research/ai
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { researchAlbum, searchNetease, getNeteaseDetail, getNeteaseAlbumComments, searchQQMusic, searchQQAlbum, getQQAlbumTracks, getQQMusicComments } from "./services/researcher.js";
import { fullAnalysis, generateListeningGuide, buildScoringPrompt, extractPlatformRatings, calcHeatScore, crossReference, reverseKeyFromTab, assessKeyReliability, buildAlbumCardData } from "./services/audio-analyzer.js";
import { mirCrossReference } from "./services/mir-cross-ref.js";
import { callAI, getEffectiveSettings, maskApiKey, readSettings, writeSettings } from "./services/ai.js";
import { proxiedFetch, smartFetch } from "./services/proxy-fetch.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 3001;

// ── 后处理: 清洗 AI 评分输出 ──
function sanitizeScores(scores, lyricsText = "") {
  const dims = ["词", "曲", "编", "唱", "混"];
  const MAX_RATIONALE = 120;

  const bannedTerms = [
    "听者笔记", "听感记录", "用户提到", "用户指出", "用户认为", "用户笔记指出",
    "根据用户", "从用户", "用户没有提供", "用户未提供",
    "具体歌词文本需以实际发行版本为准", "以实际歌词为准", "以实际版本为准",
    "并非", "已修正为", "已修正", "已删除", "原文为", "以匹配原词", "引用不完整",
  ];

  // 删除任何形式的编辑元描述——卡片是给读者看的，不是编辑日志
  const metaPatterns = [
    /用户(笔记)?(中)?(指出|提到|认为|写道|说|描述|强调|否定|标明|明确写了)/g,
    /(在原文中|在歌词中|在提供的)(不完整|不准确|无法|未提供|没有提供|缺失)/g,
    /(因此|故|所以)(仅|只)(保留|描述|记录)/g,
    /(未提供|没有|无法获取|无法确认)(具体|详细|足够)?(的)?(旋律|和声|编曲|混音|制作|演唱)(信息|数据|细节)/g,
    /(仅|只)(基于|根据|保留)([^。，]{1,20})(描述|记录|判断)/g,
    /(具体|详细)?(歌词|旋律|和声|编曲|混音)(文本|信息|数据)?(未提供|不完整|缺失|无法|不可用)/g,
    /(无法|不能|难以)(进一步|继续)?(核实|验证|确认|分析)/g,
    /(但|然而|不过)([^。，]{0,10})(未提供|不完整|无法|不能)/g,
  ];

  const lyricsClean = lyricsText
    ? lyricsText.replace(/[，。！？、；：""''「」『』（）\s\n\r]+/g, " ").toLowerCase().trim()
    : "";

  for (const dim of dims) {
    const entry = scores[dim];
    if (!entry || typeof entry.rationale !== "string") continue;

    let text = entry.rationale;
    text = text.replace(/'([^']+)'/g, "「$1」");
    for (const term of bannedTerms) {
      text = text.replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "g"), "");
    }
    for (const pat of metaPatterns) {
      text = text.replace(pat, "");
    }

    // 歌词引用核验：删除在原文中找不到的「...」引用
    if (lyricsClean) {
      text = text.replace(/「([^」]+)」/g, (match, quote) => {
        const q = quote.replace(/[，。！？、；：\s]+/g, " ").toLowerCase().trim();
        if (q.length < 4) return match;
        if (lyricsClean.includes(q)) return match;
        // 尝试缩短到60%再匹配
        const half = Math.floor(q.length * 0.6);
        const sq = q.slice(0, half);
        if (sq.length >= 4 && lyricsClean.includes(sq)) return "";
        return ""; // 找不到 → 删除
      });
    }

    if (text.length > MAX_RATIONALE) {
      const slice = text.slice(0, MAX_RATIONALE);
      // 优先找句号，其次逗号/分号
      let cut = slice.lastIndexOf("。");
      if (cut < MAX_RATIONALE * 0.5) {
        cut = Math.max(slice.lastIndexOf("，"), slice.lastIndexOf("；"));
      }
      if (cut > MAX_RATIONALE * 0.5) {
        text = slice.slice(0, cut + 1);
        // 逗号结尾 → 换成句号；如果逗号前不到5字 → 再往前找句号
        if (text.endsWith("，") || text.endsWith("；")) {
          const beforeComma = text.slice(text.lastIndexOf("。") + 1).replace(/[，；、]/g, "");
          if (beforeComma.length < 8) {
            const prevPeriod = slice.lastIndexOf("。");
            if (prevPeriod > 20) text = slice.slice(0, prevPeriod + 1);
          } else {
            text = text.slice(0, -1) + "。";
          }
        }
      } else {
        text = slice;
      }
    }
    text = text.replace(/[，、]$/, "。");
    entry.rationale = text;
  }

  // oneLiner: 去内部用语 + 单引号 + 截断 + 禁止逗号结尾
  if (typeof scores.oneLiner === "string") {
    scores.oneLiner = scores.oneLiner.replace(/'([^']+)'/g, "「$1」");
    for (const term of bannedTerms) {
      scores.oneLiner = scores.oneLiner.replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "g"), "");
    }
    if (scores.oneLiner.length > 20) {
      const slice = scores.oneLiner.slice(0, 20);
      const lastPunct = Math.max(slice.lastIndexOf("。"), slice.lastIndexOf("，"), slice.lastIndexOf("；"));
      scores.oneLiner = lastPunct > 15 ? slice.slice(0, lastPunct + 1) : slice;
    }
    // oneLiner 不能以逗号结尾——改成句号或直接去掉
    scores.oneLiner = scores.oneLiner.replace(/[，、]$/, "");
    // 超过 20 字还没句号 → 不自然，加句号收尾
    if (scores.oneLiner.length > 20 && !/[。！？」]$/.test(scores.oneLiner)) {
      scores.oneLiner += "。";
    }
  }

  // tags: 剔除非英文
  if (Array.isArray(scores.tags)) {
    scores.tags = scores.tags.filter(t =>
      !/^(female|male|guitar|bass|drum|synth|piano|violin|distortion|reverb|delay|compressor|loop|riff)/i.test(t)
    );
  }
}

// ============================================================
// 静态文件服务
// ============================================================
app.use(express.static(path.join(__dirname, "public")));

// 音频文件列表 (供前端下拉选择)
app.get("/api/audio-list", (req, res) => {
  const audioDir = path.join(__dirname, "audio");
  try {
    const files = fs.readdirSync(audioDir)
      .filter(f => /\.(mp3|wav|flac|m4a|ogg|aac|wma)$/i.test(f))
      .sort();
    res.json({ success: true, files, dir: audioDir });
  } catch (e) {
    res.json({ success: false, files: [], error: e.message });
  }
});

// ============================================================
// [保留] API: 研究专辑
// ============================================================
app.get("/api/research", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "请输入专辑名称" });

  console.log(`\n🔍 研究专辑: "${q}"`);
  const start = Date.now();
  const data = await researchAlbum(q, {
    lastfmKey: req.headers["x-lastfm-key"] || process.env.LASTFM_API_KEY,
    discogsToken: req.headers["x-discogs-token"] || process.env.DISCOGS_TOKEN,
  });
  console.log(`✅ 研究完成 (${Date.now() - start}ms)`);
  res.json(data);
});

// ═══════════════════════════════════════════════════
// [新增 v3.1] API: 音频分析 + 听歌指引
// ═══════════════════════════════════════════════════
app.post("/api/analyze", async (req, res) => {
  const { audioPath, listeningAnswers, albumMetadata } = req.body;

  if (!audioPath) {
    return res.status(400).json({ error: "请提供音频文件路径 audioPath" });
  }

  console.log(`\n🔬 音频分析: "${path.basename(audioPath)}"`);
  const start = Date.now();

  try {
    const result = await fullAnalysis(
      audioPath,
      listeningAnswers || "",
      albumMetadata || {}
    );

    const elapsed = Date.now() - start;
    console.log(`✅ 分析完成 (${elapsed}ms)`);
    console.log(`   BPM: ${result.audioFeatures.bpm || "?"}  |  Key: ${result.audioFeatures.key || "?"}`);
    console.log(`   Engine: ${result.audioFeatures.engine || "?"}`);

    res.json({
      success: true,
      ...result,
      elapsed_ms: elapsed,
    });
  } catch (err) {
    console.error(`❌ 分析失败: ${err.message}`);
    res.status(500).json({
      success: false,
      error: err.message,
      hint: "请确认: 1) pip install essentia librosa  2) Python 在 PATH 中  3) 音频文件路径正确",
    });
  }
});

// ═══════════════════════════════════════════════════
// [新增 v3.1] API: 仅生成听歌指引 (无需 Python)
// ═══════════════════════════════════════════════════
app.post("/api/analyze/guide", async (req, res) => {
  const { audioFeatures } = req.body;

  if (!audioFeatures) {
    return res.status(400).json({ error: "请提供音频特征数据 audioFeatures" });
  }

  try {
    const guide = generateListeningGuide(audioFeatures);
    res.json({ success: true, guide });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════
// [新增 v3.1] API: 五维评分 (DeepSeek + 平台校准)
// ═══════════════════════════════════════════════════
app.post("/api/analyze/score", async (req, res) => {
  const { audioFeatures, listeningAnswers, albumMetadata, researchData, platformRatings, model } = req.body;
  const apiKey = req.headers["x-api-key"] || getEffectiveSettings().apiKey;

  if (!apiKey) {
    return res.status(400).json({ error: "未配置 DEEPSEEK_API_KEY", needsApiKey: true });
  }

  if (!audioFeatures) {
    return res.status(400).json({ error: "请提供音频特征 audioFeatures" });
  }

  console.log(`\n🎯 五维评分: ${audioFeatures.file || "unknown"}`);
  const start = Date.now();

  try {
    // 合并平台评分：优先使用传入的 platformRatings，否则从 researchData 提取
    const ratings = platformRatings || extractPlatformRatings(researchData);
    if (ratings && Object.keys(ratings).length > 0) {
      console.log(`   📊 平台校准: ${Object.keys(ratings).join(", ")}`);
    }

    // 提取热度数据: 合并 AI 研究 + 中国平台实时数据
    const aiHeat = (researchData?._source === "deepseek-ai" && researchData.heat) ? researchData.heat : {};
    const bodyHeat = req.body.heat || {};
    const heat = { ...aiHeat, ...bodyHeat };  // bodyHeat 覆盖 AI (实时数据更准)
    const hasHeat = Object.values(heat).some(v => v !== null && v !== undefined);
    const heatResult = hasHeat ? calcHeatScore(heat) : { stars: 0, label: "无数据" };
    const heatScore = heatResult;
    if (heatResult.stars > 0) console.log(`   🔥 热度: ${heatResult.label} (${heatResult.stars}/5★)`);

    const prompt = buildScoringPrompt(
      audioFeatures,
      listeningAnswers || "",
      albumMetadata || {},
      ratings,
      heat,
      req.body.lyrics || "",
      researchData
    );

    const response = await callAI({
      temperature: 0.4,
      thinking: { type: "enabled" },
      messages: [
        {
          role: "system",
          content: `你是一个认真听歌的音乐爱好者。你写的是个人听后感，文字真诚朴实。

## ⚠️ 规则 1：用户的听感笔记是你的核心素材
用户听了这首歌并写了笔记。笔记中的每个观察都是你要展开的点。
- 用户提到某处编曲有变化 → 你在编曲维度必须讨论这个
- 用户说某效果不存在 → 你不能写它存在
- 用户说某处是比喻 → 你不能当真实音效描述
- 如果用户笔记很详细，你的 rationale 应该大部分基于笔记，少部分基于音频数字

## 规则 2：歌词引用要准确
只引用提供的歌词原文，找不到就不引。英文不翻译。不要截断单词。
⚠️ 你是写给读者看的最终成品，不是草稿，不是编辑日志。禁止写免责声明（"具体歌词未提供""无法进一步核实""以实际版本为准"等）。不确定的就不写，不要写了又加 but。读者不需要知道你的信息局限——他们只看到你给出的内容。

## 规则 3：不懂的不装懂
你没听到这首歌。禁止这些：
- 描述旋律线条（"上扬曲线"、"下行音阶"、"音程跳进"、"同音反复"）——你听不到旋律
- 描述具体编曲变化（"某处加了乐器"、"副歌叠层"、"riff切入"）
- 描述演唱技巧（"半说半唱"、"气声"、"假声转换"、"叠层人声"）
- 截断歌词单词（"it makes me feel ho" → 错的，要么写完整要么不引用）
你可以说：BPM暗示的节奏气质、歌词的主题意象、频谱参数暗示的音色倾向。这些都是你有数据的。

## 规则 4：音频参数简单参考
BPM、LUFS、频谱这些数字只是辅助感受的参考，不要拿来下技术结论。比如 -12 LUFS 说明响度适中，但不能说"符合club标准"。

输出 JSON。oneLiner 是一句有态度的感受，不要太夸张。标签 4-6 个，流派(英文)+听感描述(中文)，如 "Indie Rock" "内省" "温暖"。禁止引用歌名词汇。`,
        },
        { role: "user", content: prompt },
      ],
    }, { apiKey });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`DeepSeek API ${response.status}: ${body}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "";

    // 提取 JSON，清理常见语法问题
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("AI 未返回有效的 JSON 评分");
    }
    let jsonStr = jsonMatch[0];
    jsonStr = jsonStr.replace(/,\s*\}/g, "}").replace(/,\s*\]/g, "]");
    const scores = JSON.parse(jsonStr);

    // ── 后处理: 清洗 AI 输出 ──
    sanitizeScores(scores, req.body.lyrics || "");

    // 验证
    const dims = ["词", "曲", "编", "唱", "混"];
    for (const dim of dims) {
      if (scores[dim] && (scores[dim].score < 0 || scores[dim].score > 20)) {
        throw new Error(`${dim} 分数异常: ${scores[dim].score}`);
      }
    }

    console.log(`✅ 评分完成 (${Date.now() - start}ms) 总分: ${scores.totalScore}`);

    res.json({
      success: true,
      scores,
      rawText: text,
      model: data.model,
      usage: data.usage,
      _heatScore: heatScore,
    });
  } catch (err) {
    console.error(`❌ 评分失败: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════
// [新增 v3.1] API: 渲染五维评分卡 HTML
// ═══════════════════════════════════════════════════
app.post("/api/card/v3", (req, res) => {
  const cardData = req.body;
  if (!cardData || !cardData.scores) {
    return res.status(400).json({ error: "请提供评分数据 cardData.scores" });
  }
  const templatePath = path.join(__dirname, "public", "card-v3.html");
  const template = fs.readFileSync(templatePath, "utf-8");
  const dataScript = `<script>window.__CARD_DATA__ = ${JSON.stringify(cardData)};</script>`;
  const html = template.replace("</head>", `${dataScript}\n</head>`);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// [新增] card-v4 — 大SVG + 专辑封面 + 导出 + 多页
app.post("/api/card/v4", async (req, res) => {
  const cardData = req.body;
  if (!cardData || !cardData.scores) {
    return res.status(400).json({ error: "请提供评分数据 cardData.scores" });
  }

  // 计算热度星级
  const heatData = cardData.heat || {};
  const heatScore = calcHeatScore(heatData);
  cardData.heatScore = heatScore;
  cardData.heat = heatData;
  cardData._apiBase = `${req.protocol}://${req.get("host")}`;
  // 远程封面统一走本机图片代理（直连失败会经 GEJUESHI_PROXY_URL）
  if (cardData.coverUrl && /^https?:\/\//.test(cardData.coverUrl)) {
    cardData.coverUrl = `${cardData._apiBase}/api/proxy-image?url=${encodeURIComponent(cardData.coverUrl)}`;
  }

  // 封面转 base64：彻底消除跨域问题（预览 + html2canvas 导出均可靠）
  if (cardData.coverUrl && /^https?:\/\//.test(cardData.coverUrl)) {
    try {
      const imgRes = await smartFetch(cardData.coverUrl, {
        signal: AbortSignal.timeout(6000),
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      if (imgRes.ok) {
        const buf = Buffer.from(await imgRes.arrayBuffer());
        const ct = imgRes.headers.get("content-type") || "image/jpeg";
        cardData.coverUrl = `data:${ct};base64,${buf.toString("base64")}`;
      }
    } catch (e) {
      console.log(`   ⚠️ 封面转 base64 失败，保留原始 URL: ${e.message}`);
    }
  }

  const templatePath = path.join(__dirname, "public", "card-v6.html");
  if (!fs.existsSync(templatePath)) {
    return res.status(500).json({ error: "card template missing: public/card-v6.html" });
  }
  const template = fs.readFileSync(templatePath, "utf-8");
  const dataScript = `<script>window.__CARD_DATA__ = ${JSON.stringify(cardData)};</script>`;
  const html = template.replace("</head>", `${dataScript}\n</head>`);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// ═══════════════════════════════════════════════════
// [新增 v3.1] API: AI 评分查询（DeepSeek 替代 DDG/Wikipedia）
// ═══════════════════════════════════════════════════
app.get("/api/research/ai", async (req, res) => {
  const q = (req.query.q || "").trim();
  const type = (req.query.type || "auto").trim(); // "album" | "song" | "auto"
  if (!q) return res.status(400).json({ error: "请输入专辑名/歌曲名+艺术家" });

  const apiKey = req.headers["x-api-key"] || getEffectiveSettings().apiKey;
  if (!apiKey) return res.status(400).json({ error: "未配置 DEEPSEEK_API_KEY" });

  console.log(`\n🤖 AI评分查询: "${q}"`);
  const start = Date.now();

  try {
    const response = await callAI({
      max_tokens: 2048,
      temperature: 0.1,
      messages: [{
        role: "system",
        content: `你是一个音乐数据库查询助手。只返回你知道的热度/影响力参考数据（听众数、榜单、奖项等）。
评分、流派、厂牌都不能用训练数据——这些必须从实时API获取。你的训练数据可能过时或不准确。
不知道的字段填null，不要编造。输出严格的JSON格式，不要markdown包裹。

JSON格式:
{
  "artist": "艺术家名字" 或 null,
  "title": "作品名" 或 null,
  "type": "song" 或 "album" 或 null,
  "year": 发行年份 或 null,
  "heat": {
    "lastfm_listeners": 500000或null,
    "lastfm_playcount": 5000000或null,
    "spotify_popularity": 85或null,
    "discogs_have": 5000或null,
    "discogs_want": 2000或null,
    "wikipedia_page_length_kb": 50或null,
    "billboard_peak": 1或null,
    "billboard_weeks": 52或null
  }
}

注意: 这个数据只用于热度星级计算。评分必须来自Wikipedia实时抓取，流派必须来自Wikipedia/MusicBrainz。`,
      }, {
        role: "user",
        content: `查询${type === "song" ? "这首单曲" : type === "album" ? "这张专辑" : "这个作品"}的信息：${q}${type === "song" ? "\n\n这是一首单曲/歌曲。请优先提供该单曲在各平台的独立评分。如果该单曲没有独立评分，则提供所属专辑的评分并注明。" : ""}`,
      }],
    }, { apiKey });

    if (!response.ok) throw new Error(`DeepSeek ${response.status}: ${await response.text()}`);

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AI未返回有效JSON");

    // 清理常见 JSON 语法问题 (DeepSeek 偶尔产出 trailing commas)
    let jsonStr = jsonMatch[0];
    jsonStr = jsonStr.replace(/,\s*\}/g, "}");  // 移除尾部逗号
    jsonStr = jsonStr.replace(/,\s*\]/g, "]");  // 移除数组尾部逗号
    const info = JSON.parse(jsonStr);
    console.log(`✅ AI查询完成 (${Date.now() - start}ms) | ${info.artist} — ${info.title}`);

    res.json({ success: true, ...info, _raw: text, _elapsed: Date.now() - start });
  } catch (err) {
    console.error(`❌ AI查询失败: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════
// [新增 v3.1] API: 本地素材库 (JSON文件, 简单直接)
// ═══════════════════════════════════════════════════
const LIBRARY_PATH = process.env.GEJUESHI_LIBRARY_PATH || path.join(__dirname, "data", "library.json");

function outputDir() {
  return process.env.GEJUESHI_OUTPUT_DIR || path.join(__dirname, "output");
}

function readLibrary() {
  try {
    if (fs.existsSync(LIBRARY_PATH)) {
      return JSON.parse(fs.readFileSync(LIBRARY_PATH, "utf-8"));
    }
  } catch (_) {}
  return { albums: [], tracks: [], publishLog: [] };
}

function writeLibrary(data) {
  const dir = path.dirname(LIBRARY_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LIBRARY_PATH, JSON.stringify(data, null, 2), "utf-8");
}

// ═══════════════════════════════════════════════════
// [新增 v3.1] API: 中国平台搜索 (网易云 + QQ音乐)
// ═══════════════════════════════════════════════════
app.get("/api/research/chinese", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "请输入歌曲名+艺术家" });

  console.log(`\n🇨🇳 中国平台搜索: "${q}"`);
  const start = Date.now();

  try {
    // 专辑级：候选列表 + 评论/收藏数（标题精确匹配优先，Deluxe/Bonus 扣分）
    let neteaseAlbum = null;
    const albumSearch = await searchNetease(q, "album");
    if (albumSearch?.results?.length) {
      const details = await Promise.all(albumSearch.results.slice(0, 5).map(async (al) => {
        const d = await getNeteaseDetail(al.id, "album");
        return {
          id: al.id, name: al.name, artist: al.artist,
          picUrl: al.picUrl || null,
          commentCount: d?.commentCount ?? null,
          subCount: d?.subCount ?? null,
          shareCount: d?.shareCount ?? null,
          publishTime: al.publishTime || null,
        };
      }));
      const picked = details.find((d) => !/(deluxe|bonus|expanded|super\s*deluxe)/i.test(d.name || "")) || details[0];
      neteaseAlbum = { ...picked, isAlbum: true, candidates: details };
    }

    // 单曲级：单曲评论数 + 所属专辑评论/收藏数
    let neteaseSong = null;
    const songSearch = await searchNetease(q, "song");
    if (songSearch?.results?.length) {
      const top = songSearch.results[0];
      const [songDetail, songAlbumDetail] = await Promise.all([
        getNeteaseDetail(top.id, "song"),
        top.albumId ? getNeteaseDetail(top.albumId, "album") : Promise.resolve(null),
      ]);
      neteaseSong = {
        id: top.id, name: top.name, artists: top.artists,
        album: top.album, albumId: top.albumId,
        commentCount: songDetail?.commentCount ?? null,
        albumCommentCount: songAlbumDetail?.commentCount ?? null,
        albumSubCount: songAlbumDetail?.subCount ?? null,
        playCount: top.popular || null,
      };
    }

    // QQ 音乐单曲评论（接口失败返回 null，不伪装成 0）
    let qq = null;
    const qqSearch = await searchQQMusic(q);
    if (qqSearch?.results?.length) {
      const topQ = qqSearch.results[0];
      const comments = await getQQMusicComments(topQ.mid);
      qq = {
        id: topQ.id, mid: topQ.mid, name: topQ.name,
        artists: topQ.artists, album: topQ.album,
        commentCount: comments ?? null,
      };
    }

    console.log(`✅ 中国平台搜索完成 (${Date.now() - start}ms) | 网易云专辑:${neteaseAlbum ? "OK" : "N/A"} 单曲:${neteaseSong ? "OK" : "N/A"} QQ:${qq ? "OK" : "N/A"}`);
    res.json({
      success: true,
      netease: neteaseAlbum,
      neteaseAlbum,
      neteaseSong,
      qq,
      elapsed_ms: Date.now() - start,
    });
  } catch (err) {
    console.error(`❌ 中国平台搜索失败: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/library", (req, res) => {
  const lib = readLibrary();
  const { type } = req.query;
  if (type && lib[type]) {
    return res.json({ [type]: lib[type] });
  }
  res.json(lib);
});

app.post("/api/library", (req, res) => {
  const { type, data } = req.body;
  if (!type || !data) {
    return res.status(400).json({ error: "请提供 type (albums/tracks/publishLog) 和 data" });
  }

  const lib = readLibrary();
  if (!lib[type]) lib[type] = [];

  // 自动专辑归类（先执行，确保 albumId 写入曲目后再入库）
  if (type === "tracks" && (data.albumName || data.albumTitle)) {
    autoOrganizeAlbum(lib, data);
  }

  // 按 id 去重
  const idx = lib[type].findIndex((item) => item.id === data.id);
  if (idx >= 0) {
    lib[type][idx] = { ...lib[type][idx], ...data, updatedAt: new Date().toISOString() };
  } else {
    lib[type].push({ ...data, id: data.id || `item_${Date.now()}`, createdAt: new Date().toISOString() });
  }

  writeLibrary(lib);
  res.json({ success: true, count: lib[type].length, autoOrganized: type === "tracks" && !!(data.albumName || data.albumTitle) });
});

/**
 * 自动按专辑归类: 曲目入库时自动创建/更新专辑分组
 * 目录结构: output/{专辑名}/ (单曲卡片存放)
 */
function autoOrganizeAlbum(lib, trackData) {
  const albumTitle = trackData.albumName || trackData.albumTitle;
  if (!albumTitle) return;

  if (!lib.albums) lib.albums = [];

  // 按专辑名去重 (标准化: 去空格/标点后比较)
  const norm = s => (s || "").toLowerCase().replace(/[^\w一-鿿]/g, "");
  const target = norm(albumTitle);
  const existing = lib.albums.find(a => norm(a.title) === target);

  // 生成稳定的 albumId (基于艺术家+专辑名的 hash)
  const albumId = trackData.albumId || `album_${Buffer.from((trackData.artist||"") + albumTitle).toString("base64").slice(0, 12).replace(/[+/=]/g, "")}`;

  // 自动创建 output 目录
  const safeName = albumTitle.replace(/[\\/:*?"<>|]/g, "_");
  const albumDir = path.join(outputDir(), safeName);
  if (!fs.existsSync(albumDir)) {
    fs.mkdirSync(albumDir, { recursive: true });
    console.log(`📁 自动创建专辑目录: output/${safeName}`);
  }

  if (existing) {
    existing.trackCount = (existing.trackCount || 0) + 1;
    existing.trackIds = [...new Set([...(existing.trackIds || []), trackData.id])];
    existing.updatedAt = new Date().toISOString();
    existing.outputDir = `output/${safeName}`;
  } else {
    lib.albums.push({
      id: albumId,
      title: albumTitle,
      artist: trackData.artist || "",
      year: trackData.year || "",
      label: trackData.label || "",
      genre: trackData.genre || "",
      trackCount: 1,
      trackIds: [trackData.id],
      outputDir: `output/${safeName}`,
      createdAt: new Date().toISOString(),
    });
  }

  // 更新曲目的 albumId 关联
  trackData.albumId = albumId;
}

// ============================================================
// [保留] API: 系统状态
// ============================================================
app.get("/api/status", (req, res) => {
  const lib = readLibrary();
  const settings = getEffectiveSettings();
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf-8"));
  res.json({
    version: pkg.version,
    deepseekKey: !!settings.apiKey,
    model: settings.model,
    lastfmKey: !!process.env.LASTFM_API_KEY,
    discogsToken: !!process.env.DISCOGS_TOKEN,
    nodeVersion: process.version,
    pythonAvailable: false, // 由前端探测
    library: {
      albums: lib.albums?.length || 0,
      tracks: lib.tracks?.length || 0,
      published: lib.publishLog?.length || 0,
    },
    sources: [
      "Wikipedia", "MusicBrainz", "iTunes", "Last.fm", "Discogs API",
      "RYM (via DDG)", "AOTY (via DDG)",
      "—— v3.2 新增 ——",
      "标准化音频分析 (44100Hz/2048FFT/50%overlap/95%rolloff/EBU R128)",
      "Krumhansl-Schmuckler 调性检测 + Camelot 编码",
      "Demucs htdemucs 音轨分离",
      "多源交叉验证 BPM/Key (MIR数据库 + 吉他谱反算)",
      "DeepSeek 五维评分引擎",
      "专辑模式 — 聚合单曲数据生成专辑卡",
    ],
  });
});

// ═══════════════════════════════════════════════════
// 图片代理（解决 html2canvas 跨域导出问题）
// ═══════════════════════════════════════════════════
app.get("/api/proxy-image", async (req, res) => {
  const url = req.query.url;
  if (!url || !url.startsWith("http")) {
    return res.status(400).json({ error: "invalid url" });
  }
  const attempts = [
    () => fetch(url, { signal: AbortSignal.timeout(10000), headers: { "User-Agent": "Mozilla/5.0" } }),
    () => proxiedFetch(url, { signal: AbortSignal.timeout(10000), headers: { "User-Agent": "Mozilla/5.0" } }),
  ];
  for (const attempt of attempts) {
    try {
      const imgRes = await attempt();
      if (!imgRes.ok) continue;
      const contentType = imgRes.headers.get("content-type") || "image/jpeg";
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(buffer);
      return;
    } catch (_) {
      // 尝试下一个通道
    }
  }
  res.status(502).end();
});

// ═══════════════════════════════════════════════════
// 歌曲信息交叉验证 (MusicBrainz 录音数据)
// ═══════════════════════════════════════════════════
app.get("/api/song-lookup", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "请输入歌曲名+艺术家" });
  try {
    const mbUrl = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(q)}&fmt=json&limit=3`;
    const mbRes = await smartFetch(mbUrl, {
      headers: { "User-Agent": "Gejueshi/1.0 (Music Research; +http://localhost:3001)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!mbRes.ok) return res.json({ success: false, error: `MusicBrainz ${mbRes.status}` });
    const mbData = await mbRes.json();
    const recordings = (mbData.recordings || []).map(r => ({
      id: r.id, title: r.title, artist: (r["artist-credit"] || [])[0]?.name || "",
      duration_ms: r.length || null,
      duration_sec: r.length ? Math.round(r.length / 1000) : null,
    }));
    if (!recordings.length) return res.json({ success: false, hint: "MusicBrainz 中未找到" });

    res.json({
      success: true,
      query: q,
      recordings,
      _note: "MusicBrainz 录音元数据（AcousticBrainz 已下线，不再调用）",
    });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════
// [v3.2] 歌曲参数交叉验证: AI 辅助检索 MIR 数据
// 当外网 MIR 数据库不可用时，用 DeepSeek 补充已知数据
// ═══════════════════════════════════════════════════
app.get("/api/mir-lookup", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "请输入歌曲名+艺术家" });

  const apiKey = req.headers["x-api-key"] || getEffectiveSettings().apiKey;
  if (!apiKey) return res.status(400).json({ error: "未配置 DEEPSEEK_API_KEY，MIR查询不可用" });

  console.log(`\n🎵 MIR查询: "${q}"`);
  const start = Date.now();

  // 先试 MusicBrainz
  let mbResult = null;
  try {
    const mbUrl = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(q)}&fmt=json&limit=2`;
    const mbRes = await smartFetch(mbUrl, {
      headers: { "User-Agent": "Gejueshi/3.2 (Music Research; +http://localhost:3001)" },
      signal: AbortSignal.timeout(8000),
    });
    if (mbRes.ok) {
      const mbData = await mbRes.json();
      const rec = mbData.recordings?.[0];
      if (rec) {
        mbResult = { id: rec.id, title: rec.title, duration_ms: rec.length };
      }
    }
  } catch (_) {}

  // 否则用 AI 补充 (从训练数据中提取已知歌曲信息)
  try {
    const response = await callAI({
      max_tokens: 512,
      temperature: 0.1,
      messages: [{
        role: "system",
        content: `你是 MIR 数据库查询助手。返回已知的歌曲参数供交叉验证。不知道的填 null。
输出严格 JSON:
{
  "bpm": 128.5 或 null,
  "key": "C minor" 或 null,
  "camelot": "5A" 或 null,
  "energy": "high/medium/low" 或 null,
  "genres": ["Rock", "Electronic"] 或 [],
  "known_from": "来源说明" 或 "training_data"
}`,
      }, {
        role: "user",
        content: `查询歌曲参数供交叉验证: ${q}`,
      }],
    }, { apiKey });

    if (!response.ok) return res.json({ success: false, error: `AI ${response.status}` });

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "";
    const json = text.match(/\{[\s\S]*\}/);
    const info = json ? JSON.parse(json[0].replace(/,\s*\}/g, "}").replace(/,\s*\]/g, "]")) : {};

    console.log(`✅ AI MIR查询完成 (${Date.now() - start}ms) | BPM=${info.bpm} Key=${info.key} (${info.known_from || "training_data"})`);
    res.json({
      success: true,
      sources: ["ai_training_data"],
      ...info,
      _raw: mbResult,
      _note: "AI 训练数据来源，可能过时。用于交叉验证参考，不替代本地分析。",
      elapsed_ms: Date.now() - start,
    });
  } catch (e) {
    res.json({ success: false, error: e.message, elapsed_ms: Date.now() - start });
  }
});

// ═══════════════════════════════════════════════════
// 卡片内容自查: 先搜网页 → 再让 AI 核实
// ═══════════════════════════════════════════════════
app.post("/api/verify-card", async (req, res) => {
  const { scores, artist, title, year, genre, audioFeatures, listeningAnswers, lyrics } = req.body;
  const apiKey = req.headers["x-api-key"] || getEffectiveSettings().apiKey;
  if (!apiKey) return res.status(400).json({ error: "未配置 DEEPSEEK_API_KEY" });
  if (!scores) return res.status(400).json({ error: "缺少 scores" });

  const dims = ["词", "曲", "编", "唱", "混"];
  let reviewText = "";
  for (const d of dims) {
    if (scores[d]?.rationale) reviewText += `【${d}】${scores[d].rationale}\n`;
  }
  if (scores.oneLiner) reviewText += `【一句话】${scores.oneLiner}\n`;

  const songQuery = `${artist} ${title}`.trim();
  const knownInfo = [artist, title, year, genre].filter(Boolean).join(" · ");

  // 用户笔记和歌词作为权威参考
  const userGroundTruth = [
    listeningAnswers ? `用户聆听笔记（权威来源，必须尊重）：\n${listeningAnswers}` : "",
    lyrics ? `歌词原文（所有引用必须逐字匹配）：\n${lyrics.slice(0, 2000)}` : "",
  ].filter(Boolean).join("\n\n");

  console.log(`   🔍 自查: 核实 "${songQuery}"…`);

  // ── 让 AI 核实 ──
  const scoreRefs = dims.map(d => {
    const s = scores[d];
    return s ? `"${d}": {"score": ${s.score}, "rationale": "修正后的原文"}` : `"${d}": null`;
  }).join(",\n  ");

  try {
    const resp = await callAI({
      temperature: 0.1,
      thinking: { type: "enabled" },
      messages: [{
          role: "system",
          content: `你是音乐内容核查员。检查乐评卡片是否有事实问题。

权威参考（以下为事实）：
${userGroundTruth || "（无）"}

检查：
1. 用户否定过的内容 → 删除
2. 歌词引用不准确 → 修正或删除
3. 编造的具体音乐细节 → 删除
4. 明显错误的数字解读（如 -12 LUFS 说成 club 标准）→ 修正

输出 JSON（score 不动）:
{
  ${scoreRefs},
  "oneLiner": "修正后",
  "tags": ["修正后"],
  "corrections": ["修正了：xxx"]
}`
        }, {
          role: "user",
          content: `核实以下乐评：\n\n${reviewText}\n\n音频特征：BPM ${audioFeatures?.bpm || "?"}，调性 ${audioFeatures?.key || "?"}，LUFS ${audioFeatures?.dynamics?.integrated_lufs || "?"}，质心 ${audioFeatures?.spectral?.centroid_mean || "?"}Hz\n\n证据包：${JSON.stringify(audioFeatures?.evidence || {})}`
        }],
    }, { apiKey, signal: AbortSignal.timeout(120000) });

    if (!resp.ok) return res.json({ success: false, error: `API ${resp.status}` });
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || "";
    const json = text.match(/\{[\s\S]*\}/);
    if (json) {
      const verified = JSON.parse(json[0].replace(/,\s*\}/g, "}").replace(/,\s*\]/g, "]"));
      // 只覆盖有效的 rationale
      for (const d of dims) {
        const r = verified[d]?.rationale;
        if (r && r.length > 10 && !/^(已修正|已删除|原文正确|无需修改)/.test(r)) {
          scores[d] = { ...scores[d], rationale: r };
        }
      }
      if (verified.oneLiner && verified.oneLiner.length > 5) {
        scores.oneLiner = verified.oneLiner;
        // 二次截断确保不超长
        if (scores.oneLiner.length > 20) {
          const s = scores.oneLiner.slice(0, 20);
          const lp = Math.max(s.lastIndexOf("。"), s.lastIndexOf("，"), s.lastIndexOf("；"));
          scores.oneLiner = lp > 12 ? s.slice(0, lp + 1) : s;
        }
        scores.oneLiner = scores.oneLiner.replace(/[，、]$/, "");
      }
      if (verified.tags?.length) scores.tags = verified.tags;
      console.log(`   🔍 自查完成: ${(verified.corrections || []).length} 处修正`);
      res.json({ success: true, verified: { ...verified, scores } });
    } else {
      console.log("   ❌ AI 未返回有效 JSON");
      res.json({ success: false, error: "AI 未返回有效 JSON" });
    }
  } catch (e) {
    console.log(`   ❌ 自查异常: ${e.message}`);
    res.json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════
// 歌词搜索 (网易云)
// ═══════════════════════════════════════════════════
app.get("/api/lyrics", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "请输入歌曲名+艺术家" });
  try {
    const songSearch = await searchNetease(q, "song");
    if (!songSearch?.results?.length) {
      return res.json({ success: false, lyrics: null, hint: "未找到歌曲" });
    }
    const song = songSearch.results[0];
    // 用 researcher.js 已有的代理 fetch 模式
    const { default: fetchWithProxy } = await import("node-fetch");
    const { HttpsProxyAgent } = await import("https-proxy-agent");
    const agent = new HttpsProxyAgent(process.env.GEJUESHI_PROXY_URL || "http://127.0.0.1:1001");
    const lrcUrl = `https://music.163.com/api/song/lyric?id=${song.id}&lv=1`;
    const lrcRes = await fetchWithProxy(lrcUrl, {
      headers: { "User-Agent": "Mozilla/5.0", Referer: "https://music.163.com" },
      agent, signal: AbortSignal.timeout(8000),
    });
    if (!lrcRes.ok) {
      return res.json({ success: false, lyrics: null, hint: "歌词接口返回 " + lrcRes.status });
    }
    const lrcData = await lrcRes.json();
    const rawLyrics = lrcData.lrc?.lyrics || lrcData.tlyric?.lyrics || "";
    const lyrics = rawLyrics.replace(/\[[\d:.]+\]/g, "").trim();
    res.json({
      success: true,
      lyrics: lyrics || null,
      song: { id: song.id, name: song.name, artists: song.artists },
    });
  } catch (e) {
    res.json({ success: false, lyrics: null, error: e.message });
  }
});

// ═══════════════════════════════════════════════════
// 导出保存: 接收 base64 PNG，写入 output 目录
// ═══════════════════════════════════════════════════
app.post("/api/save-export", (req, res) => {
  const { data, name, folder, contentType } = req.body;
  if (!data || !name) return res.status(400).json({ error: "缺少 data 或 name" });
  try {
    const buf = contentType === "text/html"
      ? Buffer.from(data, "utf8")
      : Buffer.from(data.replace(/^data:image\/png;base64,/, ""), "base64");
    const outDir = path.join(outputDir(), folder ? folder.replace(/[\\/:*?"<>|]/g, "_") : "");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const safeName = name.replace(/[\\/:*?"<>|]/g, "_");
    const filePath = path.join(outDir, safeName);
    fs.writeFileSync(filePath, buf);
    console.log(`💾 ${folder ? folder + "/" : ""}${safeName} (${(buf.length/1024).toFixed(0)}KB)`);
    res.json({ success: true, path: filePath });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════
// [v3.2] 外部 MIR 数据库多源交叉查询
// 数据源: Spotify Audio Features / SongBPM / AcousticBrainz
// 需要: SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET (可选)
// ═══════════════════════════════════════════════════
app.post("/api/mir-cross-ref", async (req, res) => {
  const { query, localResult } = req.body;
  if (!query) return res.status(400).json({ error: "请提供歌曲搜索词 query (歌曲名+艺术家)" });

  console.log(`\n🔬 MIR交叉验证: "${query}"`);
  const start = Date.now();

  try {
    const result = await mirCrossReference(query, localResult || {});
    console.log(`✅ MIR验证完成 (${Date.now() - start}ms) | 源: ${result.sources.filter(s => s.status === "ok").map(s => s.name).join(", ") || "全失败"} | 共识: ${result.crossReference.consensus}`);
    res.json(result);
  } catch (e) {
    console.error(`❌ MIR验证失败: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════
// [v3.2] 手动多源交叉验证 (传入已知数据)
// ═══════════════════════════════════════════════════
app.post("/api/cross-reference", async (req, res) => {
  const { localResult, externalSources } = req.body;
  if (!localResult) return res.status(400).json({ error: "请提供本地分析结果 localResult" });

  try {
    const ref = crossReference(localResult, externalSources || []);
    const reliability = assessKeyReliability(localResult, ref);

    // 如果提供了吉他谱数据，进行反算校验
    let tabCheck = null;
    if (req.body.tabData) {
      const { tabKey, capoFrets } = req.body.tabData;
      const reversed = reverseKeyFromTab(tabKey, capoFrets || 0);
      if (reversed) {
        const localKey = localResult.key;
        const match = localKey && normalizeForCompare(localKey) === normalizeForCompare(reversed);
        tabCheck = { reversed, match, tabKey, capoFrets };
      }
    }

    res.json({
      success: true,
      crossReference: ref,
      reliability,
      tabCheck,
      recommendedFields: {
        bpm: ref.bpm_consensus || localResult.bpm,
        key: ref.key_consensus || localResult.key,
        key_confidence: ref.confidence_level === "high" ? 0.85 :
                        ref.confidence_level === "medium" ? 0.55 : 0.35,
        source_count: ref.sources.length,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

function normalizeForCompare(keyStr) {
  if (!keyStr) return "";
  return keyStr.replace(/\s+/g, " ").trim().toLowerCase()
    .replace("c#", "db").replace("d#", "eb").replace("f#", "gb")
    .replace("g#", "ab").replace("a#", "bb");
}

// ═══════════════════════════════════════════════════
// [新增 v3.2] 专辑模式 — 卡片生成
// ═══════════════════════════════════════════════════
app.post("/api/album/card", async (req, res) => {
  const { albumMeta, tracks, hitTracks, coverUrl } = req.body;
  if (!albumMeta || !tracks || !tracks.length) {
    return res.status(400).json({ error: "请提供 albumMeta 和 tracks 数组" });
  }

  try {
    const cardData = buildAlbumCardData(albumMeta, tracks, hitTracks || []);

    // 添加封面和热度
    if (coverUrl) {
      cardData.coverUrl = coverUrl;
    }
    cardData.heatScore = calcHeatScore(albumMeta.heat || {});

    const templatePath = path.join(__dirname, "public", "card-v6.html");
    if (!fs.existsSync(templatePath)) {
      return res.status(500).json({ error: "card template missing" });
    }
    const template = fs.readFileSync(templatePath, "utf-8");
    const dataScript = `<script>window.__CARD_DATA__ = ${JSON.stringify(cardData)};</script>`;
    const html = template.replace("</head>", `${dataScript}\n</head>`);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════
// [v3.3] SongBPM 手动 URL 抓取
// ═══════════════════════════════════════════════════
app.post("/api/songbpm-url", async (req, res) => {
  const { url } = req.body;
  if (!url || !url.includes("songbpm.com")) {
    return res.status(400).json({ error: "请提供有效的 songbpm.com URL" });
  }
  try {
    const { querySongBPMByUrl } = await import("./services/mir-cross-ref.js");
    const result = await querySongBPMByUrl(url);
    if (result) {
      res.json({ success: true, ...result });
    } else {
      res.json({ success: false, error: "无法解析该页面" });
    }
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════
// [v3.3] 模型设置 API
// ═══════════════════════════════════════════════════
app.get("/api/settings", (req, res) => {
  const s = getEffectiveSettings();
  res.json({
    success: true,
    settings: {
      model: s.model,
      apiUrl: s.apiUrl,
      apiKey: maskApiKey(s.apiKey),
      apiKeyConfigured: !!s.apiKey,
    },
    hasEnvKey: !!process.env.DEEPSEEK_API_KEY,
  });
});

app.post("/api/settings", (req, res) => {
  const { model, apiUrl, apiKey } = req.body;
  const stored = readSettings();
  if (model !== undefined) stored.model = model;
  if (apiUrl !== undefined) stored.apiUrl = apiUrl;
  if (apiKey !== undefined && apiKey) stored.apiKey = apiKey;
  writeSettings(stored);
  console.log(`⚙️ 模型设置已保存: ${stored.model} @ ${stored.apiUrl}`);
  const s = getEffectiveSettings();
  res.json({
    success: true,
    settings: {
      model: s.model,
      apiUrl: s.apiUrl,
      apiKey: maskApiKey(s.apiKey),
      apiKeyConfigured: !!s.apiKey,
    },
  });
});

// ═══════════════════════════════════════════════════
// [v3.2] 专辑目录列表 — 自动从 output/ 读取
// ═══════════════════════════════════════════════════
app.get("/api/library/album-dirs", (req, res) => {
  const outDir = outputDir();
  try {
    const dirs = fs.readdirSync(outDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith(".") && d.name !== ".test-run")
      .map(d => ({
        name: d.name,
        path: `output/${d.name}`,
        fileCount: fs.readdirSync(path.join(outDir, d.name)).filter(f => /\.(html|png)$/i.test(f)).length,
      }))
      .filter(d => d.fileCount > 0)
      .sort((a, b) => b.fileCount - a.fileCount);
    res.json({ success: true, dirs });
  } catch (e) {
    res.json({ success: false, dirs: [], error: e.message });
  }
});

// ═══════════════════════════════════════════════════
// [v3.2] 专辑数据管理 API
// ═══════════════════════════════════════════════════
app.get("/api/library/albums", (req, res) => {
  const lib = readLibrary();
  // 从 tracks 中按 albumId 聚合
  const tracks = lib.tracks || [];
  const albums = lib.albums || [];

  const albumMap = {};
  for (const album of albums) {
    albumMap[album.id] = { ...album, tracks: [] };
  }
  for (const track of tracks) {
    if (track.albumId && albumMap[track.albumId]) {
      albumMap[track.albumId].tracks.push(track);
    }
  }

  res.json({ success: true, albums: Object.values(albumMap) });
});

app.post("/api/library/album", (req, res) => {
  const { albumData } = req.body;
  if (!albumData) return res.status(400).json({ error: "请提供 albumData" });

  const lib = readLibrary();
  if (!lib.albums) lib.albums = [];

  const idx = lib.albums.findIndex(a => a.id === albumData.id);
  if (idx >= 0) {
    lib.albums[idx] = { ...lib.albums[idx], ...albumData, updatedAt: new Date().toISOString() };
  } else {
    lib.albums.push({
      id: albumData.id || `album_${Date.now()}`,
      ...albumData,
      createdAt: new Date().toISOString(),
    });
  }

  writeLibrary(lib);
  res.json({ success: true, albumCount: lib.albums.length });
});

app.post("/api/library/track-to-album", (req, res) => {
  const { trackId, albumId } = req.body;
  if (!trackId || !albumId) return res.status(400).json({ error: "请提供 trackId 和 albumId" });

  const lib = readLibrary();
  const track = (lib.tracks || []).find(t => t.id === trackId);
  if (!track) return res.status(404).json({ error: "曲目未找到" });

  track.albumId = albumId;
  track.updatedAt = new Date().toISOString();
  writeLibrary(lib);
  res.json({ success: true, track });
});

// ═══════════════════════════════════════════════════
// 启动
// ═══════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log("");
  console.log("  ╔══════════════════════════════════════════════╗");
  console.log("  ║    M44 v3.5 — 五维评分 + 专辑模式          ║");
  console.log("  ║  词·曲·编·唱·混  →  五边形雷达图          ║");
  console.log("  ╠══════════════════════════════════════════════╣");
  console.log(`  ║  http://localhost:${PORT}                     ║`);
  console.log("  ╠══════════════════════════════════════════════╣");
  console.log("  ║  [v3新增] /api/analyze   /api/card/v3        ║");
  console.log("  ║  [v3新增] /api/library   /api/album/card     ║");
  console.log("  ╠══════════════════════════════════════════════╣");
  console.log("  ║  📊 Essentia/Librosa → 客观音频特征          ║");
  console.log("  ║  🎯 听歌指引 → 用户感知 → AI 五维评分       ║");
  console.log("  ║  🖼️  card-v3.html → 五边形雷达评分卡       ║");
  console.log("  ╚══════════════════════════════════════════════╝");
  console.log("");

  if (!process.env.DEEPSEEK_API_KEY) {
    console.log("  ⚠️  DEEPSEEK_API_KEY 未设置（AI评分需要）");
  }
  console.log("  💡 Python音频分析: pip install essentia librosa");
  console.log("");
});
