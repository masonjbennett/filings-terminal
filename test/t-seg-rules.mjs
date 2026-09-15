// The Segments tab's Sep 15 2026 rules — the co-registrant entity axis (rule 1's exception), linkbases found
// by the listing and read by href (including the ones DFIN embeds in the .xsd), a row's label taken per
// table, a table not shown twice, an empty tab that says which of five things is true, and a payload built without
// a companion file the listing named that says it is partial and is cached for five minutes. Measured before
// they shipped over 217 filers through the segment instance cache (the private notes'
// measure/audit4/item0, item1 and segments-impl): NextEra's segment table foots to the dollar and 216 other
// payloads are unchanged by the entity rule; 53 filers gain their linkbases; 35 views that repeat another
// view's cells go; the 26 empty tabs classify 8 / 1 / 2 / 2 / 13.
//
// That cache is 1.7GB and dies with its session, so this suite does not use it. Every filing here is
// HAND-BUILT — submissions JSON, index.json listing, instance, .xsd, definition / label / presentation
// linkbases, FilingSummary — in the shape of the filer it is named for, served through a stubbed `fetch`,
// and driven through the SHIPPING handler. Nothing here re-implements a rule; every assertion reads the
// payload the handler returned. Mutation-tested; each mutation is named beside the block it breaks.
import { ok, eq, done } from "./_t.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = new Map();
// A URL in FAIL answers that status instead of its body; a URL in THROW never answers at all — SEC's two ways of
// failing a request the listing says will succeed.
const FAIL = new Map(), THROW = new Set();
let hits = [];
globalThis.fetch = async u => {
  u = String(u);
  hits.push(u);
  if (THROW.has(u)) throw new Error("ECONNRESET");
  if (FAIL.has(u)) return { ok: false, status: FAIL.get(u), text: async () => "", json: async () => ({}) };
  if (!SITE.has(u)) return { ok: false, status: 404, text: async () => "", json: async () => ({}) };
  const body = SITE.get(u);
  return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
};
const handler = (await import("../api/segments.js")).default;

// ── the filing builder ──────────────────────────────────────────────────────────────────────────────────
const Q = "srt:ConsolidationItemsAxis", SEG = "us-gaap:StatementBusinessSegmentsAxis",
  PROD = "srt:ProductOrServiceAxis", GEO = "srt:StatementGeographicalAxis", ENT = "dei:LegalEntityAxis";
const OPSEG = "us-gaap:OperatingSegmentsMember", REV = "us-gaap:Revenues";
const RFC = "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax";
const YEARS = [2023, 2024, 2025], M = 1e6;
const DOMAIN = { [SEG]: "us-gaap:SegmentDomain", [PROD]: "srt:ProductsAndServicesDomain", [GEO]: "srt:SegmentGeographicalDomain" };
const LI = "us-gaap:SegmentReportingInformationLineItems", TBL = "us-gaap:SegmentReportingInformationTable";
const SCHEMA = { "us-gaap": "https://xbrl.fasb.org/us-gaap/2025/elts/us-gaap-2025.xsd", srt: "https://xbrl.fasb.org/srt/2025/elts/srt-2025.xsd",
  dei: "https://xbrl.sec.gov/dei/2025/dei-2025.xsd", country: "https://xbrl.sec.gov/country/2025/country-2025.xsd" };
const frag = q => q.replace(":", "_");
const ROLE = r => `http://www.xbrl.org/2003/role/${r}`;
const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
// The three naming conventions the census found, plus the one numbered form. Which concept a locator or a
// label belongs to is in its HREF under every one of them; what the name says is a convention.
const CONV = {
  // Workiva, separate linkbases: loc_<q>_<uuid>, lab_<q>, the label attribute before the role.
  workiva: { loc: (q, i) => `loc_${frag(q)}_${(0x10000000 + i).toString(16)}-0000-4000-8000-000000000000`, res: q => `lab_${frag(q)}`, roleFirst: false },
  // DFIN, embedded in the .xsd: the bare id, with `_2` / `_default` tails where a concept is located again; <q>_lbl.
  dfin: { loc: q => /Axis$/.test(q) ? `${frag(q)}_2` : /Domain$/.test(q) ? `${frag(q)}_default` : frag(q), res: q => `${frag(q)}_lbl`, roleFirst: false },
  // Blackstone, embedded: loc_<q>_<number>, lab_<q> with the ROLE attribute first.
  bx: { loc: (q, i) => `loc_${frag(q)}_${501700 + i}`, res: q => `lab_${frag(q)}`, roleFirst: true },
  // The one separate label linkbase in the census that numbers its resources, role first.
  numbered: { loc: q => `loc_${frag(q)}`, res: q => `${frag(q)}_1_lbl`, roleFirst: true },
};
const each = (tag, dims, vals) => YEARS.map((y, i) => [tag, dims, y, Array.isArray(vals) ? vals[i] * M : vals * M]);

let nextCik = 900001;
function filing(o) {
  const cik = nextCik++, pc = String(cik).padStart(10, "0");
  const accn = `${pc}-26-000001`, dir = `https://www.sec.gov/Archives/edgar/data/${cik}/${accn.replace(/-/g, "")}`;
  const p = o.prefix, inst = o.inst || `${p}-20251231_htm.xml`;
  const stem = o.linkStem || inst.replace(/_htm\.xml$/, ""), xsdName = `${o.xsdStem || stem}.xsd`;
  const href = q => `${SCHEMA[q.split(":")[0]] || xsdName}#${frag(q)}`;
  const conv = CONV[o.conv || "workiva"];
  const namer = () => { const idx = new Map(); return q => (idx.has(q) || idx.set(q, idx.size), conv.loc(q, idx.get(q))); };

  const ctxs = new Map();
  const ctxId = (dims, y) => {
    const k = JSON.stringify([Object.entries(dims), y]);
    if (!ctxs.has(k)) ctxs.set(k, { id: `c${ctxs.size}`, dims, y });
    return ctxs.get(k).id;
  };
  const factXml = o.facts.map(([tag, dims, y, val]) => `<${tag} contextRef="${ctxId(dims, y)}" unitRef="usd" decimals="-6">${val}</${tag}>`).join("\n");
  const ctxXml = [...ctxs.values()].map(c => `<xbrli:context id="${c.id}"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">${pc}</xbrli:identifier>`
    + (Object.keys(c.dims).length ? `<xbrli:segment>${Object.entries(c.dims).map(([a, m]) => `<xbrldi:explicitMember dimension="${a}">${m}</xbrldi:explicitMember>`).join("")}</xbrli:segment>` : "")
    + `</xbrli:entity><xbrli:period><xbrli:startDate>${c.y}-01-01</xbrli:startDate><xbrli:endDate>${c.y}-12-31</xbrli:endDate></xbrli:period></xbrli:context>`).join("\n");
  const files = new Map([[inst, `<?xml version="1.0" encoding="utf-8"?>\n<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:xbrldi="http://xbrl.org/2006/xbrldi">\n${ctxXml}\n`
    + `<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>\n${factXml}\n</xbrli:xbrl>\n`]]);

  const roles = o.roles || [];
  const defLinks = roles.map(r => {
    const L = namer(), dom = DOMAIN[r.axis], concepts = r.concepts || [];
    const arc = (role, f, t) => `<link:definitionArc xlink:type="arc" xlink:arcrole="http://xbrl.org/int/dim/arcrole/${role}" xlink:from="${L(f)}" xlink:to="${L(t)}"/>`;
    return `<link:definitionLink xlink:type="extended" xlink:role="${r.uri}">`
      + [LI, TBL, r.axis, dom, ...r.members, ...concepts].map(q => `<link:loc xlink:type="locator" xlink:href="${href(q)}" xlink:label="${L(q)}"/>`).join("")
      + arc("all", LI, TBL) + arc("hypercube-dimension", TBL, r.axis) + arc("dimension-domain", r.axis, dom)
      + r.members.map(m => arc("domain-member", dom, m)).join("") + concepts.map(c => arc("domain-member", LI, c)).join("")
      + `</link:definitionLink>`;
  }).join("");
  let labLink = "";
  if (o.labels) {
    const L = namer();
    for (const [q, texts] of Object.entries(o.labels)) {
      labLink += `<link:loc xlink:type="locator" xlink:href="${href(q)}" xlink:label="${L(q)}"/>`;
      for (const [role, text] of Object.entries(texts)) labLink += conv.roleFirst
        ? `<link:label xlink:type="resource" xlink:role="${ROLE(role)}" xlink:label="${conv.res(q)}" xml:lang="en-US">${esc(text)}</link:label>`
        : `<link:label xlink:type="resource" xlink:label="${conv.res(q)}" xlink:role="${ROLE(role)}" xml:lang="en-US">${esc(text)}</link:label>`;
      labLink += `<link:labelArc xlink:type="arc" xlink:arcrole="http://www.xbrl.org/2003/arcrole/concept-label" xlink:from="${L(q)}" xlink:to="${conv.res(q)}"/>`;
    }
    labLink = `<link:labelLink xlink:type="extended" xlink:role="http://www.xbrl.org/2003/role/link">${labLink}</link:labelLink>`;
  }
  // A member's preferred label, or an ARRAY of them for a role that presents the member more than once.
  const preLinks = Object.entries(o.pres || {}).map(([uri, prefs]) => {
    const L = namer();
    return `<link:presentationLink xlink:type="extended" xlink:role="${uri}"><link:loc xlink:type="locator" xlink:href="${href(LI)}" xlink:label="${L(LI)}"/>`
      + Object.entries(prefs).map(([q, pref]) => `<link:loc xlink:type="locator" xlink:href="${href(q)}" xlink:label="${L(q)}"/>`
        + [].concat(pref).map((p, n) => `<link:presentationArc xlink:type="arc" xlink:arcrole="http://www.xbrl.org/2003/arcrole/parent-child" xlink:from="${L(LI)}" xlink:to="${L(q)}" order="${n + 1}"${p ? ` preferredLabel="${ROLE(p)}"` : ""}/>`).join("")).join("")
      + `</link:presentationLink>`;
  }).join("");
  const lb = body => `<?xml version="1.0" encoding="utf-8"?>\n<link:linkbase xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink">${body}</link:linkbase>\n`;
  const embedded = o.place === "xsd";
  files.set(xsdName, `<?xml version="1.0" encoding="utf-8"?>\n<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:link="http://www.xbrl.org/2003/linkbase"><xs:annotation><xs:appinfo>`
    + (embedded ? `<link:linkbase>${defLinks}${labLink}${preLinks}</link:linkbase>` : `<link:linkbaseRef xlink:type="simple" xlink:href="${stem}_def.xml"/>`)
    + `</xs:appinfo></xs:annotation><xs:element id="${p}_Placeholder" name="Placeholder"/></xs:schema>\n`);
  if (o.place === "separate") {
    if (defLinks) files.set(`${stem}_def.xml`, lb(defLinks));
    if (labLink) files.set(`${stem}_lab.xml`, lb(labLink));
    if (preLinks) files.set(`${stem}_pre.xml`, lb(preLinks));
  }
  if (roles.some(r => r.short)) files.set("FilingSummary.xml", `<FilingSummary><MyReports>${roles.filter(r => r.short)
    .map(r => `<Report instance="${inst}"><ShortName>${esc(r.short)} (Details)</ShortName><Role>${r.uri}</Role></Report>`).join("")}</MyReports></FilingSummary>`);
  files.set(`${accn}-index.htm`, "<html></html>");

  SITE.set(`https://data.sec.gov/submissions/CIK${pc}.json`, JSON.stringify({ name: o.name, filings: { recent: {
    form: ["10-Q", "10-K"], accessionNumber: [`${pc}-26-000002`, accn], reportDate: ["2026-03-31", "2025-12-31"], filingDate: ["2026-05-01", "2026-02-20"] } } }));
  SITE.set(`${dir}/index.json`, JSON.stringify({ directory: { item: [...files.keys()].sort().map(name => ({ name, size: String(files.get(name).length) })) } }));
  for (const [n, b] of files) SITE.set(`${dir}/${n}`, b);
  return { cik, name: o.name, dir };
}

const runs = [];
async function call(f) {
  hits = [];
  let out = null;
  const res = { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(s) { this._s = s; return this; }, json(b) { out = { status: this._s, body: b, headers: this.headers }; return this; } };
  await handler({ query: { cik: String(f.cik) } }, res);
  out.hits = hits.map(u => u.split("/").pop());
  runs.push({ name: f.name, ...out });
  return out;
}
const byAxis = (b, id) => b.views.filter(v => v.id === id);
const labelsOf = v => v.members.map(m => m.label);
const qsOf = v => v.members.map(m => m.q);
const col = (b, v, tag, p) => v.facts.filter(f => f.t === tag && f.p === p).reduce((n, f) => n + f.v, 0);
const cell = (v, q, tag, p) => (v.facts.find(f => f.t === tag && f.p === p && v.members[f.m].q === q) || {}).v;
const footsToTheDollar = (b, v, tag) => b.periods.every((end, p) => col(b, v, tag, p) === (b.consolidated[tag] || {})[end]);

// ── rule 1's exception: a co-registrant's entity axis, where its member IS the row's member ────────────────
// NextEra's figures ($m). FPL's segment rows carry dei:LegalEntityAxis = FPL beside the same member on the
// segment axis; NEER's do not; corporate and eliminations sits on the qualifier alone.
const neeFacts = (entityOnFpl, entityAxis = ENT) => [
  ...each("us-gaap:RegulatedAndUnregulatedOperatingRevenue", {}, [28114, 24753, 27412]),
  ...each("us-gaap:RegulatedAndUnregulatedOperatingRevenue", { [SEG]: "nee:FplMember", [entityAxis]: entityOnFpl, [Q]: OPSEG }, [18365, 17019, 18262]),
  ...each("us-gaap:RegulatedAndUnregulatedOperatingRevenue", { [SEG]: "nee:NeerSegmentMember", [Q]: OPSEG }, [9672, 7542, 8760]),
  ...each("us-gaap:RegulatedAndUnregulatedOperatingRevenue", { [Q]: "nee:CorporateAndEliminationsMember" }, [77, 192, 390]),
  ...each("us-gaap:NetIncomeLoss", {}, [7310, 6946, 6835]),
  ...each("us-gaap:NetIncomeLoss", { [SEG]: "nee:FplMember", [entityAxis]: entityOnFpl, [Q]: OPSEG }, [4552, 4543, 5012]),
  ...each("us-gaap:NetIncomeLoss", { [SEG]: "nee:NeerSegmentMember", [Q]: OPSEG }, [3558, 2299, 2975]),
  ...each("us-gaap:NetIncomeLoss", { [Q]: "nee:CorporateAndEliminationsMember" }, [-800, 104, -1152]),
];
// MUTATION: dropping the entity clause from `alone` (the rule as it stood before) fails this block.
{
  const f = filing({ name: "NEE shape", prefix: "nee", facts: neeFacts("nee:FplMember") });
  const { status, body: b } = await call(f);
  eq(status, 200, "NEE shape answers 200");
  const segs = byAxis(b, "segment");
  eq(segs.length, 1, "NEE shape: the entity axis on FPL's own row admits it, and the segment table is shown");
  if (segs.length) {
    const v = segs[0];
    eq(qsOf(v).join(" "), "nee:FplMember nee:NeerSegmentMember nee:CorporateAndEliminationsMember",
      "NEE shape: FPL, NEER and the corporate row, in that order");
    eq(cell(v, "nee:FplMember", "us-gaap:RegulatedAndUnregulatedOperatingRevenue", 2), 18262 * M, "NEE shape: FPL's FY2025 operating revenue is $18,262m");
    ok(footsToTheDollar(b, v, "us-gaap:RegulatedAndUnregulatedOperatingRevenue"), "NEE shape: operating revenue foots to the dollar in all three years ($27,412m in FY2025)");
    ok(footsToTheDollar(b, v, "us-gaap:NetIncomeLoss"), "NEE shape: net income foots to the dollar in all three years ($6,835m in FY2025)");
  }
  ok(!("empty" in b), "NEE shape: a tab with a table carries no `empty`");
}
// MUTATION: permitting the entity axis with ANY member fails this block (the FPL row arrives under someone else's name).
{
  const f = filing({ name: "NEE shape, a different entity member", prefix: "nee", facts: neeFacts("nee:FplHoldingsMember") });
  const { body: b } = await call(f);
  eq(b.views.length, 0, "an entity member that is NOT the row's member does not ride along — the table is refused rather than built from it");
  eq((b.empty || {}).reason, "unreconciled", "and the empty tab says the rows did not add up, which is true: NEER and corporate are $9,150m of $27,412m");
}
// FirstEnergy: Regulated Distribution's JCP&L piece ($2,554m) filed at the same coordinates as the whole
// segment ($7,547m), and FIRST in the document, so whichever form the rule admits wins rule 7's slot.
// MUTATION: permitting the entity axis with ANY member fails this block — the piece takes the row and the table is refused.
{
  const f = filing({ name: "FE shape", prefix: "fe", facts: [
    ...each(REV, {}, [8000, 8300, 8547]),
    ...each(REV, { [SEG]: "fe:RegulatedDistributionMember", [ENT]: "fe:JcplMember" }, [2400, 2500, 2554]),
    ...each(REV, { [SEG]: "fe:RegulatedDistributionMember" }, [7000, 7300, 7547]),
    ...each(REV, { [SEG]: "fe:RegulatedTransmissionMember" }, [1000, 1000, 1000]),
  ] });
  const { body: b } = await call(f);
  const segs = byAxis(b, "segment");
  eq(segs.length, 1, "FE shape: the segment table survives a subsidiary's piece of one segment filed beside it");
  if (segs.length) {
    eq(cell(segs[0], "fe:RegulatedDistributionMember", REV, 2), 7547 * M, "FE shape: Regulated Distribution is the whole segment, $7,547m, never JCP&L's $2,554m");
    ok(footsToTheDollar(b, segs[0], REV), "FE shape: revenue foots to the dollar");
  }
}
// The same slot filed twice under rule 1's exception: once with the entity axis EQUAL to the member, and once without
// it, $5-7m apart, the entity form first in the document. Rule 7 keeps one fact per (member, view, concept, period),
// and which one must not be decided by instance order: taken first-come, the row read $7,540m and the column $8,540m
// against $8,547m — 0.08%, inside the gate, so a table $7m short was shown as footing (the review's P2).
// MUTATION: letting the first fact keep the slot whatever carries it fails this block.
{
  const f = filing({ name: "entity form filed first at an entity-free slot", prefix: "p2", facts: [
    ...each(REV, {}, [8000, 8300, 8547]),
    ...each(REV, { [SEG]: "p2:DistMember", [ENT]: "p2:DistMember" }, [6995, 7295, 7540]),
    ...each(REV, { [SEG]: "p2:DistMember" }, [7000, 7300, 7547]),
    ...each(REV, { [SEG]: "p2:TransMember" }, [1000, 1000, 1000]),
  ] });
  const { body: b } = await call(f);
  const segs = byAxis(b, "segment");
  eq(segs.length ? cell(segs[0], "p2:DistMember", REV, 2) : null, 7547 * M, "entity form first: the entity-free fact takes the row — $7,547m, not the $7,540m filed first");
  ok(segs.length === 1 && footsToTheDollar(b, segs[0], REV), "entity form first: and the table foots to the dollar in all three years, not merely inside 0.1%");
  eq(segs.length ? segs[0].facts.map(x => `${segs[0].members[x.m].q.split(":")[1]}/${x.p}`).join(" ") : "",
    "DistMember/0 TransMember/0 DistMember/1 TransMember/1 DistMember/2 TransMember/2", "entity form first: the table's facts keep the filing's order");
}
// MUTATION: matching the axis by suffix (/LegalEntityAxis$/) fails this block.
{
  const f = filing({ name: "NEE shape on a non-registrant entity axis", prefix: "nee",
    facts: neeFacts("nee:FplMember", "us-gaap:FinancialSupportToNonconsolidatedLegalEntityAxis") });
  const { body: b } = await call(f);
  eq(b.views.length, 0, "the exception is dei:LegalEntityAxis exactly — FinancialSupportToNonconsolidatedLegalEntityAxis ends the same way and names no registrant");
}
// The empty-tab classifier reads contexts with the SAME predicate as the table build.
// MUTATION: giving the classifier its own copy of the old one-axis test fails this block ("one-member").
{
  const f = filing({ name: "NEE shape on a line the tab does not read", prefix: "nee", facts: [
    ...each("us-gaap:SellingGeneralAndAdministrativeExpense", {}, [100, 110, 120]),
    ...each("us-gaap:SellingGeneralAndAdministrativeExpense", { [SEG]: "nee:FplMember", [ENT]: "nee:FplMember" }, [60, 66, 72]),
    ...each("us-gaap:SellingGeneralAndAdministrativeExpense", { [SEG]: "nee:NeerSegmentMember" }, [40, 44, 48]),
  ] });
  const { body: b } = await call(f);
  eq((b.empty || {}).reason, "outside-allow-list", "an entity-axis row counts as a row to the classifier too — two members on a concept outside the allow-list, not one");
}

// ── linkbases by listing, read by href ───────────────────────────────────────────────────────────────────
// Apple's two product tables, as DFIN would file them: every linkbase inside the one .xsd, locators named by
// the bare id with a `_2` tail on the repeated axis, label resources `<q>_lbl`. Without the definition
// linkbase the two tables merge on the axis and read 170% of the company, so the gate refuses both.
// MUTATIONS: not fetching the .xsd; deriving locators by name (qname) instead of href; deriving a label's
// concept from the resource name — each fails this block.
{
  const IS = "http://dfin.example/role/CONSOLIDATEDSTATEMENTSOFOPERATIONS", FN = "http://dfin.example/role/RevenueNetSalesDisaggregatedDetails";
  const f = filing({ name: "DFIN embedded", prefix: "x", place: "xsd", conv: "dfin",
    roles: [{ uri: IS, axis: PROD, members: ["us-gaap:ProductMember", "us-gaap:ServiceMember"], concepts: [RFC], short: "CONSOLIDATED STATEMENTS OF OPERATIONS" },
      { uri: FN, axis: PROD, members: ["x:IPhoneMember", "x:MacMember", "us-gaap:ServiceMember"], concepts: [RFC], short: "Revenue - Net Sales Disaggregated" }],
    labels: { "us-gaap:ProductMember": { label: "Products" }, "us-gaap:ServiceMember": { label: "Services" }, "x:IPhoneMember": { label: "iPhone" }, "x:MacMember": { label: "Mac [Member]" } },
    facts: [...each(RFC, {}, [100, 110, 120]), ...each(RFC, { [PROD]: "us-gaap:ProductMember" }, [70, 77, 84]), ...each(RFC, { [PROD]: "us-gaap:ServiceMember" }, [30, 33, 36]),
      ...each(RFC, { [PROD]: "x:IPhoneMember" }, [50, 55, 60]), ...each(RFC, { [PROD]: "x:MacMember" }, [20, 22, 24])] });
  const { body: b, hits: h } = await call(f);
  eq(JSON.stringify(b.meta.linkbases), JSON.stringify({ definition: true, label: true, from: "xsd" }), "DFIN embedded: both linkbases found, and found in the .xsd");
  ok(h.includes("x-20251231.xsd") && !h.some(n => /_(def|lab|pre)\.xml$/.test(n)), `DFIN embedded: the .xsd is fetched and no linkbase name is invented — fetched ${h.join(", ")}`);
  const prods = byAxis(b, "product");
  eq(prods.map(v => v.role).join(" | "), `${IS} | ${FN}`, "DFIN embedded: rule 2 splits the axis into its two tables, each by its own role");
  eq(prods.map(v => v.source).join(" | "), "CONSOLIDATED STATEMENTS OF OPERATIONS | Revenue - Net Sales Disaggregated", "DFIN embedded: each titled by FilingSummary");
  if (prods.length === 2) {
    eq(labelsOf(prods[0]).join(", "), "Products, Services", "DFIN embedded: `<q>_lbl` labels name the income statement's rows");
    eq(labelsOf(prods[1]).join(", "), "iPhone, Mac, Services", "DFIN embedded: and the footnote's, with [Member] stripped");
    ok(prods.every(v => footsToTheDollar(b, v, RFC)), "DFIN embedded: each table foots on its own, to the dollar");
  }
}
// Blackstone's convention: loc_<q>_<number> locators, lab_<q> label resources with xlink:role BEFORE xlink:label,
// the .xsd named for the company while the instance is named for the printer's job.
// MUTATIONS: qname() on the locator (every axis then carries a `_501702` tail and no role matches); a label
// pattern that expects xlink:label before xlink:role — each fails this block.
{
  const R1 = "http://www.blackstone.example/role/SegmentReportingRevenuesDetails";
  const f = filing({ name: "BX embedded", prefix: "bx", inst: "d48618d10k_htm.xml", xsdStem: "bx-20251231", place: "xsd", conv: "bx",
    roles: [{ uri: R1, axis: SEG, members: ["bx:RealEstateSegmentMember", "bx:PrivateEquitySegmentMember"], concepts: [REV], short: "Segment Reporting - Revenues" }],
    labels: { "bx:RealEstateSegmentMember": { label: "Real Estate" }, "bx:PrivateEquitySegmentMember": { label: "Private Equity" } },
    facts: [...each(REV, {}, [10, 11, 12]), ...each(REV, { [SEG]: "bx:RealEstateSegmentMember" }, [6, 6, 7]), ...each(REV, { [SEG]: "bx:PrivateEquitySegmentMember" }, [4, 5, 5])] });
  const { body: b, hits: h } = await call(f);
  eq(b.meta.linkbases.from, "xsd", "BX embedded: linkbases come from bx-20251231.xsd, which the instance's name d48618d10k could never produce");
  ok(!h.some(n => /^d48618d10k_(def|lab)\.xml$/.test(n)), "BX embedded: no linkbase URL is built from the instance's stem");
  const segs = byAxis(b, "segment");
  eq(segs.map(v => v.role).join(" | "), R1, "BX embedded: the role is matched through the locator's href, not its numbered name");
  eq(segs.map(v => labelsOf(v).join(", ")).join(" | "), "Real Estate, Private Equity", "BX embedded: role-first label resources are read");
}
// A separate label linkbase whose resources are numbered, role first.
// MUTATIONS: deriving the concept from `lab_<q>`; expecting label before role — each fails this block.
{
  const R1 = "http://numbered.example/role/RevenueByGeographyDetails";
  const f = filing({ name: "numbered separate", prefix: "betrf", place: "separate", conv: "numbered",
    roles: [{ uri: R1, axis: GEO, members: ["betrf:DomesticMember", "betrf:ForeignMember"], concepts: [REV] }],
    labels: { "betrf:DomesticMember": { label: "United States" }, "betrf:ForeignMember": { label: "Canada" } },
    facts: [...each(REV, {}, [5, 6, 7]), ...each(REV, { [GEO]: "betrf:DomesticMember" }, [4, 4, 5]), ...each(REV, { [GEO]: "betrf:ForeignMember" }, [1, 2, 2])] });
  const { body: b, hits: h } = await call(f);
  eq(b.meta.linkbases.from, "separate", "numbered separate: linkbases from the separate files");
  ok(!h.some(n => n.endsWith(".xsd")), "numbered separate: the .xsd is not fetched when both separate linkbases are listed");
  eq(byAxis(b, "geo").map(v => labelsOf(v).join(", ")).join(" | "), "United States, Canada", "numbered separate: `<q>_1_lbl` resources, role first, are read");
}
// Wells Fargo's shape: separate Workiva linkbases under a name the instance stem does not produce
// (wfc-20251231_d2_htm.xml against wfc-20251231_def.xml), and a member whose name contains a PERIOD, as
// Coca-Cola's ko:A.PacificMember does.
// MUTATIONS: fetching the linkbases by the instance stem; an href pattern of word characters — each fails this block.
{
  const R1 = "http://www.wellsfargo.example/role/RevenueByGeographyDetails";
  const f = filing({ name: "WFC other-name", prefix: "wfc", inst: "wfc-20251231_d2_htm.xml", linkStem: "wfc-20251231", place: "separate",
    roles: [{ uri: R1, axis: GEO, members: ["wfc:DomesticMember", "wfc:A.PacificMember"], concepts: [REV] }],
    labels: { "wfc:DomesticMember": { label: "United States" }, "wfc:A.PacificMember": { label: "Asia Pacific" } },
    pres: { [R1]: { "wfc:DomesticMember": null, "wfc:A.PacificMember": null } },
    facts: [...each(REV, {}, [9, 9, 9]), ...each(REV, { [GEO]: "wfc:DomesticMember" }, [6, 6, 6]), ...each(REV, { [GEO]: "wfc:A.PacificMember" }, [3, 3, 3])] });
  const { body: b, hits: h } = await call(f);
  ok(h.includes("wfc-20251231_def.xml") && h.includes("wfc-20251231_lab.xml") && h.includes("wfc-20251231_pre.xml"),
    `WFC other-name: the listing's own linkbase names are fetched — fetched ${h.join(", ")}`);
  ok(!h.some(n => /_d2_(def|lab|pre)\.xml$/.test(n)), "WFC other-name: nothing is fetched under the instance's stem");
  eq(JSON.stringify(b.meta.linkbases), JSON.stringify({ definition: true, label: true, from: "separate" }), "WFC other-name: both linkbases, separate");
  const geo = byAxis(b, "geo");
  eq(geo.map(v => v.role).join(" | "), R1, "WFC other-name: the role is read");
  eq(geo.map(v => labelsOf(v).join(", ")).join(" | "), "United States, Asia Pacific", "WFC other-name: a member whose name contains a period keeps its label");
}
// No linkbase anywhere: the axis-wide fallback, and `from` says so.
{
  const f = filing({ name: "no linkbase", prefix: "nl", facts: [...each(REV, {}, [3, 3, 3]), ...each(REV, { [SEG]: "nl:AlphaMember" }, [2, 2, 2]), ...each(REV, { [SEG]: "nl:BetaMember" }, [1, 1, 1])] });
  const { body: b } = await call(f);
  eq(JSON.stringify(b.meta.linkbases), JSON.stringify({ definition: false, label: false, from: null }), "no linkbase: nothing found, and `from` is null rather than a guess");
  eq(byAxis(b, "segment").map(v => `${v.role}:${labelsOf(v).join(", ")}`).join(" | "), "null:Alpha, Beta", "no linkbase: one axis-wide table, rows named from their QNames");
}
// A companion the listing NAMES and SEC then fails to serve. The payload is still an answer — the request must not
// fail for want of a label — but it is not the filing's answer: DFIN's two product tables merge without the .xsd
// and the tab says "nothing reconciles, the nearest is 70% away" about tables that each foot to the dollar. Cached
// for a day and served stale for a week, one 500 would say that for a fortnight. So a listed companion that fails
// makes the payload `partial` and its cache five minutes; a companion the listing never named is not a failure.
// MUTATIONS: the full cache on a partial payload; no `partial` flag; a failed fetch not recorded — each fails this block.
{
  const IS = "http://dfin.example/role/CONSOLIDATEDSTATEMENTSOFOPERATIONS", FN = "http://dfin.example/role/RevenueNetSalesDisaggregatedDetails";
  const f = filing({ name: "DFIN embedded, the .xsd answering 500", prefix: "x", place: "xsd", conv: "dfin",
    roles: [{ uri: IS, axis: PROD, members: ["us-gaap:ProductMember", "us-gaap:ServiceMember"], concepts: [RFC] },
      { uri: FN, axis: PROD, members: ["x:IPhoneMember", "x:MacMember", "us-gaap:ServiceMember"], concepts: [RFC] }],
    facts: [...each(RFC, {}, [100, 110, 120]), ...each(RFC, { [PROD]: "us-gaap:ProductMember" }, [70, 77, 84]), ...each(RFC, { [PROD]: "us-gaap:ServiceMember" }, [30, 33, 36]),
      ...each(RFC, { [PROD]: "x:IPhoneMember" }, [50, 55, 60]), ...each(RFC, { [PROD]: "x:MacMember" }, [20, 22, 24])] });
  FAIL.set(`${f.dir}/x-20251231.xsd`, 500);
  const { status, body: b, headers } = await call(f);
  eq(status, 200, "listed .xsd answering 500: still a 200 — a missing linkbase never fails the request");
  eq(b.meta.linkbases.partial, true, "listed .xsd answering 500: the payload says it is partial");
  eq(headers["cache-control"], "public, s-maxage=300", "listed .xsd answering 500: cached for five minutes, not a day plus a week");
  const t = filing({ name: "separate linkbases, the _pre.xml never answering", prefix: "tp", place: "separate",
    roles: [{ uri: "http://tp.example/role/SegmentDetails", axis: SEG, members: ["tp:AlphaMember", "tp:BetaMember"], concepts: [REV] }],
    labels: { "tp:AlphaMember": { label: "Alpha" }, "tp:BetaMember": { label: "Beta" } },
    pres: { "http://tp.example/role/SegmentDetails": { "tp:AlphaMember": null, "tp:BetaMember": null } },
    facts: [...each(REV, {}, [3, 3, 3]), ...each(REV, { [SEG]: "tp:AlphaMember" }, [2, 2, 2]), ...each(REV, { [SEG]: "tp:BetaMember" }, [1, 1, 1])] });
  THROW.add(`${t.dir}/tp-20251231_pre.xml`);
  const r2 = await call(t);
  ok(r2.body.meta.linkbases.partial === true && r2.headers["cache-control"] === "public, s-maxage=300",
    `listed _pre.xml throwing: partial, five minutes — got ${JSON.stringify(r2.body.meta.linkbases)}, ${r2.headers["cache-control"]}`);
  eq(byAxis(r2.body, "segment").length, 1, "listed _pre.xml throwing: and the table it can still build is shown");
}

// ── which label names a row is the table's choice ────────────────────────────────────────────────────────
// Prologis: Other Americas carries a terseLabel "Europe" written for another table; the geography table's
// presentation arc asks for the standard label. MetLife: a table's verbose label ends in a footnote marker.
// AIG: two members whose table-preferred label is the same "Reconciling items" fall back to their own names.
// MUTATIONS: ignoring the presentation linkbase (terse wins, globally); not fetching the listed _pre.xml;
// keeping the "(n)" marker; removing the clash fallback — each fails this block.
{
  const G = "http://lbl.example/role/RevenueByRegionDetails", S = "http://lbl.example/role/SegmentResultsDetails";
  const f = filing({ name: "labels per table", prefix: "lbl", place: "separate",
    roles: [{ uri: G, axis: GEO, members: ["lbl:OtherAmericasMember", "lbl:EuropeMember"], concepts: [REV] },
      { uri: S, axis: SEG, members: ["lbl:LifeInsuranceMember", "lbl:RunOffMember", "lbl:EliminationsMember"], concepts: [REV] }],
    labels: { "lbl:OtherAmericasMember": { label: "Other Americas", terseLabel: "Europe" }, "lbl:EuropeMember": { label: "Europe" },
      "lbl:LifeInsuranceMember": { label: "Life Insurance Segment", verboseLabel: "Life insurance (1)" },
      "lbl:RunOffMember": { label: "Business in Run-Off", verboseLabel: "Reconciling items" },
      "lbl:EliminationsMember": { label: "Elimination and consolidations", verboseLabel: "Reconciling items" } },
    pres: { [G]: { "lbl:OtherAmericasMember": null, "lbl:EuropeMember": null },
      [S]: { "lbl:LifeInsuranceMember": "verboseLabel", "lbl:RunOffMember": "verboseLabel", "lbl:EliminationsMember": "verboseLabel" } },
    facts: [...each(REV, {}, [100, 100, 100]), ...each(REV, { [GEO]: "lbl:OtherAmericasMember" }, [30, 30, 30]), ...each(REV, { [GEO]: "lbl:EuropeMember" }, [70, 70, 70]),
      ...each(REV, { [SEG]: "lbl:LifeInsuranceMember" }, [60, 60, 60]), ...each(REV, { [SEG]: "lbl:RunOffMember" }, [25, 25, 25]), ...each(REV, { [SEG]: "lbl:EliminationsMember" }, [15, 15, 15])] });
  const { body: b } = await call(f);
  eq(byAxis(b, "geo").map(v => labelsOf(v).join(", ")).join(" | "), "Other Americas, Europe", "labels per table: Prologis' Other Americas is not a second \"Europe\"");
  const seg = byAxis(b, "segment").map(v => labelsOf(v));
  eq((seg[0] || [])[0], "Life insurance", "labels per table: the table's own wording, its trailing footnote marker dropped");
  eq((seg[0] || []).slice(1).join(", "), "Business in Run-Off, Elimination and consolidations", "labels per table: two rows the table names alike fall back to their own names");
}
// A role that presents the same member TWICE, asking for a different label each time: the FIRST arc names the row.
// Measured, not assumed: over 217 filers 3,208 (role, concept) pairs are presented twice with different label roles
// and none of them is a row a payload shows, so first-or-last changes no payload today (the private notes'
// segments-impl/fixes/n8-arcs.txt); this pins the choice so it cannot flip unnoticed. MUTATION: the last arc wins (the review's R5) fails this block.
{
  const G = "http://twice.example/role/RevenueByRegionDetails";
  const f = filing({ name: "a member presented twice", prefix: "tw", place: "separate",
    roles: [{ uri: G, axis: GEO, members: ["tw:OtherAmericasMember", "tw:EuropeMember"], concepts: [REV] }],
    labels: { "tw:OtherAmericasMember": { label: "Other Americas", terseLabel: "Americas ex-US" }, "tw:EuropeMember": { label: "Europe" } },
    pres: { [G]: { "tw:OtherAmericasMember": [null, "terseLabel"], "tw:EuropeMember": null } },
    facts: [...each(REV, {}, [100, 100, 100]), ...each(REV, { [GEO]: "tw:OtherAmericasMember" }, [30, 30, 30]), ...each(REV, { [GEO]: "tw:EuropeMember" }, [70, 70, 70])] });
  const { body: b } = await call(f);
  eq(byAxis(b, "geo").map(v => labelsOf(v).join(", ")).join(" | "), "Other Americas, Europe", "a member presented twice: the first arc's label names the row");
}

// ── a table is not shown twice, and twice is decided by the cells ────────────────────────────────────────
// Brown & Brown ($m): the revenue note and the segment note carry the same revenue block, the $87m of other
// revenue under MaterialReconcilingItems in one and CorporateNonSegment in the other; the segment note also
// carries pre-tax income. MUTATIONS: the old member-QName key (seenView); matching a reconciling cell by QName — each fails this block.
{
  const PT = "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest";
  const RN = "http://www.bbinsurance.example/role/RevenuesDisaggregationDetails", SN = "http://www.bbinsurance.example/role/SegmentInformationSummarizedDetails";
  const f = filing({ name: "BRO shape", prefix: "bro", place: "separate",
    roles: [{ uri: RN, axis: SEG, members: ["bro:RetailMember", "bro:SpecialtyDistributionMember", "us-gaap:MaterialReconcilingItemsMember"], concepts: [REV], short: "Revenues - Disaggregation" },
      { uri: SN, axis: SEG, members: ["bro:RetailMember", "bro:SpecialtyDistributionMember", "us-gaap:CorporateNonSegmentMember"], concepts: [REV, PT],
        short: "Segment Information - Summarized Financial Information Reportable Segments" }],
    facts: [...each(REV, {}, [5000, 5500, 5902]), ...each(REV, { [SEG]: "bro:RetailMember" }, [3000, 3200, 3406]),
      ...each(REV, { [SEG]: "bro:SpecialtyDistributionMember" }, [1950, 2230, 2409]),
      ...each(REV, { [Q]: "us-gaap:MaterialReconcilingItemsMember" }, [50, 70, 87]), ...each(REV, { [Q]: "us-gaap:CorporateNonSegmentMember" }, [50, 70, 87]),
      ...each(PT, {}, [1100, 1250, 1371]), ...each(PT, { [SEG]: "bro:RetailMember" }, [600, 650, 707]),
      ...each(PT, { [SEG]: "bro:SpecialtyDistributionMember" }, [650, 760, 865]), ...each(PT, { [Q]: "us-gaap:CorporateNonSegmentMember" }, [-150, -160, -201])] });
  const { body: b } = await call(f);
  const segs = byAxis(b, "segment");
  eq(segs.length, 1, "BRO shape: the revenue block is shown once");
  eq(segs.map(v => v.source).join(" | "), "Segment Information - Summarized Financial Information Reportable Segments", "BRO shape: the fuller table wins, because it shows everything");
  ok(segs.length === 1 && footsToTheDollar(b, segs[0], REV) && footsToTheDollar(b, segs[0], PT), "BRO shape: and every figure of the dropped table is still on the page, footing");
}
// Altria: the segment schedule and its narrative, the same cells with the members listed in a different order.
// MUTATIONS: the old member-QName key; keeping the LATER of two equal tables — each fails this block.
{
  const S1 = "http://www.altria.example/role/SegmentDataScheduleDetails", S2 = "http://www.altria.example/role/SegmentsNarrativeDetails";
  const f = filing({ name: "MO shape", prefix: "mo", place: "separate",
    roles: [{ uri: S1, axis: SEG, members: ["mo:SmokeableMember", "mo:OralMember"], concepts: [REV], short: "Segment Data Schedule" },
      { uri: S2, axis: SEG, members: ["mo:OralMember", "mo:SmokeableMember"], concepts: [REV], short: "Segments (Narrative)" }],
    facts: [...each(REV, {}, [20, 21, 22]), ...each(REV, { [SEG]: "mo:SmokeableMember" }, [18, 19, 19]), ...each(REV, { [SEG]: "mo:OralMember" }, [2, 2, 3])] });
  const { body: b } = await call(f);
  eq(byAxis(b, "segment").map(v => v.source).join(" | "), "Segment Data Schedule", "MO shape: one table, and on a tie the one first in the filing");
}
// The same two Altria tables, the narrative naming a row by its terse label: rule 8 gives one member two names, and
// the cells are still the same cells. MUTATION: keying a cell by the row's LABEL instead of its QName (measured and
// rejected above: "Nor by label") fails this block — the narrative prints a second time.
{
  const S1 = "http://www.altria.example/role/SegmentDataScheduleDetails", S2 = "http://www.altria.example/role/SegmentsNarrativeDetails";
  const f = filing({ name: "MO shape, a row named two ways", prefix: "mo", place: "separate",
    roles: [{ uri: S1, axis: SEG, members: ["mo:SmokeableMember", "mo:OralMember"], concepts: [REV], short: "Segment Data Schedule" },
      { uri: S2, axis: SEG, members: ["mo:OralMember", "mo:SmokeableMember"], concepts: [REV], short: "Segments (Narrative)" }],
    labels: { "mo:SmokeableMember": { label: "Smokeable products", terseLabel: "Smokeable" }, "mo:OralMember": { label: "Oral tobacco products" } },
    pres: { [S1]: { "mo:SmokeableMember": null, "mo:OralMember": null }, [S2]: { "mo:OralMember": null, "mo:SmokeableMember": "terseLabel" } },
    facts: [...each(REV, {}, [20, 21, 22]), ...each(REV, { [SEG]: "mo:SmokeableMember" }, [18, 19, 19]), ...each(REV, { [SEG]: "mo:OralMember" }, [2, 2, 3])] });
  const { body: b } = await call(f);
  eq(byAxis(b, "segment").map(v => `${v.source}: ${labelsOf(v).join(", ")}`).join(" | "), "Segment Data Schedule: Smokeable products, Oral tobacco products",
    "MO shape, a row named two ways: still one table — a cell is its member, not what one table calls it");
}
// Two genuinely different tables survive: Apple's income-statement split beside its footnote split (they
// share the Services row), and AES's regulated/non-regulated revenue beside generation/distribution, whose
// rows have equal VALUES and are different members.
// MUTATIONS: dropping a view on ANY shared cell; matching segment cells by value alone — each fails this block.
{
  const IS = "http://www.apple.example/role/CONSOLIDATEDSTATEMENTSOFOPERATIONS", FN = "http://www.apple.example/role/RevenueDetails";
  const apple = filing({ name: "AAPL shape", prefix: "aapl", place: "separate",
    roles: [{ uri: IS, axis: PROD, members: ["us-gaap:ProductMember", "us-gaap:ServiceMember"], concepts: [RFC] },
      { uri: FN, axis: PROD, members: ["aapl:IPhoneMember", "aapl:MacMember", "us-gaap:ServiceMember"], concepts: [RFC] }],
    facts: [...each(RFC, {}, [100, 110, 120]), ...each(RFC, { [PROD]: "us-gaap:ProductMember" }, [70, 77, 84]), ...each(RFC, { [PROD]: "us-gaap:ServiceMember" }, [30, 33, 36]),
      ...each(RFC, { [PROD]: "aapl:IPhoneMember" }, [50, 55, 60]), ...each(RFC, { [PROD]: "aapl:MacMember" }, [20, 22, 24])] });
  eq(byAxis((await call(apple)).body, "product").map(v => v.role).join(" | "), `${IS} | ${FN}`, "AAPL shape: both product tables are shown — sharing a row is not being the same table");
  const P1 = "http://www.aes.example/role/RevenueRegulatedDetails", P2 = "http://www.aes.example/role/RevenueByBusinessDetails";
  const aes = filing({ name: "AES shape", prefix: "aes", place: "separate",
    roles: [{ uri: P1, axis: PROD, members: ["aes:RegulatedMember", "aes:NonRegulatedMember"], concepts: [REV] },
      { uri: P2, axis: PROD, members: ["aes:GenerationMember", "aes:DistributionMember"], concepts: [REV] }],
    facts: [...each(REV, {}, [100, 100, 100]), ...each(REV, { [PROD]: "aes:RegulatedMember" }, [60, 60, 60]), ...each(REV, { [PROD]: "aes:NonRegulatedMember" }, [40, 40, 40]),
      ...each(REV, { [PROD]: "aes:GenerationMember" }, [60, 60, 60]), ...each(REV, { [PROD]: "aes:DistributionMember" }, [40, 40, 40])] });
  eq(byAxis((await call(aes)).body, "product").map(v => v.role).join(" | "), `${P1} | ${P2}`, "AES shape: equal numbers on different members are different rows, and both tables stay");
}

// ── an empty tab says which of five things is true ───────────────────────────────────────────────────────
// Blackstone ($m): its segments are reported on its own measures, none with an undimensioned counterpart;
// the one allow-listed concept it breaks down (contract revenue by product) has none either, because its
// consolidated revenue is tagged `Revenues`.
const bxFacts = [
  ...each(RFC, { [PROD]: "us-gaap:InvestmentAdviceMember" }, [7000, 7500, 8076]), ...each(RFC, { [PROD]: "bx:InvestmentPerformanceMember" }, [900, 950, 978]),
  ...each(RFC, { [PROD]: "bx:OtherRevenueMember" }, [10, 10, 10]),
  ...each(REV, {}, [14000, 14200, 14450]),
  ...each("bx:FeeRelatedEarnings", { [SEG]: "bx:RealEstateMember" }, [2000, 2100, 2211]), ...each("bx:FeeRelatedEarnings", { [SEG]: "bx:PrivateEquityMember" }, [1700, 1800, 1876]),
  ...each("bx:SegmentDistributableEarnings", { [SEG]: "bx:RealEstateMember" }, [3000, 3100, 3200]), ...each("bx:SegmentDistributableEarnings", { [SEG]: "bx:PrivateEquityMember" }, [2000, 2100, 2200]),
];
// MUTATIONS: dropping the segment axis from the ranking of which measures to name fails this block.
{
  const { body: b } = await call(filing({ name: "BX shape", prefix: "bx", facts: bxFacts }));
  eq(b.views.length, 0, "BX shape: no table");
  eq((b.empty || {}).reason, "no-consolidated-figure", "BX shape: nothing to reconcile against — never \"did not reconcile\", which would be false");
  const cs = (b.empty || {}).concepts || [];
  ok(cs.length && /^bx:/.test(cs[0].tag), `BX shape: the copy names its segment measures first — got ${cs.map(c => c.tag).join(", ")}`);
  ok(cs.some(c => c.tag === "bx:FeeRelatedEarnings" && c.label === "Fee Related Earnings"), "BX shape: fee-related earnings is among them, by name");
  ok(cs.every(c => !("offPct" in c)), "BX shape: no miss percentage, because nothing was missed");
}
// Own measures on two axes: two segment measures and a product-axis measure filed more often (three members against
// two). Blackstone's eleven are all on the segment axis, so its shape cannot tell whether the segment axis leads the
// naming. MUTATION: dropping the segment axis from the ranking (most-filed first) fails this block.
{
  const { body: b } = await call(filing({ name: "own measures on two axes", prefix: "ax2", facts: [
    ...each(REV, {}, [100, 100, 100]),
    ...each("ax2:SegmentEarnings", { [SEG]: "ax2:EastMember" }, [5, 5, 5]), ...each("ax2:SegmentEarnings", { [SEG]: "ax2:WestMember" }, [4, 4, 4]),
    ...each("ax2:ProductFees", { [PROD]: "ax2:AdvisoryMember" }, [3, 3, 3]), ...each("ax2:ProductFees", { [PROD]: "ax2:PlacementMember" }, [2, 2, 2]),
    ...each("ax2:ProductFees", { [PROD]: "ax2:OtherFeesMember" }, [1, 1, 1])] }));
  eq(((b.empty || {}).concepts || []).map(c => c.tag).join(" "), "ax2:SegmentEarnings ax2:ProductFees", "own measures on two axes: the segment axis's measure is named first, then the product axis's");
}
// The same Blackstone given ONE consolidated contract-revenue figure (FY2025, $9,500m): now the gate has
// something to check the product rows ($9,064m) against, and they miss — so the tab must say so.
// MUTATIONS: not recording the gate's refusal; reading the classifier without it (M1, "other"); reading a
// missing figure before the refusal with the `other` guard gone (M2, "no-consolidated-figure") — each fails this block.
{
  const { body: b } = await call(filing({ name: "BX shape + consolidated contract revenue", prefix: "bx", facts: [...bxFacts, [RFC, {}, 2025, 9500 * M]] }));
  eq((b.empty || {}).reason, "unreconciled", "BX + one consolidated figure: a breakdown the gate refused is \"did not reconcile\", whatever else is true");
  eq(JSON.stringify(((b.empty || {}).concepts || []).map(c => [c.tag, c.offPct])), JSON.stringify([[RFC, 4.6]]), "BX + one consolidated figure: the miss is 4.6%");
}
// "Nothing to reconcile against" is a claim that the company files no figure, so it is made only about the filer's
// OWN measures. Here the one breakdown is segment `Revenues` (60 + 40) and the company's revenue is filed, equal to
// the dollar, as contract revenue — a sibling tag. The gate found no SAME-TAG figure; the filing still has one. None
// of the five is true, so the page keeps the sentence that shipped before (the review's P1).
// MUTATION: routing an allow-listed breakdown with no same-tag figure to no-consolidated-figure (the rule at 4c556b2) fails this block.
{
  const { body: b } = await call(filing({ name: "segment Revenues, company revenue as contract revenue", prefix: "p1", facts: [
    ...each(RFC, {}, [100, 110, 120]), ...each(REV, { [SEG]: "p1:AlphaMember" }, [60, 66, 72]), ...each(REV, { [SEG]: "p1:BetaMember" }, [40, 44, 48])] }));
  eq((b.empty || {}).reason, "other", "segment Revenues beside a company figure under a sibling tag: `other`, never \"none of which the filing reports as a figure for the company\"");
}
// Blackstone without the one allow-listed product breakdown it happens to carry: its own segment measures (no company
// figure) beside a standard concept on the segment axis that DOES foot — a loss-contingency roll-forward, $676m + $130m
// = $806m. The tab is empty because of the measures, and that is what it names (the review's P4).
// MUTATION: the same 4c556b2 rule fails this block too ("Not a line this tab reads", naming the roll-forward).
{
  const LC = "us-gaap:LossContingencyAccrualCarryingValuePeriodIncreaseDecrease";
  const { body: b } = await call(filing({ name: "BX shape without a KEEP breakdown", prefix: "p4", facts: [
    ...each(REV, {}, [14000, 14200, 14450]),
    ...each("p4:FeeRelatedEarnings", { [SEG]: "p4:RealEstateMember" }, [2000, 2100, 2211]), ...each("p4:FeeRelatedEarnings", { [SEG]: "p4:PrivateEquityMember" }, [1700, 1800, 1876]),
    ...each("p4:SegmentDistributableEarnings", { [SEG]: "p4:RealEstateMember" }, [3000, 3100, 3200]), ...each("p4:SegmentDistributableEarnings", { [SEG]: "p4:PrivateEquityMember" }, [2000, 2100, 2200]),
    ...each(LC, {}, [500, 500, 806]), ...each(LC, { [SEG]: "p4:RealEstateMember" }, [400, 400, 676]), ...each(LC, { [SEG]: "p4:PrivateEquityMember" }, [100, 100, 130])] }));
  eq((b.empty || {}).reason, "no-consolidated-figure", "BX without its product breakdown: nothing to reconcile against — its segment measures have no company figure");
  eq(((b.empty || {}).concepts || []).map(c => c.tag).sort().join(" "), "p4:FeeRelatedEarnings p4:SegmentDistributableEarnings",
    "BX without its product breakdown: the copy names its own measures, and not the roll-forward that foots");
}
// Realty Income ($m): revenue by property type, refused at 5.4% short in FY2025; a net-income split refused
// by more; and an extension measure with no counterpart beside them.
// MUTATIONS: M1 and M2 as above; sorting the refused concepts worst-first — each fails this block.
{
  const O = [...each(REV, {}, [4000, 5000, 5749]), ...each(REV, { [PROD]: "o:RetailMember" }, [3000, 3900, 4326]),
    ...each(REV, { [PROD]: "o:IndustrialMember" }, [600, 700, 864]), ...each(REV, { [PROD]: "o:OtherPropertyMember" }, [200, 230, 247]),
    ...each("us-gaap:NetIncomeLoss", {}, [1000, 1000, 1000]), ...each("us-gaap:NetIncomeLoss", { [PROD]: "o:RetailMember" }, [300, 300, 300]),
    ...each("us-gaap:NetIncomeLoss", { [PROD]: "o:IndustrialMember" }, [300, 300, 300]), ...each("us-gaap:NetIncomeLoss", { [PROD]: "o:OtherPropertyMember" }, [100, 100, 100]),
    ...each("o:NetOperatingIncome", { [PROD]: "o:RetailMember" }, [2500, 3000, 3500]), ...each("o:NetOperatingIncome", { [PROD]: "o:IndustrialMember" }, [500, 600, 700])];
  const { body: b } = await call(filing({ name: "O shape", prefix: "o", facts: O }));
  eq((b.empty || {}).reason, "unreconciled", "O shape: refused by the gate, so \"did not reconcile\" — not a one-segment company, not nothing to reconcile against");
  eq(JSON.stringify(((b.empty || {}).concepts || []).map(c => [c.tag, c.offPct])), JSON.stringify([[REV, 5.4], ["us-gaap:NetIncomeLoss", 30]]),
    "O shape: the nearest miss leads — revenue at 5.4%, then net income at 30%");
}
// A refusal just outside the tolerance: the rows come to $1,001,004m against $1,000,000m, 0.1004% off. Printed to one
// decimal that read "the nearest is 0.1% away" beside a README giving the tolerance as 0.1%. Under 1% the miss is
// rounded UP to two decimals, so a refused table never prints as inside the gate. MUTATION: one decimal everywhere fails this block.
{
  const { body: b } = await call(filing({ name: "refused at 0.1004%", prefix: "tol", facts: [
    ...each(REV, {}, [1000000, 1000000, 1000000]), ...each(REV, { [SEG]: "tol:AlphaMember" }, [600000, 600000, 600000]),
    ...each(REV, { [SEG]: "tol:BetaMember" }, [401004, 401004, 401004])] }));
  eq(JSON.stringify(((b.empty || {}).concepts || []).map(c => c.offPct)), "[0.11]", "refused at 0.1004%: the miss prints as 0.11%, never as the 0.1% tolerance itself");
}
// Moelis: a breakdown only on a line the tab does not read, which DOES have a consolidated figure.
{
  const { body: b } = await call(filing({ name: "MC shape", prefix: "mc", facts: [
    ...each("us-gaap:InvestmentBankingRevenue", {}, [800, 900, 1000]), ...each("us-gaap:InvestmentBankingRevenue", { [GEO]: "country:US" }, [600, 700, 750]),
    ...each("us-gaap:InvestmentBankingRevenue", { [GEO]: "mc:EuropeMember" }, [200, 200, 250])] }));
  eq((b.empty || {}).reason, "outside-allow-list", "MC shape: not a line this tab reads");
  eq(((b.empty || {}).concepts || []).map(c => c.label).join(", "), "Investment Banking Revenue", "MC shape: and which line");
}
// Hycroft: every breakdown has one member. MUTATION: counting a single member as a breakdown fails this block.
{
  const { body: b } = await call(filing({ name: "HYMC shape", prefix: "hymc", facts: [
    ...each("us-gaap:GeneralAndAdministrativeExpense", {}, [10, 10, 10]), ...each("us-gaap:GeneralAndAdministrativeExpense", { [SEG]: "us-gaap:ReportableSegmentMember" }, [10, 10, 10])] }));
  eq((b.empty || {}).reason, "one-member", "HYMC shape: a single row");
}
// Edison International: no annual fact on a breakdown axis. AvalonBay: the axis only ever beside another dimension.
{
  const eix = (await call(filing({ name: "EIX shape", prefix: "eix", facts: each(REV, {}, [17, 17, 18]) }))).body;
  eq((eix.empty || {}).reason, "no-breakdown", "EIX shape: no breakdown filed");
  const avb = (await call(filing({ name: "AVB shape", prefix: "avb", facts: [...each(REV, {}, [3, 3, 3]),
    ...each(REV, { [SEG]: "avb:EstablishedMember", "srt:RangeAxis": "srt:MinimumMember" }, [2, 2, 2]), ...each(REV, { [SEG]: "avb:OtherStabilizedMember", "srt:RangeAxis": "srt:MinimumMember" }, [1, 1, 1])] }))).body;
  eq((avb.empty || {}).reason, "no-breakdown", "AVB shape: an axis that never stands on its own is no breakdown");
}
// A breakdown the gate never tested: an allow-listed concept whose consolidated figure is zero. None of the
// five is true, and the page keeps the sentence that shipped before. MUTATION: removing the `other` guard fails this block.
{
  const { body: b } = await call(filing({ name: "zero consolidated", prefix: "z", facts: [
    ...each(REV, {}, [0, 0, 0]), ...each(REV, { [SEG]: "z:AlphaMember" }, [5, 6, 7]), ...each(REV, { [SEG]: "z:BetaMember" }, [-5, -6, -7])] }));
  eq((b.empty || {}).reason, "other", "zero consolidated: an allow-listed breakdown with a figure that was never refused is `other`, not \"nothing to reconcile against\"");
}

// ── the payload and the page agree ───────────────────────────────────────────────────────────────────────
// MUTATION: emitting `empty` on every payload fails the first; renaming a reason on either side fails the rest.
{
  ok(runs.every(r => r.status === 200), `every constructed filing answers 200 — ${runs.filter(r => r.status !== 200).map(r => r.name).join(", ")}`);
  const wrong = runs.filter(r => !!r.body.views.length === ("empty" in r.body)).map(r => r.name);
  eq(wrong.join(", "), "", "`empty` is on every payload with no views and on no payload with one");
  const SRC = readFileSync(join(root, "api", "segments.js"), "utf8");
  const emitted = new Set([...SRC.matchAll(/reason: "([a-z-]+)"/g)].map(m => m[1]));
  const witnessed = new Set(runs.map(r => r.body.empty && r.body.empty.reason).filter(Boolean));
  eq([...emitted].sort().join(" "), [...witnessed].sort().join(" "), "every reason the handler can emit has a witness above");
  const APP = readFileSync(join(root, "src", "App.jsx"), "utf8");
  const copy = APP.slice(APP.indexOf("const COPY = {"), APP.indexOf("const [head, body] = COPY[e.reason]"));
  const keys = new Set([...copy.matchAll(/^\s*"([a-z-]+)": \[/gm)].map(m => m[1]));
  eq([...keys].sort().join(" "), [...emitted].filter(r => r !== "other").sort().join(" "),
    "App.jsx has copy for every reason but `other`, which keeps the sentence that shipped before");
  ok(/COPY\[e\.reason\] \|\| \["Nothing that reconciles"/.test(APP), "App.jsx falls back to the old sentence for `other` AND for a payload with no `empty` — one open across a deploy, or served by a rollback");
  ok(/segs\.empty \|\| \{\}/.test(APP), "App.jsx reads `empty` defensively, so a payload without it renders");
}
// A 200 is cached like every 200 here, empty tab included; a failure is not (test/t-cache.mjs, for this handler).
{
  const bx = runs.find(r => r.name === "BX shape");
  ok(bx && /^public, s-maxage=86400/.test(bx.headers["cache-control"] || ""), "an empty tab's 200 carries the shared cache header — a 10-K's answer changes once a year");
  // Every companion served, or never listed (the no-linkbase filing lists only an .xsd without one; the numbered
  // filing lists an .xsd it has no need to fetch): the full cache, and no `partial` key at all.
  const PARTIAL = new Set(["DFIN embedded, the .xsd answering 500", "separate linkbases, the _pre.xml never answering"]);
  const full = runs.filter(r => !PARTIAL.has(r.name));
  eq(full.filter(r => r.headers["cache-control"] !== "public, s-maxage=86400, stale-while-revalidate=604800" || "partial" in r.body.meta.linkbases).map(r => r.name).join(", "), "",
    `every filing whose listed companions all answered carries the full cache and no \`partial\` — ${full.length} of them, WFC's three separate linkbases and the no-linkbase filing among them`);
  const err = console.error; console.error = () => {};
  globalThis.fetch = async () => { throw new Error("ECONNRESET"); };
  let out = null;
  const res = { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(s) { this._s = s; return this; }, json(b) { out = { status: this._s, headers: this.headers }; return this; } };
  await handler({ query: { cik: "900001" } }, res);
  console.error = err;
  eq(out.status, 502, "an unreachable SEC is a 502");
  ok(!out.headers["cache-control"], "and it is not cached");
}

done("t-seg-rules");
