import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, "..");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gejueshi-album-"));
const libFile = path.join(tmpRoot, "library.json");
const outDir = path.join(tmpRoot, "output");


function freePort() {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}


test("album flow: track with albumName groups, HTML lands in output, album card renders", async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: PROJECT,
    env: {
      ...process.env,
      PORT: String(port),
      DEEPSEEK_API_KEY: "",
      GEJUESHI_LIBRARY_PATH: libFile,
      GEJUESHI_OUTPUT_DIR: outDir,
    },
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr.on("data", (c) => (stderr += c));

  const base = `http://127.0.0.1:${port}`;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let ready = false;
  for (let i = 0; i < 20 && !ready; i++) {
    await wait(300);
    try { ready = (await fetch(`${base}/api/status`)).status === 200; } catch {}
  }
  assert.ok(ready, `server did not start: ${stderr.slice(-800)}`);

  try {
    // 1. 入库一首带 albumName 的曲目
    const track = {
      id: "track_test_1",
      title: "测试单曲",
      songTitle: "测试单曲",
      artist: "测试艺人",
      albumName: "测试专辑",
      scores: { 曲: { score: 15, rationale: "ok" }, totalScore: 15 },
      audioFeatures: { bpm: 120, key: "C major" },
    };
    const saved = await fetch(`${base}/api/library`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "tracks", data: track }),
    }).then((r) => r.json());
    assert.equal(saved.success, true);

    // 2. 素材库分组：albums 返回该专辑与曲目
    const albums = await fetch(`${base}/api/library/albums`).then((r) => r.json());
    const album = albums.albums.find((a) => a.title === "测试专辑");
    assert.ok(album, "album 未按 albumName 分组");
    assert.equal(album.tracks.length, 1);

    // 3. HTML 落盘 → album-dirs 可见
    const savedHtml = await fetch(`${base}/api/save-export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: "<html><body>测试卡片</body></html>",
        name: "测试单曲.html",
        folder: "测试专辑",
        contentType: "text/html",
      }),
    }).then((r) => r.json());
    assert.equal(savedHtml.success, true);

    const dirs = await fetch(`${base}/api/library/album-dirs`).then((r) => r.json());
    const dir = dirs.dirs.find((d) => d.name === "测试专辑");
    assert.ok(dir, "album-dirs 未返回测试专辑目录");
    assert.ok(dir.fileCount >= 1, "album-dirs 应统计 HTML/PNG");

    // 4. 专辑卡片渲染
    const cardRes = await fetch(`${base}/api/album/card`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        albumMeta: { artist: "测试艺人", title: "测试专辑" },
        tracks: [track],
        hitTracks: ["测试单曲"],
      }),
    });
    assert.equal(cardRes.status, 200);
    const cardHtml = await cardRes.text();
    assert.match(cardHtml, /测试专辑/);
    assert.match(cardHtml, /ALBUM CARD/);
  } finally {
    child.kill();
    await wait(200);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
