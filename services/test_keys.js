import assert from "node:assert/strict";
import { test } from "node:test";

import { getKeys } from "./keys.js";

const FIELDS = [
  "getsongbpmApiKey",
  "getsongbpmSecret",
  "lastfmApiKey",
  "lastfmSharedSecret",
  "discogsConsumerKey",
  "discogsConsumerSecret",
  "discogsToken",
  "geniusToken",
  "geniusClientId",
  "spotifyClientId",
  "spotifyClientSecret",
  "youtubeApiKey",
];

test("getKeys exposes every configured key slot (values never asserted)", () => {
  const keys = getKeys();
  for (const field of FIELDS) {
    assert.equal(typeof keys[field], "string", `missing field ${field}`);
  }
});

test("getKeys never returns undefined for missing file", () => {
  const old = process.env.GEJUESHI_KEYS_PATH;
  process.env.GEJUESHI_KEYS_PATH = "Z:/__definitely_missing__/keys.json";
  try {
    const keys = getKeys();
    for (const field of FIELDS) {
      assert.equal(typeof keys[field], "string");
    }
  } finally {
    if (old === undefined) delete process.env.GEJUESHI_KEYS_PATH;
    else process.env.GEJUESHI_KEYS_PATH = old;
  }
});
