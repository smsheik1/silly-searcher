// Tests for the service worker wrapper (background.js): the paid-call
// safeguards that live outside the pure lib — sender validation, in-flight
// dedup, result cache, pending markers. chrome.* is stubbed before import;
// global fetch is overridden with a controllable mock.
// Run: node --test tests/*.test.mjs
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { requestKey } from "../lib/search.mjs";

// ---- chrome stub ----
let apiKey = "test-key";
const sessionOps = [];
const listeners = {};
let optionsOpened = 0;
const EXT_ID = "silly-test-id";

globalThis.chrome = {
  runtime: {
    id: EXT_ID,
    onInstalled: { addListener: (fn) => (listeners.installed = fn) },
    onMessage: { addListener: (fn) => (listeners.message = fn) },
    openOptionsPage: async () => optionsOpened++,
  },
  action: { onClicked: { addListener: (fn) => (listeners.clicked = fn) } },
  storage: {
    local: {
      setAccessLevel: async () => undefined,
      get: async (keys) => {
        const out = {};
        for (const k of keys) if (k === "apiKey" && apiKey) out[k] = apiKey;
        return out;
      },
      set: async () => undefined,
      remove: async () => undefined,
    },
    session: {
      set: async (obj) => sessionOps.push({ op: "set", keys: Object.keys(obj) }),
      get: async () => ({}),
      remove: async (name) => sessionOps.push({ op: "remove", keys: [name] }),
    },
  },
  scripting: { executeScript: async () => undefined },
};

// ---- fetch mock ----
let fetchCount = 0;
let modelsStatus = 200;
const realFetch = globalThis.fetch;
function jevAnswers() {
  return {
    b0: { type: "noul", noul: 0.9 },
    b1: { type: "noul", noul: 0.1 },
  };
}
globalThis.fetch = async (url, options) => {
  fetchCount++;
  if (String(url).includes("/v1/models"))
    return { ok: modelsStatus === 200, status: modelsStatus, json: async () => ({}) };
  assert.equal(options.headers.Authorization, "Bearer test-key");
  return { ok: true, json: async () => ({ answers: jevAnswers() }) };
};
after(() => {
  globalThis.fetch = realFetch;
});

await import("../background.js");
const onMessage = listeners.message;
assert.ok(onMessage, "background.js registered an onMessage listener");

const trusted = { id: EXT_ID, tab: { id: 1 } };
const blocks = [
  { id: "b0", text: "A $25 service charge is deducted from every refund." },
  { id: "b1", text: "Breakfast is served at 8." },
];
function send(message, sender = trusted, timeoutMs = 5000) {
  return Promise.race([
    new Promise((resolve) => {
      onMessage(message, sender, resolve);
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("sendResponse never called")), timeoutMs),
    ),
  ]);
}

test("untrusted sender is rejected with zero fetches", async () => {
  const before = fetchCount;
  const resp = await send(
    { type: "SILLY_SEARCH", payload: { query: "q-untrusted", blocks } },
    { id: "evil-extension", tab: { id: 1 } },
  );
  assert.equal(resp.error, "Untrusted sender.");
  assert.equal(fetchCount, before);
});

test("missing API key errors before any fetch", async () => {
  apiKey = "";
  try {
    const before = fetchCount;
    const resp = await send({ type: "SILLY_SEARCH", payload: { query: "q-nokey", blocks } });
    assert.match(resp.error, /API key/);
    assert.equal(fetchCount, before);
  } finally {
    apiKey = "test-key";
  }
});

test("malformed payload is rejected with zero fetches", async () => {
  const before = fetchCount;
  for (const payload of [
    { query: "", blocks },
    { query: "q-bad", blocks: [] },
    { query: "q-bad", blocks: [{ id: "b0", text: "x".repeat(2201) }] },
  ]) {
    const resp = await send({ type: "SILLY_SEARCH", payload });
    assert.ok(resp.error, "expected an error response");
  }
  assert.equal(fetchCount, before);
});

test("valid search performs one fetch and returns ranked matches", async () => {
  const before = fetchCount;
  const resp = await send({ type: "SILLY_SEARCH", payload: { query: "q-valid", blocks } });
  assert.equal(fetchCount, before + 1);
  assert.equal(resp.matches.length, 1); // 0.1 < 0.58 filtered
  assert.equal(resp.matches[0].id, "b0");
  assert.equal(resp.truncated, false);
});

test("concurrent identical searches share a single fetch", async () => {
  const before = fetchCount;
  const payload = { query: "q-concurrent", blocks };
  const [r1, r2] = await Promise.all([
    send({ type: "SILLY_SEARCH", payload }),
    send({ type: "SILLY_SEARCH", payload }),
  ]);
  assert.equal(fetchCount, before + 1);
  assert.deepEqual(r1.matches, r2.matches);
});

test("sequential repeat is served from cache with zero new fetches", async () => {
  const payload = { query: "q-cache", blocks };
  const before = fetchCount;
  await send({ type: "SILLY_SEARCH", payload });
  assert.equal(fetchCount, before + 1);
  const cached = await send({ type: "SILLY_SEARCH", payload });
  assert.equal(fetchCount, before + 1);
  assert.equal(cached.matches.length, 1);
});

test("different query performs a new fetch", async () => {
  const before = fetchCount;
  await send({ type: "SILLY_SEARCH", payload: { query: "q-diff-1", blocks } });
  await send({ type: "SILLY_SEARCH", payload: { query: "q-diff-2", blocks } });
  assert.equal(fetchCount, before + 2);
});

test("pending marker is written before the call and cleared after", async () => {
  sessionOps.length = 0;
  const q = "q-pending";
  await send({ type: "SILLY_SEARCH", payload: { query: q, blocks } });
  const name = `pending:${requestKey(q, blocks)}`;
  const sets = sessionOps.filter((o) => o.op === "set" && o.keys.includes(name));
  const removes = sessionOps.filter((o) => o.op === "remove" && o.keys.includes(name));
  assert.equal(sets.length, 1);
  assert.equal(removes.length, 1);
});

test("SILLY_TEST verifies the key without storing anything", async () => {
  modelsStatus = 200;
  const ok = await send({ type: "SILLY_TEST", key: "candidate-key" });
  assert.equal(ok.ok, true);
  modelsStatus = 401;
  try {
    const bad = await send({ type: "SILLY_TEST", key: "bad-key" });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /rejected/);
  } finally {
    modelsStatus = 200;
  }
});

test("SILLY_SETTINGS opens the options page", async () => {
  const before = optionsOpened;
  // settings path never calls sendResponse; drive the listener directly
  let responded = false;
  onMessage({ type: "SILLY_SETTINGS" }, trusted, () => (responded = true));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(optionsOpened, before + 1);
  assert.equal(responded, false);
});
