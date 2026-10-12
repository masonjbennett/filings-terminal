// Reintroduce each defect t-misdate claims to catch (rule 17's stand-down: the two recognisers, the
// repeat, the header guard, the marks and every place the page says why), and require the suite to go red.
//
//   node test/_mutate-misdate.mjs                 every mutant
//   node test/_mutate-misdate.mjs --from 1 --to 25   a chunk, by the numbers --list prints
//   node test/_mutate-misdate.mjs --list
//   node test/_mutate-misdate.mjs --restore       put back the originals a killed run left in the lock
//
// It refuses to start while t-misdate is red unmutated, and while test/.mutate-misdate.lock exists. The
// lock holds the original of every file this run mutates, with its sha256, from before the first
// mutation until a verified restore: each mutant is reverted in a `finally`, everything is restored again
// on exit, SIGINT and SIGTERM, and the lock is deleted only once every file hashes to its original. A
// lock still on disk (it is deliberately not ignored, so `git status` shows it) means a run was killed
// mid-mutation; --restore writes the originals back. Never stage anything while this runs.
//
// The suite runs with MISDATE_FAST=1: it stops at the first failure and skips its slowest passes. With
// FILINGS_FIXTURES pointed at the cache its pins on the 171 cached sheets run too; without it, only the
// synthetic sheets do, and the mutants only those pins catch survive.
//
// Each entry is [file, what the defect is, find, replace] — find and replace may be arrays, applied in
// order, each find required to match exactly once — and a fifth element names an EQUIVALENT mutant:
// one that cannot change any sheet, with the reason. Those run too, and are reported apart.
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCK = join(root, "test", ".mutate-misdate.lock");
const SUITE = join(root, "test", "t-misdate.mjs");
const sha = b => createHash("sha256").update(b).digest("hex");

const EX = "src/extract.js", GR = "src/grid.js", APP = "src/App.jsx";
const EARLIER = "const earlier = (h.get(p.end) || []).filter(f => f.accn !== m.accn && f.filed && m.filed && f.filed < m.filed);";
const STRAY = "return !s || (s.size === 1 && s.has(m.tag));";
const ANCHOR_KEY = "const key = `${f.accn}|${f.end}`;", STRAY_KEY = "const s = index.get(`${m.accn}|${m.end}`);";
const CUT = "reduced = { ...data, facts: withoutContexts(data.facts, R) };";
const HEADER = "const HEADER = [\"calendar\", \"behind\", \"announced\", \"ccy\", \"splits\"];";

const MUTS = [
  // ── The first test: outvoted, landing on a neighbour, convicted on purity ──
  [EX, "purity's every: a context is convicted when any one outvoted cell lands, not all",
    "const convicted = c.A > 0 && c.AC === c.A && c.nz.size >= 2;", "const convicted = c.A > 0 && c.AC > 0 && c.nz.size >= 2;"],
  [EX, "one tag is enough to convict",
    "const convicted = c.A > 0 && c.AC === c.A && c.nz.size >= 2;", "const convicted = c.A > 0 && c.AC === c.A && c.nz.size >= 1;"],
  [EX, "a zero that lands counts as a tag toward conviction",
    "if (val !== 0) c.nz.add(m.tag);", "c.nz.add(m.tag);"],
  [EX, "a zero that is outvoted no longer counts against conviction",
    "      const c = ctxOf(m);\n      c.A++;", "      if (val === 0) continue;\n      const c = ctxOf(m);\n      c.A++;"],
  [EX, "the landing may be on any filing's figure, not an older one",
    "f.filed && f.filed < m.filed && f.val === val", "f.val === val"],
  [EX, "outvoted weakened: one earlier filing that disagrees is enough",
    "!earlier.every(f => f.val !== val)", "!earlier.some(f => f.val !== val)"],
  [EX, "the landing is looked for on the cell's own column, not its neighbours",
    "const nbrs = [cols[i - 1], cols[i + 1]].filter(n => n && n.period);", "const nbrs = [cols[i], cols[i]].filter(n => n && n.period);"],
  [EX, "earlier admits later filings", EARLIER,
    "const earlier = (h.get(p.end) || []).filter(f => f.accn !== m.accn && f.filed && m.filed);"],
  [EX, "earlier admits the cell's own filing", EARLIER,
    "const earlier = (h.get(p.end) || []).filter(f => f.filed && m.filed && f.filed < m.filed);"],
  [EX, "the history the first test reads is widened below ANNUAL_MIN, so a quarter outvotes a year",
    "!(f.start && span(f) >= ANNUAL_MIN && span(f) <= ANNUAL_MAX)", "!(f.start && span(f) >= STRAY_MIN && span(f) <= ANNUAL_MAX)"],
  [EX, "a latest-only row (price, shares outstanding) is tested",
    "if (r.latest || typeof val !== \"number\") continue;", "if (typeof val !== \"number\") continue;"],

  // ── The second test: a duration whose own filing presents no period ending on its date ──
  [EX, "the 60-day floor goes to 0", "export const STRAY_MIN = 60;", "export const STRAY_MIN = 0;"],
  [EX, "the floor goes to 300, so a quarter's totals no longer present the year", "export const STRAY_MIN = 60;", "export const STRAY_MIN = 300;"],
  [EX, "no ANNUAL_MAX cap on an anchor's duration",
    "if (!(d >= STRAY_MIN && d <= ANNUAL_MAX)) continue;", "if (!(d >= STRAY_MIN)) continue;"],
  [EX, "the cell's own tag counts as an anchor", STRAY, "return !s;"],
  [EX, "a figure in a 10-Q is stray for being in a 10-Q", STRAY,
    "return /^10-Q/.test(String(m.form)) || !s || (s.size === 1 && s.has(m.tag));"],
  [EX, "an anchor from any filing counts, not only the cell's own",
    [ANCHOR_KEY, STRAY_KEY], ["const key = `|${f.end}`;", "const s = index.get(`|${m.end}`);"]],
  [EX, "an anchor ending on any date counts, not only the cell's",
    [ANCHOR_KEY, STRAY_KEY], ["const key = `${f.accn}|`;", "const s = index.get(`${m.accn}|`);"]],
  [EX, "an anchor from a filing that is not a periodic report (an 8-K) counts",
    "if (!f || !f.start || !periodic(f.form)) continue;", "if (!f || !f.start) continue;"],
  [EX, "the second test reaches instants (both duration guards dropped)",
    ["if (m.start && strayDuration(index, m)) ctxOf(m).stray = true;", "if (convicted || (c.duration && c.stray))"],
    ["if (strayDuration(index, m)) ctxOf(m).stray = true;", "if (convicted || c.stray)"]],
  [EX, "the second test's start guard alone dropped",
    "if (m.start && strayDuration(index, m)) ctxOf(m).stray = true;", "if (strayDuration(index, m)) ctxOf(m).stray = true;",
    "an instant's context is opened with duration false, and only a duration context is set aside as stray, so the flag it gains is never read"],
  [EX, "the duration guard on the stray verdict alone dropped",
    "if (convicted || (c.duration && c.stray))", "if (convicted || c.stray)",
    "only a cell with a start sets the stray flag, and a cell with a start opens a duration context, so no instant context is ever flagged"],

  // ── The rebuild and the repeat ──
  [GR, "the repeat follows instants",
    "if (!m || !REPORTED.has(m.status) || typeof c.v[k] !== \"number\" || !m.start) continue;",
    "if (!m || !REPORTED.has(m.status) || typeof c.v[k] !== \"number\") continue;"],
  [GR, "no repeat: one rebuild and stop", "    if (!adds.size) break;", "    break;"],
  [GR, "the repeat follows cells off the fetched lines",
    "if (!strayDuration(index, m) || !lineKeys.has(k)) continue;", "if (!strayDuration(index, m)) continue;",
    "every cell read for a duration sits on a fetched line that is not latest-only: the one latest-only line, the cover's shares outstanding, is an instant the repeat skips first, and no other line carries tags (0 of 37,736 reported duration cells in the annual columns of the 171 cached sheets lie off those lines)"],
  [GR, "the repeat skips nothing for being the cell's first source",
    "if (!s || s === (c0 ? contextOf(c0.meta[k]) : null) || R.has(s)) continue;", "if (!s || R.has(s)) continue;",
    "a first source that is a stray duration on a fetched line was already recognised by the second test, so it is in R and skipped by R.has"],
  [EX, "the deletion key loses the start, so a filing's instants and durations ending on one date go together",
    "const gone = f => f && accns.has(String(f.accn)) && keys.has(contextKey(f.accn, f.start, f.end));",
    "const ae = new Set([...keys.keys()].map(k => String(k).replace(/\\|.*\\.\\./, \"|\"))); const gone = f => f && ae.has(`${f.accn}|${f.end}`);"],
  [GR, "the contexts are cut from the split-adjusted facts, not the payload's own", CUT,
    "reduced = { ...data, facts: withoutContexts(applySplits(data.facts, g0.splits), R) };"],
  [GR, "each rebuilt sheet is recognised again, not only followed for strays",
    "const adds = new Map(), moves = [];",
    "const adds = new Map(), moves = []; if (g && !g.empty) for (const [s, x] of misdatedContexts(g.cols, applySplits(reduced.facts, g.splits), rows).found) if (!R.has(s)) adds.set(s, x);"],
  [GR, "the repeat's stray test reads the reduced facts, not the payload's",
    ["filingsInCurrency } from \"./extract.js\";", "const { found, outvoted, index, rows } = recogniseMisdated(data, g0);", "    g = buildSheet(reduced, quote, limit);\n"],
    ["filingsInCurrency, anchorIndex } from \"./extract.js\";", "const { found, outvoted, anchors, rows } = recogniseMisdated(data, g0); let index;", "    g = buildSheet(reduced, quote, limit); index = anchorIndex(reduced.facts, anchors);\n"]],
  [GR, "a set-aside context is cut only from the tags its cells were read under", CUT,
    "const rowTags = new Set([g0, g].filter(x => x && !x.empty).flatMap(x => x.cols.flatMap(c => Object.values(c.meta || {}).filter(m => m && R.has(contextOf(m))).map(m => m.tag)))); const cut = withoutContexts(data.facts, R); reduced = { ...data, facts: Object.fromEntries(Object.entries(cut).map(([t, d]) => [t, rowTags.has(t) ? d : data.facts[t]])) };"],

  // ── The header guard (31: a set-aside comparative can be a split's only witness) ──
  [GR, "the guard does not compare the split events", HEADER, "const HEADER = [\"calendar\", \"behind\", \"announced\", \"ccy\"];"],
  [GR, "the guard does not compare the currency", HEADER, "const HEADER = [\"calendar\", \"behind\", \"announced\", \"splits\"];"],
  [GR, "the memo path's guard compares the column periods only",
    "if (!headerMoved(known.header, headerOf(g))) {", "if (known.header.calendar.split(\"|\")[0] === headerOf(g).calendar.split(\"|\")[0]) {",
    "the header is built before the quote is applied (applyQuote writes only priced figures, in the newest year and twelve months), and the memo keeps reduced facts only when those same facts built a sheet whose header passed the cold path's guard, so its rebuild cannot move the header"],

  // ── The marks ──
  [GR, "a blank left by a set-aside filing keeps its old kind",
    "c.meta[x.k] = { status: SET_ASIDE, setAside: mark };", "c.meta[x.k] = { ...cur, setAside: mark };"],
  [GR, "a cell that moved gets no mark", "} else c.meta[x.k] = { ...cur, setAside: mark };", "}"],
  [GR, "the chain is cut to the first filing set aside",
    "ctxs: [ctx(s0, c0.v[k]), ...(chains.get(`${end}|${k}`) || []).map(x => ctx(x.key, x.value))] });", "ctxs: [ctx(s0, c0.v[k])] });"],
  [GR, "a twelve months no longer inherits its fiscal year's mark",
    "for (const L of g.ltmCols || []) {\n    const fy = byEnd.get(L.period.fyEnd)", "for (const L of []) {\n    const fy = byEnd.get(L.period.fyEnd)"],
  [GR, "a carried twelve months does not take the marks again", "if (g.ltm && !g.ltmStitched && g.cols.length) {", "if (false) {"],
  [GR, "an other-currency blank is not a blank the stand-down replaces",
    "const BLANK_KINDS = new Set([\"untagged-this-period\", \"never-tagged\", \"other-currency\"]);",
    "const BLANK_KINDS = new Set([\"untagged-this-period\", \"never-tagged\"]);"],
  [GR, "a cell re-sourced at the same figure is marked too",
    "    if (v === x.v0 && REPORTED.has(cur.status)) continue;\n", ""],

  // ── What the page says ──
  [APP, "the cell's word is gone",
    ": x.m.status === SET_ASIDE ? <span style={{ fontSize: 10, color: C.bronze, letterSpacing: .4 }}>set aside</span> : \"—\"))}", ": \"—\"))}"],
  [APP, "the tooltip branch is gone",
    "title={x.m.setAside ? setAsideTip(x.m.setAside, { k: line.k, fy: grid.cols[i].period.fy, fmt: display, ccy: grid.ccy, source: x.v == null ? null : src || \"\" })\n              : src || (x.m.week53 ? WEEK53_TIP[x.m.week53] : \"\")}>",
    "title={src || (x.m.week53 ? WEEK53_TIP[x.m.week53] : \"\")}>"],
  [APP, "the row's note is gone", "{saNote && <div style={NOTE_STYLE}>{saNote}</div>}", ""],
  [APP, "the legend line is gone",
    "<span><b style={{ color: C.bronze }}>set aside</b> — on a cell: a filing that does not present this year, or that dates another year's figures to it, is not read for it; the cell's tooltip and the row's note name it</span>", ""],
  [APP, "the workbook sentence is gone", "if (saLine) rows.push([{ v: saLine, s: XF.MUTED }]);", ""],
  [APP, "the copied sheet's sentence is gone", "if (saLine) out.push(saLine);", ""],
  [APP, "Comps' gap entry is gone",
    "...(basis === \"ltm\" ? { [SET_ASIDE]: (tic, lines) => `${tic}'s ${lines} for the fiscal year its twelve months rests on came only from a filing set aside for that year, so there is nothing to read` } : {}),", ""],
  [EX, "the tooltip loses \"besides this figure\"",
    "ending ${o.end} besides this figure, so it does not present the year", "ending ${o.end}, so it does not present the year"],
  [EX, "the row's note drops the column",
    "const y = SET_ASIDE_WORDS.year(first, c.period.fy), F = SET_ASIDE_WORDS.filing(first)", "const y = \"This year\", F = SET_ASIDE_WORDS.filing(first)"],
];

const args = process.argv.slice(2);
const num = name => { const i = args.indexOf(name); return i >= 0 ? Number(args[i + 1]) : null; };
if (args.includes("--list")) {
  MUTS.forEach(([file, what, , , eqv], i) => console.log(`${String(i + 1).padStart(2)}  ${eqv ? "(equivalent) " : ""}${what}  [${file}]`));
  process.exit(0);
}
const readLock = () => JSON.parse(readFileSync(LOCK, "utf8"));
// Write every original back, check each hashes to what it was, and only then delete the lock.
const restoreFrom = originals => {
  let ok = true;
  for (const [file, o] of Object.entries(originals)) {
    const p = join(root, file);
    if (sha(readFileSync(p)) !== o.sha256) writeFileSync(p, o.content);
    if (sha(readFileSync(p)) !== o.sha256) { ok = false; console.log(`RESTORE FAILED  ${file}: it does not hash to its original; the lock keeps it`); }
  }
  if (ok && existsSync(LOCK)) unlinkSync(LOCK);
  return ok;
};
if (args.includes("--restore")) {
  if (!existsSync(LOCK)) { console.log("no lock: nothing to restore"); process.exit(0); }
  process.exit(restoreFrom(readLock()) ? 0 : 1);
}
if (existsSync(LOCK)) {
  console.log(`REFUSED: ${LOCK} exists, so an earlier run was killed before it restored. Run with --restore, check git diff, then run again.`);
  process.exit(2);
}
const from = num("--from") ?? 1, to = num("--to") ?? MUTS.length;
if (!(from >= 1 && to <= MUTS.length && from <= to)) { console.log(`--from/--to must lie in 1..${MUTS.length}`); process.exit(2); }

const suite = () => spawnSync(process.execPath, [SUITE], { cwd: root, encoding: "utf8", env: { ...process.env, MISDATE_FAST: "1" }, timeout: 300000 });
const failLine = r => (`${r.stdout || ""}\n${r.stderr || ""}`.split("\n").map(l => l.trim()).filter(Boolean).filter((l, i, a) => /^FAIL /.test(a[i + 1] || "") || /Error/.test(l)).slice(0, 1)[0] || "").slice(0, 170);
const base = suite();
if (base.status !== 0) {
  console.log(`REFUSED: t-misdate is red unmutated, so a red mutant would prove nothing.\n${failLine(base)}`);
  process.exit(2);
}

// The lock is written before the first mutation and holds every file this run touches.
const originals = {};
for (const file of new Set(MUTS.slice(from - 1, to).map(m => m[0]))) {
  const buf = readFileSync(join(root, file)), content = buf.toString("utf8");
  if (sha(Buffer.from(content, "utf8")) !== sha(buf)) { console.log(`REFUSED: ${file} does not round-trip as UTF-8`); process.exit(2); }
  originals[file] = { content, sha256: sha(buf) };
}
writeFileSync(LOCK, JSON.stringify(originals));
let restored = false;
const restoreAll = () => { if (!restored) restored = restoreFrom(originals); return restored; };
process.on("exit", restoreAll);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { restoreAll(); process.exit(130); });

let caught = 0, survived = 0, errors = 0;
const eqv = [];
for (let i = from - 1; i < to; i++) {
  const [file, what, find, repl, equivalent] = MUTS[i], tag = `#${String(i + 1).padStart(2)}`;
  const o = originals[file], crlf = o.content.includes("\r\n");
  const finds = [].concat(find), repls = [].concat(repl);
  let text = o.content.split("\r\n").join("\n"), bad = null;
  finds.forEach((f, j) => {
    const n = text.split(f).length - 1;
    if (n !== 1) bad = bad || `anchor ${j + 1} matches x${n}`;
    else text = text.split(f).join(repls[j]);
  });
  if (bad) { errors++; console.log(`ERROR     ${tag} ${bad}: ${what} (${file})`); continue; }
  let r;
  try {
    writeFileSync(join(root, file), crlf ? text.split("\n").join("\r\n") : text);
    r = suite();
  } finally {
    writeFileSync(join(root, file), o.content);
  }
  if (sha(readFileSync(join(root, file))) !== o.sha256) { console.log(`ABORT     ${tag} ${file} did not revert`); process.exit(3); }
  const red = r.status !== 0, why = r.error ? `(${r.error.code || r.error.message})` : failLine(r);
  if (equivalent) {
    eqv.push(`${tag} ${what}: ${equivalent}`);
    console.log(`${red ? "red (named equivalent, yet caught)" : "equivalent"}  ${tag} ${what}`);
  } else if (red) { caught++; console.log(`red       ${tag} ${what}\n            by: ${why}`); }
  else { survived++; console.log(`SURVIVED  ${tag} ${what}  <-- t-misdate does not catch this`); }
}
const check = suite();
const ok = restoreAll();
const n = caught + survived;
console.log(`\n${caught} of ${n} non-equivalent mutants caught, ${survived} survived, ${errors} anchor errors (mutants ${from}-${to} of ${MUTS.length})`);
if (eqv.length) console.log(`equivalent, run and named:\n  ${eqv.join("\n  ")}`);
console.log(`unmutated suite after revert: ${check.status === 0 ? "green" : "RED — the revert failed"}; files restored and lock removed: ${ok ? "yes" : "NO"}`);
process.exit(survived || errors || check.status !== 0 || !ok ? 1 : 0);
