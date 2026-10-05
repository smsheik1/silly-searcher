// Tests for the shipped text-range.js (sentence -> DOM range mapping) using
// mocked DOM globals — the TreeWalker/Range/NodeFilter surface it touches.
// This covers SillyTextRange's chunk-locating path for split passages, which
// is the trickiest mapping code in the extension. Also direct sentenceSpans
// unit tests (offsets, decimals, Unicode).
// Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sentenceSpans } from "../lib/search.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---- mock DOM globals (only what text-range.js touches) ----
globalThis.NodeFilter = { SHOW_TEXT: 4 };
globalThis.document = {
  createTreeWalker(el, what) {
    assert.equal(what, 4);
    let i = 0;
    const nodes = el.__textNodes;
    return { nextNode: () => nodes[i++] || null };
  },
};
globalThis.Range = class {
  setStart(node, offset) {
    this.start = { node, offset };
  }
  setEnd(node, offset) {
    this.end = { node, offset };
  }
};

// Load the SHIPPED text-range.js so tests run against the real code.
(0, eval)(readFileSync(join(root, "text-range.js"), "utf8"));
const textRange = globalThis.SillyTextRange;
assert.equal(typeof textRange, "function");

// element fixture: text nodes with joined textContent, like inline markup
function element(parts) {
  const __textNodes = parts.map((textContent) => ({ textContent }));
  return { textContent: parts.join(""), __textNodes };
}

test("maps a sentence in a single text node, accounting for padding", () => {
  const el = element(["  Breakfast is included. Dogs welcome.  "]);
  const text = el.textContent.trim();
  const focus = sentenceSpans(text)[1];
  assert.equal(focus.text, "Dogs welcome.");
  const r = textRange(el, focus, text);
  assert.equal(r.start.node, el.__textNodes[0]);
  assert.equal(r.start.offset, el.textContent.indexOf("Dogs welcome."));
  assert.equal(r.end.node, el.__textNodes[0]);
  assert.equal(r.end.offset, el.textContent.indexOf("Dogs welcome.") + focus.text.length);
});

test("locates a split-passage chunk inside the element before mapping", () => {
  // Our unique path: expectedText is one chunk of a longer element.
  const full = "First chunk here. Second chunk is longer. Third one.";
  const el = element([full]);
  const chunk = "Second chunk is longer.";
  const focus = sentenceSpans(chunk)[0];
  const r = textRange(el, focus, chunk);
  assert.ok(r, "chunk found");
  assert.equal(r.start.offset, full.indexOf("Second chunk"));
  assert.equal(r.end.offset, full.indexOf("Second chunk") + chunk.length);
});

test("sentence range crosses inline markup text nodes", () => {
  const el = element([
    "  Breakfast is included. A property ",
    "service charge of $35",
    " per night applies. Dogs welcome.  ",
  ]);
  const text = el.textContent.trim();
  const focus = sentenceSpans(text)[1];
  assert.match(focus.text, /A property service charge/);
  const r = textRange(el, focus, text);
  assert.equal(r.start.node, el.__textNodes[0]);
  assert.equal(r.start.offset, el.__textNodes[0].textContent.indexOf("A property"));
  assert.equal(r.end.node, el.__textNodes[2]);
  assert.equal(r.end.offset, " per night applies.".length);
});

test("rejects mismatched focus, missing chunk, and out-of-range offsets", () => {
  const el = element(["One. ", "Two."]);
  const text = el.textContent;
  const good = { start: 5, end: 9, text: "Two." };
  const r = textRange(el, good, text);
  assert.equal(r.start.node, el.__textNodes[1]);
  assert.equal(r.start.offset, 0);
  assert.equal(r.end.offset, 4);
  // focus text doesn't match the slice
  assert.equal(textRange(el, { start: 5, end: 9, text: "Wrong" }, text), null);
  // no focus at all
  assert.equal(textRange(el, null, text), null);
  // chunk not present in the element
  assert.equal(textRange(el, good, "Changed entirely"), null);
  // offsets run past the end of the element text
  assert.equal(
    textRange(el, { start: 0, end: text.length + 50, text }, text),
    null,
  );
});

test("sentenceSpans: offsets, decimals, and Unicode", () => {
  const text = "  Welcome 👋. A charge of $3.50 applies.\n Keep your receipt!  ";
  const spans = sentenceSpans(text);
  assert.equal(spans.length, 3);
  assert.equal(spans[1].text, "A charge of $3.50 applies.");
  for (const s of spans) assert.equal(text.slice(s.start, s.end), s.text);
  assert.equal(spans[0].start, 2);
});

test("sentenceSpans: whitespace-only input yields no spans", () => {
  assert.deepEqual(sentenceSpans("   \n  "), []);
});
