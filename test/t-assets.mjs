// Every static file the app fetches by a literal path must actually be in `public/`.
//
// Written because of a time bomb with a date on it. `public/damodaran-wacc-2026.json` was fetched by
// a hardcoded filename in App.jsx while the documented January chore said, in so many words, to
// "rename the file for the year". So the first person to do the chore correctly would have broken
// the reverse DCF's reference table — and broken it SILENTLY: Vercel answers a missing static path
// with a clean 404, `r.ok` is false, the `.then` chain resolves to null, `ref` stays null, and the
// industry picker and the Damodaran attribution line simply do not render. No console error, no
// visible failure, and the chore's own instruction to "keep the attribution" quietly undone by the
// chore's other instruction. Verified in production against /damodaran-wacc-2027.json: 404, ok:false.
//
// The file is now `damodaran-wacc.json` with no year in it — the year lives inside as `asOf`, which
// is what the page renders anyway — so the chore is "overwrite it" and cannot go stale. This suite
// is the guard that keeps it that way, and it covers every asset added later for free.
//
// It is deliberately a STRUCTURAL check rather than a list: it reads the shipping source, extracts
// the paths, and asserts against the filesystem. A list of expected assets is a thing that goes out
// of date, which is the defect this exists to prevent.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ok, eq, done } from "./_t.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const src = readFileSync(join(root, "src", "App.jsx"), "utf8");

// Literal absolute paths passed to fetch(). Template literals and /api/ routes are excluded: the
// first cannot be resolved statically, and the second are serverless functions, not files.
const paths = [...src.matchAll(/fetch\(\s*"(\/[^"?]+)"/g)].map(m => m[1]).filter(p => !p.startsWith("/api/"));
ok(paths.length > 0, "found at least one literal static fetch in App.jsx — a regex that matches nothing is not a test");
for (const p of new Set(paths))
  ok(existsSync(join(root, "public", p.slice(1))), `App.jsx fetches "${p}" — and public${p} exists`);

// The reverse DCF's reference table, specifically: it is the one that was booby-trapped, and the
// shape matters as much as the presence. `src/reverse.js` never supplies a default cost of capital,
// so if this file is missing or malformed the reader is left with an empty box and no reference.
const wacc = join(root, "public", "damodaran-wacc.json");
ok(existsSync(wacc), "the cost-of-capital reference is at public/damodaran-wacc.json — no year in the name");
ok(!readdirSync(join(root, "public")).some(f => /^damodaran-wacc-\d{4}\.json$/.test(f)),
  "and no year-stamped copy is left behind for the chore to rename instead");
{
  const j = JSON.parse(readFileSync(wacc, "utf8"));
  ok(Array.isArray(j.industries) && j.industries.length > 50, `it carries the industry table (${(j.industries || []).length} industries)`);
  ok(!!j.totalMarket && typeof j.totalMarket.costOfCapital === "number", "and the total-market row the picker offers alongside them");
  // The year belongs HERE, not in the filename — this is the field the page renders, and it is what
  // makes a stable filename safe. If the chore ever stops updating it the page shows a stale date
  // rather than nothing, which is the failure mode worth having.
  ok(typeof j.asOf === "string" && /\d{4}/.test(j.asOf), `the vintage is inside the file as \`asOf\` ("${j.asOf}"), which is what the page prints`);
  ok(typeof j.url === "string" && j.url.startsWith("http"), "and the attribution URL, which the page links — the chore says keep the attribution and this is it");
  const bad = j.industries.filter(i => !i.name || typeof i.costOfCapital !== "number" || i.costOfCapital < 0 || i.costOfCapital > 0.5);
  eq(bad.length, 0, `every industry has a name and a cost of capital in a plausible range${bad.length ? " — bad: " + bad.slice(0, 3).map(b => b.name).join(", ") : ""}`);
  // The Query Drill on the main site keys off `evEbitda` in ITS damodaran file; this one is the WACC
  // table and needs `costOfCapital`. Asserting the field the consumer reads, not a field that exists.
  ok(j.industries.every(i => Number.isFinite(i.costOfCapital)), "no industry is missing the one number the picker copies into the box");
}

// ── The brand typefaces have to actually be loaded ──────────────────────────────────────────────
// `App.jsx` has declared Instrument Serif, Space Grotesk and JetBrains Mono since the first version
// and NOTHING ever loaded them: no @fontsource dependency, no <link>, no @font-face, no stylesheet
// in `dist/` at all. Production served zero stylesheets and the computed body font was Times New
// Roman. It looked deliberate on every machine — Palatino/Segoe UI/Consolas on Windows, Palatino/
// system/SF Mono on macOS — which is why nothing caught it for the life of the project, and it is
// hard constraint 5 (keep the paper/ink editorial brand) failing silently.
//
// A declared font nobody loads is the same defect class as a declared formula nobody implements:
// there is no failure to observe, only a page that quietly is not what it says it is.
{
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const main = readFileSync(join(root, "src", "main.jsx"), "utf8");
  const app = readFileSync(join(root, "src", "App.jsx"), "utf8");
  for (const [family, dep] of [["Instrument Serif", "instrument-serif"], ["Space Grotesk", "space-grotesk"], ["JetBrains Mono", "jetbrains-mono"]]) {
    ok(!!pkg.dependencies[`@fontsource/${dep}`], `${family} is a dependency — self-hosted, the same package the main site uses`);
    ok(app.includes(`'${family}'`), `...and App.jsx still asks for it`);
    ok(new RegExp(`@fontsource/${dep}/`).test(main), `...and src/main.jsx actually LOADS it, which is the half that was missing`);
  }
  // Only the weights the page uses. 400 and 600 are the only values in App.jsx; importing more ships
  // font files for faces nothing asks for, and importing fewer makes the browser synthesise one.
  const wanted = app.match(/(?:font: *`|fontWeight: *)["'`]?(\d{3})/g) || [];
  const weights = [...new Set(wanted.map(s => s.match(/(\d{3})/)[1]))].sort();
  eq(weights.join(","), "400,600", `App.jsx uses exactly these weights (${weights.join(", ")})`);
  for (const w of weights) {
    ok(main.includes(`space-grotesk/${w}.css`), `Space Grotesk ${w} is imported — the body face at a weight the page renders`);
    ok(main.includes(`jetbrains-mono/${w}.css`), `JetBrains Mono ${w} is imported — every figure on the sheet is set in it`);
  }
  ok(main.includes("instrument-serif/400.css"), "Instrument Serif 400 is imported — the headline face, used at 400 only");
}

done("t-assets");
