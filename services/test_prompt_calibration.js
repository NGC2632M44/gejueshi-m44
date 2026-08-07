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


test("song scope separates song-level and album-level ratings", () => {
  const prompt = buildScoringPrompt(
    { bpm: 128.2 },
    "",
    {},
    {
      rym: { score: 4.1, max: 5, scope: "song" },
      pitchfork: { score: 7.5, max: 10 },
      aoty: { score: 82, max: 100, scope: "album" },
    },
    null,
    "",
    null,
    "song"
  );
  assert.match(prompt, /单曲级评分参考/);
  assert.match(prompt, /专辑级评分参考/);
  assert.match(prompt, /不直接决定单曲得分/);
  assert.match(prompt, /禁止用专辑分推断/);
  assert.doesNotMatch(prompt, /五维总分不应低于70/);
});


test("album scope keeps album ratings as anchors", () => {
  const prompt = buildScoringPrompt(
    { bpm: 128.2 },
    "",
    {},
    { aoty: { score: 82, max: 100, scope: "album" }, rym: { score: 4.1, max: 5, scope: "song" } },
    null,
    "",
    null,
    "album"
  );
  assert.match(prompt, /各平台评分参考/);
  assert.match(prompt, /五维总分不应低于70/);
  assert.match(prompt, /专辑赏析/);
});


test("scoring prompt bans bracket evidence refs and asks for longer rationale", () => {
  const prompt = buildScoringPrompt({ bpm: 128.2, evidence: { 混音: { integrated_lufs: -7.6 } } });
  assert.match(prompt, /禁止在 rationale 中出现任何 \[键:值\]/);
  assert.match(prompt, /150-220/);
  assert.doesNotMatch(prompt, /必须引用对应证据键/);
});
