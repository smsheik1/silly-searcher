// Silly Searcher — semantic find with direct TypeSafe Jev calls. No backend.
//
// Based on Shubham Saboo's Needle (github.com/Shubhamsaboo/awesome-llm-apps,
// advanced_llm_apps/needle), with the local server removed: the extension calls
// https://api.typesafe.ai/v1/systemone directly using your own TypeSafe API key.
//
// This is the MV3 service worker: a thin chrome.* wrapper. All pure search
// logic lives in lib/search.mjs so it can be unit-tested in node.

import {
  MODEL,
  PROMPT_VERSION,
  SearchError,
  requestKey,
  searchDirect,
  testConnection,
  validate,
} from "./lib/search.mjs";

// --- Extension plumbing ---
// Unclutter's hardening: keep the API key out of reach of page-injected
// contexts. Content scripts never read storage, so this changes nothing else.
void chrome.storage.local
  .setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" })
  .catch(() => undefined);

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") chrome.runtime.openOptionsPage();
});

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["text-range.js", "content.js"],
    });
  } catch {
    await chrome.runtime.openOptionsPage();
  }
});

// --- In-flight dedup: one paid Jev call per unique search ---
// Two tabs or a double keypress must not each burn a paid call for the same
// query. Unclutter's jobs map, simplified.
const inflight = new Map();

// --- Paid-call safeguards (Unclutter's discipline, adapted) ---
// MODEL + PROMPT_VERSION join the cache key (Unclutter's ANALYSIS_VERSION idea):
// a future prompt/model change must never serve stale judgments.
const CACHE_MAX = 20;
const resultCache = new Map();
const cacheKey = (k) => `${MODEL}:pv${PROMPT_VERSION}:${k}`;
function cacheSet(k, value) {
  resultCache.delete(k);
  resultCache.set(k, value);
  while (resultCache.size > CACHE_MAX) resultCache.delete(resultCache.keys().next().value);
}

// Restart-safe pending marker. chrome.storage.session survives a service-worker
// restart but not a browser restart — exactly the window in which a paid Jev
// call can be orphaned. Written before the fetch, cleared on settle. A fresh
// marker with no inflight promise means a previous worker died mid-call; the
// user's retry is legitimate and proceeds immediately instead of hanging on a
// promise that will never resolve.
const PENDING_TTL_MS = 60_000;
const sessionStore = () =>
  chrome.storage.session ? chrome.storage.session : chrome.storage.local;
const pendingName = (k) => `pending:${k}`;
async function markPending(k) {
  try {
    await sessionStore().set({ [pendingName(k)]: { startedAt: Date.now() } });
  } catch {}
}
async function clearPending(k) {
  try {
    await sessionStore().remove(pendingName(k));
  } catch {}
}
// Sweep markers orphaned by a worker that died before its finally ran.
(async () => {
  try {
    const all = await sessionStore().get(null);
    const now = Date.now();
    for (const name of Object.keys(all || {})) {
      if (name.startsWith("pending:") && now - (all[name]?.startedAt || 0) > PENDING_TTL_MS)
        await sessionStore().remove(name);
    }
  } catch {}
})();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Borrowed from Unclutter: only our own extension pages/content scripts may
  // trigger searches or touch settings. Externally-connectable is not declared,
  // so this is defense in depth.
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ error: "Untrusted sender." });
    return;
  }
  if (message.type === "SILLY_SETTINGS") {
    chrome.runtime.openOptionsPage();
    return;
  }
  if (message.type === "SILLY_TEST") {
    (async () => {
      try {
        await testConnection(message.key);
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({
          ok: false,
          error: e instanceof SearchError ? e.message : "Connection test failed.",
        });
      }
    })();
    return true;
  }
  if (message.type !== "SILLY_SEARCH" || !sender.tab) return;
  (async () => {
    const { apiKey = "" } = await chrome.storage.local.get(["apiKey"]);
    if (!apiKey) {
      sendResponse({ error: "Add your TypeSafe API key in Silly Searcher settings first." });
      return;
    }
    // Validate before computing keys or spending a call: malformed payloads get
    // a clean rejection, never a fetch. (Unclutter validates every message.)
    let input;
    try {
      input = validate(message.payload);
    } catch (e) {
      sendResponse({ error: e instanceof SearchError ? e.message : "Search failed." });
      return;
    }
    const key = requestKey(input.query, input.blocks);
    const ck = cacheKey(key);
    // Never pay twice for the same decision: identical query + page reuses it.
    const hit = resultCache.get(ck);
    if (hit) {
      sendResponse(hit);
      return;
    }
    let promise = inflight.get(key);
    if (!promise) {
      // Synchronous check-and-set: no await may fall between get and set, or
      // two racing messages would each mint their own paid call.
      promise = searchDirect(input.query, input.blocks, apiKey.trim());
      inflight.set(key, promise);
      void markPending(key);
      void promise.then(
        (result) => {
          cacheSet(ck, result);
          void clearPending(key);
          if (inflight.get(key) === promise) inflight.delete(key);
        },
        () => {
          void clearPending(key);
          if (inflight.get(key) === promise) inflight.delete(key);
        },
      );
    }
    try {
      sendResponse(await promise);
    } catch (e) {
      sendResponse({
        error: e instanceof SearchError ? e.message : "Search failed.",
      });
    }
  })();
  return true;
});
