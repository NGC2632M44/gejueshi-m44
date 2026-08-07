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

export function mirCacheKeyFor(query, opts = {}) {
  return (query || "").toLowerCase().replace(/\s+/g, "_") +
    "|song=" + (opts.songTitle || "").toLowerCase().replace(/\s+/g, "_") +
    "|artist=" + (opts.artistName || "").toLowerCase().replace(/\s+/g, "_");
}

function _cacheKey(query, opts) {
  return mirCacheKeyFor(query, opts);
}

function _cacheGet(query, opts) {
  const entry = mirCache.get(_cacheKey(query, opts));
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  if (entry) mirCache.delete(_cacheKey(query, opts));
  return null;
}

function _cacheSet(query, data, opts) {
  mirCache.set(_cacheKey(query, opts), { data, ts: Date.now() });
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
  const chordText = text.match(/Most Important Chords\s*:?\s*((?:The three most important chords|[^.])+?\.)/i)?.[1] || null;
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
  const headers = {
    "User-Agent": "Mozilla/5.0 (compatible; Gejueshi-MIR/3.3; +http://localhost:3001)",
    "Accept": "text/html,application/xhtml+xml",
  };
  const attempts = [
    () => fetch(url, { headers, signal: AbortSignal.timeout(15000) }),
    () => smartFetch(url, { headers, signal: AbortSignal.timeout(15000) }),
  ];
  for (const fn of attempts) {
    try {
      const res = await fn();
      if (!res.ok) continue; // 404 = 无此曲目 Tab → no_data，不当作“挂了”
      const parsedData = parseHookTheoryHtml(await res.text());
      if (parsedData) {
        return {
          ...parsedData,
          url,
          track_name: title,
          artist_name: artist,
        };
      }
    } catch (e) {
      console.log(`   ⚠️ Hooktheory: ${e.message}`);
    }
  }
  return null;
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
 * 更稳的本地和弦进行：按 structure_segments（或整曲）取每段主导和弦，
 * 去重相邻重复后返回字母与罗马数字两种形式。仍属“未外部验证”。
 */
function segmentChordProgression(localResult) {
  const ev = localResult?.evidence?.["作曲"];
  const events = Array.isArray(ev?.chord_events) ? ev.chord_events : [];
  if (!events.length) return null;
  const segments = (Array.isArray(ev?.structure_segments) && ev.structure_segments.length)
    ? ev.structure_segments
    : [{ start_sec: events[0].start_sec || 0, end_sec: events[events.length - 1].end_sec || 0 }];
  const pickDominant = (start, end) => {
    const w = new Map();
    for (const e of events) {
      const s = Math.max(e.start_sec || 0, start || 0);
      const en = Math.min(e.end_sec || 0, end == null ? Infinity : end);
      const d = en - s;
      if (d > 0 && e.label) w.set(e.label, (w.get(e.label) || 0) + d);
    }
    return [...w.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  };
  const letters = segments
    .map((seg) => pickDominant(seg.start_sec, seg.end_sec))
    .filter(Boolean)
    .filter((c, i, arr) => c !== arr[i - 1])
    .slice(0, 5)
    .join("-");
  if (!letters) return null;
  return {
    letters,
    roman: formatChordSequenceRoman(letters, localResult?.key) || null,
  };
}

/**
 * 防串歌：外部源返回的歌曲名/艺人必须与当前查询身份一致才参与交叉验证。
 * （不匹配的来源标记为 no_match，防止上一首歌/同名歌污染本次结果）
 */
function _songIdentityMatches(ext, opts) {
  if (!opts?.songTitle && !opts?.artistName) return true;
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
  const qTitle = norm(opts.songTitle);
  const qArtist = norm(opts.artistName);
  if (qArtist && ext.artist_name) {
    const a = norm(ext.artist_name);
    if (!a.includes(qArtist) && !qArtist.includes(a)) return false;
  }
  if (qTitle && ext.track_name) {
    const t = norm(ext.track_name);
    if (!t.includes(qTitle) && !qTitle.includes(t)) return false;
  }
  return true;
}

export function songIdentityMatches(ext, opts) {
  return _songIdentityMatches(ext, opts);
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
  const url = `https://api.getsongbpm.com/search/?api_key=${encodeURIComponent(apiKey)}&type=song&lookup=${encodeURIComponent(title)}`;
  const headers = { "User-Agent": UA, "Referer": "https://getsongbpm.com/" };
  const attempts = [
    () => proxiedFetch(url, { headers, signal: AbortSignal.timeout(12000) }),
    () => smartFetch(url, { headers, signal: AbortSignal.timeout(12000) }),
  ];
  let data = null;
  for (const fn of attempts) {
    try {
      const res = await fn();
      if (!res.ok) throw new Error(`SongBPM API HTTP ${res.status}`);
      const text = await res.text();
      try {
        data = JSON.parse(text);
      } catch (_) {
        throw new Error("SongBPM API 返回非 JSON（可能被 Cloudflare 拦截）");
      }
      if (data) break;
    } catch (e) {
      console.log(`   ♪ SongBPM API: ${e.message}`);
      if (fn === attempts[attempts.length - 1]) throw e;
    }
  }
  if (data) {
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
  }
  return null;
}

async function querySongBPM(query, apiKey, songTitle, artistName) {
  return querySongBPMAPI(query, apiKey, songTitle, artistName);
}

/**
 * MusicBrainz 录音查找 (录音 MBID/时长)
 * 使用 quoted Lucene 查询（recording + artist），避免“Wet & Wild”被拆成两个词。
 */
async function queryMusicBrainz(query, songTitle, artistName) {
  const parsed = _parseTrackQuery(query);
  const title = songTitle || parsed?.title || null;
  const artist = artistName || parsed?.artist || null;
  const esc = (s) => String(s || "").replace(/"/g, " ");
  let lucene = title
    ? `recording:"${esc(title)}"`
    : `"${esc(query)}"`;
  if (artist) lucene += ` AND artist:"${esc(artist)}"`;
  try {
    const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(lucene)}&fmt=json&limit=3`;
    const res = await smartFetch(url, {
      headers: { "User-Agent": "Gejueshi/3.2 (MIR Cross-Ref; +http://localhost:3001)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`MusicBrainz HTTP ${res.status}`);
    const data = await res.json();
    const rec = data.recordings?.[0];
    return rec ? {
      source: "musicbrainz",
      mbid: rec.id,
      track_name: rec.title || null,
      artist_name: rec["artist-credit"]?.[0]?.name || null,
      duration_ms: rec.length || null,
    } : null;
  } catch (e) {
    console.log(`    ♪ MusicBrainz: ${e.message}`);
    throw e;
  }
}

/**
 * Last.fm track.getInfo（时长 / 听众 / 播放量 / 专辑 / 标签）
 * 不提供 BPM/Key，只参与时长与身份校验。
 */
async function queryLastfmTrack(query, apiKey, songTitle, artistName) {
  if (!apiKey) return null;
  const parsed = _parseTrackQuery(query);
  const artist = artistName || parsed?.artist || null;
  const title = songTitle || parsed?.title || null;
  if (!artist || !title) return null;
  const url = `https://ws.audioscrobbler.com/2.0/?method=track.getInfo&api_key=${encodeURIComponent(apiKey)}&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(title)}&format=json&autocorrect=1`;
  try {
    const res = await smartFetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`Last.fm HTTP ${res.status}`);
    const data = await res.json();
    const t = data?.track;
    if (!t) return null;
    return {
      source: "lastfm",
      track_name: t.name || title,
      artist_name: t.artist?.name || artist,
      duration_sec: t.duration ? Math.round(Number(t.duration) / 1000) : null,
      album: t.album?.title || null,
      listeners: t.listeners ? Number(t.listeners) : null,
      playcount: t.playcount ? Number(t.playcount) : null,
      tags: Array.isArray(t.toptags?.tag) ? t.toptags.tag.map(x => x.name).slice(0, 8) : [],
      url: t.url || null,
    };
  } catch (e) {
    console.log(`    ♪ Last.fm: ${e.message}`);
    throw e;
  }
}

/**
 * Genius 搜索（标题 / 艺人 / 发行日 / 歌词页）
 * 不提供 BPM/Key，参与身份与专辑信息校验；api.genius.com 需走代理。
 */
async function queryGeniusSong(query, token, songTitle, artistName) {
  if (!token) return null;
  const parsed = _parseTrackQuery(query);
  const artist = artistName || parsed?.artist || null;
  const title = songTitle || parsed?.title || query;
  const url = `https://api.genius.com/search?q=${encodeURIComponent((artist ? artist + " " : "") + title)}`;
  try {
    const res = await proxiedFetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`Genius HTTP ${res.status}`);
    const data = await res.json();
    const hits = (data?.response?.hits || []).filter(h => h.type === "song");
    for (const h of hits) {
      const r = h.result;
      if (!r) continue;
      const candidate = {
        source: "genius",
        track_name: r.title || null,
        artist_name: r.primary_artist?.name || null,
        url: r.url || null,
        release_date: r.release_date_for_display || null,
        album: r.album?.name || null,
        page_views: r.stats?.pageviews ?? null,
      };
      if (_songIdentityMatches(candidate, { songTitle, artistName })) return candidate;
    }
    return null; // 全部未匹配 → no_match
  } catch (e) {
    console.log(`    ♪ Genius: ${e.message}`);
    throw e;
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
  const cached = _cacheGet(query, opts);
  if (cached) {
    console.log(`   💾 MIR缓存命中: "${query}" (${Math.round((Date.now() - cached._cachedAt) / 1000)}s前)`);
    return { ...cached, fromCache: true };
  }

  const start = Date.now();
  const sources = [];
  const external = [];

  // ── 并行查询所有源 ──
  const songbpmApiKey = opts.getsongbpmApiKey || process.env.GETSONGBPM_API_KEY || "";
  const lastfmApiKey = opts.lastfmApiKey || process.env.LASTFM_API_KEY || "";
  const geniusToken = opts.geniusToken || process.env.GENIUS_TOKEN || "";
  const [hooktheory, songbpm, mb, lastfm, genius] = await Promise.allSettled([
    queryHookTheory(query, opts.songTitle, opts.artistName),
    querySongBPM(query, songbpmApiKey, opts.songTitle, opts.artistName),
    queryMusicBrainz(query, opts.songTitle, opts.artistName),
    queryLastfmTrack(query, lastfmApiKey, opts.songTitle, opts.artistName),
    queryGeniusSong(query, geniusToken, opts.songTitle, opts.artistName),
  ]);

  // 防串歌：先收齐外部结果，再按歌曲/艺人身份过滤
  const externalAll = [];
  if (hooktheory.value) externalAll.push(hooktheory.value);
  if (songbpm.value) externalAll.push(songbpm.value);
  if (mb.value) externalAll.push(mb.value);
  if (lastfm.value) externalAll.push(lastfm.value);
  if (genius.value) externalAll.push(genius.value);
  for (const e of externalAll) {
    if (_songIdentityMatches(e, opts)) external.push(e);
  }
  const htIn = hooktheory.value && external.includes(hooktheory.value);
  const sbIn = songbpm.value && external.includes(songbpm.value);
  const lfIn = lastfm.value && external.includes(lastfm.value);
  const gnIn = genius.value && external.includes(genius.value);

  sources.push({ name: "hooktheory", status: htIn ? "ok" : (hooktheory.value ? "no_match" : (hooktheory.reason ? "error" : "no_data")) });
  if (sbIn) {
    sources.push({ name: "songbpm", status: "ok" });
  } else if (!songbpmApiKey) {
    sources.push({ name: "songbpm", status: "no_config" });
  } else if (songbpm.value) {
    sources.push({ name: "songbpm", status: "no_match" });
  } else if (songbpm.reason) {
    sources.push({ name: "songbpm", status: "error" });
  } else {
    sources.push({ name: "songbpm", status: "no_data" });
  }

  sources.push({
    name: "musicbrainz",
    status: mb.value
      ? (external.includes(mb.value) ? "found" : "no_match")
      : (mb.reason ? "error" : "no_data"),
    ...(mb.reason ? { detail: mb.reason?.message } : {}),
  });
  if (lfIn) {
    sources.push({ name: "lastfm", status: "ok" });
  } else if (!lastfmApiKey) {
    sources.push({ name: "lastfm", status: "no_config" });
  } else if (lastfm.value) {
    sources.push({ name: "lastfm", status: "no_match" });
  } else if (lastfm.reason) {
    sources.push({ name: "lastfm", status: "error", detail: lastfm.reason?.message });
  } else {
    sources.push({ name: "lastfm", status: "no_data" });
  }
  if (gnIn) {
    sources.push({ name: "genius", status: "ok" });
  } else if (!geniusToken) {
    sources.push({ name: "genius", status: "no_config" });
  } else if (genius.value) {
    sources.push({ name: "genius", status: "no_match" });
  } else if (genius.reason) {
    sources.push({ name: "genius", status: "error", detail: genius.reason?.message });
  } else {
    sources.push({ name: "genius", status: "no_data" });
  }
  if (songbpm.reason) {
    const sp = sources.find(s => s.name === "songbpm");
    if (sp) sp.detail = songbpm.reason?.message || "API 请求失败";
  }
  if (hooktheory.reason) {
    const hp = sources.find(s => s.name === "hooktheory");
    if (hp) hp.detail = hooktheory.reason?.message || "页面请求失败";
  }

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

  // 时长交叉校验（MusicBrainz / Last.fm vs 本地 ffprobe 原时长）
  const localDurSec = localResult?.duration_seconds != null ? Number(localResult.duration_seconds) : null;
  const durationCandidates = [];
  if (mb.value?.duration_ms) {
    durationCandidates.push({ source: "MusicBrainz", seconds: mb.value.duration_ms / 1000, tolerance: 2 });
  }
  const lfDurSec = external.find(s => s.source === "lastfm" && s.duration_sec != null)?.duration_sec;
  if (lfDurSec) {
    durationCandidates.push({ source: "Last.fm", seconds: lfDurSec, tolerance: 4 });
  }
  // 优先 MusicBrainz；其次 Last.fm
  durationCandidates.sort((a, b) => (a.source === "MusicBrainz" ? -1 : 1) - (b.source === "MusicBrainz" ? -1 : 1));
  const extDur = durationCandidates[0] || null;
  const matches = durationCandidates
    .filter(c => Number.isFinite(localDurSec) && c.seconds != null)
    .map(c => ({
      source: c.source,
      seconds: Math.round(c.seconds),
      match: Math.abs(localDurSec - c.seconds) <= c.tolerance,
    }));
  const duration_check = {
    local_seconds: Number.isFinite(localDurSec) ? localDurSec : null,
    external_seconds: extDur ? Math.round(extDur.seconds) : null,
    source: extDur?.source || null,
    sources: matches,
    match: matches.length ? (matches.every(m => m.match) ? true : (matches.some(m => m.match) ? "partial" : false)) : null,
  };

  // ── 最终推荐值 ──
  const chordSource = external.find(s => s.chord_sequence);
  const netChordLetters = formatChordSequence(chordSource?.chord_sequence || null);
  const localChordLetters = topChordProgression(localResult);
  const localSeg = segmentChordProgression(localResult);
  // 主和弦进行只采用外部已验证来源；本地高频和弦单独作为参考展示
  let chordDisplay = netChordLetters || null;
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
    local_chord_progression: localSeg?.letters || localChordLetters,
    local_chord_roman: localSeg?.roman || null,
    trust: {
      bpm: {
        value: recommended.bpm,
        sources: crossRef.sources.length ? crossRef.sources.slice() : ["local"],
        local_fusion: localResult?.bpm_fusion || null,
        local_estimators: Array.isArray(localResult?.bpm_estimators) ? localResult.bpm_estimators : [],
        confidence: crossRef.confidence_level === "high" ? "high" : crossRef.confidence_level === "medium" ? "medium" : (crossRef.sources.length > 1 ? "medium" : "low"),
        note: crossRef.sources.length > 1 ? `多源一致（${crossRef.sources.length} 源）` : "仅本地单源，未外部验证",
      },
      key: {
        value: recommended.key,
        local_value: localResult?.key || null,
        second_candidate: localResult?.key_second_candidate?.key_full || null,
        local_methods_disagree: !!localResult?.key_methods_disagree,
        local_sonara_key: localResult?.sonara?.key || null,
        sources: crossRef.sources.length ? crossRef.sources.slice() : ["local"],
        confidence: crossRef.confidence_level === "high" || crossRef.confidence_level === "medium" ? crossRef.confidence_level : (crossRef.sources.length > 1 ? "medium" : "low"),
        note: (crossRef.confidence_level === "high" || crossRef.confidence_level === "medium")
          ? `多源一致（${crossRef.sources.length} 源）`
          : crossRef.sources.length > 1 ? "外部多数覆盖，但存在分歧"
          : localResult?.key_methods_disagree
            ? "仅本地单源且本地双特征分歧，未外部验证"
            : (localResult?.sonara?.key && localResult?.key && localResult.sonara.key !== localResult.key)
              ? `仅本地单源（sonara=${localResult.sonara.key} vs 本地=${localResult.key} 分歧），未外部验证`
              : "仅本地单源，未外部验证",
      },
      duration: {
        local_seconds: localDurSec,
        external_seconds: duration_check.external_seconds,
        external_sources: duration_check.sources || [],
        match: duration_check.match,
        confidence: duration_check.match === true ? "high" : duration_check.match === false ? "low" : "medium",
        note: duration_check.match === true
          ? `本地与 ${(duration_check.sources || []).map(s => s.source).join("、")} 一致`
          : duration_check.match === false
            ? `本地与外部不一致（可能版本不同）：${(duration_check.sources || []).map(s => `${s.source} ${s.seconds}s`).join("、")}`
            : duration_check.match === "partial"
              ? "部分外部源一致（版本差异）"
              : "仅本地 ffprobe，无外部时长来源",
      },
      chord: {
        value: recommended.chord_sequence,
        verified: !!chordSource,
        source: chordSource ? chordSource.source : (localSeg ? "local_sonara" : null),
        confidence: chordSource ? "medium" : (localSeg ? "low" : "low"),
        note: chordSource ? `外部来源（${chordSource.source}）` : (localSeg ? "本地算法（未外部验证）" : "无数据"),
      },
    },
    elapsed_ms: Date.now() - start,
    _cachedAt: Date.now(),
  };

  _cacheSet(query, result, opts);

  return result;
}

export { parseHookTheoryHtml };
export default { mirCrossReference };
