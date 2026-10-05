// Tests for splitPassage, extracted from the SHIPPED content.js between the
// <splitPassage> markers — so the tests run against the real code, not a copy.
// Run: node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "content.js"), "utf8");
const start = source.indexOf("// <splitPassage>");
const end = source.indexOf("// </splitPassage>");
assert.ok(start !== -1 && end > start, "splitPassage markers present in content.js");
const splitPassage = new Function(
  `${source.slice(start, end)}; return splitPassage;`,
)();

test("short text passes through untouched", () => {
  assert.deepEqual(splitPassage("Hello world, this is short."), [
    "Hello world, this is short.",
  ]);
});

test("exact 2200-char boundary is not split", () => {
  const text = "x".repeat(2200);
  assert.deepEqual(splitPassage(text), [text]);
});

test("long text splits at sentence boundaries, losslessly", () => {
  const text = "First sentence here. ".repeat(200); // ~4000 chars
  const parts = splitPassage(text);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 2200), "every chunk within cap");
  // every chunk appears in the original, in order (chunks are trimmed, so
  // boundary whitespace may differ — content must not be lost or duplicated)
  let pos = 0;
  for (const p of parts) {
    const i = text.indexOf(p, pos);
    assert.ok(i >= pos, "chunk found in order");
    pos = i + p.length;
  }
});

test("pathological single sentence is hard-cut, losslessly", () => {
  const text = "z".repeat(5000);
  const parts = splitPassage(text);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 2200));
  assert.equal(parts.join(""), text);
});

test("tiny fragments are dropped", () => {
  const text = "A".repeat(2195) + " ok";
  const parts = splitPassage(text);
  assert.ok(parts.every((p) => p.length >= 12));
});
