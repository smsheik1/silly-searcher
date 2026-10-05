// Tests for isNoise, extracted from the SHIPPED content.js between the
// <isNoise> markers — so the tests run against the real code, not a copy.
// Run: node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "content.js"), "utf8");
const start = source.indexOf("// <isNoise>");
const end = source.indexOf("// </isNoise>");
assert.ok(start !== -1 && end > start, "isNoise markers present in content.js");
const isNoise = new Function(`${source.slice(start, end)}; return isNoise;`)();

test("empty text is always noise", () => {
  assert.equal(isNoise("", "P"), true);
  assert.equal(isNoise("", "H2"), true);
});

test("long text is never noise", () => {
  assert.equal(isNoise("This is a long enough paragraph.", "P"), false);
  assert.equal(isNoise("This is a long enough heading", "H2"), false);
});

test("short paragraphs are noise", () => {
  assert.equal(isNoise("Hi there", "P"), true);
  assert.equal(isNoise("Click here!", "LI"), true);
});

test("short headings are kept — the Geo-Fencing case", () => {
  // "Geo-Fencing" is 11 chars: the old <12 rule dropped the heading and
  // orphaned its paragraph, so "geofencing" found nothing on screen.
  assert.equal(isNoise("Geo-Fencing", "H2"), false);
  assert.equal(isNoise("FAQ", "H3"), false);
  assert.equal(isNoise("Pricing", "H1"), false);
  assert.equal(isNoise("Intro", "H4"), false);
});

test("lowercase tag names are not treated as headings", () => {
  assert.equal(isNoise("Geo-Fencing", "h2"), true);
});
