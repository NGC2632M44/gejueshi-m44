// 外部 API 密钥管理：只读 data/api-keys.json（gitignore）或环境变量。
// 密钥永不写入代码/仓库；.env.example 只含占位符。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEYS_PATH = process.env.GEJUESHI_KEYS_PATH
  || path.join(__dirname, "..", "data", "api-keys.json");

export function getKeys() {
  let file = {};
  try {
    if (fs.existsSync(KEYS_PATH)) {
      file = JSON.parse(fs.readFileSync(KEYS_PATH, "utf-8"));
    }
  } catch (_) {}
  return {
    getsongbpmApiKey: process.env.GETSONGBPM_API_KEY || file.getsongbpmApiKey || "",
    getsongbpmSecret: process.env.GETSONGBPM_SECRET || file.getsongbpmSecret || "",
    lastfmApiKey: process.env.LASTFM_API_KEY || file.lastfmApiKey || "",
    lastfmSharedSecret: process.env.LASTFM_SHARED_SECRET || file.lastfmSharedSecret || "",
    discogsConsumerKey: process.env.DISCOGS_CONSUMER_KEY || file.discogsConsumerKey || "",
    discogsConsumerSecret: process.env.DISCOGS_CONSUMER_SECRET || file.discogsConsumerSecret || "",
    discogsToken: process.env.DISCOGS_TOKEN || file.discogsToken || "",
    geniusToken: process.env.GENIUS_TOKEN || file.geniusToken || "",
    geniusClientId: process.env.GENIUS_CLIENT_ID || file.geniusClientId || "",
    spotifyClientId: process.env.SPOTIFY_CLIENT_ID || file.spotifyClientId || "",
    spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET || file.spotifyClientSecret || "",
    youtubeApiKey: process.env.YOUTUBE_API_KEY || file.youtubeApiKey || "",
  };
}
