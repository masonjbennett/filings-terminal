// A FAILURE MUST NOT BE CACHED, and all four handlers used to cache one.
//
// Each set its `Cache-Control` before the try block, so every error return carried it: `api/facts.js`
// handed a 502 "couldn't reach SEC" to the edge with six hours of s-maxage behind it, and
// `api/sections.js` was worse — both its failure paths return HTTP **200** with `rendered: false`,
// because "this filing predates the Financial Report renderer" is a legitimate answer, so a timeout
// or a 503 was cached as a SUCCESS for seven days plus seven of stale-while-revalidate. On a page
// whose whole argument is that every reported figure opens the document it came from, that is the
// quietest possible way to lose the per-cell links: nothing errors, nothing retries, the edge just
// answers "no sections" for a fortnight.
//
// The rule is one line: cache the answer, never the failure to get one. The single exception is a
// genuine 404 from FilingSummary.xml, which IS the durable answer for an old filing.
//
// Drives the SHIPPING handlers with `fetch` stubbed, through the same {query} / {status,json,
// setHeader} shim shape `vite.config.js` uses for the dev server.
import { ok, eq, done } from "./_t.mjs";

const shim = () => {
  const h = {};
  const r = { statusCode: 200, headers: h, body: null,
    setHeader(k, v) { h[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; } };
  return r;
};
const cache = r => r.headers["cache-control"];
const isPublic = r => typeof cache(r) === "string" && cache(r).startsWith("public");

const realFetch = globalThis.fetch;
// The handlers console.error on failure, which is correct of them and noise here.
const withFetch = async (impl, fn) => {
  const err = console.error; console.error = () => {};
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = realFetch; console.error = err; }
};
const dead = () => { throw new Error("ECONNRESET"); };
const answering = status => async () => ({ ok: status >= 200 && status < 300, status, json: async () => ({}), text: async () => "" });

const facts = (await import("../api/facts.js")).default;
const quote = (await import("../api/quote.js")).default;
const sections = (await import("../api/sections.js")).default;

// ── api/facts.js ────────────────────────────────────────────────────────────────────────────────
// MUTATION: moving the setHeader back above the try fails every assertion in this block.
{
  const r = shim();
  await withFetch(dead, () => facts({ query: { cik: "0000320193" } }, r));
  eq(r.statusCode, 502, "an unreachable SEC is a 502");
  ok(!isPublic(r), `and it carries no public cache header — got ${JSON.stringify(cache(r))}. Six hours of s-maxage on "couldn't reach SEC" keeps the error alive long after SEC is back.`);

  const r404 = shim();
  await withFetch(answering(404), () => facts({ query: { cik: "0000000001" } }, r404));
  eq(r404.statusCode, 404, "a company with no XBRL data is a 404");
  ok(!isPublic(r404), "and is not cached either — SEC answers 404 during maintenance too, and six hours of \"no data on file\" for a filer that has data is a lie with a long tail");

  const rBad = shim();
  await facts({ query: { cik: "" } }, rBad);
  eq(rBad.statusCode, 400, "a missing cik is rejected");
  ok(!isPublic(rBad), "and not cached");
}

// ── api/quote.js ────────────────────────────────────────────────────────────────────────────────
{
  const r = shim();
  await withFetch(dead, () => quote({ query: { symbol: "AAPL" } }, r));
  ok(r.statusCode >= 400, `an unreachable quote desk is an error — got ${r.statusCode}`);
  ok(!isPublic(r), "and is not cached: a cached 502 outlives the outage that caused it");

  const rKey = shim();
  const saved = process.env.FINNHUB_KEY;
  delete process.env.FINNHUB_KEY;
  await quote({ query: { symbol: "AAPL" } }, rKey);
  if (saved !== undefined) process.env.FINNHUB_KEY = saved;
  eq(rKey.statusCode, 503, "a deployment with no FINNHUB_KEY says so");
  ok(!isPublic(rKey), "and does not cache it — the key can be added without waiting out a cache");
}

// ── api/sections.js — the one that returned 200 on failure ──────────────────────────────────────
// MUTATION: collapsing the 404 and the transient case back into one branch fails here.
{
  const accn = "0000320193-25-000079";
  const rDead = shim();
  await withFetch(dead, () => sections({ query: { cik: "320193", accn } }, rDead));
  eq(rDead.statusCode, 200, "a transient failure still answers 200 with rendered:false — the caller links to the filing index, which always exists");
  eq(rDead.body.rendered, false, "and says it rendered nothing");
  ok(!isPublic(rDead), `but it must NOT be cached — got ${JSON.stringify(cache(rDead))}. This is the fortnight-long silent loss of every per-cell section link on that filing.`);

  const r404 = shim();
  await withFetch(answering(404), () => sections({ query: { cik: "320193", accn } }, r404));
  eq(r404.statusCode, 200, "a filing that predates the renderer also answers 200");
  eq(r404.body.rendered, false, "with rendered:false");
  ok(isPublic(r404), "and THIS one is cached for the week — a 404 from FilingSummary.xml is the durable answer, not a failure to get one");

  const r503 = shim();
  await withFetch(answering(503), () => sections({ query: { cik: "320193", accn } }, r503));
  ok(!isPublic(r503), "a 503 is transient and is not cached, even though it takes the same rendered:false branch as the 404");
}

done("t-cache");
