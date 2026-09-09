// A 30-line assertion harness, on purpose — the same shape the main site uses, and for the same
// reason: the sweep suites this project was verified with (t-regress, t-ltm, t-seg, t-declared,
// t-corp) lived in session scratchpads and died with their sessions, so their counts in the README
// are history rather than a gate. Anything committed here runs with `npm test` and stays.
//
// Every suite drives the SHIPPING module by importing it. Never copy a function in here to test it:
// a mirror passes while production breaks, which is exactly the drift that moving the grid build out
// of App.jsx into grid.js was done to end.
let pass = 0;
const failures = [];
export function ok(cond, msg) { if (cond) pass++; else failures.push(msg); }
export function eq(actual, expected, msg) {
  const a = typeof actual === "string" ? actual : JSON.stringify(actual);
  const b = typeof expected === "string" ? expected : JSON.stringify(expected);
  if (a === b) pass++; else failures.push(`${msg}\n      expected: ${JSON.stringify(b)}\n      actual:   ${JSON.stringify(a)}`);
}
export function near(actual, expected, tol, msg) { ok(typeof actual === "number" && Math.abs(actual - expected) <= tol, `${msg} — got ${actual}, wanted ${expected} ± ${tol}`); }
export function done(name) {
  if (failures.length) { console.log(`FAIL ${name} — ${pass} passed, ${failures.length} failed`); for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1); }
  console.log(`ok   ${name} — ${pass} assertions`); process.exit(0);
}
