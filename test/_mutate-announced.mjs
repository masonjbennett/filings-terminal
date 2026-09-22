// Reintroduce each defect the suite claims to catch, and require the suite to go red.
// Always reverts, even on a throw. Run from the repo root.
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const MUTS = [
  ["src/grid.js", "lag measured from the newest FILED periodic, not the newest period covered",
    "if (!(dayGap(pMax.period, e.period) >= LAG_MIN)) return null;",
    "if (!(dayGap(pFiled.period, e.period) >= LAG_MIN)) return null;"],
  ["src/grid.js", "lag gate excludes its own boundary",
    "dayGap(pMax.period, e.period) >= LAG_MIN", "dayGap(pMax.period, e.period) > LAG_MIN"],
  ["src/grid.js", "threshold lowered to 99, taking AbbVie's unfinalised guidance table",
    "export const LAG_MIN = 100;", "export const LAG_MIN = 99;"],
  ["src/grid.js", "same-day filings count as later",
    "if (!(e.filed > pFiled.filed)) return null;", "if (!(e.filed >= pFiled.filed)) return null;"],
  ["src/grid.js", "the freshness ceiling removed",
    "export const ANNOUNCED_MAX_AGE = 120;", "export const ANNOUNCED_MAX_AGE = 100000;"],
  ["src/grid.js", "items matched as a substring rather than a token",
    `String(f.items ?? "").split(",").map(s => s.trim()).includes("2.02")`,
    `String(f.items ?? "").includes("2.02")`],
  ["src/grid.js", "8-K/A accepted",
    `String(f.form) === "8-K"`, `/^8-K/.test(String(f.form))`],
  ["src/grid.js", "no periodic report is not a refusal",
    "  const per = rows.filter(f => f && PERIODIC.test(String(f.form)) && ISODATE.test(String(f.filed)));\n  if (!per.length) return null;",
    "  const per = rows.filter(f => f && PERIODIC.test(String(f.form)) && ISODATE.test(String(f.filed)));\n  if (!per.length) return { form: null, filed: null, period: null, annFiled: null, annEvent: null, annAccn: null };"],
  ["src/grid.js", "the announcement dropped from the empty-grid return",
    "empty: true, announced };", "empty: true };"],
  ["src/grid.js", "the periodic pattern drifts from extract.js's",
    "const PERIODIC = /^(10-K|10-Q|20-F|40-F)T?(\\/A)?$/;", "const PERIODIC = /^(10-K|10-Q|20-F|40-F)(\\/A)?$/;"],
  ["api/facts.js", "items never reaches the browser",
    ", items: r.items ? r.items[i] : null });", " });"],
  ["api/facts.js", "the cache tier is one constant again",
    "hasLaterAnn(filings) ? CACHE_FRESH : CACHE_OK", "CACHE_OK"],
  ["src/App.jsx", "the provenance sentence claims every figure below",
    "The reported figures below are read from this company", "Every figure below comes from this company"],
  ["src/App.jsx", "the banner describes the document instead of the cover page",
    "SEC&rsquo;s heading\n              for <i>Results of Operations and Financial Condition</i>",
    "which is its earnings release\n              for <i>Results of Operations and Financial Condition</i>"],
  ["src/App.jsx", "the freshness ceiling is not consulted at the render",
    "{grid.announced && announcedIsCurrent(grid.announced, new Date().toISOString().slice(0, 10)) && (() => {",
    "{grid.announced && (() => {"],
  ["src/App.jsx", "the comps paragraph says nothing filed since again",
    "filed no quarterly report since the year end", "nothing filed since the year end"],
];

let red = 0, green = 0;
for (const [file, what, from, to] of MUTS) {
  const original = readFileSync(file, "utf8");
  const lf = original.split("\r\n").join("\n");
  if (!lf.includes(from)) { console.log(`ERROR  anchor gone: ${what} (${file})`); green++; continue; }
  if (lf.split(from).length - 1 !== 1) { console.log(`ERROR  anchor x${lf.split(from).length - 1}: ${what}`); green++; continue; }
  try {
    const mutated = lf.split(from).join(to);
    writeFileSync(file, original.includes("\r\n") ? mutated.split("\n").join("\r\n") : mutated);
    const r = spawnSync(process.execPath, ["test/t-announced.mjs"], { encoding: "utf8" });
    if (r.status !== 0) { red++; console.log(`red    ${what}`); }
    else { green++; console.log(`SURVIVED  ${what}  <-- the suite does not catch this`); }
  } finally {
    writeFileSync(file, original);
  }
}
const check = spawnSync(process.execPath, ["test/t-announced.mjs"], { encoding: "utf8" });
console.log(`\n${red} caught, ${green} survived, of ${MUTS.length}`);
console.log(`unmutated suite after revert: ${check.status === 0 ? "green" : "RED — the revert failed"}`);
process.exit(green || check.status !== 0 ? 1 : 0);
