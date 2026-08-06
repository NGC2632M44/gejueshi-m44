import assert from "node:assert/strict";
import { test } from "node:test";

import { normTitle, rankTitleScore } from "./researcher.js";


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
