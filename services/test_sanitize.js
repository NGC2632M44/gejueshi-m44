import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeScores, sanitizeOneLiner } from "./sanitize.js";


test("sanitize strips bracket evidence metadata from rationale", () => {
  const scores = {
    混: {
      score: 13,
      rationale: "整体响度偏大 [混音:LUFS=-7.6]，低频略多 [混音:subbass_stereo_width=0.1]，但人声清晰。",
    },
  };
  sanitizeScores(scores);
  assert.doesNotMatch(scores.混.rationale, /\[/);
  assert.doesNotMatch(scores.混.rationale, /LUFS/);
  assert.doesNotMatch(scores.混.rationale, /subbass_stereo_width/);
  assert.match(scores.混.rationale, /整体响度偏大/);
  assert.match(scores.混.rationale, /人声清晰/);
});


test("sanitize keeps natural prose and removes internal editorial terms", () => {
  const scores = {
    曲: { score: 15, rationale: "用户指出副歌记忆点强，旋律线条清晰有力。" },
  };
  sanitizeScores(scores);
  assert.doesNotMatch(scores.曲.rationale, /用户指出/);
  assert.match(scores.曲.rationale, /副歌记忆点强/);
});


test("sanitize caps rationale at 220 chars with a sentence boundary", () => {
  const long = "好。".repeat(140); // 280 chars
  const scores = { 编: { score: 14, rationale: long } };
  sanitizeScores(scores);
  assert.ok(scores.编.rationale.length <= 220);
  assert.ok(scores.编.rationale.endsWith("。"));
});


test("sanitize strips bracket metadata from oneLiner", () => {
  const scores = { oneLiner: "很稳 [混音:LUFS=-7.6] 的一首。" };
  sanitizeScores(scores);
  assert.doesNotMatch(scores.oneLiner, /\[/);
  assert.doesNotMatch(scores.oneLiner, /LUFS/);
});


test("sanitize removes stray space before punctuation after bracket strip", () => {
  const scores = {
    混: { score: 13, rationale: "整体响度偏大 [混音:LUFS=-7.6]，低频略多 [混音:subbass_stereo_width=0.1]。但人声清晰。" },
  };
  sanitizeScores(scores);
  assert.match(scores.混.rationale, /偏大，低频略多。/);
  assert.doesNotMatch(scores.混.rationale, /，\s/);
});


test("sanitizeOneLiner handles top-level card oneLiner", () => {
  assert.equal(sanitizeOneLiner("很稳 [混音:LUFS=-7.6]。"), "很稳。");
  assert.doesNotMatch(sanitizeOneLiner("很稳的一首 [混音:LUFS=-7.6]，"), /\[/);
});


test("sanitize removes review-meta language and keeps apostrophes intact", () => {
  const scores = {
    曲: {
      score: 15,
      rationale: "乐评里提到这首歌的副歌记忆点强，歌词「My mascara runs, but it's just the rain」把情绪收住。",
    },
  };
  sanitizeScores(scores);
  assert.doesNotMatch(scores.曲.rationale, /乐评里提到/);
  assert.match(scores.曲.rationale, /副歌记忆点强/);
  assert.match(scores.曲.rationale, /it's/);
  assert.doesNotMatch(scores.曲.rationale, /」s/);
});


test("sanitizeOneLiner cuts English at word boundary without Chinese period", () => {
  const out = sanitizeOneLiner("That off-beat keyboard line is the best part of this track and it keeps me coming back again");
  assert.ok(out.length <= 100);
  assert.doesNotMatch(out, /keyboa$/);
  assert.match(out, /keyboard/);
  assert.doesNotMatch(out, /。$/);
});


test("sanitizeOneLiner never ends mid-word on a hyphenated cut", () => {
  const out = sanitizeOneLiner("A rain-soaked dance-floor confession, all body and no filter, that keeps the groove tight from the first kick to the final fadeout of the whole mix");
  assert.doesNotMatch(out, /dance-?$/);
  assert.doesNotMatch(out, /\w-$/);
  assert.ok(out.length <= 100);
});
