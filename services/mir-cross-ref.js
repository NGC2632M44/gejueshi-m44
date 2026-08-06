// 歌掘士 v3.3 — 外部 MIR 数据库交叉查询服务
// 数据源: Hooktheory / Spotify Audio Features / SongBPM / AcousticBrainz (via MusicBrainz)
//
// Spotify 接入:
//   设置环境变量 SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET
//   Spotify Developer Dashboard → Create App → 获取凭据
//
// 交叉验证流程:
//   1. 同时查询 2-3 个源
//   2. ≥2 个结果一致 (BPM误差≤2, 调名一致) → 候选值
//   3. 外部多数派可覆盖本地算法结果
//   4. 缓存: 同一查询 1 小时内不重复请求

import { crossReference, assessKeyReliability } from "./audio-analyzer.js";

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

async function queryHookTheory(query) {
  const parsed = _parseTrackQuery(query);
  if (!parsed?.artist || !parsed?.title) return null;

  const url = `https://www.hooktheory.com/theorytab/view/${_slugifyPart(parsed.artist)}/${_slugifyPart(parsed.title)}`;
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
      track_name: parsed.title,
      artist_name: parsed.artist,
    } : null;
  } catch (e) {
    console.log(`   ⚠️ Hooktheory: ${e.message}`);
    return null;
  }
}

// ── Spotify OAuth (Client Credentials Flow) ──
let _spotifyToken = null;
let _spotifyTokenExpiry = 0;

async function getSpotifyToken() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;

  if (_spotifyToken && Date.now() < _spotifyTokenExpiry) return _spotifyToken;

  try {
    const auth = Buffer.from(`${id}:${secret}`).toString("base64");
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) { console.log(`   ⚠️ Spotify auth: ${res.status}`); return null; }
    const data = await res.json();
    _spotifyToken = data.access_token;
    _spotifyTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return _spotifyToken;
  } catch (e) {
    console.log(`   ⚠️ Spotify auth failed: ${e.message}`);
    return null;
  }
}

/**
 * Spotify Audio Features 查询
 * 返回: BPM, Key, Mode, Energy, Danceability, Valence, Acousticness 等
 */
async function querySpotify(query) {
  const token = await getSpotifyToken();
  if (!token) return null;

  try {
    // 1. 搜索曲目
    const searchUrl = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1`;
    const searchRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const track = searchData.tracks?.items?.[0];
    if (!track) return null;

    // 2. 获取 Audio Features
    const afUrl = `https://api.spotify.com/v1/audio-features/${track.id}`;
    const afRes = await fetch(afUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!afRes.ok) return null;
    const af = await afRes.json();

    // Spotify pitch class notation → 标准调名
    const pitchMap = { 0: "C", 1: "Db", 2: "D", 3: "Eb", 4: "E", 5: "F", 6: "Gb", 7: "G", 8: "Ab", 9: "A", 10: "Bb", 11: "B" };

    return {
      source: "spotify",
      bpm: af.tempo ? Math.round(af.tempo * 10) / 10 : null,
      key: af.key !== -1 ? `${pitchMap[af.key]} ${af.mode === 1 ? "major" : "minor"}` : null,
      key_confidence: af.key !== -1 ? (af.mode_confidence || 0.7) : null,
      energy: af.energy != null ? Math.round(af.energy * 100) : null,
      danceability: af.danceability != null ? Math.round(af.danceability * 100) : null,
      valence: af.valence != null ? Math.round(af.valence * 100) : null,
      acousticness: af.acousticness != null ? Math.round(af.acousticness * 100) : null,
      instrumentalness: af.instrumentalness != null ? Math.round(af.instrumentalness * 100) : null,
      spotify_id: track.id,
      spotify_popularity: track.popularity,
      track_name: track.name,
      artist_name: track.artists?.[0]?.name,
      album_name: track.album?.name,
    };
  } catch (e) {
    console.log(`   ⚠️ Spotify query: ${e.message}`);
    return null;
  }
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
 * API 搜索已死 (404) + POST 搜索被 CSRF 保护 (403)，只能通过已知 URL 直接访问
 */
async function querySongBPMByUrl(songbpmUrl) {
  try {
    const res = await fetch(songbpmUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Gejueshi-MIR/3.3; +http://localhost:3001)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    return { ...parseSongBPMHtml(html), url: songbpmUrl };
  } catch (e) {
    console.log(`   ⚠️ SongBPM: ${e.message}`);
    return null;
  }
}

// 旧版 search-based 函数保留为空 (API 已死)
async function querySongBPM(query) { return null; }

/**
 * AcousticBrainz (via MusicBrainz recording ID)
 * 需要先通过 MusicBrainz 查到 recording ID
 */
async function queryAcousticBrainz(mbid) {
  if (!mbid) return null;
  try {
    const { HttpsProxyAgent } = await import("https-proxy-agent");
    const agent = new HttpsProxyAgent("http://127.0.0.1:1001");
    const url = `https://acousticbrainz.org/api/v1/${mbid}/low-level`;
    const res = await fetch(url, { agent, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    const key = data.tonal?.key_key;
    const scale = data.tonal?.key_scale;
    return {
      source: "acousticbrainz",
      bpm: data.rhythm?.bpm ? Math.round(data.rhythm.bpm) : null,
      key: key ? `${key} ${scale || "major"}` : null,
      key_confidence: data.tonal?.key_strength ? Math.round(data.tonal.key_strength * 100) : null,
    };
  } catch (e) {
    return null;
  }
}

/**
 * MusicBrainz 录音查找 (获取 MBID 用于 AcousticBrainz)
 */
async function queryMusicBrainz(query) {
  try {
    const { HttpsProxyAgent } = await import("https-proxy-agent");
    const agent = new HttpsProxyAgent("http://127.0.0.1:1001");
    const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=2`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Gejueshi/3.2 (MIR Cross-Ref; +http://localhost:3001)" },
      agent, signal: AbortSignal.timeout(8000),
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
export async function mirCrossReference(query, localResult) {
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
  const [hooktheory, spotify, songbpm, mb] = await Promise.allSettled([
    queryHookTheory(query),
    querySpotify(query),
    querySongBPM(query),
    queryMusicBrainz(query),
  ]);

  // Hooktheory
  if (hooktheory.value) {
    sources.push({ name: "hooktheory", status: "ok" });
    external.push(hooktheory.value);
  } else {
    sources.push({ name: "hooktheory", status: "no_data" });
  }

  // Spotify
  if (spotify.value) {
    sources.push({ name: "spotify", status: "ok" });
    external.push(spotify.value);
  } else {
    sources.push({ name: "spotify", status: spotify.reason ? "error" : "no_config" });
  }

  // SongBPM — API 404 + 页面结构变更，暂时下线
  sources.push({ name: "songbpm", status: "retired" });

  // AcousticBrainz — 服务已下线 (HTTP 000)，暂时跳过
  sources.push({ name: "acousticbrainz", status: "retired" });
  sources.push({ name: "musicbrainz", status: mb.value ? "found" : "no_match" });

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

  // ── 最终推荐值 ──
  const recommended = {
    bpm: crossRef.bpm_consensus || localResult?.bpm || null,
    key: crossRef.key_consensus || localResult?.key || null,
    meter: external.find(s => s.meter)?.meter || localResult?.meter || null,
    chord_sequence: external.find(s => s.chord_sequence)?.chord_sequence || localResult?.chord_sequence || null,
    chord_summary: external.find(s => s.chord_summary)?.chord_summary || null,
    bpm_confidence: crossRef.confidence_level === "high" ? 0.85 :
                    crossRef.confidence_level === "medium" ? 0.55 : 0.35,
    key_confidence: crossRef.confidence_level === "high" ? 0.85 :
                    crossRef.confidence_level === "medium" ? 0.55 : 0.35,
    source_count: crossRef.sources.length,
    consensus_level: crossRef.confidence_level,
  };

  const result = {
    success: true,
    query,
    sources,
    external_results: external,
    crossReference: crossRef,
    reliability,
    recommended,
    elapsed_ms: Date.now() - start,
    _cachedAt: Date.now(),
  };

  _cacheSet(query, result);

  return result;
}

export { parseHookTheoryHtml };
export default { mirCrossReference };
