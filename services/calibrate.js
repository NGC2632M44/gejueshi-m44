// 基础信息校准：用多源 API 对歌名/艺人/专辑/年份/厂牌/时长做共识判定。
// 原则：任何源先做匹配过滤（见 researcher._textMatchesQuery），只保留与查询相关的数据；
// 这里只做“多源一致/冲突”的工程化判定，不靠记忆、不硬编码。

export function normCalib(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "")
    .trim();
}

export function tokenMatch(text, query) {
  const tokens = String(query || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff\s]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 3);
  if (!tokens.length) return true;
  const hay = " " + String(text || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff\s]+/g, " ") + " ";
  return tokens.every((t) => hay.includes(t));
}

export function consensus(values) {
  const vals = (values || []).filter((v) => v != null && String(v).trim() !== "");
  if (!vals.length) return null;
  const groups = new Map();
  for (const v of vals) {
    const k = normCalib(v);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, { value: String(v).trim(), count: 0, samples: [] });
    groups.get(k).count++;
    groups.get(k).samples.push(String(v).trim());
  }
  if (!groups.size) return null;
  const best = [...groups.values()].sort((a, b) => b.count - a.count)[0];
  return {
    value: best.value,
    count: best.count,
    total: vals.length,
    conflict: best.count < vals.length,
    samples: best.samples,
  };
}

export function durationConsensus(secondsList) {
  const vals = (secondsList || []).filter((v) => Number.isFinite(v) && v > 0);
  if (!vals.length) return null;
  const rounded = vals.map((v) => Math.round(v));
  const clusters = [];
  for (const r of rounded) {
    let c = clusters.find((x) => Math.abs(x.value - r) <= 2);
    if (!c) {
      c = { value: r, count: 0, samples: [] };
      clusters.push(c);
    }
    c.count++;
    c.samples.push(r);
  }
  const best = clusters.sort((a, b) => b.count - a.count)[0];
  return {
    value: best.value,
    count: best.count,
    total: vals.length,
    conflict: best.count < vals.length,
    samples: best.samples,
  };
}

export function cleanYouTubeTitle(title, channel) {
  let t = String(title || "")
    .replace(/&amp;/gi, "&")
    .replace(/\s*\([^)]*(Visualiser|Visualizer|Official|Audio|Lyrics|4K|HD|Live)[^)]*\)\s*$/i, "")
    .trim();
  const parts = t.split(/\s+-\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const hint = (channel || "").replace(/VEVO$/i, "").replace(/[^a-z0-9]/g, "").toLowerCase();
    const first = parts[0].replace(/[^a-z0-9]/g, "").toLowerCase();
    if (hint && (hint.includes(first) || first.includes(hint))) parts.shift();
  }
  return parts.join(" - ").trim() || String(title || "").trim();
}

export function buildBasicCalibration({ query, local = null, neteaseSong = null, neteaseAlbum = null, lastfmTrack = null, genius = null, youtube = null, albumAgg = null, discogsTop = null }) {
  const title = consensus([
    neteaseSong?.name,
    lastfmTrack?.name,
    genius?.title,
    youtube?.title ? cleanYouTubeTitle(youtube.title, youtube.channel) : null,
  ]);
  const artist = consensus([
    neteaseSong?.artists,
    lastfmTrack?.artist,
    genius?.artist,
    youtube?.channel ? youtube.channel.replace(/VEVO$/i, "") : null,
  ]);
  const album = consensus([
    neteaseSong?.album,
    lastfmTrack?.album,
    albumAgg?.title,
  ]);
  const year = consensus([
    albumAgg?.date ? albumAgg.date.slice(0, 4) : null,
    discogsTop?.year != null ? String(discogsTop.year) : null,
    neteaseSong?.albumYear != null ? String(neteaseSong.albumYear) : null,
    neteaseAlbum?.publishTime ? String(new Date(neteaseAlbum.publishTime).getFullYear()) : null,
  ]);
  const label = consensus([
    albumAgg?.labels?.[0],
    discogsTop?.labels?.[0] || discogsTop?.label,
  ]);
  const genre = consensus([
    albumAgg?.genre || null,
    discogsTop?.genres?.[0] || discogsTop?.style || null,
    (albumAgg?.genres || [])[0] || null,
    (albumAgg?.tags || []).find((t) => !/^\d{4}$/.test(t)) || null,
  ]);
  const durations = [
    lastfmTrack?.duration ? lastfmTrack.duration / 1000 : null,
    neteaseSong?.duration_ms ? neteaseSong.duration_ms / 1000 : null,
  ];
  const duration = durationConsensus(durations);
  const localDuration = local?.duration_seconds != null ? Number(local.duration_seconds) : null;
  let durationCheck = null;
  if (duration && Number.isFinite(localDuration)) {
    durationCheck = {
      local_seconds: localDuration,
      recommended_seconds: duration.value,
      match: Math.abs(localDuration - duration.value) <= 2,
      sources: ["Last.fm", "NetEase"].filter((_, i) => durations[i] != null),
    };
  } else if (duration) {
    durationCheck = { local_seconds: null, recommended_seconds: duration.value, match: null, sources: ["Last.fm", "NetEase"].filter((_, i) => durations[i] != null) };
  }
  return { query, title, artist, album, year, label, genre, duration, durationCheck };
}
