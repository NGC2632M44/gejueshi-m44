import assert from "node:assert/strict";
import { test } from "node:test";

const { parseHookTheoryHtml, songIdentityMatches, mirCacheKeyFor } = await import("./mir-cross-ref.js");
const { crossReference } = await import("./audio-analyzer.js");

const HOOKTHEORY_HTML = `
<html><body>
<dt>Key</dt><dd>A Minor</dd>
<dt>Tempo</dt><dd>128 BPM</dd>
<dt>Meter</dt><dd>4/4</dd>
<dt>Genre</dt><dd>Dance, House</dd>
<p>Most Important Chords: The three most important chords, built off the 1st, 4th and 5th scale degrees are all minor chords (A minor, D minor, and E minor).</p>
</body></html>`;

test("hooktheory parser extracts key/tempo/meter/chords from real page structure", () => {
  const parsed = parseHookTheoryHtml(HOOKTHEORY_HTML);
  assert.equal(parsed.source, "hooktheory");
  assert.equal(parsed.bpm, 128);
  assert.equal(parsed.key, "A Minor");
  assert.equal(parsed.meter, "4/4");
  assert.equal(parsed.chord_sequence, "A minor, D minor, E minor");
  assert.match(parsed.chord_summary, /minor chords/);
});

test("hooktheory parser returns null on 404-like page without data", () => {
  const parsed = parseHookTheoryHtml("<html><title>Not Found</title><body>404</body></html>");
  assert.equal(parsed, null);
});

test("identity filter: lastfm/genius candidates must match song+artist", () => {
  const opts = { songTitle: "Summer Fling", artistName: "Leroy" };
  assert.equal(songIdentityMatches({ track_name: "Summer Fling", artist_name: "Leroy" }, opts), true);
  assert.equal(songIdentityMatches({ track_name: "Wet & Wild", artist_name: "Rose Gray" }, opts), false);
  // 归一化：大小写、标点不影响
  assert.equal(songIdentityMatches({ track_name: "summer-fling", artist_name: "LEROY" }, opts), true);
});

test("cache key includes song/artist so metadata-only sources don't collide", () => {
  const a = mirCacheKeyFor("Wet & Wild Rose Gray", { songTitle: "Wet & Wild", artistName: "Rose Gray" });
  const b = mirCacheKeyFor("Wet & Wild Rose Gray", { songTitle: "Summer Fling", artistName: "Leroy" });
  assert.notEqual(a, b);
});

test("crossReference only counts sources that actually provide BPM/Key", () => {
  const ref = crossReference(
    { bpm: 128.8, key: "E minor" },
    [
      { source: "lastfm", duration_sec: 182, track_name: "Wet & Wild", artist_name: "Rose Gray" },
      { source: "genius", track_name: "Wet & Wild", artist_name: "Rose Gray" },
      { source: "hooktheory", bpm: 128, key: "A minor" },
    ]
  );
  // Last.fm / Genius 不提供 BPM/Key，不应被计入参数共识来源
  assert.deepEqual(ref.sources, ["local", "hooktheory"]);
  assert.equal(ref.bpm_consensus, 128.4);
  assert.equal(ref.key_consensus, "A minor");
});

test("crossReference keeps local-only result as single_source with low confidence", () => {
  const ref = crossReference({ bpm: 128.8, key: "E minor", bpm_estimators: [] }, []);
  assert.equal(ref.consensus, "single_source");
  assert.equal(ref.bpm_consensus, null);
  assert.equal(ref.key_consensus, null);
  assert.equal(ref.sources.length, 1);
});
