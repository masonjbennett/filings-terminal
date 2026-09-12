// Rebuild the fixture cache: one slimmed companyfacts payload per filer, byte-identical to what the
// browser receives, because it is produced by driving the SHIPPING `api/facts.js` rather than by
// fetching SEC directly. That is the whole point — a fixture built any other way tests a copy.
//
// WHY THIS SCRIPT EXISTS. The cache is what makes a same-session full-diff and a 1,217-filer-year
// census possible, and it is what six of the README's open items are blocked on. It has been built
// twice and died twice, both times because it lived in a session scratchpad. It is a committed
// script now so rebuilding is one command, and the output has a documented home.
//
//   node scripts/build-fixtures.mjs                 → fixtures/ (gitignored by default)
//   node scripts/build-fixtures.mjs --out ../cache  → anywhere else
//   node scripts/build-fixtures.mjs --tickers AAPL,JPM
//
// It is RESUMABLE: a filer already on disk is skipped, so an interrupted run costs only what it had
// not reached. Re-fetch one filer by deleting its file.
//
// SEC's fair-access policy caps traffic at 10 requests/second and requires a declared User-Agent
// with real contact details. The handler carries the UA; this script carries the throttle, set well
// under the cap because each filer costs TWO requests inside the handler (companyfacts, then the
// submissions list).
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = n => { const i = process.argv.indexOf(n); return i < 0 ? null : process.argv[i + 1]; };
const outDir = arg("--out") || join(root, "fixtures");
const GAP_MS = Number(arg("--gap") || 400);

const tickers = JSON.parse(readFileSync(join(root, "public", "tickers.json"), "utf8"));
const cikOf = new Map(tickers.map(([cik, t]) => [t, String(cik).padStart(10, "0")]));
const want = (arg("--tickers") || "").split(",").filter(Boolean).map(t => t.toUpperCase());
const list = want.length ? want : JSON.parse(readFileSync(join(root, "scripts", "fixture-tickers.json"), "utf8"));

const handler = (await import(join(root, "api", "facts.js"))).default;
const sleep = ms => new Promise(r => setTimeout(r, ms));

mkdirSync(outDir, { recursive: true });
let built = 0, skipped = 0, failed = 0;
const failures = [];
for (const [i, t] of list.entries()) {
  const cik = cikOf.get(t);
  if (!cik) { failures.push(`${t}: not in tickers.json`); failed++; continue; }
  const file = join(outDir, `${t}.json`);
  if (existsSync(file)) { skipped++; continue; }
  // The same shim shape vite.config.js mounts the handler behind, so the payload is the one the
  // browser gets — including the KEEP slimming and the filings list.
  let status = 200, body = null;
  const res = { setHeader() {}, status(c) { status = c; return this; }, json(b) { body = b; return this; } };
  try {
    await handler({ query: { cik }, method: "GET", headers: {} }, res);
  } catch (e) {
    failures.push(`${t}: threw ${e && e.message}`); failed++; await sleep(GAP_MS); continue;
  }
  if (status !== 200 || !body || !body.facts) {
    failures.push(`${t}: handler answered ${status}${body && body.error ? ` — ${body.error}` : ""}`);
    failed++; await sleep(GAP_MS); continue;
  }
  writeFileSync(file, JSON.stringify(body));
  built++;
  if ((i + 1) % 20 === 0 || i === list.length - 1) {
    process.stdout.write(`  ${i + 1}/${list.length} · built ${built} · skipped ${skipped} · failed ${failed}\n`);
  }
  await sleep(GAP_MS);
}

const files = readdirSync(outDir).filter(f => f.endsWith(".json") && f !== "manifest.json");
const bytes = files.reduce((n, f) => n + statSync(join(outDir, f)).size, 0);
writeFileSync(join(outDir, "manifest.json"), JSON.stringify({
  filers: files.length, bytes, builtAt: new Date().toISOString().slice(0, 10),
  note: "Built by scripts/build-fixtures.mjs driving api/facts.js. Byte-identical to what the browser receives.",
}, null, 2) + "\n");

console.log(`\n${files.length} filers on disk · ${(bytes / 1e6).toFixed(1)} MB · ${outDir}`);
if (failures.length) {
  console.log(`\n${failures.length} did not build:`);
  for (const f of failures.slice(0, 20)) console.log("   " + f);
  // Every request failing is not a per-filer problem — it is the network. Say so rather than
  // leaving someone to read 161 identical lines.
  if (failed === list.length - skipped) {
    console.log("\nEVERY filer failed, which means SEC was not reachable at all rather than anything about the filers.");
    console.log("In a Claude Code web session that is the environment's network policy: data.sec.gov is not on the");
    console.log("allowlist. Either allow it on the environment, or build this cache from a local session and copy it.");
  }
}
