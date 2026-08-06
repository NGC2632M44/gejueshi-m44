import assert from "node:assert/strict";
import { test } from "node:test";

import { extractReceptionQuotes, normTitle, rankTitleScore } from "./researcher.js";


test("normTitle strips punctuation and lowercases", () => {
  assert.equal(normTitle("Louder, Please"), "louderplease");
  assert.equal(normTitle("A Little Louder, Please (Deluxe)"), "alittlelouderpleasedeluxe");
});


test("exact title match outscores deluxe/bonus editions", () => {
  const main = rankTitleScore("Louder, Please", "Louder, Please");
  const deluxe = rankTitleScore("A Little Louder, Please (Deluxe)", "Louder, Please");
  const bonus = rankTitleScore("Louder, Please (Bonus Tracks)", "Louder, Please");
  assert.ok(main > deluxe, `main ${main} should beat deluxe ${deluxe}`);
  assert.ok(main > bonus, `main ${main} should beat bonus ${bonus}`);
});


test("extractReceptionQuotes keeps sentences that name a publication", () => {
  const text = "NME called it a confident debut. Pitchfork scored it 7.5 and praised the hooks. 一些无关句子。";
  const quotes = extractReceptionQuotes(text);
  assert.ok(quotes.some((q) => q.includes("NME")));
  assert.ok(quotes.some((q) => q.includes("Pitchfork")));
  assert.ok(quotes.length <= 3);
});
