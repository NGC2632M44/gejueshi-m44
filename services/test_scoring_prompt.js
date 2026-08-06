import assert from "node:assert/strict";
import { test } from "node:test";

import { buildScoringPrompt } from "./audio-analyzer.js";
import { calcHeatScore } from "./audio-analyzer.js";


test("scoring prompt includes the five-dimension evidence pack when present", () => {
  const af = {
    bpm: 126,
    key: "B major",
    evidence: {
      混音: { integrated_lufs: -8.9, true_peak_dbtp: -0.2 },
      作曲: { bpm: 126, key: "B major" },
    },
  };
  const prompt = buildScoringPrompt(af, "", {}, null, null, "", null);
  assert.match(prompt, /五维证据包/);
  assert.match(prompt, /integrated_lufs/);
  assert.match(prompt, /证据不足/);
});


test("scoring prompt still builds without an evidence pack", () => {
  const prompt = buildScoringPrompt({ bpm: 100, key: "C major" }, "", {}, null, null, "", null);
  assert.match(prompt, /五维评分/);
  assert.match(prompt, /BPM/);
});


test("calcHeatScore uses album/song comments and collections", () => {
  const h = calcHeatScore({ netease_album_comments: 1200, netease_album_collections: 5000 });
  assert.equal(h.stars, 4);
  assert.ok(h.sources.some((s) => s.includes("网易云专辑评论 1.2K")));
  assert.ok(h.sources.some((s) => s.includes("网易云收藏 5.0K")));
});


test("calcHeatScore returns no-data when nothing is entered (missing ≠ 0)", () => {
  const h = calcHeatScore({});
  assert.equal(h.stars, 0);
  assert.equal(h.label, "无数据");
});
