import assert from "node:assert/strict";
import { test } from "node:test";

import { buildScoringPrompt } from "./audio-analyzer.js";


test("scoring prompt includes basic calibration block when researchData has it", () => {
  const af = { bpm: 128.2, key: "A minor", duration_seconds: 182 };
  const researchData = {
    calibration: {
      title: { value: "Wet & Wild", count: 4, total: 4, conflict: false },
      artist: { value: "Rose Gray", count: 4, total: 4, conflict: false },
      album: { value: "Louder, Please", count: 3, total: 3, conflict: false },
      year: { value: "2025", count: 3, total: 3, conflict: false },
      label: { value: "Play It Again Sam Records", count: 2, total: 2, conflict: false },
      duration: { value: 182, count: 2, total: 2, conflict: false },
      durationCheck: { local_seconds: 182, recommended_seconds: 182, match: true },
    },
  };
  const prompt = buildScoringPrompt(af, "", {}, null, null, "", researchData);
  assert.match(prompt, /Wet & Wild/);
  assert.match(prompt, /Rose Gray/);
  assert.match(prompt, /Louder, Please/);
  assert.match(prompt, /Play It Again Sam Records/);
  assert.match(prompt, /182s/);
});


test("scoring prompt omits calibration block when absent", () => {
  const prompt = buildScoringPrompt({ bpm: 128.2 }, "", {}, null, null, "", null);
  assert.doesNotMatch(prompt, /基础信息校准/);
});
