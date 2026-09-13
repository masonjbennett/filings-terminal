// The full-diff: every rendered cell of every cached filer, snapshotted at one commit and diffed
// against another. This is the measurement every engine change in the README quotes — "2 filers
// moved, 0 values changed, 95 appeared, 0 vanished" — and until now the script producing it lived in
// a session scratchpad and died with the session, so each change rewrote it. It is committed so the
// number means the same thing every time it is quoted.
//
//   node scripts/full-diff.mjs snapshot <out.json> [--price 100] [--fixtures <dir>]
//   node scripts/full-diff.mjs diff <before.json> <after.json> [--out <report.json>] [--show 40]
//
// What it counts, and why each count exists:
//   values changed   — a cell non-null on both sides with a different number. The headline.
//   appeared/vanished— null on one side only. A rule that fills a row shows here, not above.
//   source moved     — same number, different accession or form. The per-cell EDGAR link moved;
//                      rule 13's 8-K → 10-K moves were this shape.
//   status changed   — same number (or same blank), different status. A blank that changed KIND
//                      (rule 5) shows here and nowhere else.
//   concept switches — a row whose resolved TAG differs between adjacent columns. "0 values
//                      changed" is a per-cell count and cannot see a row that changes concept
//                      between columns (rule 21, rule 28's first version); this can.
//   calendar changed — a filer whose column set (period ends) differs. Nothing per-cell is
//                      comparable for that filer, so it is reported once and its cells are skipped.
//   flags changed    — a BOOLEAN cell (`equityThin`, `stDebtIsLtdCur`, `week53Sheet`…) whose
//                      truth changed. A flag is a verdict, not a figure: a new one appearing on
//                      every column is not 1,800 cells appearing, and the counts above must not say
//                      it is, or the headline stops meaning what the README quotes it as.
// Drives the SHIPPING grid: run it at the commit before the change and again after, on the same
// cache, and diff. A snapshot is ~30MB for 180 filers; keep them in the scratchpad, not the repo.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = n => { const i = argv.indexOf(n); return i < 0 ? null : argv[i + 1]; };
const mode = argv[0];

const FIELDS = ["v", "status", "tag", "form", "accn"];
const cellOf = (col, k) => {
  const m = col.meta[k] || {};
  const v = col.v[k];
  return [typeof v === "number" && isFinite(v) ? v : (v === true ? true : v == null ? null : v), m.status || null, m.tag || null, m.form || null, m.accn || null];
};

async function snapshot() {
  const out = argv[1];
  if (!out) { console.error("usage: snapshot <out.json>"); process.exit(2); }
  const dir = arg("--fixtures") || process.env.FILINGS_FIXTURES || join(root, "fixtures");
  const price = arg("--price") ? Number(arg("--price")) : null;
  const { buildGrid } = await import(pathToFileURL(join(root, "src", "grid.js")).href);
  const files = readdirSync(dir).filter(f => f.endsWith(".json") && f !== "manifest.json").sort();
  const snap = { at: new Date().toISOString().slice(0, 10), fixtures: dir, price, filers: {} };
  let n = 0;
  for (const f of files) {
    const t = f.replace(/\.json$/, "");
    let g;
    try { g = buildGrid(JSON.parse(readFileSync(join(dir, f), "utf8")), price ? { price } : null, 8); }
    catch (e) { snap.filers[t] = { error: String(e && e.message) }; continue; }
    if (!g || g.empty) { snap.filers[t] = { empty: true }; continue; }
    const col = c => ({ end: c.period.end, start: c.period.start || null, gapBefore: c.period.gapBefore || 0,
      cells: Object.fromEntries(Object.keys(c.v).map(k => [k, cellOf(c, k)])) });
    snap.filers[t] = { industry: g.industry, ccy: g.ccy || null, cols: g.cols.map(col), ltm: g.ltmCols.map(col) };
    n++;
  }
  writeFileSync(out, JSON.stringify(snap));
  console.log(`${n} filers snapshotted → ${out}`);
}

const same = (a, b) => (a == null && b == null) || (typeof a === "number" && typeof b === "number"
  ? Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b), 1) : a === b);

function diff() {
  const [A, B] = [argv[1], argv[2]].map(p => JSON.parse(readFileSync(p, "utf8")));
  const show = Number(arg("--show") || 40);
  const r = { calendarChanged: [], valuesChanged: [], appeared: [], vanished: [], sourceMoved: [], statusChanged: [], flagsChanged: [], conceptSwitches: { gained: [], lost: [] }, filersMoved: new Set(), keysTouched: {} };
  const touch = (k, bucket) => { (r.keysTouched[k] = r.keysTouched[k] || {})[bucket] = ((r.keysTouched[k] || {})[bucket] || 0) + 1; };
  const switches = fl => {
    // Per row, the adjacent-column pairs where the resolved tag differs — rule 21's failure shape.
    const s = new Set();
    for (const cols of [fl.cols || []]) for (let i = 1; i < cols.length; i++) {
      for (const k of Object.keys(cols[i].cells)) {
        const [, , ta] = cols[i - 1].cells[k] || [], [, , tb] = cols[i].cells[k] || [];
        if (ta && tb && ta !== tb) s.add(`${k}@${cols[i].end}:${ta}→${tb}`);
      }
    }
    return s;
  };
  for (const t of new Set([...Object.keys(A.filers), ...Object.keys(B.filers)])) {
    const a = A.filers[t], b = B.filers[t];
    if (!a || !b || a.error || b.error || a.empty || b.empty) { if (JSON.stringify(a) !== JSON.stringify(b)) r.calendarChanged.push({ t, before: a && (a.error || (a.empty && "empty")) || (a ? "ok" : "absent"), after: b && (b.error || (b.empty && "empty")) || (b ? "ok" : "absent") }); continue; }
    for (const which of ["cols", "ltm"]) {
      const ca = a[which] || [], cb = b[which] || [];
      if (ca.map(c => c.end).join() !== cb.map(c => c.end).join()) { r.calendarChanged.push({ t, which, before: ca.map(c => c.end), after: cb.map(c => c.end) }); r.filersMoved.add(t); continue; }
      ca.forEach((colA, i) => {
        const colB = cb[i];
        for (const k of new Set([...Object.keys(colA.cells), ...Object.keys(colB.cells)])) {
          const x = colA.cells[k] || [null, null, null, null, null], y = colB.cells[k] || [null, null, null, null, null];
          const where = { t, col: which === "ltm" ? `LTM ${colA.end}` : colA.end, k };
          if (typeof x[0] === "boolean" || typeof y[0] === "boolean") {
            if (!!x[0] !== !!y[0]) { r.flagsChanged.push({ ...where, before: !!x[0], after: !!y[0] }); touch(k, "flag"); }
            continue;
          }
          if (!same(x[0], y[0])) {
            r.filersMoved.add(t);
            if (x[0] == null) { r.appeared.push({ ...where, after: y[0], tag: y[2] }); touch(k, "appeared"); }
            else if (y[0] == null) { r.vanished.push({ ...where, before: x[0], tag: x[2], status: y[1] }); touch(k, "vanished"); }
            else { r.valuesChanged.push({ ...where, before: x[0], after: y[0], tagBefore: x[2], tagAfter: y[2] }); touch(k, "changed"); }
          } else if (x[4] !== y[4] || x[3] !== y[3]) { r.sourceMoved.push({ ...where, before: `${x[3]} ${x[4]}`, after: `${y[3]} ${y[4]}` }); touch(k, "source"); r.filersMoved.add(t); }
          else if (x[1] !== y[1]) { r.statusChanged.push({ ...where, before: x[1], after: y[1] }); touch(k, "status"); }
        }
      });
    }
    const sa = switches(a), sb = switches(b);
    for (const s of sb) if (!sa.has(s)) r.conceptSwitches.gained.push(`${t} ${s}`);
    for (const s of sa) if (!sb.has(s)) r.conceptSwitches.lost.push(`${t} ${s}`);
  }
  const n = xs => xs.length;
  console.log(`full-diff ${A.at} → ${B.at}` + (A.price || B.price ? ` (price ${A.price} → ${B.price})` : "") + `
  filers moved:      ${r.filersMoved.size}
  values changed:    ${n(r.valuesChanged)}
  appeared:          ${n(r.appeared)}
  vanished:          ${n(r.vanished)}
  source moved:      ${n(r.sourceMoved)}
  status changed:    ${n(r.statusChanged)}
  flags changed:     ${n(r.flagsChanged)}
  concept switches:  +${n(r.conceptSwitches.gained)} / -${n(r.conceptSwitches.lost)}
  calendar changed:  ${n(r.calendarChanged)}`);
  const keys = Object.entries(r.keysTouched).sort((x, y) => Object.values(y[1]).reduce((s, v) => s + v, 0) - Object.values(x[1]).reduce((s, v) => s + v, 0));
  if (keys.length) console.log("\n  by row: " + keys.slice(0, 25).map(([k, c]) => `${k} ${Object.entries(c).map(([b, v]) => `${b} ${v}`).join(", ")}`).join("\n          "));
  const fmt = x => typeof x === "number" ? (Math.abs(x) >= 1e5 ? x.toLocaleString("en-US") : String(x)) : String(x);
  for (const [name, xs] of [["calendar changed", r.calendarChanged], ["values changed", r.valuesChanged], ["vanished", r.vanished], ["appeared", r.appeared], ["source moved", r.sourceMoved], ["status changed", r.statusChanged], ["flags changed", r.flagsChanged]]) {
    if (!xs.length) continue;
    console.log(`\n  ${name} (first ${Math.min(show, xs.length)} of ${xs.length}):`);
    for (const x of xs.slice(0, show)) console.log("    " + (x.k ? `${x.t} ${x.col} ${x.k}: ${fmt(x.before)} → ${fmt(x.after)}${x.tagBefore && x.tagAfter && x.tagBefore !== x.tagAfter ? ` (${x.tagBefore} → ${x.tagAfter})` : x.tag ? ` (${x.tag})` : ""}${x.status ? ` [${x.status}]` : ""}` : JSON.stringify(x)));
  }
  for (const [name, xs] of [["concept switches gained", r.conceptSwitches.gained], ["concept switches lost", r.conceptSwitches.lost]]) {
    if (!xs.length) continue;
    console.log(`\n  ${name} (first ${Math.min(show, xs.length)} of ${xs.length}):`);
    for (const x of xs.slice(0, show)) console.log("    " + x);
  }
  if (arg("--out")) writeFileSync(arg("--out"), JSON.stringify({ ...r, filersMoved: [...r.filersMoved] }, null, 1));
}

if (mode === "snapshot") await snapshot();
else if (mode === "diff") diff();
else { console.error("usage: full-diff.mjs snapshot <out.json> | diff <before.json> <after.json>"); process.exit(2); }
