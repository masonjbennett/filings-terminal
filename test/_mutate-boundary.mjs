// Reintroduce each defect t-boundary claims to catch, and require the suite to go red.
// Always reverts, even on a throw. Run from the repo root: node test/_mutate-boundary.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const MUTS = [
  ["src/boundary.js", "the notice stops saying the gap is the tool's, not the filer's",
    " — the gap here is this tool's, not the filer's", ""],
  ["src/boundary.js", "the notice becomes an error plate instead of a status register",
    "could not be rendered", "error: something went wrong rendering"],
  ["src/boundary.js", "the console message is not capped, so a payload can ride inside it",
    ".split(/\\r?\\n/)[0].trim().slice(0, 140)", ""],
  ["src/boundary.js", "the message keeps its later lines, which is where a stack lives",
    ".split(/\\r?\\n/)[0].trim()", ".trim()"],
  ["src/boundary.js", "`throw null` leaves the boundary rendering the children that threw",
    "static getDerivedStateFromError(error) { return { failed: true, error }; }",
    "static getDerivedStateFromError(error) { return { failed: !!error, error }; }"],
  ["src/boundary.js", "a healthy boundary calls setState on every update, which loops",
    "if (this.state.failed && prev.resetKey !== this.props.resetKey)",
    "if (prev.resetKey !== this.props.resetKey)"],
  ["src/boundary.js", "a failed boundary never re-arms",
    "componentDidUpdate(prev) {\n    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false, error: null });\n  }",
    "componentDidUpdate(prev) {}"],
  ["src/boundary.js", "fallback is tested for truthiness, so fallback={null} falls through to the notice",
    "if (this.props.fallback !== undefined) return this.props.fallback;",
    "if (this.props.fallback) return this.props.fallback;"],
  ["src/boundary.js", "the notice carries the error message onto the page",
    "return createElement(\"div\", { style: AGATE }, failText(this.props.name));",
    "return createElement(\"div\", { style: AGATE }, failText(this.props.name) + \": \" + failMessage(this.state.error));"],
  ["src/boundary.js", "the notice becomes a bordered plate",
    "const AGATE = { fontSize: 8.5,", "const AGATE = { border: \"1px solid #990f3d\", background: \"#fff\", fontSize: 8.5,"],
  ["src/App.jsx", "the valuation card is rendered outside a boundary",
    "<Boundary name=\"The valuation card\"", "<Fragment key=\"x\" data-was=\"The valuation card\""],
  ["src/App.jsx", "the sheet's sections lose their per-section boundary",
    ".map(sec => <Boundary key={sec.id} name={`The ${sec.title} section`}", ".map(sec => <Fragment key={sec.id} data-was={`The ${sec.title} section`}"],
  ["src/App.jsx", "the sections' fallback becomes a div, which is invalid inside tbody",
    "fallback={<tr><td colSpan=", "fallback={<div><span colSpan="],
  ["src/App.jsx", "the comps fallback loses the Clear that replaces the one inside the component",
    ">clear the set</button>", "></button>"],
  ["src/main.jsx", "App is rendered bare again, as it was before Sep 26 2026",
    "<Boundary name=\"Filings Terminal\" fallback={lastResort}><App /></Boundary>", "<App />"],
  ["src/main.jsx", "the last-resort page loses its way back",
    "<a href=\"/\"", "<span"],
  ["src/main.jsx", "the last-resort page stops saying whose fault it is",
    "The fault is this tool&rsquo;s, not the filer&rsquo;s, and nothing below it was a figure from a", "Something went wrong, and nothing below it was a figure from a"],
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
    const r = spawnSync(process.execPath, ["test/t-boundary.mjs"], { encoding: "utf8" });
    if (r.status !== 0) { red++; console.log(`red    ${what}`); }
    else { green++; console.log(`SURVIVED  ${what}  <-- the suite does not catch this`); }
  } finally {
    writeFileSync(file, original);
  }
}
const check = spawnSync(process.execPath, ["test/t-boundary.mjs"], { encoding: "utf8" });
console.log(`\n${red} caught, ${green} survived, of ${MUTS.length}`);
console.log(`unmutated suite after revert: ${check.status === 0 ? "green" : "RED — the revert failed"}`);
process.exit(green || check.status !== 0 ? 1 : 0);
