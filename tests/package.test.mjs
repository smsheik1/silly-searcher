// Packaging sanity: the extension loads with the files it references.
// Run: node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

test("manifest is MV3 with minimal permissions", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.background.service_worker);
  assert.deepEqual(
    [...manifest.permissions].sort(),
    ["activeTab", "scripting", "storage"],
  );
  assert.deepEqual(manifest.host_permissions, ["https://api.typesafe.ai/*"]);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
});

test("service worker is a module importing the pure search lib", () => {
  assert.equal(manifest.background.type, "module");
  const bg = readFileSync(join(root, manifest.background.service_worker), "utf8");
  assert.match(bg, /from "\.\/lib\/search\.mjs"/);
  assert.ok(!/function validate\(/.test(bg), "validate lives in lib");
  assert.ok(!/function makePayload\(/.test(bg), "makePayload lives in lib");
});

test("every referenced file exists on disk", () => {
  const refs = [
    manifest.background.service_worker,
    "lib/search.mjs",
    manifest.options_page,
    "options.js",
    "options.css",
    "text-range.js",
    "content.js",
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
  ];
  for (const ref of new Set(refs))
    assert.ok(existsSync(join(root, ref)), `missing: ${ref}`);
});

test("key never appears in committed source", () => {
  // Guards against accidentally committing a real TypeSafe key.
  const sources = ["lib/search.mjs", "background.js", "content.js", "options.js"];
  for (const f of sources) {
    const src = readFileSync(join(root, f), "utf8");
    assert.ok(!/sk-(live|test)-[A-Za-z0-9]{8}/.test(src), `possible key in ${f}`);
  }
});
