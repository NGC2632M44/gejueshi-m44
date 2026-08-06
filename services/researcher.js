// 歌掘士 v5 — 混合研究引擎
// API源: Wikipedia(摘要+乐评+人员+榜单) | MusicBrainz | iTunes | Last.fm | Discogs
// 搜索引擎: 通过 DuckDuckGo 间接获取 RYM/AOTY/Discogs 公开数据（不触发反爬）
// 推荐算法: 当目标平台不可用时，用已有数据计算等价评分

import fetch from "node-fetch";
import { HttpsProxyAgent } from "https-proxy-agent";

const T = 20000;
const MB_UA = "Gejueshi/1.0 (Music Research; +http://localhost:3001)";

// Windows 系统代理 — WestWorldVPN
const PROXY_URL = process.env.GEJUESHI_PROXY_URL || "http://127.0.0.1:1001";
const proxyAgent = new HttpsProxyAgent(PROXY_URL);

// 需要走代理的域名 (被 GFW 限制)
const NEEDS_PROXY = ["wikipedia.org", "musicbrainz.org", "duckduckgo.com",
  "rateyourmusic.com", "albumoftheyear.org", "pitchfork.com", "metacritic.com",
  "apple.com", "discogs.com", "last.fm", "ws.audioscrobbler.com"];

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

// ── 研究缓存 (30分钟TTL，解决重复搜索结果不一致) ──
const RESEARCH_CACHE = new Map();
const RESEARCH_CACHE_TTL = 30 * 60 * 1000;

function _researchCacheKey(query) {
  return (query || "").toLowerCase().replace(/\s+/g, "_").slice(0, 80);
}

export async function researchAlbum(query, opts = {}) {
  // 缓存命中
  const ck = _researchCacheKey(query);
  const cached = RESEARCH_CACHE.get(ck);
  if (cached && Date.now() - cached.ts < RESEARCH_CACHE_TTL) {
    console.log(`   💾 研究缓存命中: "${query}" (${Math.round((Date.now() - cached.ts) / 1000)}s前)`);
    return { ...cached.data, fromCache: true };
  }

  const lfKey = opts.lastfmKey || process.env.LASTFM_API_KEY || null;
  const dgToken = opts.discogsToken || process.env.DISCOGS_TOKEN || null;
  const r = { query, wikipedia:null, reception:null, personnel:null, charts:null, musicbrainz:null, itunes:null, lastfm:null, discogs:null, rym:null, aoty:null, anyDecentMusic:null, aggregate:null, errors:[], timestamp:new Date().toISOString() };

  // 并行任务
  const tasks = [
    fetchWikipedia(query).then(v=>{r.wikipedia=v;if(v?.title)return Promise.allSettled([
      fetchWikiSection(v.title,"Critical reception").then(x=>r.reception=x).catch(()=>{}),
      fetchWikiSection(v.title,"Personnel").then(x=>r.personnel=x).catch(()=>{}),
      fetchWikiSection(v.title,"Charts").then(x=>r.charts=x).catch(()=>{}),
    ]);}).catch(e=>r.errors.push(`Wikipedia: ${e.message}`)),
    fetchMusicBrainz(query).then(v=>r.musicbrainz=v).catch(e=>r.errors.push(`MusicBrainz: ${e.message}`)),
    fetchiTunes(query).then(v=>r.itunes=v).catch(e=>r.errors.push(`iTunes: ${e.message}`)),
    // RYM/AOTY 通过搜索引擎获取（不直接爬目标站）
    // RYM/AOTY/Discogs via DDG — DDG 已不可用 (202 redirect / timeout)，这些源暂时下线
    fetchAnyDecentMusic(query).then(v=>r.anyDecentMusic=v).catch(e=>r.errors.push(`AnyDecentMusic: ${e.message}`)),
  ];
  if (lfKey) tasks.push(fetchLastfm(query,lfKey).then(v=>r.lastfm=v).catch(e=>r.errors.push(`Last.fm: ${e.message}`)));
  if (dgToken) tasks.push(fetchDiscogsAPI(query,dgToken).then(v=>r.discogs=v).catch(e=>r.errors.push(`Discogs: ${e.message}`)));

  await Promise.allSettled(tasks);
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
  const secRes = await proxyFetch(`https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(pageTitle)}&prop=sections&format=json&origin=*`, {signal:AbortSignal.timeout(T)});
  const sections = (await secRes.json())?.parse?.sections || [];
  const section = sections.find(s => new RegExp(sectionName,"i").test(s.line) && !/commercial|legacy|tour|track/i.test(s.line.replace(new RegExp(sectionName,"i"),"")));
  if (!section) return null;
  const conRes = await proxyFetch(`https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(pageTitle)}&prop=text&section=${section.index}&format=json&origin=*`, {signal:AbortSignal.timeout(T)});
  const html = (await conRes.json())?.parse?.text?.["*"] || "";
  if (!html) return null;

  // 保留表格结构用于评分解析
  const tableText = parseWikiScoringTable(html);
  // 同时也产出纯文本
  const clean = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi,"").replace(/<style[^>]*>[\s\S]*?<\/style>/gi,"").replace(/<[^>]+>/g," ").replace(/&[^;]+;/g," ").replace(/\s+/g," ").trim().substring(0,3000);
  return { title: section.line, text: clean, tableScores: tableText };
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

    // 匹配评分格式: "7/10" / "4/5" / "6.7/10" / "77/100"
    const scoreMatch = ratingRaw.match(/(\d+\.?\d*)\s*\/\s*(\d+)/);
    if (scoreMatch) {
      const key = pubRaw.toLowerCase().replace(/[^a-z]/g, "");
      scores[key] = { score: parseFloat(scoreMatch[1]), max: parseInt(scoreMatch[2]), publication: pubRaw };
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
  const groups = (await(await fetch(`https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(query)}&fmt=json&limit=100`,{headers:{"User-Agent":MB_UA,"Accept":"application/json"},signal:AbortSignal.timeout(T)})).json())?.["release-groups"]||[];
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
  const list=await(await fetch(`https://musicbrainz.org/ws/2/release?query=rgid:${p.id}&fmt=json&inc=artist-credits+labels+release-events&limit=5`,{headers:{"User-Agent":MB_UA,"Accept":"application/json"},signal:AbortSignal.timeout(T)})).json();
  let pick=null;
  for(const r of list?.releases||[]){const rd=await(await fetch(`https://musicbrainz.org/ws/2/release/${r.id}?fmt=json&inc=recordings+labels+artist-credits+tags+ratings`,{headers:{"User-Agent":MB_UA,"Accept":"application/json"},signal:AbortSignal.timeout(T)})).json();if((rd?.media||[]).some(m=>(m.tracks?.length||0)>0)||!pick)pick=rd;if((pick?.media||[]).some(m=>(m.tracks?.length||0)>0))break;}
  if(!pick)pick=list?.releases?.[0]||{};
  const artists=(pick?.["artist-credit"]||p?.["artist-credit"]||[]).filter(c=>typeof c==="object").map(c=>(c.name||c.artist?.name||"").trim()).filter(Boolean);
  const tracks=(pick?.media||[]).flatMap(m=>m.tracks||[]).map(t=>({number:t.number,title:t.title,length:(t.length||t.recording?.length)?fmtD(t.length||t.recording?.length):null}));
  const labels=(pick?.labels||[]).map(l=>l.label?.name).filter(Boolean);
  const date=pick?.date||p?.["first-release-date"]||null;
  const tags=(pick?.tags||[]).map(t=>t.name).filter(Boolean).slice(0,20);
  const rating=pick?.rating||p?.rating||null;
  const formats=[...new Set((pick?.media||[]).map(m=>m.format).filter(Boolean))];
  const st=p?.["secondary-types"]||[];let tl=p?.["primary-type"]||"Album";if(st.length)tl+=` (${st.join(", ")})`;
  return{id:p.id,title:p.title,artists:artists.length?artists:undefined,date,labels:labels.length?labels:undefined,formats:formats.length?formats:undefined,tracks:tracks.length?tracks:undefined,trackCount:tracks.length,type:tl,tags:tags.length?tags:undefined,rating:rating?{score:rating["vote-average"],count:rating["vote-count"]}:undefined,url:`https://musicbrainz.org/release-group/${p.id}`,_score:best.score};
}

// ══════════════════════════════════════════════
//  iTunes / Last.fm / Discogs API
// ══════════════════════════════════════════════

async function fetchiTunes(query) {
  let items=(await(await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=album&limit=15&country=us`,{signal:AbortSignal.timeout(T)})).json())?.results||[];
  if(items.length<3)items=[...items,...((await(await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=album&attribute=albumTerm&limit=15&country=us`,{signal:AbortSignal.timeout(T)})).json())?.results||[])];
  const seen=new Set();items=items.filter(i=>{if(seen.has(i.collectionId))return false;seen.add(i.collectionId);return true;});
  if(!items.length)return null;
  const qL=query.toLowerCase(),qW=qL.split(/\s+/).filter(w=>w.length>2);
  const best=items.map(i=>{let s=(i.trackCount||0)*2;const n=(i.collectionName||"").toLowerCase();if(n===qL)s+=50;else if(qW.length>0&&qW.every(w=>n.includes(w)))s+=25;if(/ep\b|single/i.test(n))s-=20;if((i.trackCount||0)<4)s-=100;return{item:i,score:s};}).sort((a,b)=>b.score-a.score)[0].item;
  const songs=((await(await fetch(`https://itunes.apple.com/lookup?id=${best.collectionId}&entity=song&country=us`,{signal:AbortSignal.timeout(T)})).json())?.results||[]).filter(r=>r.wrapperType==="track");
  return{title:best.collectionName||best.collectionCensoredName,artist:best.artistName,artwork:best.artworkUrl100?.replace("100x100bb","3000x3000bb")||null,genre:best.primaryGenreName,genres:[best.primaryGenreName,...(best.genreNames?.filter(g=>g!==best.primaryGenreName)||[])],releaseDate:best.releaseDate?.split("T")[0]||null,trackCount:best.trackCount||0,price:best.collectionPrice?`$${best.collectionPrice}`:null,url:best.collectionViewUrl,tracks:songs.map(t=>({number:t.trackNumber,title:t.trackName,length:t.trackTimeMillis?fmtD(t.trackTimeMillis):null})),copyright:best.copyright||null};
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
  if(!token)return null;
  const res=await fetch(`https://api.discogs.com/database/search?q=${encodeURIComponent(query)}&type=release&per_page=10`,{headers:{"User-Agent":MB_UA,"Authorization":`Discogs token=${token}`},signal:AbortSignal.timeout(T)});
  if(!res.ok)throw new Error(`Discogs API ${res.status}`);
  const data=await res.json();
  const results=(data.results||[]).map(r=>({title:r.title,year:r.year,format:r.format?.join(", "),label:r.label?.[0],genre:r.genre?.[0],style:r.style?.[0],country:r.country,coverImage:r.cover_image,url:r.uri?`https://www.discogs.com${r.uri}`:null})).filter(r=>r.url);
  return{results,count:results.length,source:"Discogs API"};
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
    // 直接搜索
    const searchUrl = `http://www.anydecentmusic.com/search-results.aspx?search=${encodeURIComponent(query)}`;
    const res = await proxyFetch(searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept": "text/html" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // 提取搜索结果中的第一个专辑链接
    const linkMatch = html.match(/<a[^>]*href="\/review\/(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) return null;

    const reviewId = linkMatch[1];
    const titleGuess = linkMatch[2].replace(/<[^>]*>/g, "").trim();

    // 获取评分详情
    const reviewUrl = `http://www.anydecentmusic.com/review/${reviewId}.aspx`;
    const revRes = await proxyFetch(reviewUrl, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html" },
      signal: AbortSignal.timeout(12000),
    });
    if (!revRes.ok) return null;
    const revHtml = await revRes.text();

    // 解析聚合评分 (总评分数, 如 7.2)
    const overallMatch = revHtml.match(/<span[^>]*class="[^"]*rating[^"]*"[^>]*>([\d.]+)<\/span>/i)
      || revHtml.match(/(\d\.\d)\s*<\/span>/i);
    const overall = overallMatch ? parseFloat(overallMatch[1]) : null;

    // 解析 Chart 中的高亮评分 (通常在前几个 <li>)
    const chartMatch = revHtml.match(/<ul[^>]*class="[^"]*chart[^"]*list[^"]*"[\s\S]*?<\/ul>/i);
    const chartHtml = chartMatch ? chartMatch[0] : "";

    const individualScores = [];
    const scoreRegex = /<strong[^>]*>([^<]+)<\/strong>\s*<span[^>]*>[\s\S]*?(\d+\.?\d*)\s*\/?\s*(\d+)?/gi;
    // 更宽松的匹配: 任何 "PublicationName" 后跟分数的模式
    const looseRegex = />([A-Z][A-Za-z\s&]+?)\s*<\/\w+>\s*[<\w\s="'>]*?(\d\.?\d*)\s*\/?\s*(\d+)?/gi;

    let m;
    while ((m = looseRegex.exec(chartHtml)) !== null) {
      const pub = m[1].trim();
      const score = parseFloat(m[2]);
      const max = m[3] ? parseInt(m[3]) : (score <= 10 ? 10 : 100);
      if (pub.length > 2 && !isNaN(score) && score > 0 && score <= max) {
        individualScores.push({ publication: pub, score, max });
      }
    }
    if (individualScores.length > 8) individualScores.length = 8; // 最多8个

    return {
      reviewId,
      title: titleGuess,
      overall: overall != null ? Math.round(overall * 10) / 10 : null,
      overallDisplay: overall != null ? `${overall}/10` : null,
      individualScores,
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
  else{a.title=wp?.title||r.query;a.artist="?";if(wp)a.sources.push("Wikipedia");}
  if(wp?.title)a.sources.push("Wikipedia");if(lf?.title)a.sources.push("Last.fm");if(dg?.results?.length)a.sources.push("Discogs");
  if(rym?.rating)a.sources.push("RateYourMusic(via DDG)");if(aoty?.score)a.sources.push("AOTY(via DDG)");

  const iMB=a.sources[0]==="MusicBrainz";
  a.date=iMB?(mb?.date||it?.releaseDate):(it?.releaseDate||mb?.date);a.date||=lf?.published||dg?.results?.[0]?.year||discogsYear(r)||null;
  a.genre=mb?.tags?.[0]||it?.genre||dg?.results?.[0]?.genre||null;
  a.tags=[...new Set([...(mb?.tags||[]),...(it?.genres||[]),...(lf?.tags||[]),(dg?.results?.[0]?.style||null)])].filter(Boolean).slice(0,15);if(!a.tags?.length)a.tags=null;
  a.labels=mb?.labels?.length?mb.labels:(dg?.results?.[0]?.label?[dg.results[0].label]:null);
  a.formats=mb?.formats?.length?mb.formats:(dg?.results?.[0]?.format?[dg.results[0].format]:null);
  a.tracks=iMB?(mb?.tracks?.length?mb.tracks:it?.tracks):(it?.tracks?.length?it.tracks:mb?.tracks);
  a.tracks=a.tracks?.length?a.tracks:null;a.trackCount=a.tracks?.length||mb?.trackCount||it?.trackCount||null;
  a.artwork=it?.artwork||dg?.results?.[0]?.coverImage||lf?.image||wp?.thumbnail||null;
  a.summary=wp?.extract||lf?.summary||null;
  if(rc?.text)a.reception={text:rc.text};
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

    return { type, results, count: results.length };
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
    } else {
      // 歌曲评论数 — 使用公开的评论接口 (无需加密)
      const commentUrl = `https://music.163.com/api/v1/resource/comments/R_SO_4_${id}?limit=1`;
      const commentRes = await fetch(commentUrl, {
        headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://music.163.com" },
        signal: AbortSignal.timeout(8000),
      });
      if (commentRes.ok) {
        const comment = await commentRes.json();
        if (comment.code === 200) {
          return {
            commentCount: comment.total || 0,
          };
        }
      }
    }
    return null;
  } catch (e) {
    return { error: e.message };
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
 * 获取 QQ 音乐歌曲评论数
 */
/**
 * 获取 QQ 音乐歌曲评论数（需登录 cookie）
 *
 * 如何获取 cookie:
 *   浏览器打开 y.qq.com → 登录 → F12 → Application → Cookies
 *   → 复制整个 cookie 字符串
 *   然后: export QQ_MUSIC_COOKIE="uin=xxx; skey=xxx; ..."
 *   或写到 ~/.claude/settings.json 的 env 里
 */
export async function getQQMusicComments(mid) {
  if (!mid) return null;
  const cookie = process.env.QQ_MUSIC_COOKIE || "";

  // 计算 g_tk (QQ音乐鉴权token, 基于skey的hash)
  let gtk = "";
  if (cookie) {
    const skeyMatch = cookie.match(/skey=([^;]+)/);
    if (skeyMatch) {
      let hash = 5381;
      for (let i = 0; i < skeyMatch[1].length; i++) {
        hash += (hash << 5) + skeyMatch[1].charCodeAt(i);
      }
      gtk = String(hash & 0x7fffffff);
    }
  }

  const params = new URLSearchParams({
    biztype: "1", topid: mid, cmd: "8",
    pagenum: "0", pagesize: "1", format: "json",
  });
  if (gtk) {
    params.set("g_tk", gtk);
    params.set("loginUin", "0");
  }

  const url = `https://c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg?${params}`;
  try {
    const headers = { "User-Agent": "Mozilla/5.0", "Referer": "https://y.qq.com" };
    if (cookie) headers["Cookie"] = cookie;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.comment?.commenttotal || data?.commenttotal || 0;
  } catch (e) {
    return null;
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
