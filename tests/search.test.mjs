// Committed regression suite for lib/search.mjs (the pure search logic).
// Run: node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import {
  MODEL,
  THRESHOLD,
  PROMPT_VERSION,
  PAYLOAD_BYTE_BUDGET,
  SearchError,
  sentenceSpans,
  validate,
  makePayload,
  parseAnswers,
  fitBudget,
  requestKey,
  searchDirect,
  testConnection,
} from "../lib/search.mjs";

const blocks = [
  { id: "b0", text: "A $25 service charge is deducted from every refund. No exceptions." },
  { id: "b1", text: "Breakfast is served at 8." },
];

test("validate: accepts good input, trims query", () => {
  assert.deepEqual(validate({ query: "  fees  ", blocks }), {
    query: "fees",
    blocks,
  });
});

test("validate: rejects malformed payloads before any network call", () => {
  const bad = [
    null,
    {},
    { query: "", blocks },
    { query: "   ", blocks },
    { query: "x".repeat(401), blocks },
    { query: "fees", blocks: [] },
    { query: "fees", blocks: new Array(161).fill(blocks[0]) },
    { query: "fees", blocks: [blocks[0], blocks[0]] }, // dup id
    { query: "fees", blocks: [{ id: "bad", text: "abc" }] }, // id format
    { query: "fees", blocks: [{ id: "b0", text: "x".repeat(2201) }] },
    { query: "fees", blocks: [{ id: "b0", text: "   " }] },
    { query: "fees", blocks: [{ id: "b0", text: "x".repeat(30001) }, { id: "b1", text: "x".repeat(30001) }] },
  ];
  for (const body of bad) assert.throws(() => validate(body), SearchError);
  // boundary: exactly at caps passes
  assert.doesNotThrow(() =>
    validate({ query: "x".repeat(400), blocks: [{ id: "b0", text: "x".repeat(2200) }] }),
  );
});

test("makePayload: noul relevance question bound to each passage", () => {
  const p = makePayload({ query: "fees", blocks });
  assert.equal(p.model, MODEL);
  assert.equal(p.model, "jev-latest");
  assert.equal(p.state.search, "fees");
  assert.match(p.questions.b0.instructions, /ONLY passage b0/);
  assert.equal(p.questions.b0.type, "noul"); // direct Jev dialect, not "boolean"
  assert.ok(p.questions.b0.criteria.true && p.questions.b0.criteria.false);
});

test("makePayload: choice question picks key sentence from multi-sentence blocks", () => {
  const p = makePayload({ query: "fees", blocks });
  const focus = p.questions.focus_b0;
  assert.equal(focus.type, "choice");
  assert.deepEqual(Object.keys(focus.criteria), ["s0", "s1"]);
  assert.match(focus.criteria.s0, /\$25 service charge/);
  // single-sentence block gets no choice question
  assert.equal(p.questions.focus_b1, undefined);
});

test("parseAnswers: rejects incomplete, out-of-range and mistyped scores", () => {
  for (const p of [undefined, -1, 1.1, NaN, "0.9", null])
    assert.throws(
      () => parseAnswers({ answers: { b0: { type: "noul", noul: p }, b1: { type: "noul", noul: 0.1 } } }, blocks),
      SearchError,
    );
  // wrong answer type rejected even with a valid number
  assert.throws(
    () => parseAnswers({ answers: { b0: { type: "boolean", probability: 0.9 }, b1: { type: "noul", noul: 0.1 } } }, blocks),
    SearchError,
  );
  assert.throws(() => parseAnswers({}, blocks), SearchError);
  assert.throws(() => parseAnswers(null, blocks), SearchError);
});

test("parseAnswers: sorts by probability, resolves key sentence", () => {
  const out = parseAnswers(
    {
      answers: {
        b0: { type: "noul", noul: 0.6 },
        focus_b0: { choice: "s1" },
        b1: { type: "noul", noul: 0.9 },
        alien: { type: "noul", noul: 1 }, // ignored: no such block
      },
    },
    blocks,
  );
  assert.deepEqual(out.map((x) => x.id), ["b1", "b0"]);
  assert.equal(out[1].probability, 0.6);
  assert.match(out[1].focus.text, /No exceptions/);
  // single-sentence block resolves without a choice answer
  assert.equal(out[0].focus.text, blocks[1].text);
});

test("parseAnswers: rejects bad sentence choices", () => {
  const bad = ["s9", "x", "", 1, null];
  for (const choice of bad)
    assert.throws(
      () =>
        parseAnswers(
          { answers: { b0: { type: "noul", noul: 0.9 }, focus_b0: { choice }, b1: { type: "noul", noul: 0.1 } } },
          blocks,
        ),
      SearchError,
    );
});

test("fitBudget: small requests pass through untouched", () => {
  const fitted = fitBudget("fees", blocks);
  assert.equal(fitted.truncated, false);
  assert.deepEqual(fitted.blocks, blocks);
});

test("fitBudget: caps serialized payload at 60k bytes, keeps leading blocks", () => {
  const big = Array.from({ length: 160 }, (_, i) => ({
    id: `b${i}`,
    text: `Passage ${i} about refunds and fees. ` + "x".repeat(1900),
  }));
  const fitted = fitBudget("fees", big);
  assert.equal(fitted.truncated, true);
  const bytes = new TextEncoder().encode(
    JSON.stringify(makePayload({ query: "fees", blocks: fitted.blocks })),
  ).length;
  assert.ok(bytes <= PAYLOAD_BYTE_BUDGET, `payload is ${bytes} bytes`);
  assert.ok(fitted.blocks.length < 160 && fitted.blocks.length >= 1);
  // leading prefix preserved in order (what the dock's message describes)
  assert.deepEqual(
    fitted.blocks.map((b) => b.id),
    fitted.blocks.map((_, i) => `b${i}`),
  );
});

test("fitBudget: CJK worst case (3 bytes/char) still fits", () => {
  const cjk = Array.from({ length: 160 }, (_, i) => ({
    id: `b${i}`,
    text: "退".repeat(2000),
  }));
  const fitted = fitBudget("费用", cjk);
  const bytes = new TextEncoder().encode(
    JSON.stringify(makePayload({ query: "费用", blocks: fitted.blocks })),
  ).length;
  assert.ok(bytes <= PAYLOAD_BYTE_BUDGET, `payload is ${bytes} bytes`);
  assert.ok(fitted.blocks.length >= 1);
});

test("requestKey: deterministic, sensitive to query and text", () => {
  const a = requestKey("fees", blocks);
  assert.equal(requestKey("fees", blocks), a);
  assert.notEqual(requestKey("dogs", blocks), a);
  assert.notEqual(requestKey("fees", [{ id: "b0", text: "changed" }]), a);
});

const mockFetch = (answers, { status = 200, key = "sk-test-key" } = {}) => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(options.headers.Authorization, `Bearer ${key}`);
    assert.equal(options.method, "POST");
    JSON.parse(options.body); // must be valid JSON
    return status === 200
      ? { ok: true, json: async () => ({ answers }) }
      : { ok: false, status, json: async () => ({}) };
  };
  return { fetchImpl, calls };
};

test("searchDirect: full mocked round trip, threshold filters, key never leaks", async () => {
  const { fetchImpl, calls } = mockFetch({
    b0: { type: "noul", noul: 0.95 },
    focus_b0: { choice: "s1" },
    b1: { type: "noul", noul: 0.05 },
  });
  const result = await searchDirect("fees", blocks, "sk-test-key", { fetchImpl });
  assert.equal(calls.length, 1);
  assert.equal(result.matches.length, 1); // 0.05 < 0.58 dropped
  assert.equal(result.matches[0].id, "b0");
  assert.equal(result.matches[0].probability, 0.95);
  assert.match(result.matches[0].focus.text, /No exceptions/);
  assert.equal(result.threshold, THRESHOLD);
  assert.equal(result.truncated, false);
  assert.ok(!JSON.stringify(result).includes("sk-test-key"));
});

test("searchDirect: surfaces truncation flag from fitBudget", async () => {
  // 40 x 1500 CJK chars = 60,000 chars (passes validate) but ~180k bytes,
  // so fitBudget must trim before the request.
  const big = Array.from({ length: 40 }, (_, i) => ({
    id: `b${i}`,
    text: "退".repeat(1500),
  }));
  const answers = {};
  for (const b of big) {
    answers[b.id] = { type: "noul", noul: 0.9 };
    answers[`focus_${b.id}`] = { choice: "s0" };
  }
  const { fetchImpl } = mockFetch(answers, { key: "k" });
  const result = await searchDirect("费用", big, "k", { fetchImpl });
  assert.equal(result.truncated, true);
  assert.ok(result.matches.length > 0 && result.matches.length < 40);
});

test("searchDirect: status-specific errors, never fabricated matches", async () => {
  for (const [status, pattern] of [
    [401, /rejected the API key/],
    [402, /credits/],
    [403, /cannot access Jev/],
    [429, /Too many searches/],
    [500, /HTTP 500/],
  ]) {
    const { fetchImpl } = mockFetch({}, { status, key: "k" });
    await assert.rejects(searchDirect("fees", blocks, "k", { fetchImpl }), pattern);
  }
  const timeout = { name: "TimeoutError" };
  await assert.rejects(
    searchDirect("fees", blocks, "k", { fetchImpl: async () => { throw timeout; } }),
    /took too long/,
  );
  await assert.rejects(
    searchDirect("fees", blocks, "k", { fetchImpl: async () => { throw new Error("down"); } }),
    /Could not reach TypeSafe/,
  );
  await assert.rejects(
    searchDirect("fees", blocks, "k", {
      fetchImpl: async () => ({ ok: true, json: async () => { throw new Error("bad json"); } }),
    }),
    /unreadable response/,
  );
  // malformed answers from a 200: rejected, not passed through
  const { fetchImpl } = mockFetch({ b0: { type: "noul", noul: 0.9 } }, { key: "k" });
  await assert.rejects(searchDirect("fees", blocks, "k", { fetchImpl }), /incomplete/);
  // invalid input never reaches fetch
  let fetched = false;
  await assert.rejects(
    searchDirect("", blocks, "k", { fetchImpl: async () => { fetched = true; } }),
    SearchError,
  );
  assert.equal(fetched, false);
});

test("testConnection: ok, rejected key, unreachable", async () => {
  const ok = async () => ({ ok: true, status: 200 });
  await testConnection("k", { fetchImpl: ok });
  for (const status of [401, 403])
    await assert.rejects(
      testConnection("k", { fetchImpl: async () => ({ ok: false, status }) }),
      /rejected the API key/,
    );
  await assert.rejects(
    testConnection("k", { fetchImpl: async () => ({ ok: false, status: 500 }) }),
    /HTTP 500/,
  );
  await assert.rejects(
    testConnection("k", { fetchImpl: async () => { throw new Error("down"); } }),
    /Could not reach/,
  );
});

test("prompt version is exported for cache invalidation", () => {
  assert.equal(typeof PROMPT_VERSION, "number");
});
