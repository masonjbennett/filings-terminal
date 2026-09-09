// `npm test` — runs every test/t-*.mjs and fails the run if any suite fails. Suites are DISCOVERED,
// not listed: a suite that is written and never run looks exactly like one that passes.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const suites = readdirSync(here).filter(f => f.startsWith("t-") && f.endsWith(".mjs")).sort();
if (!suites.length) { console.error("no suites found in test/ — a green run over zero suites is not a passing build"); process.exit(1); }
let failed = 0;
for (const s of suites) { const r = spawnSync(process.execPath, [join(here, s)], { stdio: "inherit" }); if (r.status !== 0) failed++; }
console.log(`\n${suites.length - failed}/${suites.length} suites passed`);
process.exit(failed ? 1 : 0);
