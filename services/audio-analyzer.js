// 歌掘士 v3.1 — AI音频分析服务
// 调用 analyze_audio.py → 生成听歌指引 → Claude翻译为五维评分
import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildFinalWordPromptSection } from "./final-word.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 调用 Python 脚本提取音频特征
 * @param {string} audioPath - MP3/FLAC 文件路径
 * @returns {Promise<Object>} 音频特征 JSON
 */
export async function extractAudioFeatures(audioPath) {
  return new Promise((resolve, reject) => {
    // 清理输入：去掉 Windows 复制文件时自动带上的双引号/单引号
    let cleanedPath = audioPath.trim();
    if ((cleanedPath.startsWith('"') && cleanedPath.endsWith('"')) ||
        (cleanedPath.startsWith("'") && cleanedPath.endsWith("'"))) {
      cleanedPath = cleanedPath.slice(1, -1).trim();
    }

    const projectRoot = path.join(__dirname, "..");
    const scriptPath = path.join(projectRoot, "scripts", "analyze_audio.py");

    if (!existsSync(scriptPath)) {
      return reject(new Error(`分析脚本不存在: ${scriptPath}`));
    }

    // 解析音频路径：相对路径 → 相对项目根目录；绝对路径保持不变
    const resolvedAudioPath = path.isAbsolute(cleanedPath)
      ? cleanedPath
      : path.resolve(projectRoot, cleanedPath);

    if (!existsSync(resolvedAudioPath)) {
      return reject(new Error(`音频文件不存在: ${resolvedAudioPath}`));
    }

    const pythonCmd = process.platform === "win32" ? "python" : "python3";

    const proc = spawn(pythonCmd, [scriptPath, resolvedAudioPath], {
      cwd: projectRoot,
      timeout: 120000,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    proc.stderr.on("data", (chunk) => (stderr += chunk.toString()));

    proc.on("close", (code) => {
      if (code !== 0) {
        const errDetail = stderr ? `\n${stderr.slice(0, 500)}` : "";
        return reject(new Error(`Python 脚本退出码 ${code}${errDetail}`));
      }
      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch (e) {
        reject(new Error(`JSON 解析失败: ${e.message}\nstdout: ${stdout.slice(0, 200)}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`无法运行 Python: ${err.message}。请确认: pip install essentia librosa`));
    });
  });
}

/**
 * ── 音频参数解读函数（阈值基于 MIR 领域通用标准）──
 */

function interpretBPM(bpm) {
  if (!bpm) return "未检出";
  if (bpm < 80) return `极慢——Ambient/Downtempo/Lo-fi 区间`;
  if (bpm < 110) return `慢速——Hip-Hop/Reggaeton/R&B 区间`;
  if (bpm < 130) return `中速——House/Indie Pop/主流摇滚 区间`;
  if (bpm < 160) return `快速——Techno/Trance/Punk 区间`;
  return `极快——Hardcore/Drum & Bass 区间`;
}

function interpretCentroid(centroidMean) {
  if (!centroidMean) return "数据不足";
  if (centroidMean < 1000) return "偏暗——能量集中中低频，温暖厚重（大提琴、男低音）";
  if (centroidMean < 1800) return "平衡偏暖——中低频为主，柔和（Indie Pop、民谣、古典）";
  if (centroidMean < 2500) return "标准平衡——高中低频均衡，通透自然（主流流行、摇滚）";
  if (centroidMean < 3500) return "偏亮——中高频突出，明亮锐利（EDM、金属）";
  return "极亮——高频能量主导，尖锐穿透（镲片、齿音）";
}

function interpretRolloff(rolloffMean) {
  if (!rolloffMean) return "数据不足";
  if (rolloffMean < 5000) return "高频严重不足——高频截断明显，听感发闷（电话音质、低保真）";
  if (rolloffMean < 10000) return "高频延展一般——缺少空气感（老录音、低码率MP3）";
  if (rolloffMean < 16000) return "标准延展——高频充足，细节丰富（现代母带）";
  return "高频延展优秀——空气感强，通透度高（Hi-Res、古典）";
}

function interpretBandwidth(bw) {
  if (!bw) return "数据不足";
  if (bw < 800) return "极窄——频谱集中，音色单薄（正弦波、口哨）";
  if (bw < 1500) return "偏窄——频谱集中度高，音色偏瘦（独奏乐器）";
  if (bw < 2500) return "中等——频谱分布适中，音色饱满（流行、摇滚）";
  if (bw < 4000) return "宽——频谱分散，音色丰满有层次（交响乐、EDM）";
  return "极宽——频谱极度分散，听感嘈杂（噪音、失真金属）";
}

function interpretLUFS(lufs) {
  if (!lufs) return "数据不足";
  if (lufs < -20) return "广播级——电视/电影对白标准（EBU R128: -23 LUFS）";
  if (lufs < -14) return "流媒体标准——Spotify(-14)/Apple Music(-16) 适配区间";
  if (lufs < -10) return "轻量电子/独立流行——非舞池向，保留较多动态";
  if (lufs < -6) return "俱乐部/舞池标准——House/Techno/EDM 行业通用区间";
  return "极端压缩——硬派电子，动态损失严重";
}

function interpretDynamicRange(energyRange) {
  if (!energyRange) return "数据不足";
  // energyRange 是线性比值 (RMS/Peak 或能量范围)，×1000 为 ‰
  const permille = Math.round(energyRange * 1000);
  if (permille < 251) return `极大动态 (>12dB) ——古典/交响乐/原声爵士`;
  if (permille < 398) return `较大动态 (8~12dB) ——独立音乐/民谣/摇滚`;
  if (permille < 631) return `中等动态 (5~8dB) ——主流流行/轻电子`;
  if (permille < 794) return `压缩较强 (3~5dB) ——EDM/Hip-Hop`;
  return `极端压缩 (<3dB) ——硬派电子/响度战争`;
}

function interpretStereoWidth(width) {
  if (width == null) return "数据不足";
  if (width < 10) return "近单声道——几乎无立体声信息，听感扁平";
  if (width < 30) return "偏窄——声场较窄，重心居中（人声主导的流行）";
  if (width < 55) return "标准平衡——声场自然，兼顾宽度与兼容性";
  if (width < 70) return "偏宽——声场开阔，空间感强（电子/交响乐）";
  return "过宽风险——相位抵消风险高";
}

function interpretKeyConfidence(conf) {
  if (conf == null) return "";
  if (conf < 30) return "（置信度极低，调性不可靠）";
  if (conf < 50) return "（置信度较低，可能转调频繁）";
  if (conf < 70) return "（置信度中等）";
  return "（置信度高，调性稳定）";
}

/**
 * 生成听歌指引 — 告诉用户该听什么
 */
export function generateListeningGuide(audioFeatures) {
  const {
    bpm,
    key,
    structure = [],
    spectral = {},
    dynamics = {},
    duration_seconds,
    energy_curve = [],
  } = audioFeatures;

  const lines = [];

  lines.push("## 听歌指引\n");

  // 1. 基本信息
  lines.push("### 音频特征");
  lines.push(`- BPM: ${bpm ? bpm + " — " + interpretBPM(bpm) : "未检出"}${(audioFeatures.bpm_method || "").includes("network") ? "（多源校准）" : ""}`);
  lines.push(`- 调性: ${key || "未检出"}${(audioFeatures.key_method || "").includes("network") ? "（多源校准）" : ""}`);
  if (spectral.centroid_mean) {
    lines.push(`- 整体音色: ${interpretCentroid(spectral.centroid_mean)}`);
  }
  if (spectral.centroid_std) {
    lines.push(`- 音色变化度: ${spectral.centroid_std > 800 ? "丰富多变，不同段落色彩变化大" : "相对统一，整体听感均衡"}`);
  }
  if (duration_seconds) {
    const m = Math.floor(duration_seconds / 60);
    const s = Math.floor(duration_seconds % 60);
    lines.push(`- 时长: ${m}分${String(s).padStart(2, "0")}秒`);
  }
  lines.push("");

  // 2. 结构
  if (structure.length > 0) {
    lines.push("### 段落结构");
    for (const seg of structure) {
      const icons = { intro: "🌅", verse: "📖", chorus: "🔥", bridge: "🌉", outro: "🌙" };
      const icon = icons[seg.label] || "🎵";
      lines.push(`- ${icon} **${seg.label}** (${seg.start}s–${seg.end}s)`);
    }
    lines.push("");
  }

  // 3. 动态
  if (dynamics) {
    lines.push("### 动态与张力");
    if (dynamics.loudest_moment_seconds !== undefined) {
      const m = Math.floor(dynamics.loudest_moment_seconds / 60);
      const s = Math.round(dynamics.loudest_moment_seconds % 60);
      lines.push(`- 🔊 最响段落: ${m}:${String(s).padStart(2, "0")} — 这里是情绪爆发点，留意编曲是否同步加厚`);
    }
    if (dynamics.energy_range) {
      const range = dynamics.energy_range;
      lines.push(`- 📊 动态幅度: ${range > 0.05 ? "较大——有强烈的强弱对比，编曲上可能有突然的抽空或爆发" : "较小——整体维持在一个密度，可能是风格选择（shoegaze/drone/minimal）"}`);
    }
    lines.push("");
  }

  // 4. 针对性的听点指引
  lines.push("### 听的时候可以留意");
  lines.push("");

  const tips = [];

  if (bpm && bpm < 90) {
    tips.push("🎯 慢速曲，留意**空间**——乐器之间的距离感、混响的长度、留白的运用。");
  }
  if (bpm && bpm > 130) {
    tips.push("🎯 快速曲，留意**紧密度**——鼓手/编程的精度、乐器之间的咬合、是否有故意的错位感。");
  }
  if (spectral.centroid_mean && spectral.centroid_mean < 1500) {
    tips.push("🎯 音色篇暗，留意**低频**——贝斯的存在感、kick drum 的冲击力、是否有 sub-bass。");
  }
  if (spectral.centroid_mean && spectral.centroid_mean > 3000) {
    tips.push("🎯 音色偏亮，留意**高频管理**——镲片/hi-hat 是否刺耳？人声嘶嘶声是否被处理？");
  }
  if (spectral.centroid_std && spectral.centroid_std > 1000) {
    tips.push("🎯 音色变化大，留意**段落切换时的音色过渡**——是通过效果器变化？乐器增减？还是混音空间变化？");
  }
  if (energy_curve && energy_curve.length > 0) {
    tips.push("🎯 留意**副歌段的低频**——是否比主歌更厚？这是混音常见的'副歌升级'手法。");
  }
  tips.push("🎯 留意**人声的距离感**——dry（贴脸）还是 wet（加混响/延迟拉远）？段落间有没有变化？");
  tips.push("🎯 留意**立体声场**——哪些乐器在中间？哪些被放在左右？有没有声音在移动？");

  lines.push(tips.slice(0, 5).join("\n"));
  lines.push("");

  // 5. 引导性问题
  lines.push("### 回答这几个问题（帮助AI校准评分）");
  lines.push("");
  lines.push("1. **编曲**: 整体编曲是[稀疏 / 适中 / 密集]？有没有让你印象深刻的器乐编排细节？");
  lines.push("2. **人声/演奏**: 表现是否打动你？有没有哪个音符/句子让你想倒回去重听？");
  lines.push("3. **制作**: 整体声音质感是[干净通透 / 温暖模拟 / 粗糙有毛边 / 空间感强]？");
  lines.push("4. **记忆点**: 这首歌最好的部分是？最差（或可改进）的部分是？");
  lines.push("5. **类似作品**: 这张/首歌让你想起哪些其他艺术家或专辑？");

  return lines.join("\n");
}

/**
 * 构建五维评分 prompt（含平台评分校准）
 * @param {Object} audioFeatures
 * @param {string} listeningAnswers
 * @param {Object} albumMetadata
 * @param {Object} platformRatings - { pitchfork, rym, aoty, qq, netease, wikipedia }
 */
export function buildScoringPrompt(audioFeatures, listeningAnswers = "", albumMetadata = {}, platformRatings = null, heatData = null, lyrics = "", researchData = null, ratingScope = "song", oneLinerLang = "zh", finalWord = null) {
  const {
    bpm,
    key,
    spectral = {},
    dynamics = {},
    structure = [],
    duration_seconds,
    stereo_width,
    key_confidence,
    chord_sequence,
  } = audioFeatures;

  const prompts = [];
  const isSongScope = ratingScope === "song";

  prompts.push("# 音乐分析任务：五维评分\n");
  prompts.push("你是一个认真听歌的音乐爱好者。基于音频特征、聆听反馈、平台评分，分享你对这首歌在词曲编唱混五个维度的感受。");
  prompts.push("写你真正感觉到的，不要装专业。不知道的就说不知道，不确定的就写'可能是'。");
  prompts.push("");

  // ── 客观数据 ──
  prompts.push("## 客观音频特征（librosa 自动分析）");
  prompts.push(`- BPM: ${bpm || "?"} → ${interpretBPM(bpm)}`);
  prompts.push(`- 调性: ${key || "?"} ${interpretKeyConfidence(key_confidence)}`);
  if (duration_seconds) {
    const m = Math.floor(duration_seconds / 60);
    const s = Math.round(duration_seconds % 60);
    const durLabel = duration_seconds < 120 ? "超短" : duration_seconds < 210 ? "标准流行" : duration_seconds < 300 ? "标准版式" : "长篇幅";
    prompts.push(`- 时长: ${m}:${String(s).padStart(2,"0")} (${durLabel})`);
  }
  if (chord_sequence) {
    prompts.push(`- 和弦进行: ${chord_sequence}`);
  }
  if (spectral?.centroid_mean != null) {
    prompts.push(`- 频谱质心: ${Math.round(spectral.centroid_mean)} Hz → ${interpretCentroid(spectral.centroid_mean)}`);
  }
  if (spectral?.rolloff_mean != null) {
    prompts.push(`- 高频滚降: ${Math.round(spectral.rolloff_mean)} Hz → ${interpretRolloff(spectral.rolloff_mean)}`);
  }
  if (spectral?.bandwidth != null) {
    prompts.push(`- 频谱带宽: ${Math.round(spectral.bandwidth)} Hz → ${interpretBandwidth(spectral.bandwidth)}`);
  }
  if (stereo_width != null) {
    prompts.push(`- 立体声宽度: ${stereo_width}% → ${interpretStereoWidth(stereo_width)}`);
  }
  if (dynamics?.integrated_lufs != null) {
    prompts.push(`- 整体响度: ${dynamics.integrated_lufs.toFixed(1)} LUFS → ${interpretLUFS(dynamics.integrated_lufs)}`);
  }
  if (dynamics?.energy_range !== undefined) {
    prompts.push(`- 动态幅度: ${Math.round(dynamics.energy_range * 1000)}‰ → ${interpretDynamicRange(dynamics.energy_range)}`);
  }
  prompts.push("- 以上解读基于 MIR 领域通用阈值，仅供参考。如有用户笔记相矛盾，以用户听感为准。");
  if (structure.length > 0) {
    prompts.push(`- 段落结构: ${structure.map(s => `${s.label}(${s.start}s-${s.end}s)`).join(" → ")}`);
  }

  // ── Step1 五维证据包（只当证据，不下结论）──
  const evidence = audioFeatures.evidence;
  if (evidence && Object.keys(evidence).length > 0) {
    prompts.push("## Step1 五维证据包（只当证据，不下结论）");
    prompts.push(JSON.stringify(evidence, null, 2));
    prompts.push("规则：把证据转述成自然听感语言（如写“响度偏大、动态偏平”而不是 [混音:LUFS=-7.6]）；禁止在 rationale 中出现任何 [键:值] 形式的字段串、技术字段名或括号标注；证据不足必须明说“基于听感/平台评分推断”。禁止把数值本身说成好/坏结论。");
    prompts.push("");
  }
  prompts.push("");

  // ── 研究数据（Wikipedia/MusicBrainz 等）──
  const agg = researchData?.aggregate;
  if (agg || (albumMetadata && (albumMetadata.title || albumMetadata.artist))) {
    prompts.push("## 歌曲背景");
    if (albumMetadata?.artist) prompts.push(`- 艺术家: ${albumMetadata.artist}`);
    if (albumMetadata?.title) prompts.push(`- 作品: ${albumMetadata.title}`);
    if (albumMetadata?.release_date) prompts.push(`- 发行年份: ${albumMetadata.release_date}`);
    if (albumMetadata?.label) prompts.push(`- 厂牌: ${albumMetadata.label}`);
    if (albumMetadata?.genres?.length) prompts.push(`- 流派标签: ${albumMetadata.genres.join(", ")}`);
    if (agg?.genres?.length && !albumMetadata?.genres?.length) prompts.push(`- 流派: ${agg.genres.join(", ")}`);
    if (agg?.summary) {
      const summary = agg.summary.slice(0, 500);
      prompts.push(`- Wikipedia: ${summary}`);
    }
    if (agg?.reviewScores) {
      const rs = agg.reviewScores;
      const scoreInfo = [];
      if (rs.pitchfork) scoreInfo.push(`Pitchfork ${rs.pitchfork.score}/${rs.pitchfork.max}`);
      if (rs.metacritic) scoreInfo.push(`Metacritic ${rs.metacritic.score}/${rs.metacritic.max}`);
      if (scoreInfo.length) prompts.push(`- 专业评分: ${scoreInfo.join(", ")}`);
    }
    prompts.push("");
  }

  // ── 基础信息校准（多源共识，用于确认作品身份与时长）──
  const cal = researchData?.calibration;
  if (cal) {
    prompts.push("## 基础信息校准（多源共识）");
    if (cal.title) prompts.push(`- 歌名: ${cal.title.value}（${cal.title.count}/${cal.title.total} 源一致${cal.title.conflict ? "，存在冲突" : ""}）`);
    if (cal.artist) prompts.push(`- 艺人: ${cal.artist.value}（${cal.artist.count}/${cal.artist.total} 源一致${cal.artist.conflict ? "，存在冲突" : ""}）`);
    if (cal.album) prompts.push(`- 专辑: ${cal.album.value}（${cal.album.count}/${cal.album.total} 源一致${cal.album.conflict ? "，存在冲突" : ""}）`);
    if (cal.year) prompts.push(`- 年份: ${cal.year.value}`);
    if (cal.label) prompts.push(`- 厂牌: ${cal.label.value}`);
    if (cal.genre) prompts.push(`- 流派: ${cal.genre.value}`);
    if (cal.duration) prompts.push(`- 平台共识时长: ${cal.duration.value}s（${cal.duration.count}/${cal.duration.total} 源一致）`);
    if (cal.durationCheck && cal.durationCheck.local_seconds != null) {
      const dc = cal.durationCheck;
      const st = dc.match === true ? "一致" : dc.match === false ? "不一致（以平台共识为准）" : "无法对比";
      prompts.push(`- 时长校验: 本地 ${dc.local_seconds}s vs 平台 ${dc.recommended_seconds}s → ${st}`);
    }
    prompts.push("以上校准值用于确认歌曲/专辑身份；引用基础信息时优先采用共识值，若存在冲突需在 rationale 中说明所采用的版本。");
    prompts.push("");
  }

  // ── 平台评分参考（按单曲/专辑拆分，避免专辑分绑架单曲分）──
  if (platformRatings && Object.keys(platformRatings).length > 0) {
    const lineFor = (key) => {
      const p = platformRatings[key];
      if (p == null) return null;
      const scopeTag = p.scope === "song" ? "（单曲级）" : "（专辑级）";
      switch (key) {
        case "rym": {
          const pct = p.max ? Math.round(p.score / p.max * 100) : p.score;
          return `- **RYM (RateYourMusic)**: ${p.score}/${p.max || 5} (${pct}%) — 硬核乐迷社区评分，偏保守/严苛${scopeTag}`;
        }
        case "rym_album": {
          const pct = p.max ? Math.round(p.score / p.max * 100) : p.score;
          return `- **RYM 专辑 (RateYourMusic)**: ${p.score}/${p.max || 5} (${pct}%) — 硬核乐迷社区评分（专辑级）`;
        }
        case "rym_song": {
          const pct = p.max ? Math.round(p.score / p.max * 100) : p.score;
          return `- **RYM 单曲 (RateYourMusic)**: ${p.score}/${p.max || 5} (${pct}%) — 硬核乐迷社区评分（单曲级）`;
        }
        case "aoty": {
          const pct = p.max ? Math.round(p.score / p.max * 100) : p.score;
          return `- **AOTY (AlbumOfTheYear)**: ${p.score}/${p.max || 100} (${pct}%) — 聚合专业乐评机构评分${scopeTag}`;
        }
        case "aoty_album": {
          const pct = p.max ? Math.round(p.score / p.max * 100) : p.score;
          return `- **AOTY 专辑用户**: ${p.score}/${p.max || 100} (${pct}%) — 聚合专业乐评机构评分（专辑级）`;
        }
        case "aoty_song": {
          const pct = p.max ? Math.round(p.score / p.max * 100) : p.score;
          return `- **AOTY 单曲用户**: ${p.score}/${p.max || 100} (${pct}%) — 单曲级用户评分`;
        }
        case "pitchfork":
          return `- **Pitchfork**: ${p.score}/${p.max || 10} — 最具影响力的独立乐评机构${scopeTag}`;
        case "qq":
          return `- **QQ音乐**: ${p.score}/${p.max || 10} — 华语主流听众评分${scopeTag}`;
        case "spotify":
          return `- **Spotify 热度**: ${p.score}/${p.max || 100} — 流媒体热度参考${scopeTag}`;
        case "apple":
          return `- **Apple Music**: ${p.score}/${p.max || 100} — 流媒体热度参考${scopeTag}`;
        case "youtube":
          return `- **YouTube 播放**: ${formatNumber(p.score)} — 大众触达参考${scopeTag}`;
        case "netease":
          return `- **网易云音乐**: ${p.score}/${p.max || 10} — 华语独立/小众听众评分${scopeTag}`;
        case "wikipedia":
          return `- **Wikipedia乐评摘录**: ${p}`;
        default:
          return p && typeof p === "object" && p.score != null
            ? `- **${key}**: ${p.score}/${p.max || "?"}${scopeTag}`
            : null;
      }
    };
    const allKeys = Object.keys(platformRatings).filter(k => platformRatings[k] != null);
    const songKeys = allKeys.filter(k => platformRatings[k]?.scope === "song");
    const albumKeys = allKeys.filter(k => platformRatings[k]?.scope !== "song");
    const songLines = songKeys.map(lineFor).filter(Boolean);
    const albumLines = albumKeys.map(lineFor).filter(Boolean);

    if (isSongScope) {
      if (songLines.length) {
        prompts.push("## 单曲级评分参考（直接支撑）");
        prompts.push("以下数据直接反映这首单曲（而非整张专辑）：");
        prompts.push("");
        prompts.push(songLines.join("\n"));
        prompts.push("");
      }
      if (albumLines.length) {
        prompts.push("## 专辑级评分参考（背景支撑，不直接决定单曲得分）");
        prompts.push("以下评分针对整张专辑，只说明这张专辑的整体水准。单曲可以明显高于或低于专辑均值——");
        prompts.push("词/唱维度禁止用专辑分推断，曲/编/混也只能把专辑制作水准当作参考背景。");
        prompts.push("");
        prompts.push(albumLines.join("\n"));
        prompts.push("");
      }
      prompts.push("**校准规则（单曲赏析）**:");
      prompts.push("- 单曲级数据（单曲评分/评论/播放/热度）优先于专辑级评分；");
      prompts.push("- 专辑分是背景：好专辑里可以有平庸单曲，平庸专辑里也可以有惊艳单曲；");
      prompts.push("- 词/唱只依据歌词原文、人声证据与你的听感，禁止拿专辑分推断；");
      prompts.push("- 曲/编/混可参考专辑制作水准，但必须落到这首单曲的实际特征；");
      prompts.push("- 明显偏离专辑均值时，rationale 必须解释（如“这首是专辑里唯一……”“高分来自其他曲目”）；");
      prompts.push("- 华语平台偏好旋律和歌词，西方平台偏好编曲和创新性——文化差异不代表谁对谁错");
      prompts.push("");
    } else {
      prompts.push("## 各平台评分参考（校准锚点）");
      prompts.push("以下是真实世界的评分数据。你的评分应该与这些数据有合理的相关性——");
      prompts.push("可以有自己的判断（高出或低出1-3分），但不能完全无视共识。");
      prompts.push("");
      prompts.push([...songLines, ...albumLines].join("\n"));
      prompts.push("");
      prompts.push("**校准规则（专辑赏析）**:");
      prompts.push("- 各平台评分映射到20分制的大致对应关系：");
      prompts.push("  - RYM ≥4.0/5 → 编曲/制作维度通常在15-18分区间");
      prompts.push("  - RYM <3.0/5 → 整体评分应倾向中低分段（9-13分）");
      prompts.push("  - AOTY ≥80/100 → 这是一张公认的好专辑，五维总分不应低于70");
      prompts.push("  - Pitchfork ≥8.0/10 → 编曲和制作维度应偏高（15分以上）");
      prompts.push("  - 如果你的评分与平台共识偏离超过一个档次（如平台给高分你给低分），必须在rationale中解释原因");
      prompts.push("  - 华语平台（QQ/网易云）偏好旋律和歌词，西方平台（RYM/Pitchfork）偏好编曲和创新性——文化差异不代表谁对谁错");
      prompts.push("");
    }
  }

  // ── 热度数据（评分可信度的权重）──
  if (heatData && Object.keys(heatData).some(k => heatData[k] !== null && heatData[k] !== undefined)) {
    prompts.push("## 热度/影响力指标（国内 ★ / 国外 ●）");
    prompts.push(isSongScope
      ? "单曲级热度（听众/播放/单曲评论/YouTube）直接支撑这首单曲；专辑级热度（专辑评论/收藏/Discogs 拥有/RYM 人数）作为背景触达参考。热度只反映关注度，不等于质量。"
      : "以下数据反映这张专辑在大众和专业圈的影响力。热度越高，平台评分的共识越值得尊重；热度越低，你的个人判断权重越大——冷门好专可以有更大的评分弹性。");
    prompts.push("");

    const heatLines = [];
    if (heatData.lastfm_listeners) heatLines.push(`- Last.fm 听众: ${formatNumber(heatData.lastfm_listeners)}`);
    if (heatData.lastfm_playcount) heatLines.push(`- Last.fm 播放: ${formatNumber(heatData.lastfm_playcount)}`);
    if (heatData.discogs_have) heatLines.push(`- Discogs 拥有: ${formatNumber(heatData.discogs_have)}`);
    if (heatData.rym_rating_count) heatLines.push(`- RYM 评分人数: ${formatNumber(heatData.rym_rating_count)}`);
    if (heatData.aoty_review_count) heatLines.push(`- AOTY 乐评数: ${heatData.aoty_review_count}`);
    if (heatData.metacritic_review_count) heatLines.push(`- Metacritic 乐评数: ${heatData.metacritic_review_count}`);
    if (heatData.wikipedia_page_length_kb) heatLines.push(`- Wikipedia 条目长度: ${heatData.wikipedia_page_length_kb}KB（反映编辑关注度）`);
    if (heatData.billboard_peak) heatLines.push(`- Billboard 最高: #${heatData.billboard_peak} (${heatData.billboard_weeks || "?"}周)`);
    if (heatData.qq_music_comments) heatLines.push(`- QQ音乐 评论: ${formatNumber(heatData.qq_music_comments)}`);
    if (heatData.netease_comments) heatLines.push(`- 网易云 评论: ${formatNumber(heatData.netease_comments)}`);
    if (heatData.netease_album_comments) heatLines.push(`- 网易云 专辑评论: ${formatNumber(heatData.netease_album_comments)}`);
    if (heatData.netease_album_collections) heatLines.push(`- 网易云 专辑收藏: ${formatNumber(heatData.netease_album_collections)}`);
    if (heatData.netease_song_comments) heatLines.push(`- 网易云 单曲评论: ${formatNumber(heatData.netease_song_comments)}`);
    if (heatData.netease_song_album_comments) heatLines.push(`- 网易云 单曲所属专辑评论: ${formatNumber(heatData.netease_song_album_comments)}`);
    if (heatData.netease_song_album_collections) heatLines.push(`- 网易云 单曲所属专辑收藏: ${formatNumber(heatData.netease_song_album_collections)}`);
    if (heatData.spotify_popularity) heatLines.push(`- Spotify 热度: ${heatData.spotify_popularity}/100`);
    if (heatData.applemusic_rating) heatLines.push(`- Apple Music 热度: ${heatData.applemusic_rating}/100`);
    if (heatData.youtube_views) heatLines.push(`- YouTube 播放: ${formatNumber(heatData.youtube_views)}`);
    if (heatData.grammy_nominations || heatData.grammy_wins) heatLines.push(`- 格莱美: ${heatData.grammy_wins || 0}获奖 / ${heatData.grammy_nominations || 0}提名`);
    if (heatData.pitchfork_bnm) heatLines.push("- Pitchfork Best New Music ✓");

    if (heatLines.length === 0) {
      prompts.push("（无热度数据）");
    } else {
      prompts.push(heatLines.join("\n"));
    }

    // 热度等级：国内 ★ 与国外 ● 分开，避免“评论不过999却满星”
    const heatResult = calcHeatScore(heatData);
    prompts.push(`- 国内热度: ${heatResult.domestic.label} — ${heatResult.domestic.detail}`);
    prompts.push(`- 国外热度: ${heatResult.international.label} — ${heatResult.international.detail}`);
    prompts.push(`- 阈值标准: ${heatResult.legend}`);
    if (heatResult.stars > 0) {
      const levelHint = [
        "",
        "小众冷门 — 个人听觉判断权重大于共识",
        "有一定听众基础",
        "中等热度 — 可以参考但不必被共识限制",
        "比较热门 — 大众参与度高，评分可参考共识",
        "大众热门 — 广泛的听众/评论参与，偏离共识需强理由",
      ];
      prompts.push(`\n综合热度: ${heatResult.label} (${heatResult.stars}/5) — ${levelHint[heatResult.stars]}`);
    }
    prompts.push("");
  }

  // ── 用户定音约束（一锤定音）──
  if (finalWord && finalWord.scores) {
    prompts.push(buildFinalWordPromptSection(finalWord.scores));
    prompts.push("");
  }

  // ── 用户主观听感（最高优先级）──
  const hasNotes = !!(listeningAnswers && listeningAnswers.trim() && listeningAnswers !== "（未提供）");
  const hasLyrics = !!(lyrics && lyrics.trim());
  console.log(`   📝 歌词: ${hasLyrics ? (lyrics.trim().length + "字") : "无"} | 笔记: ${hasNotes ? "有" : "无"}`);

  if (hasNotes) {
    prompts.push("## ⚠️ 用户主观听感（这是你写 rationale 的核心依据）");
    prompts.push("以下是一位认真听了这首歌的人写下的真实感受。这些观察是事实，比音频数字更可靠。");
    prompts.push("每个维度的 rationale 必须从这个笔记出发——用户提到了什么，你就围绕它展开。");
    prompts.push("用户说没有的效果，你不能说有。用户说是比喻的，你不能当真实音效写。");
    prompts.push("");
    prompts.push(listeningAnswers);
    prompts.push("");
  }

  if (hasLyrics) {
    prompts.push("## 歌词原文（所有引用必须逐字匹配）");
    prompts.push("英文不翻译。找不到原句就不要引用。不要截断单词。");
    prompts.push("");
    prompts.push(lyrics);
    prompts.push("");
  }

  // ── 评分指令 ──
  prompts.push("## 评分");
  prompts.push("以用户的听感笔记为核心，结合音频特征和歌词，逐维度评分。每个 rationale 先回应用户笔记中相关的内容，再补充能从音频数据中合理推断的感受。");
  prompts.push("");
  prompts.push("输出 JSON：");
  prompts.push("");
  prompts.push("```json");
  prompts.push('{');
  prompts.push('  "词": {"score": 0, "rationale": "词作分析（150-220字，锚定具体词句和主题。无歌词纯器乐/电子填null）"},');
  prompts.push('  "曲": {"score": 0, "rationale": "旋律/和声/曲式（150-220字，基于音频特征描述节奏和调性气质）"},');
  prompts.push('  "编": {"score": 0, "rationale": "编曲/配器/层次/动态（150-220字，基于频谱和能量数据描述织体特征）"},');
  prompts.push('  "唱": {"score": 0, "rationale": "演唱/演奏表现（150-220字，描述声音特质）"},');
  prompts.push('  "混": {"score": 0, "rationale": "混音/制作/声音质感（150-220字，基于LUFS、动态幅度、立体声宽度等数据描述）"},');
  prompts.push('  "totalScore": 0,');
  prompts.push(`  "oneLiner": "${oneLinerLang === "en" ? "One-sentence verdict (max 100 chars, must be a complete sentence ending with a period, like a friend sharing the song, no hype)" : "一句话总评（中文歌曲用中文，不超过18个字，像发朋友圈，不要标题党）"}",`);
  prompts.push('  "tags": ["Indie Rock", "Post-Punk", "Dream Pop"],');
  prompts.push('  "calibration": "简述你的评分与平台共识的关系（一致/略高/略低/偏离，为什么）"');
  prompts.push("}");
  prompts.push("```");
  prompts.push("");
  prompts.push("## 评分标准");
  prompts.push("- 0-8分: 明显缺陷。9-13分: 合格但不出彩。14-17分: 优秀。18-20分: 大师级（极少使用）。");
  prompts.push("- 每个维度的分数必须有客观数据和听感支撑。不允许无理由的高分或低分。");
  prompts.push("- 如果用户没有提供某个维度的听感，从客观数据中推断，并标注[推断]。");
  prompts.push("- 总分 = 五个维度之和 (满分100)。");
  prompts.push("- 对于无歌词的纯器乐/电子音乐，词维度写null，总分满分为80。");
  prompts.push("- **不要编造你没有听到的信息。不确定就说\"未检出\"。**");
  prompts.push("");
  prompts.push("## 写作约束（严格执行）");
  prompts.push("rationale 要求:");
  prompts.push('- 分享你的真实感受，不是做技术报告。用「听起来」「感觉像」「让人想起」这类日常表达');
  prompts.push("- 基于歌词文本谈词作，基于BPM谈节奏感，基于频谱数据谈音色冷暖——这些是你真实拥有的信息");
  prompts.push("- 不要假装你听到了具体的乐器变化或演唱技巧——你没听到");
  prompts.push("- 禁止写具体鼓机/合成器型号（808/909 等）——音频算法无法可靠判断音源型号");
  prompts.push("- 用户笔记中提到的点，要在对应维度体现。用户否定的点，不要出现");
  prompts.push("- 每个维度写 150-220 字，真诚比专业重要，但必须句子连贯、不重复");
  prompts.push("- 语气：专业乐评口吻，克制、准确、有依据；避免“上头/绝了/拿捏/很顶/氛围感拉满/封神/yyds/天花板/杀疯了”等轻佻网络表达；可以感性，但不能轻浮");
  prompts.push("- 禁止写\"乐评里提到\"\"平台评分显示\"\"媒体评价\"\"评论区提到\"这类元描述——直接写内容本身");
  prompts.push("- 歌词引用必须完整成句、逐字匹配原文；记不全就不要引用，改为描述歌词主题；禁止半句截断或拼错单词");
  prompts.push("");
  prompts.push("oneLiner 要求:");
  prompts.push("- 12-18字，像发朋友圈分享听歌感受，自然不夸张");
  prompts.push("- 英文歌曲用英文写（最多100字符，必须是完整句子并以句号结尾，不半句截断），中文歌曲用中文写（12-18字）");
  prompts.push("- 好: \"126拍的自我审视，镜头关了就只剩自己\"");
  prompts.push("- 坏: \"一张充满激情与创新的优秀专辑\" ← 太空洞");
  prompts.push("");
  prompts.push("禁用句式（出现即严重扣分）:");
  prompts.push("- \"不是…而是…\" \"并非…而是…\" \"不是简单的…而是…\"");
  prompts.push("- \"既…又…\" \"不仅…更…\" \"在…中不失…\"");
  prompts.push("- \"xx式的\" 偏正短语套路——直接描述声音，不要套这个句式");
  prompts.push("- \"令人印象深刻\" \"值得一听\" \"展现了出色的\" \"完美融合\" \"恰到好处\"");
  prompts.push("- \"堪称\" \"无疑\" \"毫无悬念\" \"不可否认\" \"不得不说\"");
  prompts.push("- \"震撼\" \"惊艳\" \"极致\" \"无与伦比\" \"前所未有的\"");
  prompts.push("- \"你可以感受到\" \"仿佛置身于\" \"让人忍不住\" \"让人想起\"");
  prompts.push("- 禁止用单引号括起术语或歌词——用「」直角引号");
  prompts.push("- 禁止出现\"听者笔记\"\"听感记录\"\"用户提到\"等内部用语——你是写给读者看的");
  prompts.push("- \"张力\"限用一次");
  prompts.push("");
  prompts.push("## 标签规范");
  if (albumMetadata?.genres?.length) {
    prompts.push(`已知流派: ${albumMetadata.genres.join(", ")}`);
  }
  prompts.push("- 4-6个标签，兼顾流派和听感。如: \"Indie Rock\" \"内省\" \"温暖\" \"自毁美学\"");
  prompts.push("- 流派用英文，听感描述用最贴切的中文词");
  prompts.push("- 禁止直接引用歌名词汇（如歌名有\"Camera\"不能写\"镜头\"）和技术术语");

  return prompts.join("\n");
}

/**
 * 从研究数据中提取各平台评分，整理成 platformRatings 格式
 * @param {Object} researchData — /api/research 的返回数据
 * @returns {Object} platformRatings
 */
export function extractPlatformRatings(researchData) {
  if (!researchData) return null;

  const ratings = {};
  const agg = researchData.aggregate || {};

  // 优先Wikipedia实时提取的专业评分
  if (agg.reviewScores) {
    if (agg.reviewScores.pitchfork) ratings.pitchfork = agg.reviewScores.pitchfork;
    if (agg.reviewScores.metacritic) ratings.metacritic = agg.reviewScores.metacritic;
    if (agg.reviewScores.allmusic) ratings.allmusic = agg.reviewScores.allmusic;
    if (agg.reviewScores.rollingstone) ratings.rollingstone = agg.reviewScores.rollingstone;
    if (agg.reviewScores.nme) ratings.nme = agg.reviewScores.nme;
  }

  // RYM (DDG fallback — 可能不可用)
  if (researchData.rym?.rating) {
    ratings.rym = { score: researchData.rym.rating, max: 5 };
  } else if (agg.communityRating?.score) {
    ratings.rym = { score: agg.communityRating.score, max: agg.communityRating.max || 5 };
  }

  // AOTY (DDG fallback)
  if (researchData.aoty?.score) {
    ratings.aoty = { score: researchData.aoty.score, max: 100 };
  } else if (agg.professionalScore?.source?.includes("AOTY")) {
    ratings.aoty = { score: agg.professionalScore.score * 20, max: 100 };
  }

  // MusicBrainz 社区评分
  if (agg.communityRating?.source?.includes("MusicBrainz")) {
    ratings.musicbrainz = agg.communityRating;
  }

  return ratings;
}

/**
 * 完整分析流程
 * @param {string} audioPath
 * @param {string} listeningAnswers
 * @param {Object} albumMetadata
 * @returns {Promise<Object>} { audioFeatures, listeningGuide, scoringPrompt }
 */
export async function fullAnalysis(audioPath, listeningAnswers = "", albumMetadata = {}) {
  const audioFeatures = await extractAudioFeatures(audioPath);
  const listeningGuide = generateListeningGuide(audioFeatures);
  const scoringPrompt = buildScoringPrompt(audioFeatures, listeningAnswers, albumMetadata);

  return {
    audioFeatures,
    listeningGuide,
    scoringPrompt,
    ready: true,
  };
}

// ── 辅助: 格式化数字 ──
export function formatNumber(n) {
  if (n == null) return "?";
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}

// ── 热度星级 (1-5★) ──
// 主要参考网易云评论数: ≥999 → 4★+, ≥10000 → 5★
export function calcHeatScore(heat) {
  if (!heat) return { stars: 0, label: "无数据", sources: [] };
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  const pick = (...keys) => keys.map((k) => heat[k]).find((v) => isNum(v) && v > 0) || 0;

  const tierOf = (v, tiers) => {
    if (!isNum(v) || v <= 0) return 0;
    let s = 0;
    for (const t of tiers) if (v >= t.min) s = t.stars;
    return s;
  };
  const SONG_COMMENT_TIERS = [
    { min: 100, stars: 1 }, { min: 600, stars: 2 }, { min: 999, stars: 3 },
    { min: 5000, stars: 4 }, { min: 20000, stars: 5 },
  ];
  const ALBUM_COMMENT_TIERS = [
    { min: 10, stars: 1 }, { min: 99, stars: 2 }, { min: 999, stars: 3 },
    { min: 1800, stars: 4 }, { min: 3800, stars: 5 },
  ];
  const ALBUM_COLLECT_TIERS = [
    { min: 500, stars: 1 }, { min: 1000, stars: 2 }, { min: 9800, stars: 3 },
    { min: 18000, stars: 4 }, { min: 48000, stars: 5 },
  ];
  // ── 国内热度（★）：单曲/专辑分开，评论/收藏取更高者，QQ/网易云取更高平台 ──
  const neAlbumComments = pick("netease_album_comments", "netease_comments");
  const neSongComments = pick("netease_song_comments");
  const qqComments = pick("qq_music_comments");
  const songComments = Math.max(neSongComments, qqComments); // QQ/网易云取更高平台
  const albumComments = neAlbumComments;
  const albumCollect = pick("netease_album_collections");
  const nePlaycount = pick("netease_playcount");

  const domSources = [];
  if (neSongComments) domSources.push(`网易云单曲评论 ${formatNumber(neSongComments)}`);
  if (qqComments) domSources.push(`QQ评论 ${formatNumber(qqComments)}`);
  if (albumComments) domSources.push(`网易云专辑评论 ${formatNumber(albumComments)}`);
  if (albumCollect) domSources.push(`网易云专辑收藏 ${formatNumber(albumCollect)}`);
  if (nePlaycount) domSources.push(`网易云热度 ${nePlaycount}/100`);

  const playStars = nePlaycount >= 95 ? 5 : nePlaycount >= 85 ? 3 : nePlaycount >= 70 ? 2 : nePlaycount >= 55 ? 1 : 0;
  const domSignals = [];
  if (songComments) domSignals.push({ label: (qqComments > neSongComments ? "QQ单曲评论" : "NC单曲评论"), stars: tierOf(songComments, SONG_COMMENT_TIERS), value: songComments });
  if (albumComments) domSignals.push({ label: "NC专辑评论", stars: tierOf(albumComments, ALBUM_COMMENT_TIERS), value: albumComments });
  if (albumCollect) domSignals.push({ label: "NC专辑收藏", stars: tierOf(albumCollect, ALBUM_COLLECT_TIERS), value: albumCollect });
  if (nePlaycount) domSignals.push({ label: "NC热度", stars: playStars, value: nePlaycount });
  const top2 = domSignals.sort((a, b) => b.stars - a.stars || b.value - a.value).slice(0, 2);
  const domDetail = top2.map((x) => `${x.label} ${x.value.toLocaleString()}`).join("；") || "No domestic heat data";

  const domStars = Math.max(
    tierOf(songComments, SONG_COMMENT_TIERS),
    tierOf(albumComments, ALBUM_COMMENT_TIERS),
    tierOf(albumCollect, ALBUM_COLLECT_TIERS),
    playStars
  );
  const domLabel = ["", "★☆☆☆☆", "★★☆☆☆", "★★★☆☆", "★★★★☆", "★★★★★"][domStars] || "☆☆☆☆☆";

  // ── 国外热度（●）：Last.fm / YouTube / Discogs / RYM / Genius / Google Trends / Chartmetric ──
  const listeners = pick("lastfm_listeners");
  const youtube = pick("youtube_views");
  const discogsHave = pick("discogs_have");
  const discogsWant = pick("discogs_want");
  const discogs = discogsHave + discogsWant;
  const rymCount = pick("rym_rating_count");
  const geniusViews = pick("genius_pageviews");

  const intlSources = [];
  if (listeners) intlSources.push(`Last.fm ${formatNumber(listeners)}`);
  if (youtube) intlSources.push(`YouTube ${formatNumber(youtube)}`);
  if (discogs) intlSources.push(`Discogs ${formatNumber(discogs)}${discogsHave && discogsWant ? `（want/have=${(discogsWant / discogsHave).toFixed(2)}）` : ""}`);
  if (rymCount) intlSources.push(`RYM ${formatNumber(rymCount)}`);
  if (geniusViews) intlSources.push(`Genius ${formatNumber(geniusViews)}`);

  let discogsStars = tierOf(discogs, [
    { min: 200, stars: 1 }, { min: 1000, stars: 2 }, { min: 3000, stars: 3 },
    { min: 15000, stars: 4 }, { min: 50000, stars: 5 },
  ]);
  // Discogs Demand Index：want/have ≥ 0.6 表示供不应求，热度 +1（封顶 5）
  if (discogsHave > 0 && discogsWant / discogsHave >= 0.6) discogsStars = Math.min(5, discogsStars + 1);

  const intlStars = Math.max(
    tierOf(listeners, [
      { min: 10000, stars: 1 }, { min: 50000, stars: 2 }, { min: 80000, stars: 3 },
      { min: 300000, stars: 4 }, { min: 1000000, stars: 5 },
    ]),
    tierOf(youtube, [
      { min: 100000, stars: 1 }, { min: 300000, stars: 2 }, { min: 1000000, stars: 3 },
      { min: 10000000, stars: 4 }, { min: 100000000, stars: 5 },
    ]),
    discogsStars,
    tierOf(rymCount, [
      { min: 100, stars: 1 }, { min: 500, stars: 2 }, { min: 1500, stars: 3 },
      { min: 5000, stars: 4 }, { min: 20000, stars: 5 },
    ]),
    tierOf(geniusViews, [
      { min: 10000, stars: 1 }, { min: 50000, stars: 2 }, { min: 200000, stars: 3 },
      { min: 1000000, stars: 4 }, { min: 5000000, stars: 5 },
    ])
  );
  const intlLabel = ["", "●○○○○", "●●○○○", "●●●○○", "●●●●○", "●●●●●"][intlStars] || "○○○○○";
  const intlDetail = intlSources.join("；") || "No overseas heat data";

  if (!domSources.length && !intlSources.length) {
    return {
      stars: 0, label: "无数据", sources: [],
      domestic: { stars: 0, label: "☆☆☆☆☆", sources: [], detail: domDetail },
      international: { stars: 0, label: "○○○○○", sources: [], detail: intlDetail },
      legend: "国内★: 单曲评论100/600/999/5千/2万；专辑评论10/99/999/1800/3800；专辑收藏500/1千/9800/1.8万/4.8万；热度分55/70/85/95。评论/收藏取更高者，QQ与网易云取更高平台。国外●: 听众1万/5万/8万/30万/100万；播放10万/30万/100万/1000万/1亿；Discogs 200/1千/3千/1.5万/5万（want/have≥0.6 +1）；RYM 100/500/1500/5千/2万；Genius 1万/5万/20万/100万/500万。",
    };
  }

  const overallStars = Math.max(domStars, intlStars);
  const overallLabel = domStars >= intlStars ? domLabel : intlLabel;
  return {
    stars: overallStars,
    label: overallLabel,
    sources: [...domSources, ...intlSources],
    domestic: { stars: domStars, label: domLabel, sources: domSources, detail: domDetail },
    international: { stars: intlStars, label: intlLabel, sources: intlSources, detail: intlDetail },
    legend: "国内★: 单曲评论100/600/999/5千/2万；专辑评论10/99/999/1800/3800；专辑收藏500/1千/9800/1.8万/4.8万；热度分55/70/85/95。评论/收藏取更高者，QQ与网易云取更高平台。国外●: 听众1万/5万/8万/30万/100万；播放10万/30万/100万/1000万/1亿；Discogs 200/1千/3千/1.5万/5万（want/have≥0.6 +1）；RYM 100/500/1500/5千/2万；Genius 1万/5万/20万/100万/500万。",
  };
}

// ═══════════════════════════════════════════════════
// [新增 v3.2] 多源交叉验证 — BPM & Key
// ═══════════════════════════════════════════════════

/**
 * KEY_NAME 标准化: 统一 enharmonic 拼写
 * C#→Db, D#→Eb, F#→Gb, G#→Ab, A#→Bb
 */
const KEY_ALIASES = {
  "C#": "Db", "Db": "Db",
  "D#": "Eb", "Eb": "Eb",
  "F#": "Gb", "Gb": "Gb",
  "G#": "Ab", "Ab": "Ab",
  "A#": "Bb", "Bb": "Bb",
};
const VALID_KEYS = ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"];

/**
 * 和弦紧凑标注: "A minor, D minor, E minor" → "Am-Dm-Em"
 * 规则: 大调只写字母，小调加 m；保留升降号（C#m / Bbm）。
 */
export function formatChordSequence(seq) {
  if (!seq) return null;
  const parts = String(seq)
    .split(/[,，、/]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((chord) => chord
      .replace(/♭/g, "b")
      .replace(/♯/g, "#")
      .replace(/\s*(major|maj)\b/gi, "")
      .replace(/\s*(minor|min)\b/gi, "m")
      .replace(/\s+/g, ""))
    .filter(Boolean);
  return parts.length ? parts.join("-") : null;
}

const CHORD_PITCH = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
const SCALE_DEGREES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
const ROMAN = ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ", "Ⅶ"];

function chordRoman(chord, keyName) {
  const key = normalizeKeyName(keyName);
  if (!key) return null;
  const m = String(chord || "").match(/^([A-G][#b]?)(m|min|maj|dim|aug|sus[0-9]?|7|maj7|m7)?$/i);
  if (!m) return null;
  let root = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  root = KEY_ALIASES[root] || root;
  const rootPitch = CHORD_PITCH[root];
  if (rootPitch === undefined) return null;
  const keyPitch = CHORD_PITCH[key.key];
  const degrees = SCALE_DEGREES[key.mode];
  const idx = degrees.indexOf((rootPitch - keyPitch + 12) % 12);
  if (idx < 0) return null;
  return ROMAN[idx];
}

/**
 * 和弦进行 → 罗马数字（相对给定调性）。用于“本地与网源调式级数相同、
 * 只是整体移调”的场景，如 C-G-Am-F(C大调) 与 G-D-Em-C(G大调) 同为 Ⅰ-Ⅴ-Ⅵ-Ⅳ。
 */
export function formatChordSequenceRoman(seq, keyName) {
  if (!seq || !keyName) return null;
  const parts = String(seq).split("-").filter(Boolean);
  const romans = parts.map((c) => chordRoman(c, keyName));
  return romans.every(Boolean) ? romans.join("-") : null;
}

function normalizeKeyName(raw) {
  if (!raw || typeof raw !== "string") return null;
  // 提取调名和调式: "C major" / "C minor" / "Cm" / "C#m"
  const cleaned = raw.trim();
  // 处理 "C major" / "C minor" 格式
  const fullMatch = cleaned.match(/^([A-G][#b]?)\s*(major|minor|maj|min|m)?$/i);
  if (fullMatch) {
    let key = fullMatch[1];
    key = key.charAt(0).toUpperCase() + key.slice(1).toLowerCase();
    key = KEY_ALIASES[key] || key;
    let mode = (fullMatch[2] || "").toLowerCase();
    if (mode === "maj") mode = "major";
    if (mode === "min" || mode === "m") mode = "minor";
    if (!mode) mode = "major"; // 默认大调
    return { key, mode };
  }
  return null;
}

function keysMatch(k1, k2) {
  if (!k1 || !k2) return false;
  return k1.key === k2.key && k1.mode === k2.mode;
}

function bpmClose(b1, b2, tolerance = 2) {
  if (b1 == null || b2 == null) return false;
  return Math.abs(Number(b1) - Number(b2)) <= tolerance;
}

function sourcePriority(source) {
  const priority = {
    hooktheory: 1,
    songbpm: 2,
    spotify: 3,
    acousticbrainz: 4,
    local: 99,
  };
  return priority[source] || 50;
}

/**
 * 多源交叉验证 BPM & Key
 * @param {Object} localResult - Python 分析结果
 * @param {Array<{source: string, bpm: number, key: string, confidence?: number}>} externalSources
 * @returns {Object} 验证后的结果
 */
export function crossReference(localResult, externalSources = []) {
  const ref = {
    sources: ["local"],
    bpm_values: { local: localResult.bpm },
    key_values: { local: localResult.key },
    consensus: "pending",
    bpm_consensus: null,
    key_consensus: null,
    confidence_level: "medium",
    notes: [],
  };

  if (!externalSources.length) {
    ref.consensus = "single_source";
    ref.confidence_level = "medium";
    ref.notes.push("仅有本地分析结果，未进行多源交叉验证");
    return ref;
  }

  const localBpm = localResult.bpm;

  // 汇总 BPM
  const bpmVotes = [{ source: "local", bpm: localBpm }];
  for (const src of externalSources) {
    if (src.bpm != null) {
      bpmVotes.push({ source: src.source, bpm: Number(src.bpm) });
      ref.bpm_values[src.source] = Number(src.bpm);
    }
  }

  // 汇总 Key
  const keyVotes = [];
  if (localResult.key) {
    const nk = normalizeKeyName(localResult.key);
    if (nk) keyVotes.push({ source: "local", ...nk });
    ref.key_values.local = localResult.key;
  }
  for (const src of externalSources) {
    if (src.key) {
      const nk = normalizeKeyName(src.key);
      if (nk) keyVotes.push({ source: src.source, ...nk });
      ref.key_values[src.source] = src.key;
    }
  }
  ref.sources = [...new Set(["local", ...externalSources.map(s => s.source)])];

  // BPM 共识: 取多数一致 (误差≤2)
  if (bpmVotes.length >= 2) {
    const bpmGroups = clusterBPM(bpmVotes);
    bpmGroups.sort((a, b) =>
      (b.count - a.count) ||
      (b.externalCount - a.externalCount) ||
      (a.priority - b.priority)
    );
    if (bpmGroups[0].count >= 2 || bpmGroups[0].externalCount >= 1) {
      ref.bpm_consensus = roundTo(bpmGroups[0].avgBpm, 1);
    }
    ref.bpm_clusters = bpmGroups;

    // ── BPM 偏差 & 倍拍检查 ──
    if (localBpm != null) {
      for (const ext of externalSources) {
        if (ext.bpm == null) continue;
        const extBpm = Number(ext.bpm);
        const ratio = localBpm / extBpm;
        const pctDiff = Math.abs(localBpm - extBpm) / extBpm;

        // 倍拍: 0.5x 或 2.0x (误差<10%)
        if (ratio > 0.45 && ratio < 0.55) {
          ref.bpm_octave_note = `本地 BPM (${localBpm}) ≈ ½ × ${ext.source} (${extBpm})`;
          ref.bpm_octave_risk = true;
        } else if (ratio > 1.9 && ratio < 2.1) {
          ref.bpm_octave_note = `本地 BPM (${localBpm}) ≈ 2× ${ext.source} (${extBpm})`;
          ref.bpm_octave_risk = true;
        } else if (pctDiff > 0.05 && pctDiff < 0.40 && !bpmClose(localBpm, extBpm, 2)) {
          // 非倍拍但偏差>5%→librosa典型偏移 (如117.5 vs 126)
          ref.bpm_deviation = true;
          ref.bpm_deviation_note = `本地 BPM (${localBpm}) 与 ${ext.source} (${extBpm}) 偏差 ${(pctDiff*100).toFixed(0)}%，librosa 节拍检测偏移`;
          ref.notes.push(ref.bpm_deviation_note);
        }
        if (ref.bpm_octave_risk || ref.bpm_deviation) break;
      }
    }
    if (!ref.bpm_octave_risk) ref.bpm_octave_risk = false;
    if (!ref.bpm_deviation) ref.bpm_deviation = false;
  }

  // 无外部源时，仍检查本地 BPM 3 候选 (octave risk from local only)
  if (!externalSources.length && localResult.bpm_candidates) {
    const c = localResult.bpm_candidates;
    const main = localResult.bpm;
    const mainConf = localResult.bpm_confidence || 0;
    if (c.half_confidence > mainConf * 0.8) {
      ref.bpm_octave_risk = true;
      ref.bpm_octave_note = `本地自检: BPM ${main} 存在倍拍歧义 (½=${c.half} conf=${c.half_confidence}%)`;
      ref.notes.push(ref.bpm_octave_note);
    }
    if (c.double_confidence > mainConf * 0.8) {
      ref.bpm_octave_risk = true;
      ref.bpm_octave_note = `本地自检: BPM ${main} 存在倍拍歧义 (×2=${c.double} conf=${c.double_confidence}%)`;
      ref.notes.push(ref.bpm_octave_note);
    }
  }

  // ── 分歧过大 (>8 BPM) 标记，不输出单一共识 ──
  if (bpmVotes.length >= 2) {
    const values = bpmVotes.map(v => v.bpm).filter(v => v != null);
    const spread = Math.max(...values) - Math.min(...values);
    if (spread > 8) {
      ref.cross_ref_disagreement = true;
      ref.notes.push(`BPM 源分歧 ${spread.toFixed(1)} BPM，保留各源原始数据并优先采用网络 MIR 源`);
    }
  }

  // 加权规则透明化
  ref._weighting = {
    rule: "网络 MIR 源优先；同票时 Hooktheory/SongBPM/Spotify/AcousticBrainz 优先于本地 MP3 分析",
    local: "fallback",
    external_per_source: "primary",
    disagreement_threshold_bpm: 8,
  };

  // Key 共识: 取完全一致
  const localKeyNorm = localResult.key ? normalizeKeyName(localResult.key) : null;
  if (keyVotes.length >= 2) {
    const keyGroups = clusterKeys(keyVotes);
    keyGroups.sort((a, b) =>
      (b.count - a.count) ||
      (b.externalCount - a.externalCount) ||
      (a.priority - b.priority)
    );
    if (keyGroups[0].count >= 2 || keyGroups[0].externalCount >= 1) {
      ref.key_consensus = `${keyGroups[0].key} ${keyGroups[0].mode}`;
    }
    ref.key_clusters = keyGroups;
  }

  // ── local_disagreement: 本地与外部源集群分歧 ──
  // 场景: 本地算法高置信但算错，外部源共识指向不同答案
  ref.local_disagreement = { bpm: false, key: false };

  // BPM 分歧: 外部 BPM 投票最多的组 ≠ 本地
  if (ref.bpm_clusters && ref.bpm_clusters.length >= 2 && localBpm != null) {
    const topGroup = ref.bpm_clusters[0];
    const localInTop = topGroup.members.includes("local");
    if (!localInTop) {
      ref.local_disagreement.bpm = true;
      ref.notes.push(`本地 BPM (${localBpm}) 与外部多数源 (${topGroup.members.join(", ")}) 不一致，推荐 ${roundTo(topGroup.avgBpm, 1)}`);
      // 覆盖共识为外部多数
      if (!ref.bpm_consensus) ref.bpm_consensus = roundTo(topGroup.avgBpm, 1);
    }
  }

  // Key 分歧: 检查第二候选是否匹配外部源
  if (ref.key_clusters && ref.key_clusters.length >= 2 && localKeyNorm) {
    const topKeyGroup = ref.key_clusters[0];
    const localInTopKey = topKeyGroup.members.includes("local");
    const secondCandidate = localResult.key_second_candidate?.key_full
      ? normalizeKeyName(localResult.key_second_candidate.key_full)
      : null;

    if (!localInTopKey) {
      ref.local_disagreement.key = true;
      ref.notes.push(`本地 Key (${localResult.key}) 与外部多数源不一致，推荐 ${ref.key_consensus || topKeyGroup.key + " " + topKeyGroup.mode}`);
      if (!ref.key_consensus) ref.key_consensus = `${topKeyGroup.key} ${topKeyGroup.mode}`;
    }

    // 第二候选匹配检查: 本地第二候选是否等于外部共识
    if (secondCandidate && topKeyGroup.members.includes("local") && topKeyGroup.count >= 2) {
      // 外部和本地一致 → 正常
    } else if (secondCandidate && !localInTopKey && ref.key_consensus) {
      const extNorm = normalizeKeyName(ref.key_consensus);
      if (extNorm && keysMatch(secondCandidate, extNorm)) {
        ref.notes.push(`本地第二候选 (${localResult.key_second_candidate.key_full}) 匹配外部共识，建议采信`);
        ref.key_second_matches_external = true;
      }
    }
  }

  // Key 歧义: 无论置信高低，第一/第二候选相关系数接近 → 标记
  if (localResult.key_ambiguity) {
    ref.key_ambiguity = true;
    ref.notes.push("K-S 第一/第二候选相关系数接近，调性判定不可靠，请参考外部交叉验证");
  }

  // ── 置信度判定 ──
  const bpmConsistent = ref.bpm_consensus != null && !ref.local_disagreement.bpm;
  const keyConsistent = ref.key_consensus != null && !ref.local_disagreement.key;
  const externalOverride = (ref.local_disagreement.bpm && ref.bpm_consensus != null) ||
                           (ref.local_disagreement.key && ref.key_consensus != null);

  if (externalOverride) {
    ref.confidence_level = "medium";
    ref.consensus = "local_diverged";
    ref.notes.push("本地 MP3 分析与网络 MIR 源分歧，按网络源校准 (0.5~0.8)");
  } else if (bpmConsistent && keyConsistent) {
    ref.confidence_level = "high";
    ref.consensus = "multi_source_agree";
    ref.notes.push("多源一致，置信度高 (0.7~1.0)");
  } else if (bpmConsistent || keyConsistent) {
    ref.confidence_level = "medium";
    ref.consensus = "partial_agree";
    if (ref.local_disagreement.bpm || ref.local_disagreement.key) {
      ref.consensus = "local_diverged";
      ref.notes.push("本地算法与外部源存在分歧，建议采信外部多数 (0.5~0.8)");
    } else {
      ref.notes.push("部分一致，存在分歧但主候选明确 (0.4~0.7)");
    }
  } else if (Object.keys(ref.key_values).length <= 1) {
    ref.confidence_level = "low";
    ref.consensus = "single_source";
    ref.notes.push("仅有本地分析结果，未进行多源交叉验证");
  } else {
    ref.confidence_level = "low";
    ref.consensus = "conflict";
    ref.notes.push("多源互相冲突，无共识 (<0.4)，请人工校验");
  }

  return ref;
}

function clusterBPM(votes) {
  const used = new Set();
  const groups = [];
  for (const v of votes) {
    if (used.has(v.source)) continue;
    const group = [v];
    used.add(v.source);
    for (const w of votes) {
      if (used.has(w.source)) continue;
      if (bpmClose(v.bpm, w.bpm)) {
        group.push(w);
        used.add(w.source);
      }
    }
    groups.push({
      count: group.length,
      avgBpm: group.reduce((s, x) => s + x.bpm, 0) / group.length,
      members: group.map(g => g.source),
      externalCount: group.filter(g => g.source !== "local").length,
      priority: Math.min(...group.map(g => sourcePriority(g.source))),
    });
  }
  return groups;
}

function clusterKeys(votes) {
  const used = new Set();
  const groups = [];
  for (const v of votes) {
    if (used.has(v.source)) continue;
    const group = [v];
    used.add(v.source);
    for (const w of votes) {
      if (used.has(w.source)) continue;
      if (keysMatch(v, w)) {
        group.push(w);
        used.add(w.source);
      }
    }
    groups.push({
      count: group.length,
      key: group[0].key,
      mode: group[0].mode,
      members: group.map(g => g.source),
      externalCount: group.filter(g => g.source !== "local").length,
      priority: Math.min(...group.map(g => sourcePriority(g.source))),
    });
  }
  return groups;
}

function roundTo(n, decimals) {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

/**
 * 吉他谱反算: 实际调 = 选调 + 变调夹半音数
 * @param {string} tabKey - 吉他谱标注的"选调"
 * @param {number} capoFrets - 变调夹品数 (默认0)
 * @returns {string|null} 反推的实际录音调
 */
export function reverseKeyFromTab(tabKey, capoFrets = 0) {
  if (!tabKey) return null;
  const nk = normalizeKeyName(tabKey);
  if (!nk) return null;

  const semitones = ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"];
  const idx = semitones.indexOf(nk.key);
  if (idx < 0) return null;

  const actualIdx = (idx + capoFrets) % 12;
  return `${semitones[actualIdx]} ${nk.mode}`;
}

/**
 * 生成调性模糊标记
 */
export function assessKeyReliability(localResult, crossRefResult) {
  // 失真摇滚/无调性/转调频繁的判断信号
  const signals = [];
  const spectral = localResult.spectral || {};
  const dynamics = localResult.dynamics || {};

  // 高平坦度 → 噪音感强 → 调性检测不可靠
  if (spectral.flatness_mean && spectral.flatness_mean > 0.25) {
    signals.push("频谱平坦度高，噪音成分显著");
  }
  // 高失真信号 (高压缩 + 高响度)
  if (dynamics.integrated_lufs && dynamics.integrated_lufs > -8 && dynamics.crest_factor && dynamics.crest_factor < 6) {
    signals.push("高压缩响度 + 低峰值因数，疑似失真/硬派处理");
  }
  // BPM 置信度低
  if (localResult.bpm_confidence && localResult.bpm_confidence < 40) {
    signals.push("BPM置信度低，节奏不规则");
  }
  // Key 置信度低
  if (localResult.key_confidence && localResult.key_confidence < 40) {
    signals.push("调性置信度低，可能频繁转调或无调性");
  }

  if (signals.length >= 2) {
    return { fuzzy: true, reason: signals.join("; "), label: "调性模糊" };
  }
  return { fuzzy: false, reason: null, label: null };
}

// ═══════════════════════════════════════════════════
// [新增 v3.2] 专辑模式 — 卡片数据构建
// ═══════════════════════════════════════════════════

/**
 * 基于已有单曲解析数据，构建专辑评分卡
 * @param {Object} albumMeta - { artist, title, year, label, genre }
 * @param {Array<Object>} tracks - 单曲卡片完整数据数组
 * @param {Array<string>} hitTracks - 热门单曲名称列表 (用于封面tag展示)
 * @returns {Object} 专辑卡片数据
 */
export function buildAlbumCardData(albumMeta, tracks, hitTracks = []) {
  // 聚合各维度评分 (取加权平均: 每首等权)
  const dims = ["词", "曲", "编", "唱", "混"];
  const dimScores = {};
  const allTags = [];
  const allRationales = {};

  for (const dim of dims) {
    dimScores[dim] = [];
    allRationales[dim] = [];
  }

  let totalScore = 0;
  let trackCount = 0;

  for (const track of tracks) {
    const scores = track.scores || {};
    if (!scores.totalScore && !scores["曲"]) continue; // 无效数据跳过

    trackCount++;
    for (const dim of dims) {
      if (scores[dim]?.score != null) {
        dimScores[dim].push(scores[dim].score);
        if (scores[dim].rationale) {
          allRationales[dim].push(`[${track.title || "?"}]: ${scores[dim].rationale}`);
        }
      }
    }
    if (scores.totalScore) totalScore += scores.totalScore;
    if (Array.isArray(scores.tags)) {
      allTags.push(...scores.tags);
    }
  }

  // 计算平均
  const avgScores = {};
  for (const dim of dims) {
    const vals = dimScores[dim];
    avgScores[dim] = vals.length > 0
      ? { score: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) }
      : null;
  }

  // 合成 rationale (取各轨代表性片段)
  for (const dim of dims) {
    if (avgScores[dim] && allRationales[dim].length > 0) {
      // 取每轨第一句，最多合并3轨
      const excerpts = allRationales[dim].slice(0, 3).map(r => r.split("。")[0] + "。");
      avgScores[dim].rationale = excerpts.join(" ");
    }
  }

  const avgTotal = trackCount > 0 ? Math.round(totalScore / trackCount) : 0;

  // 标签: 聚合高频标签 + 替换为热门单曲
  const tagFreq = {};
  for (const t of allTags) {
    tagFreq[t] = (tagFreq[t] || 0) + 1;
  }
  const sortedTags = Object.entries(tagFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([t]) => t);

  return {
    mode: "album",
    artist: albumMeta.artist || "",
    title: albumMeta.title || "",
    year: albumMeta.year || "",
    label: albumMeta.label || "",
    genre: albumMeta.genre || "",
    hitTracks: hitTracks.slice(0, 6),
    trackCount,
    scores: {
      ...avgScores,
      totalScore: avgTotal,
      oneLiner: `${albumMeta.title || "这张专辑"} · ${trackCount}轨`,
      tags: sortedTags,
      calibration: `基于${trackCount}首单曲解析数据聚合`,
    },
    _albumTracks: tracks.map(t => ({
      title: t.title || t.audioFeatures?.filename || "",
      artist: t.artist || "",
      scores: t.scores || {},
    })),
  };
}

export default {
  extractAudioFeatures,
  generateListeningGuide,
  buildScoringPrompt,
  fullAnalysis,
  calcHeatScore,
  crossReference,
  reverseKeyFromTab,
  assessKeyReliability,
  buildAlbumCardData,
};
