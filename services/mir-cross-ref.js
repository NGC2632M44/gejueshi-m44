// 歌掘士 v3.3 — 外部 MIR 数据库交叉查询服务
// 数据源: Hooktheory / Spotify Audio Features / SongBPM / MusicBrainz
//
// Spotify 接入:
//   设置环境变量 SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET
//   Spotify Developer Dashboard → Create App → 获取凭据
//
// 交叉验证流程:
//   1. 同时查询 2-3 个源
//   2. ≥2 个结果一致 (BPM误差≤2, 调名一致) → 候选值
//   3. 外部多数派可覆盖本地算法结果

import { smartFetch, proxiedFetch } from "./proxy-fetch.js";
//   4. 缓存: 同一查询 1 小时内不重复请求

import { crossReference, assessKeyReliability, formatChordSequence, formatChordSequenceRoman } from "./audio-analyzer.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// ── 简单内存缓存 (避免频繁请求三方 API) ──
const CACHE_TTL = 3600000; // 1 小时
const mirCache = new Map();

function _cacheKey(query) {
  return (query || "").toLowerCase().replace(/\s+/g, "_");
}

function _cacheGet(query) {
  const entry = mirCache.get(_cacheKey(query));
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  if (entry) mirCache.delete(_cacheKey(query));
  return null;
}

function _cacheSet(query, data) {
  mirCache.set(_cacheKey(query), { data, ts: Date.now() });
}

function _slugifyPart(value) {
  return (value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function _parseTrackQuery(query) {
  const cleaned = (query || "")
    .replace(/\.(mp3|flac|wav|m4a|aac|ogg)$/i, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;

  const parts = cleaned.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(" - ").trim() };
  }
  return { artist: null, title: cleaned };
}

function _flatText(html) {
  return (html || "")
    .replace(/<span[^>]*class=["'][^"']*margin-flat[^"']*["'][^>]*>\s*♭\s*<\/span>/gi, "b")
    .replace(/&nbsp;/g, " ")
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function _normalizeExternalKey(key) {
  if (!key) return null;
  return key
    .replace(/♭/g, "b")
    .replace(/\bMaj\b/i, "major")
    .replace(/\bMin\b/i, "minor")
    .replace(/\s+/g, " ")
    .trim();
}

function parseHookTheoryHtml(html) {
  const text = _flatText(html);
  const key = text.match(/\bKey\s+([A-G](?:#|b)?\s+(?:Major|Minor))/i)?.[1] || null;
  const bpm = text.match(/\bTempo\s+(\d+(?:\.\d+)?)\s*BPM/i)?.[1] || null;
  const meter = text.match(/\bMeter\s+(\d+\s*\/\s*\d+)/i)?.[1] || null;
  const genre = text.match(/\bGenre\s+(.+?)\s+(?:Melody Range|Mood|Most Used Chord|Other tags|Premium|We are processing|Access|Section|Key|Tempo|Meter)\b/i)?.[1] || null;
  const chordText = text.match(/Most Important Chords\s+((?:The three most important chords|[^.])+?\.)/i)?.[1] || null;
  const chordNames = chordText?.match(/\(([A-G][^)]+?)\)/)?.[1] || null;

  if (!key && !bpm && !meter && !chordNames) return null;

  return {
    source: "hooktheory",
    bpm: bpm ? Math.round(parseFloat(bpm) * 10) / 10 : null,
    key: _normalizeExternalKey(key),
    meter: meter ? meter.replace(/\s+/g, "") : null,
    genre: genre ? genre.trim() : null,
    chord_sequence: chordNames ? chordNames.replace(/,\s*and\s*/i, ", ").replace(/\s+/g, " ").trim() : null,
    chord_summary: chordText ? chordText.replace(/\s+/g, " ").trim().slice(0, 240) : null,
  };
}

async function queryHookTheory(query, songTitle, artistName) {
  const parsed = _parseTrackQuery(query);
  const artist = artistName || parsed?.artist || null;
  const title = songTitle || parsed?.title || null;
  if (!artist || !title) return null;

  const url = `https://www.hooktheory.com/theorytab/view/${_slugifyPart(artist)}/${_slugifyPart(title)}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Gejueshi-MIR/3.3; +http://localhost:3001)",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const parsedData = parseHookTheoryHtml(await res.text());
    return parsedData ? {
      ...parsedData,
      url,
      track_name: title,
      artist_name: artist,
    } : null;
  } catch (e) {
    console.log(`   ⚠️ Hooktheory: ${e.message}`);
    return null;
  }
}

function topChordProgression(localResult) {
  const events = localResult?.evidence?.["作曲"]?.chord_events;
  if (!Array.isArray(events) || !events.length) return null;
  const w = new Map();
  for (const e of events) {
    if (!e || !e.label) continue;
    const dur = ((e.end_sec || 0) - (e.start_sec || 0)) || 0;
    w.set(e.label, (w.get(e.label) || 0) + dur);
  }
  const top = [...w.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
  return top.length ? top.join("-") : null;
}

/**
 * SongBPM 页面解析（2026-08 实测页面结构）。
 * BPM 在 "128 <span>BPM</span>"；Key 字母在 Key <dd>；调式在正文
 * "key and a <span>minor</span> mode" 中。
 * 注意：songbpm 搜索页 URL 带随机后缀，无法可靠自动定位，仅支持已知 URL。
 */
export function parseSongBPMHtml(html) {
  const bpmMatch = html.match(/>\s*(\d+(?:\.\d+)?)\s*<span[^>]*>\s*BPM\s*</i)
    || html.match(/Tempo \(BPM\)\s*<\/dt>\s*<dd[^>]*>\s*(\d+(?:\.\d+)?)\s*<\/dd>/i);
  const keyMatch = html.match(/Key\s*<\/dt>\s*<dd[^>]*>\s*([A-G][#b]?)\s*<\/dd>/i);
  const modeMatch = html.match(/key and a\s*<span[^>]*>\s*(major|minor)\s*<\/span>\s*mode/i);

  const bpm = bpmMatch ? parseFloat(bpmMatch[1]) : null;
  let key = null;
  if (keyMatch) {
    const letter = keyMatch[1];
    const mode = (modeMatch?.[1] || "").toLowerCase();
    key = mode ? `${letter} ${mode}` : letter;
  }

  return {
    source: "songbpm",
    bpm: bpm && !Number.isNaN(bpm) ? Math.round(bpm * 10) / 10 : null,
    key: _normalizeExternalKey(key),
  };
}


/**
 * SongBPM 直接页面抓取 (需要完整 URL，如 https://songbpm.com/@rose-gray/wet-wild-njwcb)
 * 仅手动校验：官方 API 搜索/ID 均查不到部分歌曲（Rose Gray 实测 no result），
 * 因此不做自动定位，用户粘贴完整 URL 后解析页面。
 */
export async function querySongBPMByUrl(songbpmUrl) {
  const headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36" };
  const attempts = [
    () => fetch(songbpmUrl, { headers, signal: AbortSignal.timeout(12000) }),
    () => smartFetch(songbpmUrl, { headers, signal: AbortSignal.timeout(12000) }),
  ];
  for (const fn of attempts) {
    try {
      const res = await fn();
      if (res.ok) {
        const html = await res.text();
        return { ...parseSongBPMHtml(html), url: songbpmUrl };
      }
    } catch (e) {
      console.log(`   ⚠️ SongBPM: ${e.message}`);
    }
  }
  return null;
}

/**
 * SongBPM 官方 API 搜索（需要 api_key，走代理 + UA/Referer 绕过 Cloudflare）
 * 返回: tempo / key_of / uri / artist。按艺人名过滤同名歌曲。
 */
async function querySongBPMAPI(query, apiKey, songTitle, artistName) {
  if (!apiKey) return null;
  const parsed = _parseTrackQuery(query);
  const title = songTitle || parsed?.title || query;
  const artist = artistName || parsed?.artist || null;
  try {
    const url = `https://api.getsongbpm.com/search/?api_key=${encodeURIComponent(apiKey)}&type=song&lookup=${encodeURIComponent(title)}`;
    const res = await proxiedFetch(url, {
      headers: { "User-Agent": UA, "Referer": "https://getsongbpm.com/" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const results = Array.isArray(data.search) ? data.search : [];
    if (!results.length) return null;

    const artistWords = [...new Set((artist || query || "").toLowerCase().split(/\s+/).filter((w) => w.length > 2))];
    const hit = results.find((r) => {
      const a = (r.artist?.name || "").toLowerCase();
      return artistWords.length === 0 || artistWords.some((w) => a.includes(w));
    }) || (artist ? null : results[0]);
    if (!hit) return null;

    const rawKey = (hit.key_of || "").replace(/♯/g, "#").replace(/♭/g, "b");
    return {
      source: "songbpm",
      bpm: hit.tempo ? Math.round(parseFloat(hit.tempo) * 10) / 10 : null,
      key: _normalizeExternalKey(rawKey),
      url: hit.uri || null,
      track_name: hit.title || null,
      artist_name: hit.artist?.name || null,
    };
  } catch (e) {
    console.log(`   ♪ SongBPM API: ${e.message}`);
    return null;
  }
}

async function querySongBPM(query, apiKey, songTitle, artistName) {
  return querySongBPMAPI(query, apiKey, songTitle, artistName);
}

/**
 * MusicBrainz 录音查找 (录音 MBID/时长)
 */
async function queryMusicBrainz(query) {
  try {
    const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=2`;
    const res = await smartFetch(url, {
      headers: { "User-Agent": "Gejueshi/3.2 (MIR Cross-Ref; +http://localhost:3001)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const rec = data.recordings?.[0];
    return rec ? { mbid: rec.id, title: rec.title, duration_ms: rec.length } : null;
  } catch (e) {
    return null;
  }
}

/**
 * ── 主导出: 多源交叉查询 ──
 * @param {string} query - 歌曲名 + 艺术家
 * @param {Object} localResult - Python 本地分析结果
 * @returns {Object} 交叉验证报告
 */
export async function mirCrossReference(query, localResult, opts = {}) {
  // 缓存检查
  const cached = _cacheGet(query);
  if (cached) {
    console.log(`   💾 MIR缓存命中: "${query}" (${Math.round((Date.now() - cached._cachedAt) / 1000)}s前)`);
    return { ...cached, fromCache: true };
  }

  const start = Date.now();
  const sources = [];
  const external = [];

  // ── 并行查询所有源 ──
  const songbpmApiKey = opts.getsongbpmApiKey || process.env.GETSONGBPM_API_KEY || "";
  const [hooktheory, songbpm, mb] = await Promise.allSettled([
    queryHookTheory(query, opts.songTitle, opts.artistName),
    querySongBPM(query, songbpmApiKey, opts.songTitle, opts.artistName),
    queryMusicBrainz(query),
  ]);

  // Hooktheory
  if (hooktheory.value) {
    sources.push({ name: "hooktheory", status: "ok" });
    external.push(hooktheory.value);
  } else {
    sources.push({ name: "hooktheory", status: "no_data" });
  }

  // SongBPM — 官方 API（部分歌曲未收录 → no_data；手动 URL 另行校验）
  if (songbpm.value) {
    sources.push({ name: "songbpm", status: "ok" });
    external.push(songbpm.value);
  } else if (!songbpmApiKey) {
    sources.push({ name: "songbpm", status: "no_config" });
  } else if (songbpm.reason) {
    sources.push({ name: "songbpm", status: "error" });
  } else {
    sources.push({ name: "songbpm", status: "no_data" });
  }

  sources.push({ name: "musicbrainz", status: mb.value ? "found" : (mb.reason ? "error" : "no_match") });

  // ── 交叉验证 ──
  const localData = {
    bpm: localResult?.bpm,
    key: localResult?.key,
    key_confidence: localResult?.key_confidence,
    spectral: localResult?.spectral,
    dynamics: localResult?.dynamics,
  };

  const crossRef = crossReference(localData, external);
  const reliability = assessKeyReliability(localData, crossRef);

  // 时长交叉校验（MusicBrainz 录音时长 vs 本地 ffprobe 原时长）
  const mbDurSec = mb.value?.duration_ms ? mb.value.duration_ms / 1000 : null;
  const localDurSec = localResult?.duration_seconds != null ? Number(localResult.duration_seconds) : null;
  const duration_check = {
    local_seconds: Number.isFinite(localDurSec) ? localDurSec : null,
    external_seconds: mbDurSec != null ? Math.round(mbDurSec) : null,
    source: "MusicBrainz",
    match: Number.isFinite(localDurSec) && mbDurSec != null ? Math.abs(localDurSec - mbDurSec) <= 2 : null,
  };

  // ── 最终推荐值 ──
  const chordSource = external.find(s => s.chord_sequence);
  const netChordLetters = formatChordSequence(chordSource?.chord_sequence || null);
  const localChordLetters = topChordProgression(localResult);
  let chordDisplay = netChordLetters || localChordLetters || null;
  let chordRomanMode = false;
  let chordKeyNote = null;
  const netKey = crossRef.key_consensus || localResult?.key || null;
  if (netChordLetters && localChordLetters && netKey && localResult?.key) {
    const romanNet = formatChordSequenceRoman(netChordLetters, netKey);
    const romanLocal = formatChordSequenceRoman(localChordLetters, localResult.key);
    if (romanNet && romanLocal && romanNet === romanLocal) {
      chordDisplay = romanNet;
      chordRomanMode = true;
      chordKeyNote = `罗马数字（${netKey}，本地 ${localResult.key} 同构）`;
    }
  }
  const recommended = {
    bpm: crossRef.bpm_consensus || localResult?.bpm || null,
    key: crossRef.key_consensus || localResult?.key || null,
    meter: external.find(s => s.meter)?.meter || localResult?.meter || null,
    chord_sequence: chordDisplay,
    chord_summary: external.find(s => s.chord_summary)?.chord_summary || null,
    bpm_confidence: crossRef.confidence_level === "high" ? 0.85 :
                    crossRef.confidence_level === "medium" ? 0.55 : 0.35,
    key_confidence: crossRef.confidence_level === "high" ? 0.85 :
                    crossRef.confidence_level === "medium" ? 0.55 : 0.35,
    source_count: crossRef.sources.length,
    consensus_level: crossRef.confidence_level,
  };
  const chord_evidence = chordSource ? {
    source: chordSource.source,
    url: chordSource.url || null,
    raw: chordSource.chord_summary || null,
    formatted: chordDisplay,
    roman: chordRomanMode,
    keyNote: chordKeyNote,
    localProgression: localChordLetters,
  } : null;

  const result = {
    success: true,
    query,
    sources,
    external_results: external,
    duration_check,
    crossReference: crossRef,
    reliability,
    recommended,
    chord_evidence,
    elapsed_ms: Date.now() - start,
    _cachedAt: Date.now(),
  };

  _cacheSet(query, result);

  return result;
}

export { parseHookTheoryHtml };
export default { mirCrossReference };
