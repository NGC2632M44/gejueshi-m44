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


test("querySongBPMByUrl is exported (endpoint import regression)", async () => {
  const mod = await import("./mir-cross-ref.js");
  assert.equal(typeof mod.querySongBPMByUrl, "function");
});


test("MIR cache key includes song and artist identity to avoid cross-song collisions", async () => {
  const mod = await import("./mir-cross-ref.js");
  const a = mod.mirCacheKeyFor("Rose Gray Louder, Please", { songTitle: "Wet & Wild", artistName: "Rose Gray" });
  const b = mod.mirCacheKeyFor("Rose Gray Louder, Please", { songTitle: "Summer Fling", artistName: "Leroy" });
  assert.notEqual(a, b);
  assert.match(a, /wet/);
  assert.match(b, /summer/);
});


test("song identity filter rejects external results from another song", async () => {
  const mod = await import("./mir-cross-ref.js");
  const wetWild = { track_name: "Wet & Wild", artist_name: "Rose Gray" };
  assert.equal(mod.songIdentityMatches(wetWild, { songTitle: "Summer Fling", artistName: "Leroy" }), false);
  assert.equal(mod.songIdentityMatches(wetWild, { songTitle: "Wet & Wild", artistName: "Rose Gray" }), true);
  assert.equal(mod.songIdentityMatches({ track_name: "Summer Fling", artist_name: "leroy" }, { songTitle: "Summer Fling", artistName: "Leroy" }), true);
});
