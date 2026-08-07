import assert from "node:assert/strict";
import { test } from "node:test";

import { parseFinalScores, finalTotal, finalRankingText, buildFinalWordPromptSection, checkFinalWord } from "./final-word.js";


test("parseFinalScores accepts 0-20 integers and rejects incomplete input", () => {
  assert.deepEqual(parseFinalScores({ 词: 13, 曲: 15, 编: 15, 唱: 17, 混: 16 }), { 词: 13, 曲: 15, 编: 15, 唱: 17, 混: 16 });
  assert.equal(parseFinalScores({ 词: 13, 曲: 15 }), null);
  assert.equal(parseFinalScores({ 词: 25, 曲: 15, 编: 15, 唱: 17, 混: 16 }), null);
});


test("finalRankingText encodes strict > and tie ≥", () => {
  assert.equal(finalRankingText({ 词: 13, 曲: 15, 编: 15, 唱: 17, 混: 16 }), "唱>混>编≥曲>词");
});


test("buildFinalWordPromptSection includes total range and ranking", () => {
  const s = buildFinalWordPromptSection({ 词: 13, 曲: 15, 编: 15, 唱: 17, 混: 16 });
  assert.match(s, /\[72, 80\]/);
  assert.match(s, /唱>混>编≥曲>词/);
});


test("checkFinalWord enforces total range and ranking", () => {
  const user = { 词: 13, 曲: 15, 编: 15, 唱: 17, 混: 16 };
  const ok = { 词: { score: 13 }, 曲: { score: 15 }, 编: { score: 15 }, 唱: { score: 17 }, 混: { score: 16 } };
  assert.equal(checkFinalWord(ok, user), null);

  const badTotal = { 词: { score: 13 }, 曲: { score: 15 }, 编: { score: 15 }, 唱: { score: 20 }, 混: { score: 20 } };
  assert.match(checkFinalWord(badTotal, user), /总分/);

  const badOrder = { 词: { score: 16 }, 曲: { score: 15 }, 编: { score: 15 }, 唱: { score: 13 }, 混: { score: 16 } };
  assert.match(checkFinalWord(badOrder, user), /唱/);
});
