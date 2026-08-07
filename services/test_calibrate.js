import assert from "node:assert/strict";
import { test } from "node:test";

import { buildBasicCalibration, cleanYouTubeTitle, durationConsensus } from "./calibrate.js";
import { formatChordSequence } from "./audio-analyzer.js";


test("cleanYouTubeTitle removes artist prefix and qualifier suffix", () => {
  assert.equal(
    cleanYouTubeTitle("Rose Gray - Wet & Wild (Official Visualiser)", "RoseGrayVEVO"),
    "Wet & Wild"
  );
  assert.equal(
    cleanYouTubeTitle("Artist - Song (Lyrics)", "Artist"),
    "Song"
  );
});


test("durationConsensus treats seconds-like values within tolerance", () => {
  const r = durationConsensus([182, 182.21, 186]);
  assert.equal(r.value, 182);
  assert.equal(r.count, 2);
  assert.equal(r.conflict, true);
});


test("buildBasicCalibration fuses title/artist/album/year/label/duration", () => {
  const cal = buildBasicCalibration({
    query: "Wet & Wild Rose Gray",
    local: { duration_seconds: 182 },
    neteaseSong: { name: "Wet & Wild", artists: "Rose Gray", album: "Louder, Please", duration_ms: 182210 },
    lastfmTrack: { name: "Wet & Wild", artist: "Rose Gray", album: "Louder, Please", duration: 182000 },
    genius: { title: "Wet & Wild", artist: "Rose Gray" },
    youtube: { title: "Rose Gray - Wet & Wild (Official Visualiser)", channel: "RoseGrayVEVO" },
    albumAgg: { title: "Louder, Please", date: "2025-10-24", labels: ["Play It Again Sam Records"] },
    discogsTop: { year: 2025, label: "Play It Again Sam Records" },
  });
  assert.equal(cal.title.value, "Wet & Wild");
  assert.equal(cal.title.count, 4);
  assert.equal(cal.artist.value, "Rose Gray");
  assert.equal(cal.album.value, "Louder, Please");
  assert.equal(cal.year.value, "2025");
  assert.equal(cal.label.value, "Play It Again Sam Records");
  assert.equal(cal.duration.value, 182);
  assert.equal(cal.durationCheck.match, true);
});


test("formatChordSequence compacts full chord names", () => {
  assert.equal(formatChordSequence("A minor, D minor, E minor"), "Am-Dm-Em");
  assert.equal(formatChordSequence("C major / G major / Am"), "C-G-Am");
  assert.equal(formatChordSequence("C# minor, Bb major"), "C#m-Bb");
  assert.equal(formatChordSequence(null), null);
});
