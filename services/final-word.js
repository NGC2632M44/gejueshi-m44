// 一锤定音：用户填写五维分数后，AI 评分必须满足
// 1) 总分在用户总分 ±4 内；2) 五维大小排序与用户一致（并列允许 ≥）。
export const FINAL_DIMS = ["词", "曲", "编", "唱", "混"];

export function parseFinalScores(userScores) {
  const out = {};
  let ok = true;
  for (const d of FINAL_DIMS) {
    const v = Number(userScores && userScores[d]);
    if (Number.isFinite(v) && v >= 0 && v <= 20) out[d] = Math.round(v);
    else ok = false;
  }
  return ok ? out : null;
}

export function finalTotal(userScores) {
  return FINAL_DIMS.reduce((s, d) => s + (Number(userScores && userScores[d]) || 0), 0);
}

export function finalRankingText(userScores) {
  const idx = (d) => FINAL_DIMS.indexOf(d);
  const order = FINAL_DIMS.slice().sort((a, b) => ((Number(userScores[b]) || 0) - (Number(userScores[a]) || 0)) || (idx(b) - idx(a)));
  let text = order[0];
  for (let i = 0; i < order.length - 1; i++) {
    const a = order[i];
    const b = order[i + 1];
    text += (Number(userScores[a]) || 0) > (Number(userScores[b]) || 0) ? ">" : "≥";
    text += b;
  }
  return text;
}

export function buildFinalWordPromptSection(userScores) {
  const total = finalTotal(userScores);
  const min = Math.max(0, total - 4);
  const max = Math.min(100, total + 4);
  const lines = [
    "## 用户定音约束（硬性要求，违反即重做）",
    `- 总分必须落在 [${min}, ${max}] 区间（用户基准 ${total}）`,
    `- 五维排序必须满足：${finalRankingText(userScores)}`,
    `- 用户基准分：${FINAL_DIMS.map((d) => `${d}=${Number(userScores[d]) || 0}`).join("，")}`,
    "- 各维度尽量贴近用户基准（±3 内），但排序与总分范围是硬约束；",
    "- 输出的 score 必须是 0-20 整数；rationale 仍按专业乐评口吻书写。",
  ];
  return lines.join("\n");
}

export function checkFinalWord(scores, userScores) {
  if (!scores || !userScores) return "缺少评分数据";
  const total = FINAL_DIMS.reduce((s, d) => s + (Number(scores[d] && scores[d].score) || 0), 0);
  const userTotal = finalTotal(userScores);
  const min = Math.max(0, userTotal - 4);
  const max = Math.min(100, userTotal + 4);
  if (total < min || total > max) {
    return `总分 ${total} 不在 [${min}, ${max}] 区间`;
  }
  const idx = (d) => FINAL_DIMS.indexOf(d);
  const order = FINAL_DIMS.slice().sort((a, b) => ((Number(userScores[b]) || 0) - (Number(userScores[a]) || 0)) || (idx(b) - idx(a)));
  for (let i = 0; i < order.length - 1; i++) {
    const hi = order[i];
    const lo = order[i + 1];
    const a = Number(scores[hi] && scores[hi].score);
    const b = Number(scores[lo] && scores[lo].score);
    if ((Number(userScores[hi]) || 0) > (Number(userScores[lo]) || 0)) {
      if (!(a > b)) return `${hi}(${a}) 必须大于 ${lo}(${b})`;
    } else {
      if (!(a >= b)) return `${hi}(${a}) 必须不小于 ${lo}(${b})`;
    }
  }
  return null;
}

export default { parseFinalScores, finalTotal, finalRankingText, buildFinalWordPromptSection, checkFinalWord, FINAL_DIMS };
