// 卡片文本后处理：删除元数据串/内部用语，控制长度，保证面向读者可读。
export function sanitizeOneLiner(value) {
  if (typeof value !== "string") return value;
  let text = value;
  text = text.replace(/\s*\[[^\]]+\]\s*/g, " ");
  text = text.replace(/\s+([，。！？、；：])/g, "$1").replace(/[ \t]{2,}/g, " ").trim();
  const bannedTerms = [
    "听者笔记", "听感记录", "用户提到", "用户指出", "用户认为", "用户笔记指出",
    "根据用户", "从用户", "用户没有提供", "用户未提供",
    "乐评里提到", "乐评提到", "媒体评价", "平台评分显示", "评论区提到", "网友评价",
    "具体歌词文本需以实际发行版本为准", "以实际歌词为准", "以实际版本为准",
    "并非", "已修正为", "已修正", "已删除", "原文为", "以匹配原词", "引用不完整",
  ];
  for (const term of bannedTerms) {
    text = text.replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "g"), "");
  }
  const isCJK = /[\u4e00-\u9fff]/.test(text);
  const LIMIT = isCJK ? 20 : 60;
  if (text.length > LIMIT) {
    const slice = text.slice(0, LIMIT);
    const lastPunct = Math.max(slice.lastIndexOf("。"), slice.lastIndexOf("，"), slice.lastIndexOf("；"));
    text = lastPunct > LIMIT * 0.6 ? slice.slice(0, lastPunct + 1) : slice;
  }
  text = text.replace(/[，、]$/, "");
  if (text.length > LIMIT && !/[。！？」]$/.test(text)) {
    text += "。";
  }
  return text.trim();
}

export function sanitizeScores(scores, lyricsText = "") {
  const dims = ["词", "曲", "编", "唱", "混"];
  const MAX_RATIONALE = 220;

  const bannedTerms = [
    "听者笔记", "听感记录", "用户提到", "用户指出", "用户认为", "用户笔记指出",
    "根据用户", "从用户", "用户没有提供", "用户未提供",
    "乐评里提到", "乐评提到", "媒体评价", "平台评分显示", "评论区提到", "网友评价",
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
    // 删除面向读者的元数据串（如 [混音:LUFS=-7.6]），只保留自然语言
    text = text.replace(/\s*\[[^\]]+\]\s*/g, " ");
    text = text.replace(/\s+([，。！？、；：])/g, "$1").replace(/[ \t]{2,}/g, " ").replace(/。\s*。/g, "。");
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
    scores.oneLiner = sanitizeOneLiner(scores.oneLiner);
  }

  // tags: 剔除非英文
  if (Array.isArray(scores.tags)) {
    scores.tags = scores.tags.filter(t =>
      !/^(female|male|guitar|bass|drum|synth|piano|violin|distortion|reverb|delay|compressor|loop|riff)/i.test(t)
    );
  }
}

export default sanitizeScores;
