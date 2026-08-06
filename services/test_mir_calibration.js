import assert from "node:assert/strict";

import { crossReference } from "./audio-analyzer.js";
import { parseHookTheoryHtml } from "./mir-cross-ref.js";

function testHookTheoryParser() {
  const html = `
    <span>Key</span><span>A<span class="margin-flat">♭</span> Major</span>
    <span>Tempo</span><span>126 BPM</span>
    <span>Meter</span><span>4/4</span>
    <div>Most Important Chords</div>
    <div>The three most important chords are all major chords (A♭ Major, D♭ Major, and E♭ Major).</div>
    <a>Cheat Sheet Card</a>
  `;

  const parsed = parseHookTheoryHtml(html);

  assert.equal(parsed.source, "hooktheory");
  assert.equal(parsed.bpm, 126);
  assert.equal(parsed.key, "Ab Major");
  assert.equal(parsed.meter, "4/4");
  assert.equal(parsed.chord_sequence, "A♭ Major, D♭ Major, E♭ Major");
}

function testExternalMirOverridesLocalBpmAndKey() {
  const ref = crossReference(
    { bpm: 117.5, key: "Gb major", bpm_confidence: 95.5, key_confidence: 78 },
    [{ source: "hooktheory", bpm: 126, key: "Ab Major" }]
  );

  assert.equal(ref.bpm_consensus, 126);
  assert.equal(ref.key_consensus, "Ab major");
  assert.equal(ref.local_disagreement.bpm, true);
  assert.equal(ref.local_disagreement.key, true);
}

testHookTheoryParser();
testExternalMirOverridesLocalBpmAndKey();
console.log("MIR calibration regression tests passed");
