// Reads the fixture cache if it is there, and says so plainly when it is not.
//
// Six of the README's open items are blocked on this cache, so suites that want real filers should
// be written against it NOW and skip cleanly until it exists — rather than not being written,
// which is how the last two caches came and went without leaving a committed test behind.
//
// Build it with `node scripts/build-fixtures.mjs`. Point suites at a copy elsewhere with
// FILINGS_FIXTURES=/path/to/cache. Files are `<TICKER>.json`, each the exact payload the browser
// receives from api/facts.js.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURE_DIR = process.env.FILINGS_FIXTURES || join(root, "fixtures");
export const haveFixtures = () => existsSync(join(FIXTURE_DIR, "manifest.json"));
export const fixtureTickers = () =>
  (haveFixtures() ? readdirSync(FIXTURE_DIR) : []).filter(f => f.endsWith(".json") && f !== "manifest.json")
    .map(f => f.replace(/\.json$/, ""));
export const loadFixture = t => JSON.parse(readFileSync(join(FIXTURE_DIR, `${t}.json`), "utf8"));
// A suite calls this first and returns early when it is false. The message names the command, so a
// skipped suite tells the next reader how to un-skip it rather than just being quiet.
export function needFixtures(name) {
  if (haveFixtures()) return true;
  console.log(`skip ${name} — no fixture cache at ${FIXTURE_DIR}. Build it: node scripts/build-fixtures.mjs`);
  return false;
}
