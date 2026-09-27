// The error boundary: what it renders when a block fails, and that every block has one.
//
// Two halves, because neither is enough alone. The first drives the SHIPPING class directly — it is
// a plain .js module using createElement, so node imports it without a build step — and pins the
// behaviour that decides what a reader sees. The second reads src/App.jsx and src/main.jsx as text
// and fails if a component is rendered outside a boundary, which is what stops the next card
// shipping unprotected.
//
// WHAT NEITHER HALF CAN DO: prove that React actually routes a child's throw to the boundary. That
// is React's contract, not this code's, and showing it needs a browser. It was verified on the
// running site the day this shipped — a component made to throw, the agate line appearing in its
// place, the rest of the page standing — and that check has to be redone by hand if the React major
// version ever moves.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ok, eq, done } from "./_t.mjs";
import { Boundary, failMessage, failText } from "../src/boundary.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = f => readFileSync(join(root, f), "utf8");

// ── Block 1 — what a failure shows ──────────────────────────────────────────────────────────────
// MUTATION: dropping the "not the filer's" clause fails here. That clause is the whole reason the
// notice exists rather than being silence — rule 5 says every blank on this sheet declares its kind,
// and a block that vanished because code threw would otherwise read as "n/a, this filer never
// reported it", which is the page lying about EDGAR to hide a bug in itself.
{
  const t = failText("The income statement section");
  ok(t.includes("could not be rendered"), "the notice says the block failed to render");
  ok(/not the filer/.test(t), "and that the gap is the tool's, not the filer's — the seventh kind of blank");
  ok(!/error|exception|stack|wrong|sorry/i.test(t), "and it is not an error plate: no error, exception, stack, sorry");
  ok(t.startsWith("The income statement section"), "it names the block it replaced");
  eq(failText(), "this block could not be rendered — the gap here is this tool's, not the filer's",
    "and falls back to a neutral subject when a boundary was given no name");
}

// ── Block 2 — the message never reaches the page, and is capped for the console ────────────────
// An upstream payload can end up quoted inside an error message, and a stack is never a thing to
// print on this page. MUTATION: removing the 140-char cap or the first-line split fails here.
{
  eq(failMessage(new Error("boom")), "boom", "an Error gives its message");
  eq(failMessage(new Error("first\nsecond\nthird")), "first", "only the FIRST line — a stack starts on line two");
  eq(failMessage(new Error("first\r\nsecond")), "first", "CRLF too");
  eq(failMessage(new Error("x".repeat(400))).length, 140, "capped at 140 characters");
  eq(failMessage(null), "", "a null throw gives an empty string rather than \"null\"");
  eq(failMessage(undefined), "", "so does undefined");
  eq(failMessage("a string throw"), "a string throw", "a thrown string is used as-is");
  eq(failMessage({ nope: 1 }), "[object Object]", "and a thrown object with no message degrades rather than throwing");
  ok(!failText("x").includes("boom"), "the notice text never carries the message");
}

// ── Block 3 — the class's state machine ─────────────────────────────────────────────────────────
// `failed` is a flag SEPARATE from `error` because `throw null` is legal: keyed on the error alone,
// a falsy throw would leave the boundary rendering the children that just threw.
// MUTATION: returning `{ error }` alone from getDerivedStateFromError fails the null-throw case.
{
  eq(Boundary.getDerivedStateFromError(new Error("x")).failed, true, "a throw sets the failed flag");
  eq(Boundary.getDerivedStateFromError(null).failed, true, "and `throw null` sets it too — the flag is why");
  eq(Boundary.getDerivedStateFromError(undefined).failed, true, "and `throw undefined`");

  // componentDidUpdate is the re-arm. Driven directly with a fake `this`, which is all it touches.
  const runUpdate = (state, prevKey, nowKey) => {
    let next = null;
    const self = { state, props: { resetKey: nowKey }, setState: s => { next = s; } };
    Boundary.prototype.componentDidUpdate.call(self, { resetKey: prevKey });
    return next;
  };
  eq(runUpdate({ failed: true, error: 1 }, "a", "b"), { failed: false, error: null },
    "a failed boundary re-arms when its resetKey changes");
  eq(runUpdate({ failed: true, error: 1 }, "a", "a"), null, "and does not re-arm when it has not");
  eq(runUpdate({ failed: false, error: null }, "a", "b"), null, "a healthy boundary never calls setState — that would loop");
  eq(runUpdate({ failed: true, error: 1 }, undefined, undefined), null,
    "a boundary with no resetKey at all never re-arms from this path; it re-arms by unmounting");
}

// ── Block 4 — render: children, fallback, notice ────────────────────────────────────────────────
// `fallback !== undefined` rather than truthiness, because `fallback={null}` is a real instruction —
// "render NOTHING here" — for the places an agate line has no room.
{
  const render = (state, props) => Boundary.prototype.render.call({ state, props });
  eq(render({ failed: false }, { children: "kids" }), "kids", "a healthy boundary renders its children");
  const notice = render({ failed: true, error: new Error("x") }, { name: "The segments tab" });
  eq(notice.type, "div", "a failed one renders a div");
  ok(String(notice.props.children).includes("The segments tab"), "carrying the named notice");
  ok(!String(notice.props.children).includes("x"), "and never the error message");
  eq(notice.props.style.color, "#990f3d", "in claret");
  eq(notice.props.style.fontSize, 8.5, "at agate size");
  ok(/JetBrains Mono/.test(notice.props.style.fontFamily), "in the mono face the other status tokens use");
  ok(!("border" in notice.props.style) && !("background" in notice.props.style),
    "with no border and no background — a register, not an error plate");
  eq(render({ failed: true, error: 1 }, { fallback: null }), null, "fallback={null} renders nothing at all");
  eq(render({ failed: true, error: 1 }, { fallback: "page" }), "page", "and a given fallback wins over the notice");
}

// ── Block 5 — every component is rendered inside a boundary ─────────────────────────────────────
// The sweep. For each component App() renders, the nearest <Boundary before its tag must be an OPEN
// one — i.e. no </Boundary> sits between them. Deliberately window-free: the first cut searched the
// preceding 600 characters and went red on CompsTable, whose own fallback JSX is longer than that,
// so the window was measuring the fallback's size rather than whether the component was wrapped.
// Text rather than an AST on purpose: the
// property being checked is lexical, the file is one 1,700-line component, and an AST walk of a JSX
// return with this many conditional branches is more machinery to get wrong than the thing it checks.
// MUTATION: unwrapping any one of the five fails this block by name.
{
  const app = src("src/App.jsx");
  const COMPONENTS = ["CompsTable", "CompanySheet", "ValuationCard", "PricedIn", "SegmentTables", "SectionRows"];
  for (const name of COMPONENTS) {
    const at = app.indexOf(`<${name}`);
    ok(at > 0, `${name} is rendered in App.jsx`);
    const before = app.slice(0, at);
    const open = before.lastIndexOf("<Boundary");
    const close = before.lastIndexOf("</Boundary>");
    ok(open > -1 && open > close, `${name} is rendered inside a <Boundary>`);
  }
  // The anti-vacuity check: the sweep must be looking at something. If the component list ever
  // stops matching what the file renders, this goes red rather than passing over nothing.
  const rendered = [...app.matchAll(/<([A-Z][A-Za-z]*)/g)].map(m => m[1]).filter(n => n !== "Fragment" && n !== "Boundary" && n !== "Label");
  eq([...new Set(rendered)].sort().join(" "), COMPONENTS.slice().sort().join(" "),
    "and the list is every component App.jsx renders — a new one fails this until it is added and wrapped");
  ok(app.includes(`import { Boundary } from "./boundary.js";`), "App.jsx imports the boundary");
}

// ── Block 5b — the grid is built BELOW a boundary, which is the point of CompanySheet ────────────
// `buildGrid` used to run in a useMemo inside App's own render, where no boundary in the returned
// JSX could catch it — only the root boundary was above it, and the root firing costs the whole
// page. It moved into CompanySheet on Sep 27 2026 so a failure there costs the sheet and leaves the
// masthead and a working search box. This assertion is that move, pinned.
// MUTATION: moving the sheet's `const grid = useMemo(...)` back above App's return fails here.
{
  const app = src("src/App.jsx");
  const sheetAt = app.indexOf("function CompanySheet(");
  const gridAt = app.indexOf("const grid = useMemo(() => buildGrid(");
  ok(sheetAt > 0, "CompanySheet exists");
  ok(gridAt > sheetAt, "and the sheet's grid is built INSIDE it, below a boundary — not in App's own render");

  // App may still call buildGrid for a comps set member; that one is not the sheet's and is not in
  // App's render path. Anything ELSE would put an unprotected grid build back in App.
  const appBody = app.slice(app.indexOf("export default function App"), sheetAt);
  const calls = (appBody.match(/buildGrid\(/g) || []).length;
  eq(calls, 1, "App calls buildGrid exactly once — for a comps member, inside addComp, not in its render");
  ok(/grid: buildGrid\(d, quote\)/.test(appBody), "and that one call is the comps member's own grid");
}

// ── Block 6 — the two fallbacks that are not the default notice ─────────────────────────────────
{
  const app = src("src/App.jsx");
  // A <div> inside <tbody> is invalid markup, so the sections' fallback has to be a table row.
  const secAt = app.indexOf("<SectionRows");
  const secBlock = app.slice(Math.max(0, secAt - 900), secAt);
  ok(/fallback=\{<tr><td colSpan=/.test(secBlock),
    "the per-section fallback is a table ROW — a div inside tbody is invalid markup");
  ok(secBlock.includes("not the filer&rsquo;s"), "and it carries the seventh-kind wording");
  // The comps controls live inside CompsTable, so its fallback has to carry its own way out.
  const compsAt = app.indexOf("<CompsTable");
  const compsBlock = app.slice(Math.max(0, compsAt - 1200), compsAt);
  ok(/clear the set/.test(compsBlock),
    "the comps fallback carries its own Clear — Remove and Clear live inside the component it replaced");
}

// ── Block 7 — the root ──────────────────────────────────────────────────────────────────────────
// The one fallback that is a PAGE, because rendering nothing at the root is the white page this
// whole module exists to prevent. MUTATION: rendering <App /> bare again fails here.
{
  const main = src("src/main.jsx");
  ok(/<Boundary[^>]*>\s*<App \/>\s*<\/Boundary>/.test(main.replace(/\n/g, " ")), "main.jsx renders App inside a boundary");
  ok(main.includes("fallback={lastResort}"), "with a page-sized fallback");
  ok(/href="\/"/.test(main), "whose way back is / with no query string — a different edge-cache key");
  ok(!/import .* from "\.\/App\.jsx".*\n.*lastResort/.test(main) && main.includes("#faf3ea"),
    "and whose colours are inlined: a fallback that imports from the thing that just failed is not a fallback");
  ok(/not the filer/.test(main), "the last-resort page makes the same claim the agate notice does");
}

done("t-boundary");
