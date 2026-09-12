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
import { DERIVED, DERIVED_BY_INDUSTRY, YOY, CAGRS } from "../src/extract.js";
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

// 27 today. Asserted so that ADDING a property to the template cannot slip through on a green run
// without someone looking at this file — the count moving is the prompt to check the new one is
// wired, which is the conversation `derivedOnly` never triggered.
// MUTATION: declaring any new property on any line fails here first.
eq(declared.size, 27, `the template declares 27 distinct properties — found ${declared.size}: ${[...declared.keys()].sort().join(" ")}`);

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
// row renders a ƒ marker whose tooltip IS `line.formula` (src/App.jsx:1397) and whose status is
// deliberately `null` (src/App.jsx:1391) — so a computed row with no implementation is a BLANK CELL
// ADVERTISING A FORMULA, with nothing on the page saying it was never computed. That is strictly
// worse than "not tagged", which at least sends the reader somewhere.
//
// The implemented set is DERIVED from the code rather than listed, so a derivation added tomorrow
// counts tomorrow: the four derivation tables, the two cross-column passes, and — read out of
// src/grid.js's own text — the `mark("…")` calls in applyQuote and the `v.<key> =` facts fillCol
// writes directly. A hand-maintained list here would be one more declaration nothing enforces.
const gridSrc = ENGINE["src/grid.js"];
const implemented = new Set([
  ...Object.keys(DERIVED),
  ...Object.values(DERIVED_BY_INDUSTRY).flatMap(d => Object.keys(d)),
  ...Object.keys(YOY), ...Object.keys(CAGRS),
  ...[...gridSrc.matchAll(/\bmark\(\s*"(\w+)"/g)].map(m => m[1]),
  ...[...gridSrc.matchAll(/\bv\.(\w+)\s*=(?!=)/g)].map(m => m[1]),
]);
// The matcher has to have matched something, or this whole check passes vacuously. applyQuote's
// bridge is eleven rows and fillCol writes six column facts; both regexes earn their place.
ok([...gridSrc.matchAll(/\bmark\(\s*"(\w+)"/g)].length >= 11, "the applyQuote bridge was found in grid.js — if this regex stops matching, every market row looks unimplemented");
ok([...gridSrc.matchAll(/\bv\.(\w+)\s*=(?!=)/g)].length >= 6, "fillCol's directly-written column facts were found — same vacuous-pass risk");

const rows = [];
for (const sec of SECTIONS) for (const line of sec.lines) rows.push({ sec, line, id: `${sec.id}/${line.k}` });
for (const [ind, secs] of Object.entries(OVERLAY_SECTIONS)) for (const sec of secs) for (const line of sec.lines) rows.push({ sec, line, ind, id: `${ind}/${sec.id}/${line.k}` });

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
const UNIMPLEMENTED_ON_A_TAB = {
  "dcf/netDebtBridge": "declared `netDebt`, which is a row the engine already computes — the equity-bridge restatement of it was never wired",
  "dilution/treasuryMethod": "declared as the treasury-stock method over `optionsOut`/`optionsStrike`/`rsuOut`, all three of which ARE fetched; it needs a price, which the row does not declare as an input",
};
const unimplementedOnATab = rows
  .filter(r => r.line.how === "computed" && !implemented.has(r.line.k) && tabSecs.has(r.sec.id))
  .map(r => r.id).sort();
eq(unimplementedOnATab.join("\n"), Object.keys(UNIMPLEMENTED_ON_A_TAB).sort().join("\n"),
  `exactly the known computed rows on a RENDERED tab have no implementation. A row added to this list is rule 25 again — ` +
  `a blank cell under a ƒ marker advertising a formula, with status deliberately null so nothing on the page says it was never computed. ` +
  `A row REMOVED from it is a fix: delete its entry here.`);

// Every OTHER computed row is implemented. Stated as its own assertion so the baseline above can
// never quietly grow to cover the whole template.
for (const r of rows)
  if (r.line.how === "computed" && !(r.id in UNIMPLEMENTED_ON_A_TAB) && !footerSecs.includes(r.sec.id))
    ok(implemented.has(r.line.k), `\`${r.id}\` declares how:"computed" and something computes it — formula: ${r.line.formula || "(none declared)"}`);

// ── The footer prints only its manual lines, so a non-manual line there renders NOWHERE ─────────
// The tighter statement of the same class, and the one that sorts the severity out. src/App.jsx:749
// builds the "Deliberately not computed" block from `s.lines.filter(l => l.how === "manual")`, and
// the three footer sections appear in no tab, so they are not exported either. A line in one of them
// that is not `manual` is therefore a row that claims to be obtainable, is obtained by nothing, and
// is shown to no one — invisible in a way the two rows above at least are not.
//
// Six of them, and the list is exact for the same ratchet reason.
const FOOTER_NON_MANUAL = {
  "premia/undisturbed": 'how:"market", and the free quote tier carries no historical price, so an undisturbed price cannot arrive',
  "premia/premium1d": 'how:"computed" over `offerPrice` (manual) and `undisturbed` (unobtainable above) — it could never have computed',
  "lbo/ltmEbitda": 'how:"computed" as "sum(last 4 quarters)"; the engine HAS an LTM path (ltmWindows/pickLtm) and this row is not on it',
  "lbo/ltmRevenue": "same — the LTM column computes both of these, under different keys, for every other tab",
  "lbo/entryNetDebt": "declared `netDebt`, a row the engine already computes",
  "pta/ptaFilings": 'how:"fetched" with NO `tags` at all, so fillCol skips it at src/grid.js:72 and it can never fetch anything',
};
const footerNonManual = rows.filter(r => footerSecs.includes(r.sec.id) && r.line.how !== "manual").map(r => r.id).sort();
eq(footerNonManual.join("\n"), Object.keys(FOOTER_NON_MANUAL).sort().join("\n"),
  `exactly the known non-manual lines sit in a footer section. The footer renders only how:"manual" labels and these sections get no tab, ` +
  `so each of these is a declared row that computes nothing and displays nowhere. Either it becomes manual (the footer then names it honestly), ` +
  `or it gets implemented and a tab, or it goes.`);

// ── A fetched row with no tags can never fetch ───────────────────────────────────────────────────
// `if (line.how !== "fetched" || !line.tags) continue;` — src/grid.js:72. The row is skipped
// entirely: no value, no meta, and on a rendered tab it would fall through to "not tagged", which
// points a reader at EDGAR to hunt for something the template never asked for.
// MUTATION: deleting `tags` from any fetched row on a tab fails here.
for (const r of rows)
  if (r.line.how === "fetched" && !(r.id in FOOTER_NON_MANUAL))
    ok(Array.isArray(r.line.tags) && r.line.tags.length > 0 || r.line.wcAggregate,
      `\`${r.id}\` declares how:"fetched" and has tags to fetch with (or aggregates its own, like chgNwc) — grid.js skips a fetched row with no tags`);

// ── A derivation nothing displays and nothing reads is work thrown away ─────────────────────────
// The mirror of rule 22: there, a declared formula with no implementation; here, an implementation
// with no declaration. `DERIVED_PC.lossesTotal` runs on every column of every P&C insurer and its
// result is displayed by no row and read by no note — every other pc derivation calls the `pcLosses`
// helper directly rather than reading `v.lossesTotal`.
//
// A derivation key is legitimately absent from the rows when a `flagNote` keys off it — that is how
// `nciDerived`, `equityThin` and `grossProfitDerived` earn their place, which is the next check.
const rowKeys = new Set(rows.map(r => r.line.k));
const flagKeys = new Set(rows.flatMap(r => (r.line.flagNote ? Object.keys(r.line.flagNote) : [])));
const ORPHANS = { "pc.lossesTotal": "computed on every P&C column and read by nothing — the other pc derivations call the `pcLosses` helper, not `v.lossesTotal`" };
const orphans = [];
for (const [name, tbl] of Object.entries({ DERIVED, ...DERIVED_BY_INDUSTRY }))
  for (const k of Object.keys(tbl)) if (!rowKeys.has(k) && !flagKeys.has(k)) orphans.push(`${name === "DERIVED" ? "DERIVED" : name}.${k}`);
eq(orphans.sort().join("\n"), Object.keys(ORPHANS).sort().join("\n"),
  "exactly the known orphan derivations compute into `v` without a row or a flagNote reading the result");

// ── Names that must match other names, or nothing is enforced ───────────────────────────────────
// Every check below is of the same kind and it is the kind that fails silently: a set naming a row
// that does not exist suppresses nothing, a note keyed to a tag the row never asks for can never
// fire, and an industry key INDUSTRY() cannot return is unreachable code that looks like a rule.
// None of these is hypothetical — the mezzanine row held a KEEP slot for a tag SEC 404s, and nothing
// could fail because a tag that never matches looks exactly like a filer that never tagged.
const allK = new Set(rows.map(r => r.line.k));
const mustBeRows = (label, names) => {
  const bad = [...names].filter(n => !allK.has(n));
  eq(bad.join(" "), "", `every name in ${label} is a line \`k\` the template actually declares${bad.length ? ` — orphaned: ${bad.join(" ")}` : ""}`);
};
mustBeRows("EQUITY_DENOMINATED", EQUITY_DENOMINATED);
mustBeRows("CURRENCY_DENOMINATED", CURRENCY_DENOMINATED);
mustBeRows("COMPS_MEDIAN", COMPS_MEDIAN);
mustBeRows("COMPS_ROWS", COMPS_ROWS.flatMap(g => g.rows.map(r => r.k)));
for (const [ind, list] of Object.entries(NOT_APPLICABLE)) mustBeRows(`NOT_APPLICABLE.${ind}`, list);
mustBeRows("YOY keys", Object.keys(YOY));
mustBeRows("YOY sources", Object.values(YOY));
mustBeRows("CAGRS keys", Object.keys(CAGRS));
mustBeRows("CAGRS sources", Object.values(CAGRS).map(c => c[0]));
mustBeRows("pinIdentity minus/equals", rows.filter(r => r.line.pinIdentity).flatMap(r => [r.line.pinIdentity.minus, r.line.pinIdentity.equals]));

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
  ok(ENGINE["src/grid.js"].length > 10000 && ENGINE["src/App.jsx"].length > 50000, "both engine files were read and are the real ones, not empty");
  ok(/\blet line2 = line\.omitFor\b/.test(ENGINE["src/grid.js"]), "and comment-stripping left the code intact — grid.js's omitFor read survives it");
}

// ── The mutation record ─────────────────────────────────────────────────────────────────────────
// 30 mutations, 28 required to FAIL this suite and 2 required to leave it green, all 30 behaving as
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
// The 28 caught: an unread property declared; `tags` deleted from a fetched row; a fifth `how` value;
// a duplicated core `k`; rule 29 restored on `nii`; a tagNote keyed to a tag the row does not ask for;
// an omitFor industry typo; a flagNote keyed to nothing; NOT_APPLICABLE naming a row that does not
// exist; an unreachable industry key; grid.js ceasing to read `line.instant`, `sec.after` and
// `line.omitFor`; the comment stripper made a no-op; a stale DYNAMIC entry; a DYNAMIC entry masking a
// visible read; COMPS_MEDIAN naming a missing row; a pinIdentity pointing at one; a SEVENTH
// unimplemented computed row on a tab; one baseline entry FIXED (the ratchet biting the other way); an
// orphan derivation added; an export nothing imports; a stale EXPORT_EXEMPT entry; both README counts
// drifting; tally disagreeing with its own breakdown; and a genuine rename of grid.js's `line` receiver.
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
