// EVERY VALUE DECLARED IN template.js MUST BE READ BY THE ENGINE.
//
// This is the one suite that tests for ABSENCE, and it exists because absence is the defect class
// this repo keeps producing. A value the engine never reads has no behaviour, so no test of
// behaviour can fail on it — and the page renders a blank, which cannot be mis-computed. The class
// has landed five times:
//
//   `revCagr3` / `revCagr5`  declared as formulas, implemented nowhere, blank on every sheet served
//   `fallback:`              declared on three rows, wired on exactly one (`nii`)
//   `derivedOnly:`           declared on 8 sections, read nowhere, and FALSE on 3 of them
//   `chgNwc`                 declared `nwc - nwc[-1]`, implemented NOWHERE — rule 25
//   `ufcf`                   declared `nopat + da - capex - chgNwc`, computed without the ΔNWC term
//
// A suite of this shape was written twice — Aug 17, which caught `derivedOnly` on its first run, and
// again in the Sep 11 audit — and BOTH times it died uncommitted with its session, which is why
// rule 25's two were still on the page three weeks later. It is committed now. That is the whole
// point of `test/` existing, and it is why this file leads with the history rather than the code.
//
// Two things make the gate trustworthy rather than decorative, and both are assertions here:
//
//   1. COMMENTS ARE STRIPPED BEFORE MATCHING. `fallback:` was found by `grep fallback src/grid.js
//      src/extract.js` returning ONLY COMMENTS. A matcher that counts prose reports a wired property
//      that is not wired, and template.js itself contains `// No \`flagNote\` here, deliberately.` —
//      a comment stating a property's ABSENCE, which a naive search scores as a read.
//   2. THE RECEIVER IS CHECKED, not just the property name. `.label` appears in src/App.jsx twelve
//      times as `S.label` (a CSS style object), plus on TABS entries, segment members and the
//      reverse-DCF plate's basis descriptor. If `label` were deleted from every template line, a
//      bare `.label` search would still match and this suite would pass while the sheet lost every
//      row heading. Only a read off one of the engine's template iteration variables counts.
//
// The matcher's own correctness is asserted at the bottom, for the reason t-balance records: a
// mutation harness that does not check its anchor matched reports SURVIVES when it never mutated
// anything. A gate that silently stops matching is worse than no gate.
//
// Drives the SHIPPING modules. src/grid.js and src/extract.js are imported and executed; src/App.jsx
// is read as TEXT because it is JSX and node cannot parse it — which is exactly why the App.jsx half
// of this audit is the weaker half, and why it is fenced with the receiver check.
import { ok, eq, done } from "./_t.mjs";
import { SECTIONS, OVERLAY_SECTIONS, COMPS_ROWS, COMPS_MEDIAN, EQUITY_DENOMINATED, CURRENCY_DENOMINATED, tally,
  NOT_APPLICABLE, PERIOD_TAGS, INDUSTRY, INDUSTRY_LABEL } from "../src/template.js";
import { DERIVED, DERIVED_BY_INDUSTRY, DERIVED_PRICED, PRICED_NEEDS_SHARES, YOY, CAGRS } from "../src/extract.js";
import { isInstant, sectionsFor } from "../src/grid.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = p => readFileSync(join(root, ...p.split("/")), "utf8");

// Line and block comments out. Anchored on `[^:\\]` before `//` so a URL in a string survives — the
// one thing that would cut real code out of the middle of a file and make everything below it look
// unread. Deliberately NOT line-ending-sensitive: this repo's working copies are CRLF on Windows and
// LF here, and a mutation harness for this very engine once reported four false survivors because
// its anchors were written with `\n`.
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");

// THE ENGINE, for the purpose of "is this declaration read": the files that actually receive a
// template object. Only these two import template.js. src/extract.js, src/xlsx.js, src/reverse.js and
// all four api/ handlers import NOTHING from it — so a match in them cannot be a read of a
// declaration, and counting one is how `mustBeCurrent` and `preferNonZero` look wired from
// src/extract.js when what that file reads is the plain OPTIONS OBJECT src/grid.js assembles for it.
const ENGINE = { "src/grid.js": stripComments(read("src/grid.js")), "src/App.jsx": stripComments(read("src/App.jsx")) };

// The names the engine binds a template object to. Small, stable, and checked rather than assumed:
// `line`/`l` for a line, `sec`/`s` for a section, `r`/`row` for a comps row, `g`/`group` for a comps
// group. A rename breaks this suite loudly, which is the correct outcome — it is asking to be told
// the new name, not guessing.
const RECEIVERS = ["line", "l", "sec", "s", "r", "row", "g", "group"];
const readSites = prop => {
  const out = [];
  const recv = "(?:" + RECEIVERS.join("|") + ")";
  for (const [file, src] of Object.entries(ENGINE)) {
    const member = new RegExp("\\b" + recv + "\\s*\\.\\s*" + prop + "(?![A-Za-z0-9_$])", "g");
    const bracket = new RegExp("\\b" + recv + "\\s*\\[\\s*[\"']" + prop + "[\"']\\s*\\]", "g");
    const n = (src.match(member) || []).length + (src.match(bracket) || []).length;
    if (n) out.push(`${file}×${n}`);
  }
  return out;
};

// ── Every property declared anywhere in the template is read off a template object ───────────────
// Walked rather than listed, so a property added to ONE line of ONE overlay is covered the moment it
// exists. That is the difference between this and a checklist: a checklist only ever knows about the
// defects already found.
const declared = new Map();
const declare = (obj, where) => { for (const p of Object.keys(obj)) declared.set(p, (declared.get(p) || new Set()).add(where)); };
for (const sec of SECTIONS) { declare(sec, "section"); for (const line of sec.lines) declare(line, "line"); }
for (const secs of Object.values(OVERLAY_SECTIONS)) for (const sec of secs) { declare(sec, "overlay section"); for (const line of sec.lines) declare(line, "overlay line"); }
for (const grp of COMPS_ROWS) { declare(grp, "comps group"); for (const r of grp.rows) declare(r, "comps row"); }

// 28 today (`notBelow` arrived with rule 30). Asserted so that ADDING a property to the template cannot slip through on a green run
// without someone looking at this file — the count moving is the prompt to check the new one is
// wired, which is the conversation `derivedOnly` never triggered.
// MUTATION: declaring any new property on any line fails here first.
eq(declared.size, 28, `the template declares 28 distinct properties — found ${declared.size}: ${[...declared.keys()].sort().join(" ")}`);

// A property reached through a VARIABLE key is invisible to the matcher above and must be named here
// WITH A REASON. Empty today, and that is worth stating: every one of the 27 is statically visible.
// An entry added here is a claim, not an excuse — the two assertions under it check the claim.
const DYNAMIC = {};

for (const [prop, where] of [...declared].sort()) {
  const sites = readSites(prop);
  const why = DYNAMIC[prop];
  ok(sites.length > 0 || why,
    `\`${prop}\` (declared on: ${[...where].join(", ")}) is read by the engine — ` +
    (why ? `dynamically: ${why}` : `NO read site off ${RECEIVERS.join("/")} in src/grid.js or src/App.jsx. ` +
      `A declared value nothing reads has no behaviour, so nothing else in test/ can fail on it: it renders ` +
      `a blank, and a blank cannot be mis-computed. Either wire it, delete it, or add it to DYNAMIC with a reason.`));
}
// A stale allowlist is the same defect wearing the audit's own clothes: it asserts a property is
// fine when the property is gone.
for (const prop of Object.keys(DYNAMIC)) {
  ok(declared.has(prop), `DYNAMIC names \`${prop}\`, which the template still declares — a stale entry excuses a property that no longer exists`);
  eq(readSites(prop).length, 0, `\`${prop}\` is in DYNAMIC because it is genuinely invisible to a static read — if the matcher CAN see it, the exemption is hiding the real read site`);
}

// ── The same question one level up: every EXPORT of template.js must be imported ────────────────
// A property nothing reads and a whole export nothing imports are the same defect at different
// scales, and the second is easier to miss because it still looks like a feature. Both of the
// exemptions below are real, and neither is "it might be useful later" — that is the reasoning the
// `derivedOnly` flag was left in on.
const templateSrc = read("src/template.js");
const exported = [...templateSrc.matchAll(/^export (?:const|function|let) (\w+)/gm)].map(m => m[1]);
eq(exported.length, 13, `template.js has 13 exports — found ${exported.length}: ${exported.join(" ")}`);
const imported = new Set();
for (const src of Object.values(ENGINE))
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']\.\/template\.js["']/g))
    for (const name of m[1].split(",")) imported.add(name.trim().split(/\s+as\s+/)[0]);
// Both engine files import from template.js, and App.jsx does it twice. If this parse breaks, every
// export below looks unimported and the exemptions would be the only thing passing.
ok(imported.size >= 10, `the template imports were parsed out of the engine — found ${imported.size}`);

const EXPORT_EXEMPT = {
  OVERLAYS: "deliberately an empty object, documented as the shape a future overlay starts from. Every sketch that ever lived in it — bank, insurance, REIT — was wrong in a way that failed silently, so it holds no guesses and the engine is right not to read it.",
  tally: "a counting helper for the README's own figures rather than production code. It is read HERE, three assertions down, where the numbers it returns are checked against the README — which is the only thing that makes it more than a comment.",
};
for (const name of exported)
  ok(imported.has(name) || name in EXPORT_EXEMPT,
    `export \`${name}\` is imported by src/grid.js or src/App.jsx — an export nothing imports is a declaration nothing enforces, one scale up`);
for (const name of Object.keys(EXPORT_EXEMPT)) {
  ok(exported.includes(name), `EXPORT_EXEMPT names \`${name}\`, which template.js still exports`);
  ok(!imported.has(name), `\`${name}\` really is unimported — if the engine has started reading it, the exemption is stale and should go`);
}

// `tally` counts the template, and the README states those counts as fact. Written down in two
// places, they drift — which is the lesson the segments work already recorded from the other side:
// a suite asserting 1% while the code gated at 0.1% tests nothing, and the fix was to write the
// number ONCE and have the suite read the same one. So the README's number is PARSED, not restated.
// MUTATION: changing either number in the README, or adding a line to the template, fails here.
{
  const t = tally();
  const readme = read("README.md");
  const m = readme.match(/`src\/template\.js`\s*—\s*(\d+) line items across (\d+) core sections/);
  ok(m, "the README states the template's size in the shape this assertion reads — if that sentence is reworded, teach it the new shape rather than deleting the check");
  let overlayLines = 0;
  for (const secs of Object.values(OVERLAY_SECTIONS)) for (const sec of secs) overlayLines += sec.lines.length;
  eq(Number(m[1]), t.total + overlayLines,
    `the README's line-item count matches the template: ${t.total} core + ${overlayLines} overlay = ${t.total + overlayLines}`);
  eq(Number(m[2]), t.bySection.length, `and its core-section count matches: ${t.bySection.length}`);
  // tally's own arithmetic, so a refactor of it cannot quietly stop agreeing with the walk above.
  eq(Object.values(t.byHow).reduce((a, b) => a + b, 0), t.total, "tally's byHow breakdown sums to its own total");
  eq(t.total, SECTIONS.reduce((n, s) => n + s.lines.length, 0), "and its total is the core line count");
}

// ── A formula in the template is not an implementation ──────────────────────────────────────────
// Rule 22, and rule 25 is the same rule arriving again three weeks later. Every `how: "computed"`
// row renders a ƒ marker whose tooltip IS `line.formula` (src/App.jsx:1421) and whose status is
// deliberately `null` (src/App.jsx:1415) — so a computed row with no implementation is a BLANK CELL
// ADVERTISING A FORMULA, with nothing on the page saying it was never computed. That is strictly
// worse than "not tagged", which at least sends the reader somewhere.
//
// The implemented set is DERIVED from the code rather than listed, so a derivation added tomorrow
// counts tomorrow: the four derivation tables, the two cross-column passes, and — read out of
// src/grid.js's own text — the `mark("…")` calls in applyQuote and the `v.<key> =` facts fillCol
// writes directly. A hand-maintained list here would be one more declaration nothing enforces.
const gridSrc = ENGINE["src/grid.js"];
// The priced layer is IMPORTED, not recovered from grid.js's text. It used to be a run of
// `mark("…")` statements inside applyQuote, so this file had to regex them out and then assert the
// regex had matched anything — a check whose own failure mode was "every market row looks
// unimplemented". `DERIVED_PRICED` is a table now, like the other four, so the audit reads it the
// same way. The only thing still recovered by regex is the handful of column facts `fillCol` writes
// directly (`v.equityThin` and friends), which are flags rather than rows.
const implementedBase = new Set([
  ...Object.keys(DERIVED), ...Object.keys(YOY), ...Object.keys(CAGRS), ...Object.keys(DERIVED_PRICED),
  ...[...gridSrc.matchAll(/\bv\.(\w+)\s*=(?!=)/g)].map(m => m[1]),
]);
const implemented = new Set([...implementedBase, ...Object.values(DERIVED_BY_INDUSTRY).flatMap(d => Object.keys(d))]);
ok([...gridSrc.matchAll(/\bv\.(\w+)\s*=(?!=)/g)].length >= 6, "fillCol's directly-written column facts were found — a regex that stops matching passes this check vacuously");

const rows = [];
for (const sec of SECTIONS) for (const line of sec.lines) rows.push({ sec, line, id: `${sec.id}/${line.k}` });
for (const [ind, secs] of Object.entries(OVERLAY_SECTIONS)) for (const sec of secs) for (const line of sec.lines) rows.push({ sec, line, ind, id: `${ind}/${sec.id}/${line.k}` });
// The three key universes, declared once and used by every check below. Scope is the half that is
// easy to get wrong, so they are named rather than rebuilt inline: CORE is what a comps sheet and
// the cross-column passes can see, core+overlay is what one industry's sheet can see, and the union
// is only ever correct for something that runs on every sheet.
const coreK = new Set(SECTIONS.flatMap(s => s.lines.map(l => l.k)));
const overlayK = Object.fromEntries(Object.entries(OVERLAY_SECTIONS)
  .map(([ind, secs]) => [ind, new Set(secs.flatMap(s => s.lines.map(l => l.k)))]));
const allK = new Set(rows.map(r => r.line.k));


// Which sections a reader can actually SEE. Taken from src/App.jsx rather than restated, because the
// whole finding below turns on it: `TABS` lists the sections that get a tab, `FOOTER_SECS` the three
// that are deliberately NOT tabs ("as a tab with your name on it, four blank fields read as a tool
// that cannot do LBOs"), and the footer prints only their `how: "manual"` labels under the heading
// "Deliberately not computed".
const tabSecs = new Set();
for (const m of ENGINE["src/App.jsx"].matchAll(/\{\s*id:\s*"\w+",\s*label:\s*"[^"]*",\s*secs:\s*\[([^\]]*)\]/g))
  for (const s of m[1].matchAll(/"(\w+)"/g)) tabSecs.add(s[1]);
const footerSecs = [...(ENGINE["src/App.jsx"].match(/const FOOTER_SECS\s*=\s*\[([^\]]*)\]/) || [, ""])[1].matchAll(/"(\w+)"/g)].map(m => m[1]);
eq([...tabSecs].sort().join(" "), "addbacks bs cf credit dcf debtlike dilution is margins returns sh", "the tabbed sections were parsed out of App.jsx's TABS");
eq(footerSecs.sort().join(" "), "lbo premia pta", "and the three footer sections, which get no tab");
// Every section is either tabbed, in the footer, or `ev` — which is lifted OUT of the year grid into
// the card above the tabs and appended to the Valuation sheet on export. A section in none of those
// three places renders nowhere at all, which no one would notice.
// MUTATION: adding a section without giving it a home fails here.
for (const sec of SECTIONS)
  ok(tabSecs.has(sec.id) || footerSecs.includes(sec.id) || sec.id === "ev",
    `section \`${sec.id}\` has somewhere to render — a tab, the footer, or the EV card. A section in none renders nowhere and nothing says so`);

// THE OPEN BASELINE, and it is recorded EXACTLY so it ratchets rather than smothers. A seventh
// unimplemented row fails this; FIXING either of these two also fails it, with a message saying to
// delete the entry. A baseline nobody has to maintain is how a defect becomes a convention.
//
// Both of these REACH THE READER. They sit on the Valuation tab as blank rows carrying a ƒ whose
// tooltip states a formula the engine never computes, and both export as rows of blanks into the
// Valuation sheet of the workbook (src/App.jsx:464 skips only `manual` lines). They are rule 25's
// exact shape, still open, and they are a FIX rather than a suite's business — changing the engine
// wants the 160-filer fixture cache and a full-diff, which is the next session's work.
// EMPTY, and that is the state to defend. Both rows that were here are resolved: `netDebtBridge` is
// implemented (it restates `netDebt`, one line, directly under it), and `treasuryMethod` moved to the
// `ev` section and applyQuote, because it needs a price and the derivation layer never has one.
// MUTATION: un-implementing either, or declaring a new computed row with no derivation, fails here.
const UNIMPLEMENTED_ON_A_TAB = {};
const unimplementedOnATab = rows
  .filter(r => r.line.how === "computed" && !implemented.has(r.line.k) && tabSecs.has(r.sec.id))
  .map(r => r.id).sort();
eq(unimplementedOnATab.join("\n"), Object.keys(UNIMPLEMENTED_ON_A_TAB).sort().join("\n"),
  `no computed row on a RENDERED tab is without an implementation. One that is, is rule 25 again — a blank cell under a ƒ marker ` +
  `advertising a formula, with status deliberately null so nothing on the page says it was never computed.`);

// Every OTHER computed row is implemented. Stated as its own assertion so the baseline above can
// never quietly grow to cover the whole template.
// Scoped per row, not against the union of all six industry tables: a `life` overlay row implemented
// only in `DERIVED_PC` is implemented for nobody who renders it. A CORE row keeps the wider scope,
// because a core row really does render on every industry's sheet and any of those tables may fill it.
const implementedFor = ind => (ind ? new Set([...implementedBase, ...Object.keys(DERIVED_BY_INDUSTRY[ind])]) : implemented);
for (const r of rows)
  if (r.line.how === "computed" && !(r.id in UNIMPLEMENTED_ON_A_TAB) && !footerSecs.includes(r.sec.id))
    ok(implementedFor(r.ind).has(r.line.k),
      `\`${r.id}\` declares how:"computed" and something that runs on ${r.ind || "every"} sheet computes it — formula: ${r.line.formula || "(none declared)"}`);

// ── Derivations run in INSERTION ORDER over one shared `v`, and two read a key filled later ─────
// `fillCol` does `for (const [k, fn] of Object.entries(derivations))` over `{...DERIVED,
// ...DERIVED_BY_INDUSTRY[ind]}`, so position is behaviour: a derivation reading a key whose own
// derivation runs later sees whatever the FETCH pass left there, which is the filer's tagged value or
// nothing at all. That is a silent dependency — no error, just a null — and `netDebtBridge` is the
// newest thing to depend on it, which is why it sits directly under `netDebt`.
//
// Two derivations read a later key, and BOTH are deliberate, so this is a ratchet rather than a rule:
//   · `nciDerived` reads `nciBs` and MUST run first — it asks "did the filer tag the interest?", and
//     `nciBs`'s own derivation fills that key. Reversed, it would always see a value and never fire.
// There WAS a second, and finding it is what this check is for: `DERIVED_BANK.revenue` read `nii`
// from slot 0 while `nii` was reconstructed at slot 47, so a bank's top line and the identical
// expression two rows below it disagreed by position. `DERIVED.nii: () => null` now reserves the
// earlier slot and both answer the same. Fixed Sep 12 2026 rather than recorded.
// MUTATION: moving `netDebtBridge` above `netDebt`, or adding any new later-key read, fails here.
{
  const KNOWN_FORWARD_READS = {
    "DERIVED.nciDerived → nciBs": "asks whether the FILER tagged it, so it must run before nciBs's own derivation fills the key",
  };
  // A derivation's body is not the whole story: `bankTopLine(v)` and `pcLosses(v)` are module-private
  // helpers, and `Function.prototype.toString` shows only the CALL. Extracting `bankTopLine` in the
  // same change that added this gate hid the exact dependency the gate exists to protect — removing
  // the reserved `nii` slot left this green. So one level of helper call is resolved, out of the
  // source text, and the resolution is asserted below rather than assumed.
  const extractSrc = stripComments(read("src/extract.js"));
  const helpers = new Map();
  for (const m of extractSrc.matchAll(/^const (\w+) = (v|\(\.\.\.[^)]*\)|\([^)]*\)) =>[^\n]*/gm)) helpers.set(m[1], m[0]);
  ok(helpers.has("bankTopLine") && helpers.has("pcLosses"),
    `the module-private derivation helpers were found in the source — ${helpers.size} matched. If this parse breaks, every helper-wrapped read below becomes invisible again.`);
  const bodyOf = fn => {
    let body = stripComments(fn.toString());
    for (const m of body.matchAll(/\b(\w+)\s*\(\s*v\s*\)/g)) if (helpers.has(m[1])) body += "\n" + helpers.get(m[1]);
    return body;
  };
  const forward = [];
  for (const ind of [null, ...Object.keys(DERIVED_BY_INDUSTRY)]) {
    const tbl = ind ? { ...DERIVED, ...DERIVED_BY_INDUSTRY[ind] } : DERIVED;
    const keys = Object.keys(tbl);
    const pos = new Map(keys.map((k, i) => [k, i]));
    keys.forEach((k, i) => {
      for (const m of bodyOf(tbl[k]).matchAll(/\bv\s*\.\s*(\w+)/g)) {
        const j = pos.get(m[1]);
        if (j !== undefined && j > i) forward.push(`${ind && DERIVED_BY_INDUSTRY[ind][k] ? ind : "DERIVED"}.${k} → ${m[1]}`);
      }
    });
  }
  eq([...new Set(forward)].sort().join("\n"), Object.keys(KNOWN_FORWARD_READS).sort().join("\n"),
    `exactly the known derivations read a key whose own derivation runs later. Position is behaviour here — a new one gets whatever ` +
    `the fetch pass left, silently — so a row added to this list needs its ordering thought about, not accepted.`);
  // The one that motivated the check: netDebtBridge restates netDebt and must follow it.
  const d = Object.keys(DERIVED);
  ok(d.indexOf("netDebtBridge") > d.indexOf("netDebt"), "`netDebtBridge` runs after `netDebt`, which is the row it restates — above it, it would read undefined and render blank exactly as it did before it was implemented");
}

// ── The priced layer, now that it is a table the audit can read ────────────────────────────────
// `DERIVED_PRICED` is imported rather than regexed out of grid.js, so these checks are about the
// structure itself rather than about whether a pattern still matches.
// MUTATION: reordering the table, mis-scoping PRICED_NEEDS_SHARES, or blanking `ev` for an industry
// without blanking the multiples built on it, each fail here.
{
  const priced = Object.keys(DERIVED_PRICED);
  // Every `how: "market"` row is in the table and vice versa — the template and the layer that fills
  // it are two lists of the same rows, which is exactly the shape that drifts.
  const marketRows = rows.filter(r => r.line.how === "market").map(r => r.line.k).sort();
  eq(priced.slice().sort().join(" "), marketRows.join(" "),
    "the priced table and the template's how:\"market\" rows are the same set — a row in one and not the other is either a figure nothing fills or a figure no row shows");

  // ORDER IS BEHAVIOUR here as in DERIVED: applyQuote walks the table over one shared `v`, so an
  // entry reading another priced key must come after it. `ev` reads `mktCap`; the four multiples
  // read `ev`; `pb` and `fcfYield` read `mktCap`.
  const pos = new Map(priced.map((k, i) => [k, i]));
  const readsOf = k => [...new Set([...stripComments(DERIVED_PRICED[k].toString()).matchAll(/\bv\s*\.\s*(\w+)/g)].map(m => m[1]))];
  for (const k of priced) for (const r of readsOf(k)) if (pos.has(r))
    ok(pos.get(r) < pos.get(k), `\`${k}\` runs after \`${r}\`, the priced value it reads — above it, it would read whatever the fetch pass left`);

  // PRICED_NEEDS_SHARES must be the TRANSITIVE closure of what depends on the cover-page count,
  // or a row built on a refused share count says "needs price" when the price is fine.
  const needs = new Set();
  for (let again = true; again; ) {
    again = false;
    for (const k of priced) {
      if (needs.has(k)) continue;
      const r = readsOf(k);
      if (r.includes("sharesOut") || r.some(x => needs.has(x))) { needs.add(k); again = true; }
    }
  }
  eq([...PRICED_NEEDS_SHARES].sort().join(" "), [...needs].sort().join(" "),
    "PRICED_NEEDS_SHARES is exactly what depends on the cover-page count, directly or through another entry");

  // The blanking chain, which is what makes reading `v.ev` safe rather than reading a local. A
  // multiple must never be built from an enterprise value the sheet has just refused to show — the
  // Chubb failure — and the same for anything built on a market cap.
  const CHAIN = { ev: ["evRev", "evEbitda", "evEbit", "evFcf"], mktCap: ["ev", "pb", "fcfYield", "treasuryMethod"] };
  for (const [ind, list] of Object.entries(NOT_APPLICABLE))
    for (const [src, dependents] of Object.entries(CHAIN))
      if (list.includes(src)) for (const d of dependents)
        ok(list.includes(d), `NOT_APPLICABLE.${ind} blanks \`${src}\`, so it must blank \`${d}\` too — applyQuote reads the WRITTEN value, so a dependent left off the list would be computed from a figure the sheet refuses to show`);
}

// ── A computed row whose formula needs a PRICE cannot be a derivation at all ────────────────────
// This is the mechanism behind the two rows above that look like an oversight and are not, and it is
// worth stating as its own rule because "just wire it up" is the obvious wrong answer.
//
// `fillCol` runs the derivations over one column's `v` with no price in it. The price arrives later
// and elsewhere: `applyQuote` runs AFTER the whole grid is built, and only on the NEWEST column,
// because there is one price — today's — and an EV/EBITDA against FY2019 would be today's enterprise
// value over a six-year-old profit. So a `how: "computed"` row whose formula names a `how: "market"`
// input is not a missing entry in DERIVED; it is a row in the wrong layer. Wiring it into the
// derivations would silently compute it from an absent price on every column.
//
// And the placement it actually needs is already solved once in this repo, in the other direction:
// every price-dependent figure lives in the `ev` section, which was LIFTED OUT of the year grid
// precisely because "a table row of seven blanks buried the only real value off the right-hand edge
// of the scroll". A treasury-method share count in the year grid would recreate exactly that.
// MUTATION: declaring a computed formula over a market input on a new row fails here.
{
  const marketK = new Set(rows.filter(r => r.line.how === "market").map(r => r.line.k));
  eq(marketK.size, 12, `12 rows are how:"market" — found ${marketK.size}`);
  // EMPTY. `treasuryMethod` was here and is now a `market` row in the `ev` section, computed in
  // applyQuote where a price exists; `premium1d` is `manual`, because both of ITS inputs are deal
  // terms. What the check defends is the shape: the next person to declare a computed row over a
  // priced input finds out here rather than from a blank column.
  const NEEDS_A_PRICE = {};
  const needsPrice = rows.filter(r => r.line.how === "computed" && r.line.formula &&
    [...r.line.formula.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)].some(m => marketK.has(m[0]))).map(r => r.id).sort();
  eq(needsPrice.join("\n"), Object.keys(NEEDS_A_PRICE).sort().join("\n"),
    `exactly the known computed rows name a market input in their formula. Such a row cannot be a derivation: applyQuote runs after ` +
    `fillCol and only on the newest column, so the derivation layer never sees a price. A row added here needs a LAYER decision — ` +
    `the ev section and its card — not a DERIVED entry.`);
}

// ── Every line in a footer section is `manual`, so the heading over them is true ────────────────
// `lbo`, `pta` and `premia` are deliberately NOT tabs — "as a tab with your name on it, four blank
// fields read as a tool that cannot do LBOs" — and the page renders them as one line under the
// heading "Deliberately not computed", built from `s.lines.filter(l => l.how === "manual")`. So a
// non-manual line in one of those sections is shown to NOBODY: not on a tab, not in the workbook, not
// in the clipboard. Six were, when this suite first ran. They are resolved rather than baselined:
//   · `ltmEbitda`, `ltmRevenue`, `entryNetDebt` — DELETED. All three are figures the engine derives
//     already, so "deliberately not computed" would have been a false label, and a shadow copy of a
//     row the sheet shows elsewhere is the very thing this suite exists to find.
//   · `ptaFilings` — `fetched` with no `tags`, so it could never fetch. Now `manual`.
//   · `undisturbed` — `market`, but the free quote tier carries no price history at all. Now `manual`.
//   · `premium1d` — `computed` over two judgement inputs, so it could never compute. Now `manual`.
// No baseline: the correct number here is zero, and the heading on the page is only honest at zero.
// MUTATION: making any footer line non-manual, or adding one, fails here.
for (const r of rows)
  if (footerSecs.includes(r.sec.id))
    eq(r.line.how, "manual",
      `\`${r.id}\` is manual — the footer renders only manual labels and these sections get no tab, so anything else here is declared, computed by nothing, and shown to no one`);
ok(rows.filter(r => footerSecs.includes(r.sec.id)).length >= 6, "and the footer sections were actually walked");

// ── A fetched row with no tags can never fetch ───────────────────────────────────────────────────
// `if (line.how !== "fetched" || !line.tags) continue;` — src/grid.js:72. The row is skipped
// entirely: no value, no meta, and on a rendered tab it would fall through to "not tagged", which
// points a reader at EDGAR to hunt for something the template never asked for.
// No exception list any more: `pta/ptaFilings` was the only row in this state and it is `manual` now,
// so EVERY fetched row in the template must be able to fetch.
// MUTATION: deleting `tags` from any fetched row fails here.
for (const r of rows)
  if (r.line.how === "fetched")
    ok(Array.isArray(r.line.tags) && r.line.tags.length > 0 || r.line.wcAggregate,
      `\`${r.id}\` declares how:"fetched" and has tags to fetch with (or aggregates its own, like chgNwc) — grid.js skips a fetched row with no tags`);

// ── A row that restates another must be blanked wherever the other is ──────────────────────────
// `netDebtBridge` returns `v.netDebt` — the same quantity on a different tab — and the derivations
// run BEFORE the industry blanking pass, so it would survive a blanking that removes the row it
// restates. Today no NOT_APPLICABLE list carries `netDebt`, which is the only reason the pairing is
// invisible; the day one does (and `NOT_APPLICABLE.bank` has had to gain `ev`, `evRev`, `evFcf` and
// the whole FCF family already), the Ratios tab would read "Net debt — n/a" while the Valuation tab
// printed the identical figure. A code comment is not enforcement, so this is the enforcement.
// MUTATION: adding `netDebt` to any NOT_APPLICABLE list without `netDebtBridge` fails here.
for (const [ind, list] of Object.entries(NOT_APPLICABLE))
  eq(list.includes("netDebt"), list.includes("netDebtBridge"),
    `NOT_APPLICABLE.${ind} blanks \`netDebtBridge\` exactly when it blanks \`netDebt\` — the bridge row restates that figure, and the derivations run before the blanking pass, so it would outlive the row it copies`);

// ── A derivation nothing displays and nothing reads is work thrown away ─────────────────────────
// The mirror of rule 22: there, a declared formula with no implementation; here, an implementation
// with no declaration. This suite found one on its first run — `DERIVED_PC.lossesTotal`, which
// computed on every column of every P&C insurer into a key no row declared and no note read, while
// the five derivations beside it called the `pcLosses` helper directly. It is deleted, and the list
// below is empty, which is the state worth defending.
//
// A derivation key is legitimately absent from the rows when a `flagNote` keys off it — that is how
// `nciDerived`, `equityThin` and `grossProfitDerived` earn their place, which is the next check.
// MUTATION: adding a derivation for a key no row declares fails here; so did deleting lossesTotal,
// which is the ratchet working in the direction that matters least often and matters most.
const rowKeys = new Set(rows.map(r => r.line.k));
const flagKeys = new Set(rows.flatMap(r => (r.line.flagNote ? Object.keys(r.line.flagNote) : [])));
// Scoped, for the same reason the name-match sets below are: `DERIVED` runs on every sheet so any
// row anywhere can display its output, but `DERIVED_BANK.x` only ever runs on a bank, so it must be
// reachable from CORE ∪ the bank overlay. Against the union, a bank derivation displayed only by a
// REIT row would look fine and compute into nothing on every bank column.
const orphans = [];
for (const [name, tbl] of Object.entries({ DERIVED, ...DERIVED_BY_INDUSTRY })) {
  const visible = name === "DERIVED" ? rowKeys
    : new Set([...coreK, ...overlayK[name]]);
  for (const k of Object.keys(tbl)) if (!visible.has(k) && !flagKeys.has(k)) orphans.push(`${name}.${k}`);
}
eq(orphans.sort().join("\n"), "",
  `no derivation computes into \`v\` without a row or a flagNote reading the result${orphans.length ? ` — orphaned: ${orphans.join(", ")}` : ""}`);

// ── Names that must match other names, or nothing is enforced ───────────────────────────────────
// Every check below is of the same kind and it is the kind that fails silently: a set naming a row
// that does not exist suppresses nothing, a note keyed to a tag the row never asks for can never
// fire, and an industry key INDUSTRY() cannot return is unreachable code that looks like a rule.
// None of these is hypothetical — the mezzanine row held a KEEP slot for a tag SEC 404s, and nothing
// could fail because a tag that never matches looks exactly like a filer that never tagged.
// SCOPE IS THE HALF THAT IS EASY TO GET WRONG, and the first version of this suite got it wrong:
// it checked every set against the UNION of core and all six overlays, which passes a name that
// exists but can never be reached from where the set is read. `NOT_APPLICABLE.bank` naming a
// pc-only key would then blank nothing on a bank — the Chubb enterprise-value failure, back inside
// the one list that exists to prevent it. So each set is checked against the keys its READ SITE can
// actually see, and nothing wider.

const forIndustry = ind => new Set([...coreK, ...overlayK[ind]]);
const mustBeRows = (label, names, scope, why) => {
  const bad = [...names].filter(n => !scope.has(n));
  eq(bad.join(" "), "", `every name in ${label} is a line \`k\` reachable from where it is read${bad.length ? ` — out of scope: ${bad.join(" ")}` : ""} — ${why}`);
};
// The comps sets are read as `r.k` on a COMPS_ROWS entry, and a comps sheet is built from core rows
// only, so an overlay key in any of them is a rule that can never fire.
mustBeRows("EQUITY_DENOMINATED", EQUITY_DENOMINATED, coreK, "the comps table reads it off a comps row, which is always a core row");
mustBeRows("CURRENCY_DENOMINATED", CURRENCY_DENOMINATED, coreK, "same read site, same scope");
mustBeRows("COMPS_MEDIAN", COMPS_MEDIAN, coreK, "a median is taken over comps rows");
mustBeRows("COMPS_ROWS", COMPS_ROWS.flatMap(g => g.rows.map(r => r.k)), coreK, "every comps row must exist on the sheet the set is built from");
// `NOT_APPLICABLE[industry]` blanks keys on a sheet built from core PLUS that industry's overlay and
// nothing else — grid.js writes `v[k] = null` for each, so an out-of-scope name blanks nothing at all.
for (const [ind, list] of Object.entries(NOT_APPLICABLE))
  mustBeRows(`NOT_APPLICABLE.${ind}`, list, forIndustry(ind), `a ${ind} sheet is core plus the ${ind} overlay, so a key from another industry's overlay would blank nothing`);
// The cross-column passes run for EVERY industry, so a source that only exists on one overlay leaves
// the growth row permanently blank elsewhere while its meta still says "computed" — revCagr3 exactly.
mustBeRows("YOY keys", Object.keys(YOY), coreK, "crossColumn runs for every industry");
mustBeRows("YOY sources", Object.values(YOY), coreK, "a source only some industries have renders the growth row blank for the rest, with meta still claiming computed");
mustBeRows("CAGRS keys", Object.keys(CAGRS), coreK, "same pass, same reason");
mustBeRows("CAGRS sources", Object.values(CAGRS).map(c => c[0]), coreK, "same");
// `pinIdentity` is resolved through `lineByKey`, which holds the merged list for the filer in hand —
// so a target outside that filer's scope degrades silently to `tagsByRun` with nothing blank to notice.
for (const r of rows.filter(r => r.line.pinIdentity)) {
  const scope = r.ind ? forIndustry(r.ind) : coreK;
  for (const target of [r.line.pinIdentity.minus || r.line.pinIdentity.plus, r.line.pinIdentity.equals]) {
    ok(scope.has(target), `\`${r.id}\`'s pinIdentity target \`${target}\` is reachable on the sheets this row renders on — otherwise rule 23 degrades to rule 21's proxy with nothing to show for it`);
    const t = rows.find(x => x.line.k === target);
    ok(t && Array.isArray(t.line.tags) && t.line.tags.length, `and \`${target}\` carries tags, which is what tagsByIdentity is handed`);
  }
}

// ── An overlay line must not shadow a core line ─────────────────────────────────────────────────
// `fillCol` writes `v[line.k]` over the MERGED section list, and `lineByKey[line.k] = line` is
// last-writer-wins. So an overlay line sharing a core key would overwrite the core row's value AND
// the meta carrying its accession, and hand `pinIdentity` the wrong tag list — rule 29's damage by a
// different route. Zero today, per industry, and asserted per industry because the merge is per
// industry: two overlays may safely share a key, and three pairs do.
// MUTATION: renaming any overlay line to a core key fails here.
for (const [ind, keys] of Object.entries(overlayK)) {
  const shadow = [...keys].filter(k => coreK.has(k));
  eq(shadow.join(" "), "", `no ${ind} overlay line shadows a core line${shadow.length ? ` — ${shadow.join(" ")}` : ""} — fillCol keys v by \`k\` and the last writer wins`);
  const own = OVERLAY_SECTIONS[ind].flatMap(s => s.lines.map(l => l.k));
  const dup = own.filter((k, i) => own.indexOf(k) !== i);
  eq(dup.join(" "), "", `and no ${ind} overlay line is declared twice within the overlay${dup.length ? ` — ${dup.join(" ")}` : ""}`);
}

// A `tagNote` keyed to a tag the row does not ask for can never fire — the read is
// `line.tagNote[newest.m.tag]`, and `m.tag` can only ever be one of the row's own candidates.
for (const r of rows) if (r.line.tagNote) for (const tag of Object.keys(r.line.tagNote))
  ok((r.line.tags || []).includes(tag), `\`${r.id}\`'s tagNote for ${tag} is on the row's own tag list, or it can never be shown`);

// `omitFor` removes named tags for a named industry. Both halves can be wrong silently: an industry
// INDUSTRY() never returns, or a tag the row does not carry — which filters nothing and reads as a
// rule protecting a filer it has never touched.
const industries = new Set();
for (let sic = 0; sic <= 9999; sic++) industries.add(INDUSTRY(sic));
eq([...industries].sort().join(" "), "advisory bank corporate health life pc reit", "INDUSTRY() reaches exactly the seven industries the overlays are written for");
for (const r of rows) if (r.line.omitFor) for (const [ind, tags] of Object.entries(r.line.omitFor)) {
  ok(industries.has(ind), `\`${r.id}\`'s omitFor targets industry \`${ind}\`, which INDUSTRY() can return`);
  for (const tag of tags) ok((r.line.tags || []).includes(tag), `\`${r.id}\`'s omitFor drops ${tag}, which is on its tag list — dropping a tag the row never asked for filters nothing`);
}

// Every industry-keyed table is reached by a variable key, so a typo is unreachable code rather than
// an error. `PERIOD_TAGS` carries `corporate` as well, which is its documented fallback.
for (const [name, obj] of [["NOT_APPLICABLE", NOT_APPLICABLE], ["OVERLAY_SECTIONS", OVERLAY_SECTIONS],
  ["DERIVED_BY_INDUSTRY", DERIVED_BY_INDUSTRY], ["PERIOD_TAGS", PERIOD_TAGS], ["INDUSTRY_LABEL", INDUSTRY_LABEL]]) {
  const bad = Object.keys(obj).filter(k => !industries.has(k));
  eq(bad.join(" "), "", `every key of ${name} is an industry INDUSTRY() can return${bad.length ? ` — unreachable: ${bad.join(" ")}` : ""}`);
}

// A `flagNote` is keyed on a `v` key and printed when any column has it truthy. Keyed to something
// nothing sets, the note is dead — and these are the notes that explain a DERIVED figure, so a dead
// one means a computed number rendering as if it were filed. That is the Exxon collapsed-table
// obligation, which rule 22's own follow-on exists to honour.
const settable = new Set([...rowKeys, ...implemented]);
for (const r of rows) if (r.line.flagNote) for (const k of Object.keys(r.line.flagNote))
  ok(settable.has(k), `\`${r.id}\`'s flagNote keys on \`${k}\`, which the engine sets — a note keyed to nothing never fires, and this row's note is what stops a computed figure reading as filed`);

// ── A `formula` on a row that is not computed can never be displayed ────────────────────────────
// There are TWO renderers of template lines and they draw the ƒ on different rules, which is the
// whole reason this was invisible. `SectionRows` draws the year grid and guards on
// `how === "computed"`. `ValuationCard` draws the `ev` section ALONE — that section is lifted out of
// the grid, because there is one price and a table row of seven blanks buried the only real value off
// the right-hand edge — and it now draws a ƒ for ANY row declaring a formula, which is right for a
// section whose every line is `market` or `computed` and none of which is fetched.
//
// So a formula is displayable iff the renderer that draws its section can draw it. A footer section
// needs no exemption any more: every line there is `manual` now, and a manual row is drawn only as a
// label, so a formula on one would be caught by the `how !== "computed"` test like any other. The
// assertion below is therefore unconditional — there is no list of accepted exceptions left.
// MUTATION: taking the ƒ out of ValuationCard, or declaring a formula on a non-computed row in a
// tabbed section, fails here.
{
  const appSrc = ENGINE["src/App.jsx"];
  // The card's marker has to be PROVEN present, or this whole check certifies a renderer that stopped
  // drawing it. Both halves: the row object must carry `formula`, and the ƒ must be keyed off it.
  const card = appSrc.slice(appSrc.indexOf("function ValuationCard"));
  const cardBody = card.slice(0, card.indexOf("\nfunction "));
  ok(/formula:\s*l\.formula/.test(cardBody), "ValuationCard carries each line's `formula` onto its row object — without it the marker below has nothing to show");
  ok(/r\.formula\s*&&[\s\S]{0,200}title=\{r\.formula\}/.test(cardBody), "and draws the ƒ from it, so the EV bridge's own arithmetic is visible on the card that prints it");
  // The card's column minimum is a MEASURED value, not a taste one, so it is pinned like the Layout
  // section's other widths. At 190px the grid gave 211px columns and a 13-digit market cap needed
  // 224px beside a label that wraps, so the number ran into the cell next to it at every desktop
  // width — 1 of 12 cells overlapping at 1440, 1280, 1024 and 768. At 250px it is 0 of 12 at all
  // five widths measured, and the card is the same height at 1280 and 1440 as it was while broken.
  // MUTATION: reverting it to 190px fails here.
  ok(/minmax\(250px,1fr\)/.test(cardBody), "the valuation card's grid minimum is 250px — measured, because at 190px a mega-cap's market capitalisation overlapped the cell beside it at every desktop width");
  const notDisplayable = rows.filter(r => {
    if (!r.line.formula) return false;
    if (r.sec.id === "ev") return false;                      // ValuationCard: any formula
    return r.line.how !== "computed";                         // SectionRows' guard
  }).map(r => r.id).sort();
  eq(notDisplayable.join("\n"), "",
    `every declared \`formula\` can be drawn by the renderer that draws its section${notDisplayable.length ? ` — unreachable: ${notDisplayable.join(" ")}` : ""}. ` +
    `SectionRows guards the ƒ on how==="computed"; ValuationCard draws it for any row of the ev section. A formula outside both is ` +
    `documentation the page cannot show.`);
  eq(rows.filter(r => r.line.formula).length, 100, "100 rows declare a formula — the count is asserted so a new one cannot arrive unexamined");
}

// ── A tag the template asks for and the proxy drops never arrives ────────────────────────────────
// `api/facts.js` slims a 10–15MB companyfacts document down to the ~235 concepts the template needs,
// and it says of itself that a tag added to the template must be added to `KEEP` too "or the value
// silently never arrives". That is this suite's exact subject matter: the row then renders
// "not tagged", pointing a reader at EDGAR to hunt for something the browser was never sent.
// t-balance asserts this for the three tags of ONE row, because that row proved it can happen. Here
// it is asserted for every tag on every fetched row.
// MUTATION: adding a tag to any row without adding it to KEEP fails here.
{
  const keepSrc = read("api/facts.js");
  const keep = new Set([...keepSrc.matchAll(/"([A-Za-z][A-Za-z0-9:]*)"/g)].map(m => m[1]));
  ok(keep.size > 300, `api/facts.js's KEEP was parsed — ${keep.size} string literals, or every tag below would look dropped`);
  const tplTags = [...new Set(rows.flatMap(r => r.line.tags || []))];
  eq(tplTags.length, 258, `the template asks for 258 distinct tags — found ${tplTags.length}`);
  // The `dei` taxonomy is reached by a different door: facts.js loops us-gaap and dei, and its dei
  // branch admits exactly one element BY NAME rather than through KEEP. So the template's `dei:` tag
  // is checked against that gate instead, and the two spellings must agree — the template writes the
  // prefixed form, facts.js writes the bare one.
  const deiGate = keepSrc.match(/ns === "dei" && tag !== "(\w+)"/);
  ok(deiGate, "facts.js's dei branch gates its one admitted element by name — if that changes shape, teach this check the new one");
  for (const tag of tplTags) {
    if (tag.startsWith("dei:")) {
      eq(tag.slice(4), deiGate[1], `the template's \`${tag}\` is the element facts.js's dei branch admits — the prefixed and bare spellings must agree or the share count never arrives`);
      continue;
    }
    ok(keep.has(tag), `\`${tag}\` has a KEEP slot in api/facts.js — a tag the template asks for and the proxy slims out renders "not tagged", which sends a reader to EDGAR for something the browser was never sent`);
  }
}

// ── Three hand-kept sets of line keys, outside the template, that nothing else joins ────────────
// Each is a list of `k` strings maintained by hand in another file, so a key that stops existing — or
// never existed — is silently inert. The formatting sets have already failed exactly this way: the
// comment above them records `revCagr3`/`revCagr5` rendering as "1" instead of "100%" because a
// percentage row was missing from PCT, which is the same two rows rule 22 found declared and never
// implemented. A wrong key here is not a crash; it is a number in the wrong units.
// MUTATION: renaming any line `k` without updating these fails here.
{
  const sectionIds = new Set([...SECTIONS.map(s => s.id), ...Object.values(OVERLAY_SECTIONS).flat().map(s => s.id)]);
  const setOf = (src, name) => {
    const m = src.match(new RegExp("const " + name + " = new Set\\(\\[([\\s\\S]*?)\\]\\);"));
    ok(m, `${name} was found and parsed — an unparsed set passes this check vacuously`);
    return [...stripComments(m[1]).matchAll(/"([A-Za-z][A-Za-z0-9]*)"/g)].map(x => x[1]);
  };
  const appSrc = read("src/App.jsx"), gridRaw = read("src/grid.js");
  for (const [name, universe, label] of [
    ["PCT", allK, "a percentage row missing from PCT renders 1 instead of 100%"],
    ["MULT", allK, "a multiple row missing from MULT loses its x suffix"],
    ["DAYS", allK, "a day-count row missing from DAYS is formatted as a plain number"],
  ]) {
    const keys = setOf(appSrc, name);
    const bad = keys.filter(k => !universe.has(k));
    eq(bad.join(" "), "", `every key in App.jsx's ${name} is a line the template declares${bad.length ? ` — orphaned: ${bad.join(" ")}` : ""} — ${label}`);
  }
  const instSecs = setOf(gridRaw, "INSTANT_SECTIONS");
  eq(instSecs.filter(id => !sectionIds.has(id)).join(" "), "", "every id in grid.js's INSTANT_SECTIONS is a section that exists — an unknown one silently matches a balance sheet as a duration, which is how a bank's deposits and loans read \"not tagged\"");
  const instLines = setOf(gridRaw, "INSTANT_LINES");
  eq(instLines.filter(k => !allK.has(k)).join(" "), "", "and every key in INSTANT_LINES is a line that exists");
}

// ── Two reads that do not go through a name at all ───────────────────────────────────────────────
// `const REV = SECTIONS[0].lines[0].tags;` (src/template.js) builds PERIOD_TAGS from the revenue row
// by POSITION. Move revenue, or put a new section above the income statement, and the fiscal calendar
// for every corporate filer is derived from the wrong row — which would not fail, it would produce a
// different set of years.
// MUTATION: reordering the first section's lines, or prepending a section, fails here.
eq(SECTIONS[0].id, "is", "the income statement is still the first section — PERIOD_TAGS reads SECTIONS[0].lines[0] by position");
eq(SECTIONS[0].lines[0].k, "revenue", "and revenue is still its first line, which is the row the whole fiscal calendar is built from");
eq(PERIOD_TAGS.corporate[0], SECTIONS[0].lines[0].tags[0], "so PERIOD_TAGS.corporate really does lead with the revenue row's first tag");
// `dcfApplicable` decides whether the reverse DCF runs, off two row names written as string literals
// in src/reverse.js. A typo there silently re-enables the plate for a bank.
{
  const lits = [...read("src/reverse.js").matchAll(/includes\("(\w+)"\)/g)].map(m => m[1]);
  eq(lits.join(" "), "ufcf ev", "dcfApplicable still gates on the two row names it was written for");
  for (const k of lits) ok(allK.has(k), `\`${k}\` is a real template row, or the reverse DCF's gate reads a NOT_APPLICABLE list for a row that cannot be in it`);
}

// ── A ratio dividing by a near-cancelled residual must say so, on whichever surface it appears ──
// `EQUITY_DENOMINATED` exists so "the sheet's notes and the comps table cannot drift apart about which
// figures a near-cancelled equity makes incomparable" — its own comment. There are THREE surfaces a
// member can appear on, and the set is read on only one of them:
//   · the COMPS table — `EQUITY_DENOMINATED.has(r.k)` softens the cell. The set's one read site.
//   · the YEAR GRID — the per-line `flagNote: { equityThin }`, which prints the filer's own percentage.
//   · the VALUATION CARD — `c.v.equityThin` gates a compact line naming P/B and book value per share
//     by hand, because the card is deliberately four numbers read at a glance and the sheet's
//     five-line note would cost the thing it is for.
//
// Counting only the first two makes `pb` look uncovered, which is wrong and was written down as a
// finding before the card was read: `pb` lives in the `ev` section, the card is the ONLY place it
// appears, and the card names it explicitly. The assertion below therefore checks all three — and
// checks the card's text really does name them, so the one surface maintained by hand cannot drift
// from the set the other two are driven by.
// MUTATION: dropping P/B from the card's note, or adding a member covered by none of the three, fails.
const compsK = new Set(COMPS_ROWS.flatMap(g => g.rows.map(r => r.k)));
const flagged = new Set(rows.filter(r => r.line.flagNote && "equityThin" in r.line.flagNote).map(r => r.line.k));
const cardNote = (ENGINE["src/App.jsx"].match(/equityThin\s*&&[\s\S]{0,700}?<\/p>/) || [""])[0];
ok(/near-cancelled residual/.test(cardNote), "the valuation card's near-cancelled-equity note was found — if it moves, teach this check where, rather than letting the members below look covered");
const namedOnCard = new Set();
if (/P\/B/.test(cardNote)) namedOnCard.add("pb");
if (/book value per share/.test(cardNote)) namedOnCard.add("bvps");
for (const k of EQUITY_DENOMINATED) {
  ok(allK.has(k), `EQUITY_DENOMINATED's \`${k}\` is a real template row`);
  const where = [compsK.has(k) && "the comps table", flagged.has(k) && "an equityThin flagNote", namedOnCard.has(k) && "the valuation card's note"].filter(Boolean);
  ok(where.length > 0,
    `\`${k}\` divides by equity and SAYS SO somewhere — found on: ${where.join(", ") || "NO SURFACE"}. ` +
    `A member marked nowhere is a ratio dividing by a residual that reads like any other number beside it.`);
}
// The card's note is the only one of the three not driven by the set, so the row it names must still
// be the row that needs it — `pb` is in the `ev` section, which only the card draws.
eq(rows.find(r => r.line.k === "pb").sec.id, "ev", "`pb` is in the ev section, so the valuation card is the only surface that can mark it");

// ── A formula string is a promise about rows, and it is now shown to readers ────────────────────
// The ƒ tooltip prints `line.formula` verbatim, on the sheet and — since the card was given the
// marker — on the valuation card too. So every identifier inside one is a claim that a row by that
// name exists. Rename `reGross` and the REIT's `debtToGrossRE` keeps promising `totalDebt / reGross`
// to every reader who hovers it, with no blank anywhere to notice: the row it describes still has a
// value, the sentence describing it is just false. That is worse than the blank class, and making
// these visible is what made it worth asserting.
// MUTATION: renaming a row named in any formula, without updating the formula, fails here.
{
  // Words that are prose or arithmetic rather than row names. `or` is the odd one and it is real:
  // the REIT float row's formula reads "(lossReservesNet or lossReserves - reinsRecov) + …", which
  // describes a fallback in English because there is no operator for it.
  // Words inside a formula that are prose or arithmetic rather than row names. Asserted to be LIVE,
  // because an allowlist nobody prunes is the defect this file is about: `sum`, `last` and `quarters`
  // were here for "sum(last 4 quarters)" on two rows that have since been deleted, and `price` was
  // here before it became a real row key — four dead entries, each one silently accepting a formula
  // that names a row which does not exist.
  const PROSE = new Set(["or"]);
  for (const w of PROSE) {
    ok(rows.some(r => r.line.formula && new RegExp("\\b" + w + "\\b").test(r.line.formula)),
      `PROSE exempts \`${w}\` and some formula still contains it — a dead exemption accepts a formula naming a row that does not exist`);
    ok(!allK.has(w), `and \`${w}\` is not itself a row key, which would make the exemption pointless`);
  }
  const unresolved = [];
  for (const r of rows) {
    if (!r.line.formula) continue;
    const scope = r.ind ? forIndustry(r.ind) : coreK;
    for (const m of r.line.formula.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g))
      if (!PROSE.has(m[0]) && !scope.has(m[0])) unresolved.push(`${r.id} → ${m[0]}`);
  }
  eq(unresolved.join("\n"), "",
    `every identifier inside a declared \`formula\` names a row reachable on the sheets that formula renders on` +
    `${unresolved.length ? ` — unresolved: ${unresolved.join(", ")}` : ""}. The tooltip prints the formula verbatim, so a stale ` +
    `name is a false sentence under a figure that still has a value — nothing goes blank to give it away.`);
  ok(rows.filter(r => r.line.formula).length > 90, "and the formulas were actually walked, rather than the loop finding nothing to check");
}

// ── A note that is a FUNCTION must produce a sentence, not "NaN%" ───────────────────────────────
// `flagNote` values may be functions of the flagged column, so a note can print the filer's own
// figure rather than assert a category — which is the whole reason `thinEquity`'s threshold is
// allowed to be a judgement: it decides only when to speak, and the number shown is the filer's.
// That makes these the one name-match in the template whose failure is a FALSE SENTENCE rather than
// a blank: `EQUITY_THIN_NOTE` reads `col.v.equity` and `col.v.totalAssets`, and renaming either
// prints "Shareholders' equity is NaN% of total assets" on two rows. A blank cannot be mis-computed;
// this can.
// Rule 30's note is the third, and it reads `meta` as well as `v`: the figure it set aside travels
// on the cell, not in a row. The probe column carries both, and each note gets its own expectation —
// a generic "returns a string" would pass a note that printed the wrong filer's number.
// MUTATION: renaming `equity` or `totalAssets`, or breaking the note's arithmetic, fails here.
{
  const col = { v: { equity: -1.2e8, totalAssets: 3.7e10, ltdCur: 2.9282e9, ltDebt: 2.40554e10,
      // Rules 34 and 35: AbbVie's 2018 D&A summed from $471m of depreciation and $1.29bn of amortisation,
      // and a tangible book that could not deduct goodwill.
      da: 1.765e9, amort: 1.294e9, goodwill: null, intangibles: 2.1e9,
      // Rule 39: Shopify's FY2023 EBITDA loss.
      ebitda: -1.348e9 }, period: { end: "2024-12-31", fy: 2024 },
    meta: { ltDebt: { rejected: { tag: "LongTermDebt", value: 1.9e6 } },
      epsDil: { status: "split-adjusted", splitFactor: 40, splitMark: "÷40", filedValue: 6.63, splits: [{ K: 4, forward: true, newFrom: "2021-08-20" }, { K: 10, forward: true, newFrom: "2024-08-28" }] },
      // Rule 32's probe: Allstate's FY2020, the legs read from the 10-K filed 2022-02-18 and the equity
      // leg displacing the −$298m the 10-K filed 2024-02-21 carried.
      totalAssets: { value: 125987e6, aligned: { form: "10-K", filed: "2022-02-18", accn: "a" } },
      // Rule 38's probe: Farmland Partners' FY2018 mezzanine, its preferred units plus its Series B
      // "other" redeemable interest, summed inside one filing.
      tempEquity: { value: 264268000, closes: "sum", from: { form: "10-K", filed: "2019-03-01", accn: "f" },
        parts: { RedeemableNoncontrollingInterestEquityPreferredCarryingAmount: 120510000, RedeemableNoncontrollingInterestEquityOtherCarryingAmount: 143758000 } },
      equityAll: { value: 30217e6, aligned: { form: "10-K", filed: "2022-02-18", accn: "a" }, displaced: { value: -298e6, form: "10-K", filed: "2024-02-21", accn: "b", tag: "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest" } } } };
  let fns = 0;
  for (const r of rows) if (r.line.flagNote) for (const [k, text] of Object.entries(r.line.flagNote)) {
    if (typeof text !== "function") { ok(typeof text === "string" && text.length > 0, `\`${r.id}\`'s flagNote for ${k} is a non-empty string or a function`); continue; }
    fns++;
    const out = text(col);
    ok(typeof out === "string" && out.length > 0, `\`${r.id}\`'s flagNote function for ${k} returns a string`);
    ok(!/NaN|undefined|Infinity/.test(out), `and it reads as a sentence rather than "${(out.match(/NaN|undefined|Infinity/) || [])[0]}" — ${r.id}/${k} prints the filer's own figure, so a renamed input produces a FALSE sentence under a figure that still has a value`);
    // The percentage it prints is the one the reader is asked to believe, so the arithmetic is
    // checked rather than assumed: 1.2e8 / 3.7e10 is 0.32%.
    if (k === "equityThin") ok(out.includes("0.32%"), `and the percentage is computed from the column it was handed (expected 0.32% from the probe) — ${r.id}/${k}`);
    else if (k === "ltDebtRejected") ok(/1\.9m/.test(out) && /LongTermDebt\b/.test(out) && /2\.93bn/.test(out), `and it names the figure it set aside, the tag it came from and the current portion it fell below — ${r.id}/${k}: ${out.slice(0, 90)}`);
    else if (k === "splitAdjusted") ok(/4-for-1 split first reported 2021-08-20/.test(out) && /10-for-1 split first reported 2024-08-28/.test(out) && /÷40/.test(out) && /6\.63/.test(out), `and it names both splits, the factor and the figure as filed — ${r.id}/${k}: ${out.slice(0, 90)}`);
    else if (k === "daSummed") ok(/depreciation 471\.0m plus amortisation of intangibles 1\.29bn/.test(out), `and it names both parts with the filer's own figures — ${r.id}/${k}: ${out.slice(0, 100)}`);
    else if (k === "tbvpsPartial") ok(/tags no goodwill at 2024-12-31/.test(out) && /deducts only intangibles/.test(out) && !/no goodwill and no intangibles/.test(out), `and it names the leg that was not deducted and only that leg — ${r.id}/${k}: ${out.slice(0, 100)}`);
    else if (k === "bsAligned") ok(/read from the 10-K filed 2022-02-18/.test(out) && /total equity incl\. NCI −298\.0m in the 10-K filed 2024-02-21 against 30\.22bn here/.test(out) && /2024-12-31/.test(out) && !/total assets/.test(out), `and it names the filing the legs were read from, the leg that moved with the figure its own newest filing carried, and the date — ${r.id}/${k}: ${out.slice(0, 120)}`);
    else if (k === "levNegEbitda") ok(/EBITDA is a loss of 1\.35bn in FY2024/.test(out) && /n\/m/.test(out), `and it names the loss with the filer's figure and the column, and says what the row reads — ${r.id}/${k}: ${out.slice(0, 110)}`);
    else if (k === "mezzSummed") ok(/preferred 120\.5m plus other 143\.8m/.test(out) && /10-K filed 2019-03-01/.test(out) && /closes/.test(out), `and it names both classes with the filer's figures, the filing, and the condition it was taken on — ${r.id}/${k}: ${out.slice(0, 120)}`);
    else ok(false, `${r.id}/${k} is a function-valued flagNote with no expectation of its own here — add one, or a wrong sentence passes as a sentence`);
    // Every `col.v.<name>` the body reads has to be a row, or the note is one rename from NaN.
    for (const m of stripComments(text.toString()).matchAll(/col\s*\.\s*v\s*\.\s*(\w+)/g))
      ok(coreK.has(m[1]), `and \`${m[1]}\`, which the note reads off the column, is a core row`);
  }
  eq(fns, 18, `all eighteen function-valued flagNotes were exercised (two equity-thin, one rule 30, five rule 31, five rule 32, one rule 34, one rule 35, one rule 38, two rule 39) — found ${fns}. If this reaches zero the checks above pass over nothing.`);
}

// ── PERIOD_TAGS is the revenue row's own tag array, not a copy of it ────────────────────────────
// `const REV = SECTIONS[0].lines[0].tags;` and three industries then use REV unchanged, so
// `PERIOD_TAGS.corporate` IS that array — the same object, by identity. Nothing copies it and nothing
// should mutate it: a single `push` or `sort` on the fiscal-calendar list would silently rewrite the
// revenue row's candidate ORDER for every filer, which is rule 11's "first hit wins" rewritten from
// a distance. Pinned by identity rather than by restating the tags, so the intent is what is asserted.
// MUTATION: copying REV instead of aliasing it, or reordering the revenue row's tags, fails here.
{
  const revTags = SECTIONS[0].lines[0].tags;
  for (const ind of ["corporate", "advisory", "reit"])
    ok(PERIOD_TAGS[ind] === revTags, `PERIOD_TAGS.${ind} is the revenue row's own tag array, by identity — the fiscal calendar and the top line are deliberately one list`);
  for (const [ind, list] of Object.entries(PERIOD_TAGS)) {
    ok(Array.isArray(list) && list.length > 0, `PERIOD_TAGS.${ind} is a non-empty tag list`);
    ok(list.slice(0, revTags.length).join(" ") === revTags.join(" ") || list !== revTags,
      `PERIOD_TAGS.${ind} either IS the revenue list or extends it — an industry that reorders the shared prefix would reorder the revenue row too`);
  }
  // The bank list re-adds a tag REV already ends with. Harmless — first hit wins — but pinned so the
  // duplicate is a known one rather than a new one nobody counted.
  const dupes = Object.entries(PERIOD_TAGS).map(([i, l]) => [i, l.length - new Set(l).size]).filter(([, n]) => n > 0);
  eq(dupes.map(([i, n]) => `${i}:${n}`).join(" "), "bank:1",
    "exactly the known duplicate tag across the PERIOD_TAGS lists — bank re-adds the lending top line REV already ends with");
}

// ── `tab` and `after` place an overlay section, and both fail by putting it somewhere useless ───
// `after` is read ONLY while iterating the overlay list, so a core section declaring it would be
// silently inert — and `out.splice(at >= 0 ? at + 1 : out.length, …)` turns a typo into a quiet
// append at the very bottom rather than an error. `tab` decides which tab renders the section, and
// `TABS` contains a `segments` entry with NO `secs`: a section tabbed there is fetched in full and
// then rendered by nothing — not on the page, not in the workbook, not in the clipboard.
// MUTATION: declaring `after` on a core section, pointing it at an id that does not exist, or
// tabbing an overlay section to `segments`, fails here.
{
  eq(SECTIONS.filter(s => s.after).length, 0, "no CORE section declares `after` — sectionsFor reads it only while placing overlays, so on a core section it would be inert");
  const gridTabs = new Set();
  for (const m of ENGINE["src/App.jsx"].matchAll(/\{\s*id:\s*"(\w+)",\s*label:\s*"[^"]*",\s*secs:\s*\[([^\]]*)\]/g))
    if (m[2].trim()) gridTabs.add(m[1]);
  eq([...gridTabs].sort().join(" "), "ratios statements valuation", "the tabs that actually render a grid were parsed — `segments` has no secs and renders none of the template");
  const coreIds = new Set(SECTIONS.map(s => s.id));
  for (const [ind, secs] of Object.entries(OVERLAY_SECTIONS)) for (const sec of secs) {
    ok(gridTabs.has(sec.tab), `${ind}/${sec.id} declares a \`tab\` that renders a grid (got ${JSON.stringify(sec.tab)}) — a section tabbed to \`segments\` is fetched in full and drawn nowhere`);
    if (sec.after) ok(coreIds.has(sec.after), `${ind}/${sec.id}'s \`after\` names a core section (got ${JSON.stringify(sec.after)}) — an unknown id splices the section silently onto the BOTTOM rather than failing`);
  }
}

// ── `how` is a closed vocabulary, and `k` is the join key for everything above ──────────────────
// `how` decides fetching (grid.js:72), the ƒ marker, the status label and whether the row exports.
// A fifth value would take the `else` branch everywhere at once — fetched, with no tags, silently.
for (const r of rows)
  ok(["fetched", "computed", "market", "manual"].includes(r.line.how),
    `\`${r.id}\` declares one of the four documented \`how\` values, not \`${r.line.how}\``);
// Duplicate core keys would collide in `v`, and the second would win in a way no column shows.
const dupes = [];
const seenK = new Map();
for (const sec of SECTIONS) for (const line of sec.lines) {
  if (seenK.has(line.k)) dupes.push(`${line.k} (${seenK.get(line.k)} and ${sec.id})`);
  seenK.set(line.k, sec.id);
}
eq(dupes.join(" "), "", `no core line \`k\` is declared twice${dupes.length ? ` — ${dupes.join(", ")}` : ""} — fillCol keys \`v\` by it, so a collision silently drops a row`);

// ── Rule 29, checked over the function bodies rather than the file's text ────────────────────────
// A derivation must never return the figure it was handed: fillCol writes
// `meta[k] = { status: "computed" }` for ANY non-null return, so handing back a FETCHED value
// destroys the meta carrying the tag, the form and the ACCESSION. `DERIVED_BANK.nii` did that on the
// top line of a bank's income statement — 0 of 64 bank columns carried a link, against 64 of 64 on
// the Deposits row beside it.
//
// t-balance asserts this with a regex over src/extract.js matching one exact spelling. This reads
// every derivation's compiled body instead, so a reformatting, a different guard or a helper-wrapped
// return cannot slip past the spelling.
// MUTATION: restoring `nii: v => (v.nii != null ? v.nii : …)` fails here and in t-balance.
const selfReturning = [];
for (const [name, tbl] of Object.entries({ DERIVED, ...DERIVED_BY_INDUSTRY }))
  for (const [k, fn] of Object.entries(tbl)) {
    const body = stripComments(fn.toString());
    if (new RegExp("(?:return|=>|\\?|:)\\s*v\\s*\\.\\s*" + k + "(?![A-Za-z0-9_$])").test(body)) selfReturning.push(`${name}.${k}`);
  }
eq(selfReturning.join(" "), "",
  `no derivation returns the value it was handed for the key it fills${selfReturning.length ? ` — ${selfReturning.join(", ")}` : ""}. ` +
  `fillCol overwrites meta for any non-null return, so doing that deletes the cell's link to the filing it came from.`);

// ── The engine really does read the two properties a pure-text audit cannot vouch for ───────────
// Everything above this line proves a read EXISTS in the source. These two prove the engine OBEYS
// it, by calling the exported functions and requiring the answer to move — which is the lesson the
// main site's own audit wrote down three times in one session: testing a rule in isolation says the
// rule is right, not that the code obeys it.
// MUTATION: deleting the `line.instant` or `sec.instant` clause of isInstant fails here.
ok(isInstant({ id: "is" }, { k: "zzz", instant: true }), "a LINE declaring instant:true is an instant, in a section that is otherwise all durations");
ok(!isInstant({ id: "is" }, { k: "zzz" }), "and the same line without it is not — so the flag is what moved the answer, not the section");
ok(isInstant({ id: "zzz", instant: true }, { k: "zzz" }), "a SECTION declaring instant:true makes its lines instants — the clause a bank's deposits and loans needed");
ok(!isInstant({ id: "zzz" }, { k: "zzz" }), "and an unknown section with no flag is durations, which is the fallback the hardcoded list serves");
// `after` and `tab` place an overlay section. Both are declared on few objects, which is exactly
// where an unread property hides; `after` is asserted against the real insurance overlay.
// MUTATION: ignoring `sec.after` in sectionsFor fails here.
{
  const pc = sectionsFor("pc").map(s => s.id);
  const base = SECTIONS.map(s => s.id);
  ok(pc.length > base.length, "a pc sheet gains its overlay sections");
  const uw = OVERLAY_SECTIONS.pc.find(s => s.after);
  ok(uw, "the insurance overlay declares `after` on at least one section");
  eq(pc[pc.indexOf(uw.after) + 1], uw.id,
    `\`${uw.id}\` lands directly below \`${uw.after}\` — so the sheet reads I/S → Underwriting → B/S → Reserves rather than appending an industry annex at the bottom`);
  eq(sectionsFor("corporate").map(s => s.id).join(" "), base.join(" "), "and a corporate filer gets the template unchanged");
}

// ── The matcher is not a no-op ───────────────────────────────────────────────────────────────────
// Asserted last and asserted at all because every check in the first half of this file is only as
// good as `readSites`, and a gate that silently stops matching passes everything. t-balance records
// the same failure from the other side: a mutation harness whose anchors did not match reported four
// false survivors, and the fix was to make it assert its anchor.
{
  const probe = (src, prop) => {
    const saved = ENGINE["src/grid.js"];
    ENGINE["src/grid.js"] = stripComments(src);
    const n = readSites(prop).length;
    ENGINE["src/grid.js"] = saved;
    return n;
  };
  eq(probe("if (line.widget) return 1;", "widget"), 1, "a member read off a template receiver is found");
  eq(probe('const x = line["widget"];', "widget"), 1, "and a bracket read with a string key");
  eq(probe("if (sec.widget) return 1;", "widget"), 1, "on a section receiver too");
  eq(probe("// line.widget is read below, honestly\n", "widget"), 0,
    "a COMMENT mentioning the property is NOT a read — this is the exact failure that let `fallback:` look wired when `grep` returned only comments");
  eq(probe("/* line.widget */", "widget"), 0, "nor a block comment");
  eq(probe("// No `widget` here, deliberately.\n", "widget"), 0,
    "nor a comment stating the property's ABSENCE, which template.js really does contain for flagNote");
  eq(probe("const y = S.widget;", "widget"), 0,
    "a read off a NON-template receiver is not a read of a declaration — `S.label` is a CSS object and appears a dozen times in App.jsx");
  eq(probe("const y = basis.widget + m.widget + t.widget;", "widget"), 0,
    "nor the reverse-DCF basis, a segment member, or a TABS entry, all of which carry a `label` of their own");
  eq(probe("const widget = 1; return widget;", "widget"), 0, "nor a bare local of the same name");
  eq(probe("function f(widget) { return widget; }", "widget"), 0, "nor a function parameter — which is how `tags` looks read in extract.js, where no template object ever arrives");
  eq(probe("const o = { widget: 1 };", "widget"), 0, "nor a property being CONSTRUCTED on a new object, which is how `k` and `label` look read in reverse.js");
  // The stripper's one real limit, stated rather than overclaimed: `://` is protected, so a protocol
  // survives, but a BARE `//` inside a string literal would be treated as a comment and cut the rest
  // of its line — including any read site after it. That is safe only as long as no engine line
  // contains one, so the precondition is checked rather than assumed.
  eq(probe("const u = 'https://x.test/a'; if (line.widget) return 1;", "widget"), 1, "a protocol's `//` is protected, so a read after a URL still counts");
  for (const [file, src] of Object.entries({ "src/grid.js": read("src/grid.js"), "src/App.jsx": read("src/App.jsx") })) {
    const risky = src.split("\n").filter(ln => [...ln.matchAll(/[^:\\]\/\//g)]
      .some(m => (ln.slice(0, m.index + 1).match(/["`]/g) || []).length % 2 === 1));
    eq(risky.length, 0, `no line of ${file} carries a bare \`//\` inside a string literal — one would be stripped as a comment and take any read site after it off this suite's radar`);
  }
  // The real files must actually be in hand, or every read site above came from an empty string.
  ok(ENGINE["src/grid.js"].length > 8000 && ENGINE["src/App.jsx"].length > 50000, "both engine files were read and are the real ones, not empty");
  ok(/\blet line2 = line\.omitFor\b/.test(ENGINE["src/grid.js"]), "and comment-stripping left the code intact — grid.js's omitFor read survives it");
}

// ── The mutation record ─────────────────────────────────────────────────────────────────────────
// 72 mutations, 70 required to FAIL this suite and 2 required to leave it green, all 72 behaving as
// required. The harness ran against a COPY of the repo in the session scratchpad and has died with
// it — deliberately not committed, for the reason t-reverse records: a runner that rewrites `src/`
// leaves a mutated source file on disk if it is interrupted, which is a worse failure than the one it
// guards against. The durable record is the `MUTATION:` comment beside each assertion above, which is
// this repo's pattern.
//
// Every mutation asserted its own anchor matched before scoring, because the first run reported three
// "survivors" that were nothing of the kind — the find strings had simply not matched. That is the
// same failure the rule-28 session hit from the CRLF side, and a harness that cannot tell "survived"
// from "never mutated anything" is worse than no harness.
//
// The 70 caught: an unread property declared; `tags` deleted from a fetched row; a fifth `how` value;
// a duplicated core `k`; rule 29 restored on `nii`; a tagNote keyed to a tag the row does not ask for;
// an omitFor industry typo; a flagNote keyed to nothing; NOT_APPLICABLE naming a row that does not
// exist; an unreachable industry key; grid.js ceasing to read `line.instant`, `sec.after` and
// `line.omitFor`; the comment stripper made a no-op; a stale DYNAMIC entry; a DYNAMIC entry masking a
// visible read; COMPS_MEDIAN naming a missing row; a pinIdentity pointing at one; a SEVENTH
// unimplemented computed row on a tab; one baseline entry FIXED (the ratchet biting the other way); an
// orphan derivation added; an export nothing imports; a stale EXPORT_EXEMPT entry; both README counts
// drifting; tally disagreeing with its own breakdown; a genuine rename of grid.js's `line` receiver; a
// formula declared on a row that is not computed; a tag added to a row but not to KEEP; a tag removed
// from KEEP the template still asks for; the dei gate drifting from the template's `dei:` spelling; a
// PCT key that is not a row; an INSTANT_LINES key that is not a row; dcfApplicable gating on a row that
// does not exist; an EQUITY_DENOMINATED member reachable on neither surface; ValuationCard dropping
// `formula` or its ƒ, or its grid minimum reverting to 190px; a footer line made non-manual; the TSM
// gate losing any of its three legs or its in-the-money floor; `bankTopLine` tolerating a missing
// leg in either direction; the reserved `nii` slot removed; a dead `PROSE` entry; `netDebt` blanked
// without `netDebtBridge`; a life derivation moved to the pc table; and a section prepended
// above the income statement, in both its forms — empty, which crashes template.js at import and so
// cannot ship quietly, and WITH lines, which does not crash and is caught by the positional assertions
// plus three others independently. Then, from the completeness pass: NOT_APPLICABLE.bank naming a key
// from another industry's overlay; an overlay line shadowing a core line; a formula naming a row that
// no longer exists; the equity-thin note reading a renamed column key; PERIOD_TAGS copying the revenue
// row's tag array instead of aliasing it; an overlay section tabbed to `segments`, which renders no
// grid; `after` pointing at an id that does not exist, and `after` declared on a core section where it
// is inert; ValuationCard dropping `formula` or its marker; the card's note ceasing to name P/B; and
// the deleted orphan derivation coming back; netDebtBridge un-implemented again or moved above the
// row it restates; and a new computed row whose formula divides by a market price.
// The 2 correctly left green: a comment mentioning a fake property, and reordering two tags on a row.
//
// The receiver list looked like the weak link and was MEASURED rather than assumed, which reversed
// the answer. Renaming every `line` in grid.js to `ln` — 62 occurrences, a genuine rename — fails this
// suite NINE times, once per property that grid.js is the only reader of (`latest`, `mustBeCurrent`,
// `omitFor`, `pinByRun`, `pinIdentity`, `preferNonZero`, `tags`, `wcAggregate`, `how`), each saying no
// read site was found. That is the intended behaviour: the suite is asking to be told the new name
// rather than guessing, and it asks loudly. What does NOT fail is a rename that aliases the old name
// straight back (`for (const ln of sec.lines) { const line = ln; … }`) — and that is correct, because
// such a rename changes no read at all. Recorded because the first draft of this comment claimed the
// opposite from reasoning alone.

done("t-declared");
