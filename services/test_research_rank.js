import assert from "node:assert/strict";
import { test } from "node:test";

import { extractReceptionQuotes, normTitle, rankTitleScore, sortChartsByInfluence, parseAnyDecentMusicPage } from "./researcher.js";


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


test("charts are sorted by market influence, not alphabetically", () => {
  const charts = sortChartsByInfluence([
    { chart: "Australian Albums ( ARIA )", peak: "1" },
    { chart: "Austrian Albums ( Ö3 Austria )", peak: "4" },
    { chart: "Spanish Albums ( PROMUSICAE )", peak: "4" },
    { chart: "US Billboard 200", peak: "3" },
    { chart: "UK Albums ( Official Charts )", peak: "1" },
    { chart: "Irish Albums ( Official Charts )", peak: "3" },
    { chart: "Scottish Albums ( Official Charts )", peak: "1" },
    { chart: "Japanese Download Albums ( Billboard Japan )", peak: "52" },
  ]);
  assert.equal(charts[0].chart, "US Billboard 200");
  assert.equal(charts[1].chart, "UK Albums ( Official Charts )");
  assert.equal(charts[2].chart, "Australian Albums ( ARIA )");
  assert.equal(charts[3].chart, "Japanese Download Albums ( Billboard Japan )");
  assert.equal(charts[4].chart, "Irish Albums ( Official Charts )");
  assert.equal(charts[5].chart, "Austrian Albums ( Ö3 Austria )");
  // 爱尔兰不因“Official Charts”被误判成英国；苏格兰（区域性）排最后
  assert.ok(charts.findIndex(c => /irish/i.test(c.chart)) < charts.findIndex(c => /scottish/i.test(c.chart)));
  assert.equal(charts[charts.length - 1].chart, "Scottish Albums ( Official Charts )");
});


test("charts keep Wikipedia order when influence ties", () => {
  const charts = sortChartsByInfluence([
    { chart: "Belgian Albums ( Ultratop Wallonia)", peak: "4" },
    { chart: "Belgian Albums ( Ultratop Flanders)", peak: "1" },
  ]);
  assert.equal(charts[0].chart, "Belgian Albums ( Ultratop Wallonia)");
  assert.equal(charts[1].chart, "Belgian Albums ( Ultratop Flanders)");
});


test("ADM review page parser extracts aggregate and individual scores", () => {
  const html = `
    <html><body>
      <p class="score">8.0</p>
      <ul>
        <li class="review_item">
          <span class="data_rating">9</span>
          <h4>9.0|<span>NME</span></h4>
          <p>Confident, playful and brutally catchy.</p>
          <a href='https://www.nme.com/reviews/album/charli-xcx-music-fashion-film'>Read Review</a>
        </li>
        <li class="review_item">
          <span class="data_rating">8</span>
          <h4>8.0|<span>The Guardian</span></h4>
          <p>Her boldest record yet.</p>
          <a href='https://www.theguardian.com/music/...'>Read Review</a>
        </li>
      </ul>
      <h2>Charli XCX</h2><h3>Music, Fashion, Film</h3>
    </body></html>`;
  const parsed = parseAnyDecentMusicPage(html, "http://www.anydecentmusic.com/review/14677/x.aspx", "14677");
  assert.equal(parsed.overall, 8);
  assert.equal(parsed.individualScores.length, 2);
  assert.equal(parsed.individualScores[0].publication, "NME");
  assert.equal(parsed.individualScores[0].score, 9);
  assert.match(parsed.individualScores[0].quote, /catchy/);
  assert.equal(parsed.title, "Music, Fashion, Film");
  assert.equal(parsed.artist, "Charli XCX");
});
