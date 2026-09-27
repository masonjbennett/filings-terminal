// The terminal's error boundary. Until Sep 26 2026 there was none: `src/main.jsx` rendered <App />
// bare, so one throw while rendering unmounted the entire tree and a reader got a white page. The
// payloads this page renders come from SEC and from Finnhub, are shaped by whatever those APIs
// returned, and are cached at Vercel's edge for up to 30 hours — so a blank could outlive the bad
// data for every reader who looked up that ticker.
//
// WHAT THIS IS NOT FOR, and the measurement that decides it. Driving the shipping `buildGrid` over
// all 180 cached payloads throws zero times. Mutating those payloads the way a cache actually goes
// bad — 21 kinds, 40 filers each: facts missing, facts null, a unit array replaced by a string, a
// fact row nulled, an end date truncated, a value turned into a string or NaN, the whole payload
// null — makes it throw on exactly TWO, and both were the same field read without a guard
// (`data.filings`, at grid.js's `newestFiledDate` and the `behind` filter). Both are now normalised
// at the top of buildGrid. Everything else already fails gracefully, because rule 5's discipline
// forced this engine to handle absent data everywhere.
//
// So this boundary is not the answer to a known defect. It is the answer to the UNFORESEEN one: the
// next formatter, the next API that changes a field's type, the next card. A shape gate is the right
// tool where a bad shape can be named in advance, because a gate still knows which kind of blank it
// owes the reader; a boundary catches what nobody predicted, and by then that knowledge is gone.
//
// FAILING CLOSED, AND WHY IT IS NOT SILENCE. The house rule the Fed Ledger set is that a bad or
// partial parse renders nothing rather than something WRONG about a filer. A boundary that renders
// nothing satisfies the letter of that and breaks its purpose, because of rule 5: every blank on
// this sheet declares its kind — not tagged, n/a, n/m, judgement, needs price, refused — so that a
// reader can tell "go hunt this in the 10-K" from "this does not exist for this filer". A row that
// vanishes because code threw is the one blank with no kind, and a reader who has learned this
// page's grammar will read it as the nearest kind they know: n/a, this filer never reported it.
// That is the page telling a lie about EDGAR in order to hide a bug in itself, on the one page whose
// argument is that it does not do that.
//
// So a failed block says so, to everyone. The notice asserts nothing about a filing — no figure, no
// date, no form, no tag, no accession — and it is deliberately in the register this page already
// uses for "this blank has a reason": agate, JetBrains Mono, 8.5px, claret, no box, no border, no
// heading, no icon. It is a seventh kind of blank, not an error plate.
//
// The error MESSAGE never reaches the page — upstream payload text ends up inside error messages,
// and a stack is never a thing to print here. The console always gets it, with the block's name,
// because minified React calls the component `_a` and the name is the part that says where to look.
// There is no owner-only channel: this repo has no localStorage, sessionStorage or IndexedDB
// anywhere in src/, api/ or public/, and adding the first persistent client-side state to carry a
// debug flag would be a worse trade than reading the console.
//
// A class because React 18 has no hook for this, and written with createElement rather than JSX so
// it stays a plain .js module that node imports without a build step — `test/t-boundary.mjs` drives
// render() and the reset rule directly.
//
// TWO LIMITS worth knowing. (1) A boundary catches what its CHILDREN throw while rendering. JSX
// written inline in App()'s own return runs in App's render, above every boundary inside that
// return, so only the root boundary in main.jsx is above it — which is why the root boundary's
// fallback is a page rather than a line. (2) It does not catch event handlers, timers or rejected
// promises; those never unmounted anything, so they were never this problem.
import { Component, createElement } from "react";

// The first line of the message, capped, for the console only. Exported so the suite can pin the
// cap and the single-line rule without rendering anything.
export function failMessage(error) {
  const raw = error && typeof error === "object" && "message" in error ? error.message : error;
  return String(raw == null ? "" : raw).split(/\r?\n/)[0].trim().slice(0, 140);
}

// What the reader is told. Says the gap is the tool's, which is the whole point — it is the seventh
// kind of blank, and the one thing it must not be mistaken for is a filer that did not report.
export const failText = name => `${name || "this block"} could not be rendered — the gap here is this tool's, not the filer's`;

const AGATE = { fontSize: 8.5, color: "#990f3d", fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.5, margin: "10px 0", textTransform: "uppercase" };

// Props: `name` (the block, for the console and the notice) · `resetKey` (when it changes, a failed
// boundary tries its children again) · `fallback` (rendered instead of the notice; `null` where even
// an agate line has no room, and a page at the root, where rendering nothing IS the blank page).
export class Boundary extends Component {
  constructor(props) { super(props); this.state = { failed: false, error: null }; }
  // `failed` is its own flag because `throw null` is legal: keyed on the error alone, a falsy throw
  // would leave the boundary rendering the children that just threw.
  static getDerivedStateFromError(error) { return { failed: true, error }; }
  componentDidCatch(error, info) {
    console.error(`[boundary] ${this.props.name || "unnamed"} threw while rendering and was removed from the page: ${failMessage(error)}`, error, info && info.componentStack);
  }
  // A transient failure must not stick. A block inside a tab needs no key — switching away unmounts
  // it, so coming back mounts a fresh boundary. resetKey is for what never unmounts: the sheet
  // itself, which survives a tab change and has to re-arm when the ticker or the price changes.
  componentDidUpdate(prev) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false, error: null });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return createElement("div", { style: AGATE }, failText(this.props.name));
  }
}
