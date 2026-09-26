// Reintroduce each defect t-week53 claims to catch, and require the suite to go red.
// Always reverts, even on a throw. Run from the repo root: node test/_mutate-week53.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const MINUS = "−";

const MUTS = [
  ["src/grid.js", "only the endpoint is marked — the base's extra week is ignored",
    "const net = (c.period && c.period.weeks53 ? 1 : 0) - (base && base.period && base.period.weeks53 ? 1 : 0);",
    "const net = (c.period && c.period.weeks53 ? 1 : 0);"],
  ["src/grid.js", "only the base is marked — the endpoint's own extra week is ignored",
    "const net = (c.period && c.period.weeks53 ? 1 : 0) - (base && base.period && base.period.weeks53 ? 1 : 0);",
    "const net = 0 - (base && base.period && base.period.weeks53 ? 1 : 0);"],
  ["src/grid.js", "the direction is flipped",
    `if (net) c.meta[k] = { ...c.meta[k], week53: net > 0 ? "+wk" : "${MINUS}wk" };`,
    `if (net) c.meta[k] = { ...c.meta[k], week53: net > 0 ? "${MINUS}wk" : "+wk" };`],
  ["src/grid.js", "a mark floats beside a blank cell",
    "      if (c.v[k] == null) continue;\n      const base = cols[i - back];",
    "      const base = cols[i - back];"],
  ["src/grid.js", "the mark overwrites the cell's computed status instead of riding beside it",
    `if (net) c.meta[k] = { ...c.meta[k], week53: net > 0 ? "+wk" : "${MINUS}wk" };`,
    `if (net) c.meta[k] = { week53: net > 0 ? "+wk" : "${MINUS}wk" };`],
  ["src/grid.js", "the mark is written into v, where the full-diff counts it as a cell",
    `if (net) c.meta[k] = { ...c.meta[k], week53: net > 0 ? "+wk" : "${MINUS}wk" };`,
    `if (net) { c.meta[k] = { ...c.meta[k], week53: net > 0 ? "+wk" : "${MINUS}wk" }; c.v[k + "Week53"] = true; }`],
  ["src/grid.js", "the lookback table drops the 5-year CAGR",
    "  ...Object.fromEntries(Object.entries(CAGRS).map(([k, [, n]]) => [k, n])),",
    "  ...Object.fromEntries(Object.entries(CAGRS).filter(([k]) => k !== \"revCagr5\").map(([k, [, n]]) => [k, n])),"],
  ["src/grid.js", "a year-on-year rate is given the wrong lookback",
    "  ...Object.fromEntries(Object.keys(YOY).map(k => [k, 1])),",
    "  ...Object.fromEntries(Object.keys(YOY).map(k => [k, 2])),"],
  ["src/App.jsx", "the cell stops rendering the mark",
    "            {x.m.week53 && <span style={{ fontSize: 8, fontFamily: MONO, color: C.bronze, marginLeft: 4, letterSpacing: .3 }}>{x.m.week53}</span>}",
    ""],
  ["src/App.jsx", "the mark loses its tooltip, on cells that have no other one",
    `: (x.m.week53 ? WEEK53_TIP[x.m.week53] : "")}>`,
    `: ""}>`],
  ["src/template.js", "the note stops saying that two long years cancel",
    " A rate with a 53-week year at both ends is not marked, because the two cancel.", ""],
  ["src/template.js", "the short note no longer points at the marks",
    `const WEEKS53_SHORT = "Cells marked +wk or \\u2212wk are moved by a 53-week fiscal year`,
    `const WEEKS53_SHORT = "A 53-week fiscal year is on this sheet`],
];

let red = 0, green = 0;
for (const [file, what, from, to] of MUTS) {
  const original = readFileSync(file, "utf8");
  const lf = original.split("\r\n").join("\n");
  const n = lf.split(from).length - 1;
  if (n !== 1) { console.log(`ERROR  anchor x${n}: ${what} (${file})`); green++; continue; }
  try {
    const mutated = lf.split(from).join(to);
    writeFileSync(file, original.includes("\r\n") ? mutated.split("\n").join("\r\n") : mutated);
    const r = spawnSync(process.execPath, ["test/t-week53.mjs"], { encoding: "utf8" });
    if (r.status !== 0) { red++; console.log(`red    ${what}`); }
    else { green++; console.log(`SURVIVED  ${what}  <-- the suite does not catch this`); }
  } finally {
    writeFileSync(file, original);
  }
}
const check = spawnSync(process.execPath, ["test/t-week53.mjs"], { encoding: "utf8" });
console.log(`\n${red} caught, ${green} survived, of ${MUTS.length}`);
console.log(`unmutated suite after revert: ${check.status === 0 ? "green" : "RED — the revert failed"}`);
process.exit(green || check.status !== 0 ? 1 : 0);
