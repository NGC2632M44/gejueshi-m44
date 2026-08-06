import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "..", "scripts", "fixtures", "songbpm-wet-wild.html");
const html = fs.readFileSync(FIXTURE, "utf-8");

const { parseSongBPMHtml } = await import("./mir-cross-ref.js");


test("parses bpm 128 and key A minor from the real songbpm page", () => {
  const parsed = parseSongBPMHtml(html);
  assert.equal(parsed.source, "songbpm");
  assert.equal(parsed.bpm, 128);
  assert.equal(parsed.key, "A minor");
});
