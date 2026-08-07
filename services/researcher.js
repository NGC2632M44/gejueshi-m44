// 歌掘士 v5 — 混合研究引擎
// API源: Wikipedia(摘要+乐评+人员+榜单) | MusicBrainz | iTunes | Last.fm | Discogs
// 搜索引擎: 通过 DuckDuckGo 间接获取 RYM/AOTY/Discogs 公开数据（不触发反爬）
// 推荐算法: 当目标平台不可用时，用已有数据计算等价评分

import fetch from "node-fetch";
import { HttpsProxyAgent } from "https-proxy-agent";
import { smartFetch } from "./proxy-fetch.js";

const T = 20000;
const MB_UA = "Gejueshi/1.0 (Music Research; +http://localhost:3001)";

// Windows 系统代理 — WestWorldVPN
const PROXY_URL = process.env.GEJUESHI_PROXY_URL || "http://127.0.0.1:1001";
const proxyAgent = new HttpsProxyAgent(PROXY_URL);

// 需要走代理的域名 (被 GFW 限制)
const NEEDS_PROXY = ["wikipedia.org", "musicbrainz.org", "duckduckgo.com",
  "rateyourmusic.com", "albumoftheyear.org", "pitchfork.com", "metacritic.com",
  "apple.com", "discogs.com", "last.fm", "ws.audioscrobbler.com",
  "googleapis.com", "genius.com"];

function needsProxy(url) {
  try { return NEEDS_PROXY.some(d => new URL(url).hostname.includes(d)); }
  catch { return false; }
}

async function proxyFetch(url, opts = {}) {
  if (needsProxy(url)) {
    opts.agent = proxyAgent;
  }
  return fetch(url, opts);
}

function _textMatchesQuery(text, query) {
  const tokens = (query || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff\s]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 3);
  if (!tokens.length) return true;
  const hay = " " + (text || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff\s]+/g, " ") + " ";
  return tokens.every((t) => hay.includes(t));
}

// ── 研究缓存 (30分钟TTL，解决重复搜索结果不一致) ──
const RESEARCH_CACHE = new Map();
const RESEARCH_CACHE_TTL = 30 * 60 * 1000;

function _researchCacheKey(query) {
  return (query || "").toLowerCase().replace(/\s+/g, "_").slice(0, 80);
}

export async function researchAlbum(query, opts = {}) {
  // 缓存命中
  const ck = _researchCacheKey(query + "|" + (opts.songTitle || ""));
  const cached = RESEARCH_CACHE.get(ck);
  if (cached && Date.now() - cached.ts < RESEARCH_CACHE_TTL) {
    console.log(`   💾 研究缓存命中: "${query}" (${Math.round((Date.now() - cached.ts) / 1000)}s前)`);
    return { ...cached.data, fromCache: true };
  }

  const lfKey = opts.lastfmKey || process.env.LASTFM_API_KEY || null;
  const dgToken = opts.discogsToken || process.env.DISCOGS_TOKEN || null;
  const r = { query, wikipedia:null, reception:null, personnel:null, charts:null, yearEnd:null, trackListing:null, wikiData:null, musicbrainz:null, itunes:null, lastfm:null, discogs:null, rym:null, aoty:null, anyDecentMusic:null, aggregate:null, errors:[], timestamp:new Date().toISOString() };

  // 并行任务
  const tasks = [
    fetchWikipedia(query).then(async v=>{
      r.wikipedia=v;
      if(v?.title){
        const secs = await fetchWikiPageSections(v.title);
        if (secs) {
          r.reception = secs["critical reception"] || null;
          r.personnel = secs["personnel"] || null;
          r.charts = secs["charts"] || null;
          r.yearEnd = secs["year-end lists"] || null;
          r.trackListing = secs["track listing"] || null;
        }
      }
    }).catch(e=>r.errors.push(`Wikipedia: ${e.message}`)),
    fetchMusicBrainz(query).then(v=>r.musicbrainz=v).catch(e=>r.errors.push(`MusicBrainz: ${e.message}`)),
    fetchiTunes(query).then(v=>r.itunes=v).catch(e=>r.errors.push(`iTunes: ${e.message}`)),
  ];
  if (lfKey) tasks.push(fetchLastfm(query,lfKey).then(v=>r.lastfm=v).catch(e=>r.errors.push(`Last.fm: ${e.message}`)));
  if (dgToken) tasks.push(fetchDiscogsAPI(query,dgToken).then(v=>r.discogs=v).catch(e=>r.errors.push(`Discogs: ${e.message}`)));

  await Promise.allSettled(tasks);
  // 若 Wikipedia 抓到的是艺人页而非专辑页，用已解析的专辑名（Discogs/Last.fm）重查
  const resolvedAlbum = r.discogs?.results?.[0]?.title || r.lastfm?.title || null;
  // ADM 用专辑名搜索（单曲通常搜不到；全查询“专辑+艺人”会无结果）
  try {
    r.anyDecentMusic = await fetchAnyDecentMusic(resolvedAlbum || query);
  } catch (e) {
    r.errors.push(`AnyDecentMusic: ${e.message}`);
  }
  if (resolvedAlbum && (!r.wikipedia?.title || !new RegExp(resolvedAlbum.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(r.wikipedia.title))) {
    const wp2 = await fetchWikipedia(resolvedAlbum);
    if (wp2 && /album|song|single/i.test(wp2.title + " " + (wp2.extract || ""))) {
      console.log(`   📚 Wikipedia 重定向到专辑页: ${wp2.title}`);
      r.wikipedia = wp2;
      const secs = await fetchWikiPageSections(wp2.title);
      if (secs) {
        r.reception = secs["critical reception"] || null;
        r.personnel = secs["personnel"] || null;
        r.charts = secs["charts"] || null;
        r.yearEnd = secs["year-end lists"] || null;
        r.trackListing = secs["track listing"] || null;
      }
    }
  }
  r.wikiData = buildWikiData(r, opts.songTitle);
  r.aggregate = buildAggregate(r);
  // 写入缓存
  RESEARCH_CACHE.set(ck, { data: { ...r }, ts: Date.now() });
  return r;
}

// ══════════════════════════════════════════════
//  Wikipedia API — 摘要
// ══════════════════════════════════════════════

async function fetchWikipedia(query) {
  const res = await proxyFetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=1&format=json&origin=*&srlimit=5&srprop=snippet|wordcount`, {signal:AbortSignal.timeout(T)});
  const pages = (await res.json())?.query?.search || [];
  if (!pages.length) return null;
  // 智能页面选择: 优先精确匹配，选最相关的页面
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

  const scored = pages.map(p => {
    const titleLower = p.title.toLowerCase();
    const snippetLower = (p.snippet || "").toLowerCase();

    // 排除明显无关页面 (如 discography, list of, timeline 等)
    const isBadTitle = /\b(discography|list of|timeline|filmography|category)\b/i.test(p.title);
    if (isBadTitle) return { ...p, score: -1000 };

    // 标题精确包含查询词
    const queryInTitle = queryWords.every(w => titleLower.includes(w));
    const titleScore = queryInTitle ? 10000 : 0;

    // 标题含 "album" → 专辑页面
    const isAlbumTitle = /\balbum\b/i.test(titleLower);
    const isAlbumSnippet = /\balbum\b/i.test(snippetLower);
    const albumBonus = isAlbumTitle ? 5000 : (0);

    // "song" 或 "single" → 单曲页面
    const isSongTitle = /\b(song|single|track)\b/i.test(titleLower);

    return { ...p, score: titleScore + albumBonus + Math.min(p.wordcount || 0, 10) };
  }).sort((a, b) => b.score - a.score);

  const picked = scored[0]?.score >= 0 ? scored[0] : pages[0];
  if (!picked) return null;
  // 用 action=query 代替 REST API (更稳定走代理)
  const extractRes = await proxyFetch(
    `https://en.wikipedia.org/w/api.php?action=query&prop=extracts|pageimages&exintro=1&explaintext=1&titles=${encodeURIComponent(picked.title)}&format=json&origin=*&piprop=thumbnail&pithumbsize=300`,
    {signal:AbortSignal.timeout(T)}
  );
  const extractData = await extractRes.json();
  const page = Object.values(extractData?.query?.pages || {})[0] || {};
  return {
    title: page.title || picked.title,
    extract: page.extract || null,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(picked.title)}`,
    thumbnail: page.thumbnail?.source || null,
    pageLength: page.length || null,
  };
}

async function fetchWikiSection(pageTitle, sectionName) {
  let html = "";
  for (let attempt = 0; attempt < 2 && !html; attempt++) {
    try {
      const secRes = await proxyFetch(`https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(pageTitle)}&prop=sections&format=json&origin=*`, {signal:AbortSignal.timeout(T)});
      const sections = (await secRes.json())?.parse?.sections || [];
      const section = sections.find(s => {
        if (!new RegExp(sectionName, "i").test(s.line)) return false;
        if (/track/i.test(sectionName)) return true;
        return !/commercial|legacy|tour|track/i.test(s.line.replace(new RegExp(sectionName, "i"), ""));
      });
      if (!section) return null;
      const conRes = await proxyFetch(`https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(pageTitle)}&prop=text&section=${section.index}&format=json&origin=*`, {signal:AbortSignal.timeout(T)});
      html = (await conRes.json())?.parse?.text?.["*"] || "";
    } catch (e) {
      if (attempt === 1) throw e;
      await new Promise((r) => setTimeout(r, 600));
    }
  }
  if (!html) return null;

  // 保留表格结构用于评分解析
  const tableText = parseWikiScoringTable(html);
  const tables = parseWikiTables(html);
  // 同时也产出纯文本
  const clean = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi,"").replace(/<style[^>]*>[\s\S]*?<\/style>/gi,"").replace(/<[^>]+>/g," ").replace(/&[^;]+;/g," ").replace(/\s+/g," ").trim().substring(0,3000);
  return { title: section.line, text: clean, tableScores: tableText, tables, html };
}

function sectionData(name, html) {
  if (!html || !String(html).trim()) return null;
  const tableText = parseWikiScoringTable(html);
  const tables = parseWikiTables(html);
  const clean = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[^;]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 3000);
  return { title: name, text: clean, tableScores: tableText, tables, html };
}

/**
 * 一次抓取整页 HTML，按 h2 标题拆出各 section（比逐 section 请求更稳）。
 */
async function fetchWikiPageSections(pageTitle) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await proxyFetch(
        `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(pageTitle)}&prop=text&format=json&origin=*`,
        { signal: AbortSignal.timeout(T) }
      );
      const html = (await res.json())?.parse?.text?.["*"] || "";
      if (!html) return null;
      const out = {};
      const parts = html.split(/(<h2[^>]*>)/i);
      for (let i = 2; i < parts.length; i += 2) {
        const openTag = parts[i - 1] || "";
        const idMatch = openTag.match(/id="([^"]+)"/i) || parts[i].match(/<span[^>]*id="([^"]+)"[^>]*>/i);
        const hEnd = parts[i].indexOf("</h2>");
        const body = hEnd >= 0 ? parts[i].slice(hEnd + 5) : parts[i];
        const rawId = idMatch?.[1] || "";
        const name = rawId.replace(/_/g, " ").toLowerCase().trim();
        if (name && body.trim()) out[name] = sectionData(name, body);
      }
      return out;
    } catch (e) {
      if (attempt === 1) throw e;
      await new Promise((r) => setTimeout(r, 600));
    }
  }
  return null;
}

function cleanWikiCell(html) {
  return String(html || "")
    .replace(/title="(\d+\.?\d*)\s*\/\s*(\d+)\s*stars?"/gi, "$1/$2")
    .replace(/&#91;/g, "[")
    .replace(/&#93;/g, "]")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<li[^>]*>/gi, "")
    .replace(/<\/li>/gi, ",")
    .replace(/<\/dd>/gi, ",")
    .replace(/<[^>]+>/g, " ")
    .replace(/\.[a-zA-Z0-9_-]+\s*\{[^}]*\}/g, " ")
    .replace(/\[\s*\d+\s*\]/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseWikiTables(html) {
  const tables = [];
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tm;
  while ((tm = tableRe.exec(html)) !== null) {
    const rows = [];
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rm;
    while ((rm = rowRe.exec(tm[1])) !== null) {
      const cells = [...rm[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) => cleanWikiCell(m[1]));
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}

function normalizeRatingText(rating) {
  const r = String(rating || "").trim();
  const starMatch = r.match(/^(Star)+$/i);
  if (starMatch) return `${starMatch[0].length / 5}/5`;
  const score = r.match(/(\d+\.?\d*)\s*\/\s*(\d+)/);
  return score ? `${score[1]}/${score[2]}` : r;
}

function classifyWikiTables(tables) {
  const charts = [], yearEnd = [], aggregate = [], reviews = [];
  for (const rows of tables) {
    const hi = rows.findIndex((r) => /^(source|publication|rating|chart|peak|list|rank|title|writer|producer|no\.)/i.test((r.join(" ") || "").trim()));
    if (hi < 0) continue;
    const head = rows[hi].join(" ");
    const dataRows = rows.slice(hi + 1);
    if (/chart|peak/i.test(head)) {
      for (const r of dataRows) {
        if (r.length >= 2 && r[0] && r[1]) charts.push({ chart: r[0], peak: r[1] });
      }
    } else if (/publication|list|rank/i.test(head)) {
      for (const r of dataRows) {
        const rankRaw = (r[2] || "").replace(/\s+/g, " ").trim();
        const rank = (/^(—|–|-|n\/?a)$/i.test(rankRaw) || /^—?\s*n\/?a$/i.test(rankRaw)) ? "" : rankRaw;
        if (r.length >= 3) yearEnd.push({ publication: r[0], list: r[1], rank });
        else if (r.length >= 2) yearEnd.push({ publication: r[0], list: r[1], rank: "" });
      }
    } else if (/source|rating|publication|score/i.test(head)) {
      let bucket = (hi > 0 && /aggregate/i.test(rows[hi - 1].join(" "))) ? "aggregate" : "reviews";
      for (const r of dataRows) {
        const joined = r.join(" ");
        if (/aggregate scores?/i.test(joined)) { bucket = "aggregate"; continue; }
        if (/review scores?/i.test(joined)) { bucket = "reviews"; continue; }
        if (/^source\s+rating$/i.test(joined) || /^(source|rating)$/i.test(joined)) continue;
        if (r.length >= 2 && r[0] && r[1]) (bucket === "aggregate" ? aggregate : reviews).push({ source: r[0], rating: normalizeRatingText(r[1]) });
      }
    }
  }
  return { charts, yearEnd, aggregate, reviews };
}

function splitCredits(s) {
  return String(s || "")
    .split(/[,，、;；/]+/)
    .map((x) => x.replace(/^\[.*?\]$/g, "").trim())
    .filter(Boolean);
}

function parseWikiTrackCredits(html, songTitle) {
  const tables = parseWikiTables(html || "");
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
  const target = norm(songTitle);
  for (const rows of tables) {
    const head = rows[0] || [];
    const wi = head.findIndex((h) => /writer/i.test(h));
    const pi = head.findIndex((h) => /producer/i.test(h));
    const ti = head.findIndex((h) => /title|song|track/i.test(h));
    if (wi < 0 && pi < 0) continue;
    for (const r of rows.slice(1)) {
      const titleCell = r[ti] || r[0] || "";
      if (target && !norm(titleCell).includes(target) && !target.includes(norm(titleCell))) continue;
      return {
        title: titleCell,
        writers: wi >= 0 ? splitCredits(r[wi]) : [],
        producers: pi >= 0 ? splitCredits(r[pi]) : [],
      };
    }
  }
  return null;
}

function buildWikiData(r, songTitle) {
  const chartsTables = classifyWikiTables(r.charts?.tables || []);
  const yearTables = classifyWikiTables([...(r.yearEnd?.tables || []), ...(r.reception?.tables || [])]);
  const rateTables = classifyWikiTables(r.reception?.tables || []);
  const tableRatings = (rateTables.aggregate.length || rateTables.reviews.length)
    ? { aggregate: rateTables.aggregate, reviews: rateTables.reviews }
    : (r.reception?.tableScores
      ? { aggregate: [], reviews: Object.entries(r.reception.tableScores).map(([k, v]) => ({ source: k, rating: `${v.score}/${v.max}` })) }
      : { aggregate: [], reviews: [] });
  return {
    charts: chartsTables.charts,
    yearEnd: yearTables.yearEnd,
    ratings: tableRatings,
    credits: songTitle ? parseWikiTrackCredits(r.trackListing?.html || "", songTitle) : null,
  };
}

/**
 * 解析 Wikipedia 乐评表格 (wikitable class)
 * 提取 "Publication → Rating" 的结构化评分数据
 */
function parseWikiScoringTable(html) {
  const scores = {};
  // 匹配 wikitable 内的每一行: <tr> <td>Publication</td> <td>Rating</td> </tr>
  const rowRegex = /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;

  let m;
  while ((m = rowRegex.exec(html)) !== null) {
    const pubRaw = m[1].replace(/<[^>]*>/g, "").replace(/\[.*?\]/g, "").trim();
    const ratingRaw = m[2].replace(/<[^>]*>/g, "").replace(/\[.*?\]/g, "").trim();

    if (!pubRaw || !ratingRaw) continue;
    // 排除表头行
    if (/^(Source|Publication|Aggregate|Review|Critic)/i.test(pubRaw)) continue;

    // 匹配评分格式: "7/10" / "4/5" / "6.7/10" / "77/100" / "StarStarStarStar"
    const scoreMatch = ratingRaw.match(/(\d+\.?\d*)\s*\/\s*(\d+)/);
    const starMatch = ratingRaw.match(/^(Star)+$/i);
    if (scoreMatch || starMatch) {
      const key = pubRaw.toLowerCase().replace(/[^a-z]/g, "");
      const urlMatch = m[1].match(/href="([^"]+)"/);
      scores[key] = {
        score: scoreMatch ? parseFloat(scoreMatch[1]) : starMatch[0].length / 5,
        max: scoreMatch ? parseInt(scoreMatch[2]) : 5,
        publication: pubRaw,
        url: urlMatch ? (urlMatch[1].startsWith("http") ? urlMatch[1] : `https://en.wikipedia.org${urlMatch[1]}`) : undefined,
      };
    }
  }

  // 也匹配纯文本中的评分信息 (回退)
  const plainText = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const plainScores = parseReviewScores(plainText);

  // 合并
  return { ...plainScores, ...scores };
}

// ══════════════════════════════════════════════
//  MusicBrainz
// ══════════════════════════════════════════════

async function fetchMusicBrainz(query) {
  const groups = (await(await smartFetch(`https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(query)}&fmt=json&limit=100`,{headers:{"User-Agent":MB_UA,"Accept":"application/json"},signal:AbortSignal.timeout(T)})).json())?.["release-groups"]||[];
  if(!groups.length)return null;
  const qW=query.toLowerCase().split(/\s+/).filter(w=>w.length>2),qL=query.toLowerCase().trim();
  const scored=groups.map(g=>{let s=(g.score||0)*1;const t=g["primary-type"]||"";if(t==="Album")s+=60;else if(/single|ep/i.test(t))s-=50;
    s+=Math.min((typeof g.count==="number"?g.count:(g.releases?.length||0))*3,60);
    const ti=(g.title||"").toLowerCase().trim();if(ti===qL)s+=40;else if(qW.length>0&&qW.every(w=>ti.includes(w)))s+=20;
    const an=(g["artist-credit"]||[]).filter(c=>typeof c==="object").map(c=>c.name?.toLowerCase()||"");
    if(an.some(n=>/\b(tribute|cover|karaoke|instrumental|reimagined|orchestra|orchestral|tribute\s+to)\b/i.test(n)||/piano\s/.test(n)||/\btrio\b/.test(n)))s-=70;
    if(g["first-release-date"]){const y=parseInt(g["first-release-date"].substring(0,4));if(y&&y>=1950&&y<=2028){if(y>=1970&&y<=2000)s+=Math.min((2000-y)*0.5+15,30);else if(y>2010)s-=(y-2010)*3;}}
    return{group:g,score:s};}).sort((a,b)=>b.score-a.score);
  const best=scored[0];if(!best)return null;const p=best.group;
  const list=await(await smartFetch(`https://musicbrainz.org/ws/2/release?query=rgid:${p.id}&fmt=json&inc=artist-credits+labels+release-events&limit=5`,{headers:{"User-Agent":MB_UA,"Accept":"application/json"},signal:AbortSignal.timeout(T)})).json();
  let pick=null;
  for(const r of list?.releases||[]){const rd=await(await smartFetch(`https://musicbrainz.org/ws/2/release/${r.id}?fmt=json&inc=recordings+labels+artist-credits+tags+ratings`,{headers:{"User-Agent":MB_UA,"Accept":"application/json"},signal:AbortSignal.timeout(T)})).json();if((rd?.media||[]).some(m=>(m.tracks?.length||0)>0)||!pick)pick=rd;if((pick?.media||[]).some(m=>(m.tracks?.length||0)>0))break;}
  if(!pick)pick=list?.releases?.[0]||{};
  const artists=(pick?.["artist-credit"]||p?.["artist-credit"]||[]).filter(c=>typeof c==="object").map(c=>(c.name||c.artist?.name||"").trim()).filter(Boolean);
  const tracks=(pick?.media||[]).flatMap(m=>m.tracks||[]).map(t=>({number:t.number,title:t.title,length:(t.length||t.recording?.length)?fmtD(t.length||t.recording?.length):null}));
  const labels=(pick?.labels||[]).map(l=>l.label?.name).filter(Boolean);
  const date=pick?.date||p?.["first-release-date"]||null;
  const tags=(pick?.tags||[]).map(t=>t.name).filter(Boolean).slice(0,20);
  const rating=pick?.rating||p?.rating||null;
  const formats=[...new Set((pick?.media||[]).map(m=>m.format).filter(Boolean))];
  const st=p?.["secondary-types"]||[];let tl=p?.["primary-type"]||"Album";if(st.length)tl+=` (${st.join(", ")})`;
  // 封面艺术：release-group 主封面（coverartarchive 307 → archive.org 图片本体；
  // Node 直连 archive.org 不稳，因此只取 Location，由前端 /api/proxy-image 代理加载）
  let artwork = null;
  try {
    const ca = await smartFetch(`https://coverartarchive.org/release-group/${p.id}/front`, {
      redirect: "manual", signal: AbortSignal.timeout(T),
    });
    const loc = ca.headers.get("location");
    if (loc) artwork = loc.startsWith("http") ? loc : `https:${loc}`;
  } catch (_) {}
  return{id:p.id,title:p.title,artists:artists.length?artists:undefined,date,labels:labels.length?labels:undefined,formats:formats.length?formats:undefined,tracks:tracks.length?tracks:undefined,trackCount:tracks.length,type:tl,tags:tags.length?tags:undefined,rating:rating?{score:rating["vote-average"],count:rating["vote-count"]}:undefined,artwork,url:`https://musicbrainz.org/release-group/${p.id}`,_score:best.score};
}

// ══════════════════════════════════════════════
//  iTunes / Last.fm / Discogs API
// ══════════════════════════════════════════════

async function fetchiTunes(query) {
  let items=(await(await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=album&limit=15&country=us`,{signal:AbortSignal.timeout(T)})).json())?.results||[];
  if(items.length<3)items=[...items,...((await(await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=album&attribute=albumTerm&limit=15&country=us`,{signal:AbortSignal.timeout(T)})).json())?.results||[])];
  const seen=new Set();items=items.filter(i=>{if(seen.has(i.collectionId))return false;seen.add(i.collectionId);return true;});
  if(!items.length)return null;
  const hiRes=(u)=>(u||"").replace(/\d+x\d+bb/,"3000x3000bb");
  const ranked=items.map(i=>{let s=(i.trackCount||0)*2+rankTitleScore(i.collectionName||i.collectionCensoredName,query);if(/ep\b|single/i.test(i.collectionName||""))s-=20;if((i.trackCount||0)<4)s-=100;return{item:i,score:s};}).sort((a,b)=>b.score-a.score);
  const best=ranked[0].item;
  const songs=((await(await fetch(`https://itunes.apple.com/lookup?id=${best.collectionId}&entity=song&country=us`,{signal:AbortSignal.timeout(T)})).json())?.results||[]).filter(r=>r.wrapperType==="track");
  return{
    title:best.collectionName||best.collectionCensoredName,
    artist:best.artistName,
    artwork:hiRes(best.artworkUrl100||best.artworkUrl60)||null,
    genre:best.primaryGenreName,
    genres:[best.primaryGenreName,...(best.genreNames?.filter(g=>g!==best.primaryGenreName)||[])],
    releaseDate:best.releaseDate?.split("T")[0]||null,
    trackCount:best.trackCount||0,
    price:best.collectionPrice?`$${best.collectionPrice}`:null,
    url:best.collectionViewUrl,
    tracks:songs.map(t=>({number:t.trackNumber,title:t.trackName,length:t.trackTimeMillis?fmtD(t.trackTimeMillis):null})),
    copyright:best.copyright||null,
    candidates:ranked.slice(0,8).map(r=>({
      title:r.item.collectionName||r.item.collectionCensoredName,
      artist:r.item.artistName,
      artwork:hiRes(r.item.artworkUrl100||r.item.artworkUrl60)||null,
      url:r.item.collectionViewUrl,
      trackCount:r.item.trackCount||0,
      releaseDate:r.item.releaseDate?.split("T")[0]||null,
    })),
    _score:ranked[0].score,
  };
}

async function fetchLastfm(query,key) {
  const m=(await(await fetch(`https://ws.audioscrobbler.com/2.0/?method=album.search&album=${encodeURIComponent(query)}&api_key=${key}&format=json&limit=5`,{signal:AbortSignal.timeout(T)})).json())?.results?.albummatches?.album||[];
  if(!m.length)return null;
  const b=m.sort((a,b)=>parseInt(b.listeners||0)-parseInt(a.listeners||0))[0];
  const a=(await(await fetch(`https://ws.audioscrobbler.com/2.0/?method=album.getinfo&artist=${encodeURIComponent(b.artist)}&album=${encodeURIComponent(b.name)}&api_key=${key}&format=json&lang=zh`,{signal:AbortSignal.timeout(T)})).json())?.album;
  if(!a)return{title:b.name,artist:b.artist,url:b.url,image:b.image?.find(i=>i.size==="extralarge")?.["#text"]||null,listeners:parseInt(b.listeners||0),searchOnly:true};
  return{title:a.name,artist:a.artist,url:a.url,image:a.image?.find(i=>i.size==="extralarge")?.["#text"]||null,listeners:a.listeners?parseInt(a.listeners):null,playcount:a.playcount?parseInt(a.playcount):null,summary:a.wiki?.summary?.replace(/<[^>]*>/g,"").trim()||null,tags:(a.tags?.tag||[]).map(t=>t.name).filter(Boolean),tracks:(a.tracks?.track||[]).map(t=>({number:t["@attr"]?.rank||t.rank,title:t.name,length:t.duration?fmtD(parseInt(t.duration)*1000):null}))};
}

async function fetchDiscogsAPI(query,token) {
  // Discogs Personal Access Token（Settings → Developers → Generate token）
  // 消费者 Consumer Key 不是 PAT，直接当 token 用会返回 401。
  if(!token || token.length < 30)return null;
  const headers={"User-Agent":MB_UA,"Authorization":`Discogs token=${token}`};
  const dgJson=async(url)=>{
    const res=await fetch(url,{headers,signal:AbortSignal.timeout(T)});
    if(!res.ok)throw new Error(`Discogs API ${res.status}`);
    return res.json();
  };
  const fmt=(f)=>f.name+(f.descriptions?.length?" "+f.descriptions.join("/"):"");
  // 1) 优先 Master Release：聚合所有版本，社区拥有/想要最有参考价值
  try {
    const search=await dgJson(`https://api.discogs.com/database/search?q=${encodeURIComponent(query)}&type=master&per_page=5`);
    const scored=(search.results||[]).map(r=>({
      item:r,
      score: rankTitleScore((r.title||"").replace(/^[^-]+-\s*/,""),query)
        - (/(deluxe|bonus|limited|reissue|remaster|compilation)/i.test(r.title||"")?30:0),
    })).sort((a,b)=>b.score-a.score);
    const master=scored[0]?.item;
    if(master?.id){
      const m=await dgJson(`https://api.discogs.com/masters/${master.id}`);
      const mainId=m.main_release;
      let versionIds=[mainId];
      try{
        const versions=await dgJson(`https://api.discogs.com/masters/${master.id}/versions?per_page=5&sort=have&sort_order=desc`);
        versionIds=[...new Set([mainId,...(versions.versions||[]).map(v=>v.id).filter(Boolean)])].slice(0,3);
      }catch(_){}
      const details=(await Promise.allSettled(versionIds.map(id=>dgJson(`https://api.discogs.com/releases/${id}`).catch(()=>null))))
        .map(x=>x.status==="fulfilled"?x.value:null).filter(Boolean);
      const mainDetail=details.find(d=>d.id===mainId)||details[0]||null;
      const rated=[...(details||[])].filter(d=>d.community?.rating?.count).sort((a,b)=>b.community.rating.count-a.community.rating.count)[0]||mainDetail;
      const result={
        id:master.id,
        master:true,
        masterId:master.id,
        mainReleaseId:mainId,
        title:m.title||master.title,
        year:m.year||master.year,
        artist:(m.artists||[]).map(a=>a.name).join(", ")||null,
        genre:m.genres?.[0]||master.genre?.[0],
        genres:m.genres||[],
        style:m.styles?.[0],
        styles:m.styles||[],
        label:mainDetail?.labels?.[0]?.name||master.label?.[0],
        labels:(mainDetail?.labels||[]).map(l=>l.name).filter(Boolean),
        format:(mainDetail?.formats||[]).map(fmt).join(", ")||master.format?.join(", "),
        formats:(mainDetail?.formats||[]).map(fmt),
        country:mainDetail?.country||master.country||null,
        coverImage:master.cover_image||m.images?.[0]?.uri||null,
        tracklist:(m.tracklist||[]).slice(0,15).map(t=>t.title),
        community:{
          have:master.community?.have??mainDetail?.community?.have??null,
          want:master.community?.want??mainDetail?.community?.want??null,
          rating:rated?.community?.rating?.average??null,
          ratingCount:rated?.community?.rating?.count??null,
          ratingReleaseId:rated?.id??null,
        },
        url:master.uri?`https://www.discogs.com${master.uri}`:null,
      };
      return {results:[result],count:1,source:"Discogs API (Master)"};
    }
  } catch(e){
    console.log(`   ♪ Discogs master: ${e.message}`);
  }
  // 2) 回退：没有 Master 时用发行版搜索
  try {
    const data=await dgJson(`https://api.discogs.com/database/search?q=${encodeURIComponent(query)}&type=release&per_page=10`);
    const scored=(data.results||[]).map(r=>({
      item:{id:r.id,title:r.title,year:r.year,format:r.format?.join(", "),label:r.label?.[0],genre:r.genre?.[0],style:r.style?.[0],country:r.country,coverImage:r.cover_image,url:r.uri?`https://www.discogs.com${r.uri}`:null},
      score:rankTitleScore((r.title||"").replace(/^[^-]+-\s*/,""),query)-(/(deluxe|bonus|limited|reissue|remaster)/i.test(r.title||"")?25:0),
    })).filter(s=>s.item.url).sort((a,b)=>b.score-a.score);
    const base=scored.map(s=>s.item).slice(0,3);
    const details=(await Promise.allSettled(base.map(r=>dgJson(`https://api.discogs.com/releases/${r.id}`).catch(()=>null))))
      .map(x=>x.status==="fulfilled"?x.value:null).filter(Boolean);
    const results=base.map(r=>{
      const d=details.find(x=>x.id===r.id);
      if(!d)return r;
      return {...r,
        title:d.title||r.title,year:d.year||r.year,label:d.labels?.[0]?.name||r.label,
        labels:(d.labels||[]).map(l=>l.name).filter(Boolean),
        formats:(d.formats||[]).map(fmt),
        country:d.country||r.country,coverImage:r.coverImage||d.images?.[0]?.uri||null,
        tracklist:(d.tracklist||[]).slice(0,12).map(t=>t.title),
        community:d.community?{have:d.community.have??null,want:d.community.want??null,rating:d.community.rating?.average??null,ratingCount:d.community.rating?.count??null}:null,
      };
    });
    return{results,count:results.length,source:"Discogs API"};
  } catch(e){
    console.log(`   ♪ Discogs release: ${e.message}`);
    return null;
  }
}

/**
 * Genius 歌曲搜索（免费 Token，走代理）
 * 返回歌曲页 + 页浏览量，用于 Step2 展示与卡片佐料。
 */
export async function fetchGeniusSong(query, token) {
  if (!token) return null;
  try {
    const res = await proxyFetch(`https://api.genius.com/search?q=${encodeURIComponent(query)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(T),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const hits = data?.response?.hits || [];
    const matched = hits.filter((h) => {
      const r = h.result || {};
      return _textMatchesQuery(`${r.title} ${r.primary_artist?.name || ""}`, query);
    });
    const hit = matched
      .slice()
      .sort((a, b) => ((b.result?.stats?.pageviews) || 0) - ((a.result?.stats?.pageviews) || 0))[0]?.result
      || matched[0]?.result
      || null;
    if (!hit) return null;
    return {
      title: hit.title || null,
      artist: hit.primary_artist?.name || null,
      url: hit.url || null,
      id: hit.id || null,
      pageviews: hit.stats?.pageviews ?? null,
    };
  } catch (_) {
    return null;
  }
}

/**
 * Genius 歌词页解析（免费，无官方歌词 API）
 * 从 data-lyrics-container 提取纯文本歌词。
 */
export async function fetchGeniusLyrics(url) {
  if (!url || !url.includes("genius.com")) return null;
  try {
    const res = await proxyFetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36" },
      signal: AbortSignal.timeout(T),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const containers = [...html.matchAll(/<div[^>]*data-lyrics-container="true"[^>]*>([\s\S]*?)<\/div>/g)];
    const blocks = containers.map((m) =>
      m[1]
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&#x27;|&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&gt;/g, ">")
        .replace(/&lt;/g, "<")
        .replace(/&nbsp;/g, " ")
        .split("\n").map((l) => l.trim()).filter(Boolean).join("\n")
    );
    const lyrics = blocks
      .join("\n")
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        if (!t) return false;
        if (/\b(Contributors|Translations|Embed|Share|Annotations)\b/i.test(t)) return false;
        return true;
      })
      .join("\n")
      .trim();
    return lyrics.length > 80 ? lyrics : null;
  } catch (_) {
    return null;
  }
}

/**
 * YouTube 官方视频搜索 + 播放统计（YouTube Data API v3，走代理）
 * 优先 Official Visualiser / Official Audio / Lyrics，排除 Remix/Live/Cover。
 */
export async function fetchYouTubeStats(query, apiKey) {
  if (!apiKey) return null;
  try {
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=5&q=${encodeURIComponent(query)}&key=${apiKey}`;
    const res = await proxyFetch(searchUrl, { signal: AbortSignal.timeout(T) });
    if (!res.ok) return null;
    const data = await res.json();
    const items = data?.items || [];
    if (!items.length) return null;

    const ids = items.map((i) => i.id?.videoId).filter(Boolean).slice(0, 5);
    if (!ids.length) return null;

    const statsRes = await proxyFetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids.join(",")}&key=${apiKey}`,
      { signal: AbortSignal.timeout(T) }
    );
    if (!statsRes.ok) return null;
    const statsData = await statsRes.json();
    const statsMap = new Map(
      (statsData?.items || []).map((x) => [x.id, x.statistics || {}])
    );
    const toNum = (v) => (v != null && v !== "" ? Number(v) : null);

    const ranked = items.map((item) => {
      const title = item.snippet?.title || "";
      let score = 0;
      if (/official|visuali[sz]er|\baudio\b|lyric/i.test(title)) score += 30;
      if (/remix|live|cover|acoustic|reaction|interview/i.test(title)) score -= 20;
      const views = toNum(statsMap.get(item.id?.videoId)?.viewCount) || 0;
      if (views >= 100000) score += 20;
      else if (views >= 10000) score += 10;
      return { item, score, views };
    }).sort((a, b) => b.score - a.score || b.views - a.views);

    const top = ranked[0]?.item;
    if (!top || !_textMatchesQuery(`${top.snippet?.title || ""} ${top.snippet?.channelTitle || ""}`, query)) return null;
    const videoId = top?.id?.videoId;
    if (!videoId) return null;
    const stat = statsMap.get(videoId) || {};
    return {
      title: top.snippet?.title || null,
      channel: top.snippet?.channelTitle || null,
      videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      views: toNum(stat.viewCount),
      likes: toNum(stat.likeCount),
      comments: toNum(stat.commentCount),
    };
  } catch (_) {
    return null;
  }
}

/**
 * Last.fm 单曲热度（track.search + track.getinfo）
 * 返回听众/播放量/时长，用于 Step2 热度与卡片佐料。
 */
export async function fetchLastfmTrack(query, apiKey) {
  if (!apiKey) return null;
  try {
    const qWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const searchRes = await proxyFetch(
      `https://ws.audioscrobbler.com/2.0/?method=track.search&track=${encodeURIComponent(query)}&api_key=${apiKey}&format=json&limit=5`,
      { signal: AbortSignal.timeout(T) }
    );
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const matches = searchData?.results?.trackmatches?.track || [];
    if (!matches.length) return null;

    const ranked = matches.map((m) => {
      const title = (m.name || "").toLowerCase();
      const artist = (m.artist || "").toLowerCase();
      let score = 0;
      if (qWords.length && qWords.every((w) => title.includes(w) || artist.includes(w))) score += 40;
      if (qWords.some((w) => title.includes(w))) score += 15;
      if (qWords.some((w) => artist.includes(w))) score += 15;
      score += Math.min(parseInt(m.listeners || 0) / 10000, 10);
      return { m, score };
    }).sort((a, b) => b.score - a.score);

    const best = ranked[0]?.m;
    if (!best || !_textMatchesQuery(`${best.name} ${best.artist}`, query)) return null;

    const infoRes = await proxyFetch(
      `https://ws.audioscrobbler.com/2.0/?method=track.getinfo&artist=${encodeURIComponent(best.artist)}&track=${encodeURIComponent(best.name)}&api_key=${apiKey}&format=json`,
      { signal: AbortSignal.timeout(T) }
    );
    if (!infoRes.ok) return null;
    const info = (await infoRes.json())?.track || null;
    if (!info) {
      return {
        name: best.name, artist: best.artist, url: best.url,
        listeners: parseInt(best.listeners || 0) || null,
        searchOnly: true,
      };
    }
    return {
      name: info.name,
      artist: info.artist?.name,
      url: info.url,
      listeners: info.listeners ? parseInt(info.listeners) : null,
      playcount: info.playcount ? parseInt(info.playcount) : null,
      duration: info.duration ? parseInt(info.duration) : null,
      album: info.album?.title || null,
    };
  } catch (_) {
    return null;
  }
}

// ══════════════════════════════════════════════
//  聚合 + 推荐算法
// ══════════════════════════════════════════════

// ══════════════════════════════════════════════
//  解析 Wikipedia 乐评段提取结构化评分
// ══════════════════════════════════════════════
function parseReviewScores(receptionText) {
  if (!receptionText) return null;
  const scores = {};

  // Pitchfork: "Pitchfork 6.8/10" or "Pitchfork (7.5/10)"
  const p4k = receptionText.match(/Pitchfork\s*[:\s]*\(?(\d+\.?\d*)\s*\/\s*10\)?/i);
  if (p4k) scores.pitchfork = { score: parseFloat(p4k[1]), max: 10 };

  // Metacritic: "Metacritic 75/100"
  const mc = receptionText.match(/Metacritic\s*[:\s]*(\d+)\s*\/\s*100/i);
  if (mc) scores.metacritic = { score: parseInt(mc[1]), max: 100 };

  // AllMusic
  const am = receptionText.match(/AllMusic\s*[:\s]*(\d+\.?\d*)\s*\/\s*5/);
  if (am) scores.allmusic = { score: parseFloat(am[1]), max: 5 };

  // Rolling Stone
  const rs = receptionText.match(/Rolling\s*Stone\s*[:\s]*(\d+\.?\d*)\s*\/\s*5/);
  if (rs) scores.rollingstone = { score: parseFloat(rs[1]), max: 5 };

  // The Guardian
  const grd = receptionText.match(/(?:The\s+)?Guardian\s*[:\s]*(\d+\.?\d*)\s*\/\s*5/);
  if (grd) scores.guardian = { score: parseFloat(grd[1]), max: 5 };

  // NME
  const nme = receptionText.match(/NME\s*[:\s]*(\d+\.?\d*)\s*\/\s*10/);
  if (nme) scores.nme = { score: parseFloat(nme[1]), max: 10 };

  // Generic X/10
  const tens = [...receptionText.matchAll(/(\d+\.?\d*)\s*\/\s*10/g)];
  if (tens.length >= 2 && !scores.pitchfork) {
    scores.aggregate_score_10 = tens.map(m => parseFloat(m[1]));
  }

  return Object.keys(scores).length > 0 ? scores : null;
}

// ══════════════════════════════════════════════
//  AnyDecentMusic — 聚合乐评评分 (免费, 无API Key)
//  覆盖: Pitchfork/NME/The Guardian/Clash/Dork/Mojo 等 50+ 媒体
// ══════════════════════════════════════════════

async function fetchAnyDecentMusic(query) {
  try {
    // ADM 以专辑/排行榜为主，单曲通常搜不到；用专辑查询词搜索
    const searchUrl = `http://www.anydecentmusic.com/search-results.aspx?search=${encodeURIComponent(query)}`;
    const res = await proxyFetch(searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept": "text/html" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // 收集所有 review 链接并按查询词匹配度选最相关（搜索页顶部是“最近高评”而非结果）
    const qTokens = (query || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ").split(/\s+/).filter((w) => w.length > 2);
    const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ");
    const candidates = [];
    const seen = new Set();
    let linkMatch;
    const linkRe = /<a[^>]*href="(\/review\/(\d+)[^"']*)"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((linkMatch = linkRe.exec(html)) !== null) {
      if (seen.has(linkMatch[1])) continue;
      seen.add(linkMatch[1]);
      const anchor = linkMatch[3].replace(/<[^>]*>/g, "").trim();
      const hay = norm(linkMatch[1] + " " + anchor);
      let score = 0;
      for (const t of qTokens) if (hay.includes(t)) score += 2;
      candidates.push({ path: linkMatch[1], id: linkMatch[2], score, anchor });
    }
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (!best) return null;

    const reviewPath = best.path;
    const reviewId = best.id;

    // 获取评分详情
    const reviewUrl = `http://www.anydecentmusic.com${reviewPath}`;
    const revRes = await proxyFetch(reviewUrl, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html" },
      signal: AbortSignal.timeout(12000),
    });
    if (!revRes.ok) return null;
    const revHtml = await revRes.text();

    // 解析聚合评分（<p class="score">7.2</p>，ADM rating）
    const overallMatch = revHtml.match(/<p[^>]*class="[^"]*score[^"]*"[^>]*>\s*([\d.]+)\s*<\/p>/i)
      || revHtml.match(/ADM rating[^<]*<[^>]*>[\s\S]*?([\d.]+)/i)
      || revHtml.match(/(\d\.\d)\s*<\/span>/i);
    const overall = overallMatch ? parseFloat(overallMatch[1]) : null;

    // 解析媒体个体评分：<span class="data_rating">6.7</span> ... <span>Pitchfork</span> ... <p>quote</p> ... Read Review
    const individualScores = [];
    const itemRegex = /<li[^>]*class="[^"]*review_item[^"]*"[\s\S]*?<span[^>]*class="data_rating"[^>]*>\s*([\d.]+)\s*<\/span>[\s\S]*?<h4[^>]*>\s*[\d.]+\s*\|[^<]*<span[^>]*>([^<]+)<\/span>[\s\S]*?<p>\s*([\s\S]*?)\s*<\/p>[\s\S]*?<a[^>]*href='([^']+)'/gi;
    let m;
    while ((m = itemRegex.exec(revHtml)) !== null) {
      const score = parseFloat(m[1]);
      const pub = m[2].trim();
      if (!isNaN(score) && score > 0 && pub.length > 1) {
        individualScores.push({
          publication: pub,
          score,
          max: 10,
          quote: m[3].replace(/<[^>]+>/g, "").replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim().slice(0, 220),
          url: m[4].startsWith("http") ? m[4] : `https:${m[4]}`,
        });
      }
    }
    if (individualScores.length > 8) individualScores.length = 8; // 最多8个

    // 专辑信息：艺人 / 专辑名 / 厂牌 / 发行日期
    const artist = revHtml.match(/<h2>\s*([^<]+)<\/h2>\s*<h3>/i)?.[1]?.trim() || null;
    const albumTitle = revHtml.match(/<h3>\s*([\s\S]*?)\s*<\/h3>/i)?.[1]?.replace(/<[^>]+>/g, "").trim() || null;
    const label = revHtml.match(/<dt>\s*Label\s*<\/dt>\s*<dd>([\s\S]*?)<\/dd>/i)?.[1]?.replace(/<[^>]+>/g, "").trim() || null;
    const releaseDate = revHtml.match(/<dt>\s*UK Release date\s*<\/dt>\s*<dd>([\s\S]*?)<\/dd>/i)?.[1]?.replace(/<[^>]+>/g, "").trim() || null;

    return {
      reviewId,
      title: albumTitle,
      artist,
      overall: overall != null ? Math.round(overall * 10) / 10 : null,
      overallDisplay: overall != null ? `${overall}/10` : null,
      individualScores,
      label,
      releaseDate,
      url: reviewUrl,
      source: "AnyDecentMusic",
    };
  } catch (e) {
    return null;
  }
}

function buildAggregate(r) {
  const{musicbrainz:mb,itunes:it,wikipedia:wp,reception:rc,personnel:ps,charts:ch,lastfm:lf,discogs:dg,rym,aoty,anyDecentMusic:adm}=r;
  const a={title:null,artist:null,date:null,genre:null,labels:null,formats:null,trackCount:null,tracks:null,artwork:null,url:null,summary:null,reception:null,personnel:null,charts:null,tags:null,rating:null,popularity:null,communityRating:null,professionalScore:null,sources:[]};

  // 主数据源判别
  const mbS=mb?._score||0,itS=it?._score||0;
  if(mb&&(mbS>itS*2||(mb?.artists?.[0]&&!it?.artist)||(mb?.artists?.[0]&&mbS>100))){a.title=mb.title;a.artist=mb.artists?.[0]||"?";a.sources.push("MusicBrainz");if(it)a.sources.push("iTunes");}
  else if(it){a.title=it.title;a.artist=it.artist||"?";a.sources.push("iTunes");if(mb)a.sources.push("MusicBrainz");}
  else if(mb){a.title=mb.title;a.artist=mb.artists?.[0]||"?";a.sources.push("MusicBrainz");}
  else if(lf?.title){a.title=lf.title;a.artist=lf.artist||"?";a.sources.push("Last.fm");}
  else if(dg?.results?.[0]?.title){a.title=dg.results[0].title;a.artist=dg.results[0].artist||"?";a.sources.push("Discogs");}
  else{a.title=wp?.title||r.query;a.artist="?";if(wp)a.sources.push("Wikipedia");}
  if(wp?.title)a.sources.push("Wikipedia");if(lf?.title)a.sources.push("Last.fm");if(dg?.results?.length)a.sources.push("Discogs");
  if(rym?.rating)a.sources.push("RateYourMusic(via DDG)");if(aoty?.score)a.sources.push("AOTY(via DDG)");

  const iMB=a.sources[0]==="MusicBrainz";
  a.date=iMB?(mb?.date||it?.releaseDate):(it?.releaseDate||mb?.date);a.date||=lf?.published||dg?.results?.[0]?.year||discogsYear(r)||null;
  a.genre=mb?.tags?.[0]||it?.genre||dg?.results?.[0]?.genre||null;
  a.tags=[...new Set([...(mb?.tags||[]),...(it?.genres||[]),...(lf?.tags||[]),(dg?.results?.[0]?.style||null)])].filter(Boolean).filter(t=>!/^\d{4}$/.test(t)).slice(0,15);if(!a.tags?.length)a.tags=null;
  a.labels= dg?.results?.[0]?.labels?.length ? dg.results[0].labels
    : (mb?.labels?.length ? mb.labels : (dg?.results?.[0]?.label ? [dg.results[0].label] : null));
  a.formats= dg?.results?.[0]?.formats?.length ? dg.results[0].formats
    : (mb?.formats?.length ? mb.formats : (dg?.results?.[0]?.format ? [dg.results[0].format] : null));
  a.tracks=iMB?(mb?.tracks?.length?mb.tracks:it?.tracks):(it?.tracks?.length?it.tracks:mb?.tracks);
  a.tracks=a.tracks?.length?a.tracks:null;a.trackCount=a.tracks?.length||mb?.trackCount||it?.trackCount||null;
  // 封面优先级：MusicBrainz release-group 主封面（最接近“最流行版本”）> iTunes > Discogs > Last.fm > Wikipedia
  a.artwork=it?.artwork||lf?.image||mb?.artwork||dg?.results?.[0]?.coverImage||wp?.thumbnail||null;
  if (it?.candidates?.length) {
    a.albumCandidates = it.candidates.map((c) => ({ source: "iTunes", ...c }));
  }
  if (lf?.image) {
    a.albumCandidates = a.albumCandidates || [];
    a.albumCandidates.push({
      source: "Last.fm",
      title: lf.title,
      artist: lf.artist,
      artwork: lf.image,
      url: lf.url || null,
    });
  }
  if (dg?.results?.[0]?.coverImage) {
    a.albumCandidates = a.albumCandidates || [];
    a.albumCandidates.push({
      source: "Discogs",
      title: dg.results[0].title,
      artist: a.artist,
      artwork: dg.results[0].coverImage,
      url: dg.results[0].url,
      have: dg.results[0].community?.have ?? null,
      want: dg.results[0].community?.want ?? null,
      rating: dg.results[0].community?.rating ?? null,
    });
  }
  a.summary=wp?.extract||lf?.summary||null;
  if(rc?.text)a.reception={text:rc.text};
  if (rc?.text) {
    // 一句话评价：提取带媒体名的句子（Pitchfork/NME/Guardian/Clash/Dork 等）
    const quotes = extractReceptionQuotes(rc.text);
    if (quotes.length) a.receptionQuotes = quotes;
  }
  if(ps?.text)a.personnel={text:ps.text};
  if(ch?.text)a.charts={text:ch.text};

  // ═══════════════════════════════════════════
  //  推荐算法：综合多个维度计算「社区评分」
  // ═══════════════════════════════════════════

  // —— 社区评分 ——
  // 优先 RYM 直接评分 > MusicBrainz 评分 > 综合推荐
  if (rym?.rating) {
    a.communityRating = { score: rym.rating, max: 5, source: "RateYourMusic (via DDG)", confidence: "high" };
  } else if (mb?.rating?.score) {
    // MusicBrainz 评分 × 2 映射到 /5 制
    const mbScore = (mb.rating.score / 5) * 5;
    a.communityRating = { score: Math.round(mbScore * 10) / 10, max: 5, source: "MusicBrainz (替代 RYM)", confidence: "medium", votes: mb.rating.count };
  } else if (dg?.results?.[0]?.community?.rating != null) {
    const dgRating = dg.results[0].community;
    a.communityRating = {
      score: Math.round(dgRating.rating * 10) / 10,
      max: 5,
      source: "Discogs",
      confidence: (dgRating.ratingCount || 0) >= 20 ? "high" : "medium",
      votes: dgRating.ratingCount ?? null,
    };
  } else if (lf?.listeners) {
    // Last.fm 听众数归一化到 /5
    const listenerScore = Math.min(5, Math.max(1, Math.log10(lf.listeners) - 2));
    a.communityRating = { score: Math.round(listenerScore * 10) / 10, max: 5, source: "Last.fm (基于听众数推荐)", confidence: "low", listeners: lf.listeners };
  }

  // —— 专业评分 (Wikipedia 乐评段 + AnyDecentMusic 聚合) ——
  const parsedScores = rc?.tableScores ? rc.tableScores : (rc?.text ? parseReviewScores(rc.text) : {});
  // 合并 AnyDecentMusic 评分 (ADM 数据更全，覆盖 Wikipedia 未能提取的评分)
  if (adm?.individualScores?.length) {
    for (const s of adm.individualScores) {
      const key = s.publication.toLowerCase().replace(/\s+/g, "");
      if (key.includes("pitchfork") && !parsedScores.pitchfork) parsedScores.pitchfork = {score:s.score,max:s.max};
      else if (key.includes("nme") && !parsedScores.nme) parsedScores.nme = {score:s.score,max:s.max};
      else if (key.includes("guardian") && !parsedScores.guardian) parsedScores.guardian = {score:s.score,max:s.max};
      else if (key.includes("clash") && !parsedScores.clash) parsedScores.clash = {score:s.score,max:s.max};
      else if (key.includes("dork") && !parsedScores.dork) parsedScores.dork = {score:s.score,max:s.max};
      else if (key.includes("metacritic") && !parsedScores.metacritic) parsedScores.metacritic = {score:s.score,max:s.max};
      else if (!parsedScores[key] && key.length > 2) parsedScores[key] = { score: s.score, max: s.max, publication: s.publication, source: "AnyDecentMusic" };
    }
    // AnyDecentMusic 聚合评分
    if (adm.overall != null) parsedScores.anydecentmusic = { score: adm.overall, max: 10 };
  }
  if (Object.keys(parsedScores).length > 0) {
    a.reviewScores = parsedScores;
    const allScores = [];
    if (parsedScores.pitchfork) allScores.push(parsedScores.pitchfork.score / 2);
    if (parsedScores.metacritic) allScores.push(parsedScores.metacritic.score / 20);
    if (parsedScores.allmusic) allScores.push(parsedScores.allmusic.score);
    if (parsedScores.rollingstone) allScores.push(parsedScores.rollingstone.score);
    if (parsedScores.guardian) allScores.push(parsedScores.guardian.score);
    if (parsedScores.nme) allScores.push(parsedScores.nme.score / 2);
    if (parsedScores.aggregate_score_10) {
      parsedScores.aggregate_score_10.forEach(s => allScores.push(s / 2));
    }
    const validScores = allScores.filter(s => s > 0 && s <= 5);
    if (validScores.length) {
      const avg = validScores.reduce((a,b) => a+b, 0) / validScores.length;
      a.professionalScore = {
        score: Math.round(avg * 10) / 10,
        max: 5,
        source: "Wikipedia Critical Reception (实时提取)",
        confidence: "high",
        reviewCount: validScores.length,
        publications: Object.keys(parsedScores).filter(k => k !== "aggregate_score_10"),
      };
    }
  } else if (aoty?.score) {
    a.professionalScore = { score: aoty.score / 20, max: 5, source: "AlbumOfTheYear (via DDG)", confidence: "high" };
  } else if (rc?.text) {
    const scores = (rc.text.match(/(\d{1,2})\s*\/\s*10/gi) || []).map(s => parseInt(s)/2);
    const scores5 = (rc.text.match(/([\d.]+)\s*\/\s*5/gi) || []).map(s => parseFloat(s));
    const allScores = [...scores, ...scores5].filter(s => s > 0 && s <= 5);
    if (allScores.length) {
      const avg = allScores.reduce((a,b) => a+b, 0) / allScores.length;
      a.professionalScore = { score: Math.round(avg * 10) / 10, max: 5, source: "Wikipedia (通用提取)", confidence: "medium", reviewCount: allScores.length };
    }
  }

  // —— 流行度 ——
  if (lf?.listeners) a.popularity = { source:"Last.fm", listeners:lf.listeners, playcount:lf.playcount };
  else if (dg?.results?.[0]?.community?.have != null) a.popularity = { source:"Discogs", have:dg.results[0].community.have, want:dg.results[0].community.want };
  else if (it?.trackCount) a.popularity = { source:"Apple Music", trackCount:it.trackCount };

  a.url=wp?.url||mb?.url||it?.url||null;
  a.sources=[...new Set(a.sources.filter(Boolean))];if(!a.sources.length)a.sources=null;
  return a;
}

function discogsYear(r) {
  const m = r.query?.match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : null;
}

function fmtD(ms){const s=Math.floor(ms/1000);return`${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;}

// 标题匹配打分：精确匹配 > 包含 > 关键词；编辑版（deluxe/bonus 等）扣分
export function normTitle(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "").trim();
}

export function rankTitleScore(name, query) {
  const n = normTitle(name);
  const q = normTitle(query);
  if (!n || !q) return 0;
  let s = 0;
  if (n === q) s += 60;
  else if (n.includes(q) || q.includes(n)) s += 30;
  else {
    const qW = q.split(/\s+/).filter((w) => w.length > 2);
    if (qW.length && qW.every((w) => n.includes(w))) s += 15;
  }
  if (/(deluxe|bonus|expanded|super\s*deluxe|live|remix|instrumental|karaoke|anniversary|remaster|acoustic)/i.test(name)) s -= 25;
  return s;
}

export function extractReceptionQuotes(text) {
  if (!text) return [];
  const quoteMatches = text.match(/[^。！？]*?(?:Pitchfork|NME|The Guardian|Clash|Dork|Mojo|Q magazine|Uncut|The Observer|The Line of Best Fit|DIY|Record Collector)[^。！？]*[。！？]/g) || [];
  return quoteMatches.map((s) => s.trim()).filter((s) => s.length >= 20 && s.length <= 200).slice(0, 3);
}

// ══════════════════════════════════════════════
//  中国平台搜索 — NetEase Cloud Music + QQ音乐
// ══════════════════════════════════════════════

/**
 * 搜索网易云音乐 (单曲/专辑)
 * @param {string} query - 搜索关键词
 * @param {string} type - "song" | "album"
 */
export async function searchNetease(query, type = "song") {
  const searchType = type === "album" ? 10 : 1;
  // 公共搜索 API (无需认证)
  const searchUrl = `https://music.163.com/api/search/get?s=${encodeURIComponent(query)}&type=${searchType}&limit=5`;

  try {
    const res = await proxyFetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://music.163.com",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.code !== 200) return null;

    const results = type === "album"
      ? (data.result?.albums || []).map(a => ({
          id: a.id, name: a.name, artist: a.artist?.name,
          picUrl: a.picUrl, size: a.size, publishTime: a.publishTime,
        }))
      : (data.result?.songs || []).map(s => ({
          id: s.id, name: s.name,
          artists: (s.artists || []).map(a => a.name).join("/"),
          album: s.album?.name, albumId: s.album?.id,
          duration: s.duration, popular: s.popular || s.pop || 0,
        }));

    // 标题匹配优先 + 热度排序（网易云默认结果经常把 Deluxe/翻唱放前面）
    const ranked = results
      .map((r) => ({ ...r, _score: (r.popular || 0) + rankTitleScore(r.name, query) }))
      .sort((a, b) => b._score - a._score);

    return { type, results: ranked, count: ranked.length };
  } catch (e) {
    return { type, results: [], error: e.message };
  }
}

/**
 * 获取网易云歌曲/专辑详情 (含评论数/收藏数)
 */
export async function getNeteaseDetail(id, type = "song") {
  try {
    if (type === "album") {
      // 专辑动态数据 (含评论数/收藏数/分享数)
      try {
        const dynUrl = `https://music.163.com/api/album/detail/dynamic?id=${id}`;
        const dynRes = await fetch(dynUrl, {
          headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://music.163.com" },
          signal: AbortSignal.timeout(8000),
        });
        if (dynRes.ok) {
          const dyn = await dynRes.json();
          if (dyn.code === 200) {
            return {
              commentCount: dyn.commentCount || 0,
              shareCount: dyn.shareCount || 0,
              subCount: dyn.subCount || 0,
              isSub: dyn.isSub || false,
            };
          }
        }
      } catch (_) {}
      try {
        const cmtUrl = `https://music.163.com/api/v1/resource/comments/R_AL_3_${id}?limit=1`;
        const cmtRes = await fetch(cmtUrl, {
          headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://music.163.com" },
          signal: AbortSignal.timeout(8000),
        });
        if (cmtRes.ok) {
          const cmt = await cmtRes.json();
          if (cmt.code === 200) {
            return { commentCount: cmt.total || 0, shareCount: null, subCount: null, isSub: false };
          }
        }
      } catch (_) {}
    } else {
      // 歌曲评论数 + 官方热度分 (0-100)，两者并行获取
      const commentUrl = `https://music.163.com/api/v1/resource/comments/R_SO_4_${id}?limit=1`;
      const detailUrl = `https://music.163.com/api/song/detail?ids=[${id}]`;
      const [commentRes, detailRes] = await Promise.allSettled([
        fetch(commentUrl, {
          headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://music.163.com" },
          signal: AbortSignal.timeout(8000),
        }),
        fetch(detailUrl, {
          headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://music.163.com" },
          signal: AbortSignal.timeout(8000),
        }),
      ]);
      let commentCount = null;
      if (commentRes.status === "fulfilled" && commentRes.value.ok) {
        const comment = await commentRes.value.json();
        if (comment.code === 200) commentCount = comment.total || 0;
      }
      let popularity = null;
      if (detailRes.status === "fulfilled" && detailRes.value.ok) {
        const detail = await detailRes.value.json();
        popularity = detail.songs?.[0]?.popularity ?? null;
      }
      if (commentCount != null || popularity != null) {
        return { commentCount, popularity };
      }
    }
    return null;
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * 网易云专辑基本信息（含封面/艺人/发行时间），用于以“单曲所属专辑”为准。
 */
export async function fetchNeteaseAlbumInfo(id) {
  try {
    const res = await fetch(`https://music.163.com/api/album/${id}`, {
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://music.163.com" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const a = data.album;
    if (!a) return null;
    return {
      id: a.id,
      name: a.name,
      artist: a.artist?.name || (a.artists || []).map((x) => x.name).join("/") || null,
      picUrl: a.picUrl ? (a.picUrl.includes("?") ? a.picUrl : a.picUrl + "?param=800y800") : null,
      publishTime: a.publishTime || null,
      size: a.size || null,
    };
  } catch (e) {
    return null;
  }
}

/**
 * 搜索 QQ 音乐 (单曲)
 */
export async function searchQQMusic(query) {
  const url = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${encodeURIComponent(query)}&format=json&n=5&t=0`;
  try {
    const res = await proxyFetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.code !== 0) return null;

    const songs = (data.data?.song?.list || []).map(s => ({
      id: s.songid || s.id,
      mid: s.songmid,
      name: s.songname || s.name,
      artists: (s.singer || []).map(a => a.name).join("/"),
      album: s.albumname || s.album?.name,
      interval: s.interval,
    }));

    return { results: songs, count: songs.length };
  } catch (e) {
    return { results: [], error: e.message };
  }
}

/**
 * 搜索 QQ 音乐专辑
 */
export async function searchQQAlbum(query) {
  const url = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${encodeURIComponent(query)}&format=json&n=5&t=8`;
  try {
    const res = await proxyFetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.code !== 0) return null;

    const albums = (data.data?.album?.list || []).map(a => ({
      id: a.albumID,
      mid: a.albumMID,
      name: a.albumName,
      singer: a.singerName,
      songCount: a.song_count,
      publicTime: a.publicTime,
    }));

    return { results: albums, count: albums.length };
  } catch (e) {
    return { results: [], error: e.message };
  }
}

/**
 * 获取 QQ 专辑曲目列表
 */
export async function getQQAlbumTracks(albumMid) {
  if (!albumMid) return null;
  const url = `https://c.y.qq.com/v8/fcg-bin/fcg_v8_album_detail_cp.fcg?albummid=${albumMid}&format=json`;
  try {
    const res = await proxyFetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://y.qq.com" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.code !== 0) return null;

    return (data.data?.getSongInfo || []).map(s => ({
      id: s.songid,
      mid: s.songmid,
      name: s.songname,
      album: s.albumname,
    }));
  } catch (e) {
    return [];
  }
}

/**
 * 网易云专辑评论数（专辑级别，不含单曲）
 */
export async function getNeteaseAlbumComments(query) {
  try {
    const search = await searchNetease(query, "album");
    if (!search?.results?.length) return null;
    const album = search.results[0];
    const cmtRes = await fetch(
      `https://music.163.com/api/v1/resource/comments/R_AL_3_${album.id}?limit=1`,
      {
        headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://music.163.com" },
        signal: AbortSignal.timeout(8000),
      }
    );
    const base = {
      id: album.id, name: album.name, artist: album.artist,
      picUrl: album.picUrl || null,
    };
    if (cmtRes.ok) {
      const cmt = await cmtRes.json();
      if (cmt.code === 200) {
        return { ...base, commentCount: cmt.total || 0 };
      }
    }
    return { ...base, commentCount: 0 };
  } catch (e) {
    return null;
  }
}
