// 歌掘士 v3 — AI 播客稿件生成器
// 强制溯源：每个事实性陈述必须标注来源

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function generatePodcastScript(researchData, options = {}) {
  const { apiKey = process.env.ANTHROPIC_API_KEY || "", model = "claude-sonnet-4-6" } = options;

  if (!apiKey) {
    return { success: false, error: "未配置 Anthropic API Key。请设置 ANTHROPIC_API_KEY 环境变量，或在页面中输入。", needsApiKey: true };
  }

  const systemPrompt = fs.readFileSync(path.join(__dirname, "..", "prompts", "podcast-system.md"), "utf-8");
  const userPrompt = buildPrompt(researchData);

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 4096, system: systemPrompt, messages: [{ role: "user", content: userPrompt }] }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`API ${response.status}: ${body}`);
    }
    const data = await response.json();
    const content = data.content?.[0]?.text || "";
    const parts = content.split("---");
    const script = parts[0]?.trim() || content;
    const showNotes = parts[1]?.trim() || "";
    return { success: true, fullContent: content, script, showNotes, model: data.model, usage: data.usage };
  } catch (e) {
    console.error("Script generation failed:", e);
    return { success: false, error: `生成失败: ${e.message}`, needsApiKey: e.message.includes("401") || e.message.includes("authentication") || e.message.includes("api_key") };
  }
}

function buildPrompt(data) {
  const a = data.aggregate;
  const lines = [];

  lines.push("# 专辑研究数据（仅基于以下信息撰写稿件，不可使用外部知识）");
  lines.push("");

  // —— 基本信息 ——
  lines.push("## 基本信息");
  if (a) {
    lines.push(`- 专辑名: ${a.title}  [MusicBrainz/iTunes]`);
    lines.push(`- 艺术家: ${a.artist}  [MusicBrainz/iTunes]`);
    if (a.date) lines.push(`- 发行日期: ${a.date}`);
    if (a.genre) lines.push(`- 流派: ${a.genre}`);
    if (a.labels?.length) lines.push(`- 厂牌: ${a.labels.join(", ")}  [MusicBrainz]`);
    if (a.trackCount) lines.push(`- 曲目数: ${a.trackCount}`);
    if (a.sources?.length) lines.push(`- 数据来源: ${a.sources.join(" + ")}`);
    if (a.tags?.length) lines.push(`- 标签: ${a.tags.join(", ")}`);
    if (a.rating) lines.push(`- MusicBrainz 评分: ${a.rating.score}/5 (${a.rating.count}票)`);
    if (a.popularity) {
      lines.push(`- 流行度: ${a.popularity.source} ${a.popularity.listeners ? `听众 ${(a.popularity.listeners/1000).toFixed(0)}k` : ""}${a.popularity.playcount ? ` 播放 ${(a.popularity.playcount/1000000).toFixed(1)}M` : ""}`);
    }
    lines.push("");
  }

  // —— Wikipedia 摘要 ——
  if (data.wikipedia?.extract) {
    lines.push("## Wikipedia 专辑简介");
    lines.push(data.wikipedia.extract);
    lines.push(`来源: ${data.wikipedia.url}`);
    lines.push("");
  }

  // —— 专业乐评（Wikipedia Critical Reception 段落） ——
  if (data.reception) {
    lines.push("## 专业乐评（Wikipedia 'Critical reception' 段落）");
    lines.push("以下内容摘自 Wikipedia 的乐评章节，聚合了各大音乐媒体的评价：");
    if (data.reception.reviews?.length) {
      lines.push("### 提取的评分");
      data.reception.reviews.forEach(r => lines.push(`- ${r.source}: ${r.score}  [Wikipedia Reception]`));
      lines.push("");
    }
    lines.push("### 原文摘要");
    lines.push(data.reception.text);
    lines.push("  [来源: Wikipedia 'Critical reception' 章节]");
    lines.push("");
  }

  // —— MusicBrainz ——
  if (data.musicbrainz) {
    const mb = data.musicbrainz;
    lines.push("## MusicBrainz 结构化数据  [MusicBrainz]");
    if (mb.artists?.length) lines.push(`艺术家: ${mb.artists.join(", ")}`);
    if (mb.type) lines.push(`类型: ${mb.type}`);
    if (mb.date) lines.push(`发行日期: ${mb.date}`);
    if (mb.country) lines.push(`发行国家: ${mb.country}`);
    if (mb.labels?.length) lines.push(`厂牌: ${mb.labels.join(", ")}`);
    if (mb.tags?.length) lines.push(`标签: ${mb.tags.join(", ")}`);
    if (mb.tracks?.length) {
      lines.push(`曲目列表 (${mb.trackCount}首):`);
      mb.tracks.forEach(t => lines.push(`  ${t.number}. ${t.title}${t.length ? ` (${t.length})` : ""}`));
    }
    lines.push(`MusicBrainz: ${mb.url}`);
    lines.push("");
  }

  // —— iTunes ——
  if (data.itunes) {
    const it = data.itunes;
    lines.push("## Apple Music 数据  [iTunes]");
    lines.push(`专辑: ${it.title}`);
    lines.push(`艺术家: ${it.artist}`);
    if (it.genre) lines.push(`流派: ${it.genre}`);
    if (it.releaseDate) lines.push(`发行日期: ${it.releaseDate}`);
    if (it.trackCount) lines.push(`曲目数: ${it.trackCount}`);
    if (it.copyright) lines.push(`版权: ${it.copyright}`);
    lines.push(`Apple Music: ${it.url}`);
    lines.push("");
  }

  // —— Last.fm ——
  if (data.lastfm && !data.lastfm.searchOnly) {
    const lf = data.lastfm;
    lines.push("## Last.fm 数据  [Last.fm]");
    if (lf.listeners) lines.push(`听众: ${lf.listeners.toLocaleString()}`);
    if (lf.playcount) lines.push(`总播放: ${lf.playcount.toLocaleString()}`);
    if (lf.tags?.length) lines.push(`标签: ${lf.tags.join(", ")}`);
    if (lf.summary) lines.push(`简介: ${lf.summary.substring(0, 1000)}`);
    lines.push(`Last.fm: ${lf.url}`);
    lines.push("");
  }

  // —— 错误说明 ——
  if (data.errors?.length) {
    lines.push("## 数据采集说明");
    lines.push("以下源未返回有效数据（不影响已有数据使用）:");
    data.errors.forEach(e => lines.push(`- ${e}`));
    lines.push("");
  }

  lines.push("---");
  lines.push("请严格按照以下要求撰写稿件：");
  lines.push("1. 每句事实陈述后标注 `[来源名]`，如 `[Wikipedia]`、`[MusicBrainz]`、`[Wikipedia Reception]`、`[iTunes]`、`[Last.fm]`");
  lines.push("2. 只使用上面提供的数据，不要编造、补充任何未提供的信息");
  lines.push("3. 如果某个话题方向完全没有数据支撑，就跳过该部分");
  lines.push("4. 乐评评分必须写清楚来源媒体和具体分数");
  lines.push("5. 完稿后在 Show Notes 中附上完整的来源清单");

  return lines.join("\n");
}
