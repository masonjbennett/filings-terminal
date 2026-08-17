// Segment, product and geographic breakdowns — a genuinely different data path from every other
// route here, and the reason it took a reconnaissance pass before a line of it was written.
//
// `companyfacts`, which api/facts.js proxies, carries NO DIMENSIONAL DATA AT ALL. A fact there is
// `start, end, val, accn, fy, fp, form, filed, frame` and nothing else, so "Apple's revenue" exists
// and "Apple's revenue in Greater China" cannot. The breakdowns live in the XBRL instance, where a
// CONTEXT carries an explicitMember on an axis and a FACT points at a context. SEC extracts that
// instance out of the inline-XBRL 10-K as a standalone `<stem>_htm.xml`, 1.4MB for Apple and 14.9MB
// for JPMorgan.
//
// Three companion files, three fetches, and each earns its place:
//   index.json  — names the instance. SEC's convention is `<primary doc stem>_htm.xml`, but the
//                 convention only holds for the inline-XBRL era and the directory listing is
//                 authoritative and small.
//   _def.xml    — the definition linkbase, which is the only honest way to spot a SUBTOTAL member.
//   _lab.xml    — the label linkbase, so a segment reads "OptumRx" rather than "Optumrx".
//
// Scope is the newest 10-K, deliberately. A segment footnote presents three years, so one filing is
// three columns; reaching eight would mean three more instances and 45MB to add two stale years of a
// segment structure that has usually been reorganised since.
const UA = { "User-Agent": "Mason Bennett masonjbennett.com bennettmasonj@gmail.com", "Accept-Encoding": "gzip, deflate" };

// The axes worth a table. Everything else on a filing is a disclosure breakdown — fair-value levels,
// debt instruments, award types — that belongs in the footnote it came from, not on a sheet.
const VIEWS = [
  { id: "segment", axis: "us-gaap:StatementBusinessSegmentsAxis", title: "Reportable segments" },
  { id: "product", axis: "srt:ProductOrServiceAxis", title: "Products & services" },
  { id: "geo", axis: "srt:StatementGeographicalAxis", title: "Geography" },
];

// The ONE axis allowed to ride along with a breakdown axis. It does not subdivide the figure, it
// says which VIEW of it this is — an operating segment, corporate, an intersegment elimination.
// Everything else riding along makes the fact a cell in a cross-tab rather than a row in a table:
// Apple files revenue by segment × product, and counting those as segment rows would multiply the
// company. It is also what quietly separates a segment table from Chubb's claims-development
// triangles, which sit on the segment axis with an accident-year axis beside them — 542 of its
// contexts, and the single largest block of dimensional data in the filing.
const QUALIFIER = "srt:ConsolidationItemsAxis";

// That axis does two jobs, and both of them break a table if it is only ever "permitted".
//
// RIDING ALONGSIDE A MEMBER it says which view of that segment a figure is, and a filer routinely
// files two or three views of the SAME row for the same period. Caterpillar files Construction
// Industries three times — external sales, the intersegment elimination, and the total of the two —
// so the rows summed to 345% of the company. One member, one period, one concept is ONE row, and
// which view of it to take has to be decided rather than added up.
//
// The UNQUALIFIED fact leads. That was not the first guess: `OperatingSegmentsMember` is the measure
// the ASC 280 reconciliation starts from, so it looked like the natural head of the list, and it cost
// Exxon its table. Exxon files the three revenue lines of its income statement unqualified and ALSO
// tags the operating-segment portion of one of them — $323.820bn against the statement's own
// $323.905bn — under that member. Ranked that way the table quietly swapped one line for a subset of
// itself and read $1.0bn short of a consolidated figure printed directly beneath it. An unqualified
// fact is the figure as the statement presents it; a qualified one is a view of it, so the plain one
// is the table's own number. Measured both ways over the 30 filers: unqualified-first foots 320 of 342
// cells to the dollar against 302, and keeps one more filer and two more concepts.
//
// The prefix pattern is `[\w-]+`, not `\w+`, and that is not a detail: the member these two rules are
// about is `us-gaap:OperatingSegmentsMember` and the standard prefix contains a HYPHEN. Written `\w+`
// both rules simply never fire on the one member they exist for, and neither fails loudly — the rank
// silently falls through to "component" and the subtotal renders as a row called "Operating Segments"
// sitting beside the segments it is the total of.
const QUAL_RANK = q => (!q ? 0 : /^(?:[\w-]+:)?OperatingSegmentsMember$/.test(q) ? 1 : 2);

// FILED ALONE, with no member on any breakdown axis, it is the reconciliation's own rows — corporate,
// intersegment eliminations, "all other". Those are rows of the table and were invisible to a
// pipeline that only looked at contexts carrying a breakdown member, which is why JPMorgan's segments
// summed to $178.6bn against $182.5bn and Procter & Gamble's to 98.9% of itself. Both foot exactly
// once the corporate row is on the page.
//
// One value alone there is NOT a row: `OperatingSegmentsMember` means "the total of the operating
// segments", so it is the subtotal the table already contains, and 14 of the 30 filers swept file
// one. Adding it doubles them.
const SEGMENT_TOTAL = /^(?:[\w-]+:)?OperatingSegments(?:ExcludingIntersegmentElimination)?Member$/;

// The concepts a segment build is made of, and nothing else — the same allow-list discipline
// api/facts.js uses, for the same reason. Every table in a filing that touches one of these axes
// becomes a candidate view, and most of them are disclosures nobody puts in a model: goodwill
// translation adjustments by segment, restructuring costs by segment, a held-for-sale narrative.
// Caterpillar produced thirteen tables and three of the four that survived reconciliation were of
// that kind. Revenue and a profit measure are what a segment build is; the rest is footnote.
const KEEP = new Set([
  // Revenue, across the taxonomy eras and the industry variants. A bank's segment top line is
  // `RevenuesNetOfInterestExpense` and a carrier's is a premium line; neither ever files `Revenues`.
  "Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax",
  "RevenuesNetOfInterestExpense", "PremiumsEarnedNet", "SupplementaryInsuranceInformationPremiumRevenue",
  "RegulatedAndUnregulatedOperatingRevenue", "HealthCareOrganizationPremiumRevenue", "OperatingLeaseLeaseIncome",
  // Profit. Which one a filer uses is its own choice and the page names whichever arrives rather
  // than pretending they are the same measure — a bank reports segment pre-tax income, an operating
  // company reports segment operating income, and calling both "profit" would be the lie.
  "OperatingIncomeLoss", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
  "NetIncomeLoss", "ProfitLoss",
  // The rest of a segment footnote's standard content.
  "CostOfGoodsAndServicesSold", "GrossProfit", "Assets", "DepreciationDepletionAndAmortization",
  "SegmentExpenditureAdditionToLongLivedAssets", "PaymentsToAcquirePropertyPlantAndEquipment",
  "NoninterestIncome", "InterestIncomeExpenseNet", "NoninterestExpense", "PropertyPlantAndEquipmentNet", "NoncurrentAssets",
]);
const LABEL = {
  Revenues: "Revenue", RevenueFromContractWithCustomerExcludingAssessedTax: "Revenue",
  RevenueFromContractWithCustomerIncludingAssessedTax: "Revenue", RevenuesNetOfInterestExpense: "Net revenue",
  PremiumsEarnedNet: "Net premiums earned", SupplementaryInsuranceInformationPremiumRevenue: "Premium revenue",
  RegulatedAndUnregulatedOperatingRevenue: "Operating revenue", HealthCareOrganizationPremiumRevenue: "Premium revenue",
  OperatingLeaseLeaseIncome: "Lease income", OperatingIncomeLoss: "Operating income",
  IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: "Pre-tax income",
  IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments: "Pre-tax income",
  NetIncomeLoss: "Net income", ProfitLoss: "Net income", CostOfGoodsAndServicesSold: "Cost of sales",
  GrossProfit: "Gross profit", Assets: "Assets", DepreciationDepletionAndAmortization: "D&A",
  SegmentExpenditureAdditionToLongLivedAssets: "Capital expenditure", PaymentsToAcquirePropertyPlantAndEquipment: "Capital expenditure",
  NoninterestIncome: "Noninterest income", InterestIncomeExpenseNet: "Net interest income",
  NoninterestExpense: "Noninterest expense", PropertyPlantAndEquipmentNet: "Property, plant & equipment",
  NoncurrentAssets: "Long-lived assets",
};

const ANNUAL_MIN = 300, ANNUAL_MAX = 400;
// How close "the parts equal the whole" has to be for the gate to show a table at all.
//
// It was 1%, which on a $400bn company is $4bn — bigger than most of the rows. The page prints the
// consolidated line under every table precisely so a reader can add the column up, and at 1% a table
// that visibly does not add up passes: Exxon's revenue by product was $1.7bn short and Johnson &
// Johnson's cost of sales 0.44%. The distribution says a looser number buys nothing, because it is
// not a distribution at all — 320 of the 342 cells shown foot to the DOLLAR, 19 more are inside
// 0.05%, and the rest are wrong by a whole missing row. Tightening to 0.1% costs exactly one concept
// on one filer across the sweep and makes the claim on the page true.
const TOL = 0.001;
// And how close it has to be to say a breakdown ALREADY closes, so a reconciling row would be a
// second copy of something inside it. That is a different question and it wants a far tighter number:
// measured over the 345 (view, concept, period) cells the sweep shows, 312 foot to the DOLLAR and the
// rest are wrong by a real reconciling item. There is nothing in between, so the test is exactness.
//
// Reusing TOL here was written first and was wrong in the one way that costs a table: AT&T's revenue
// by segment is 0.37% short of consolidated, which is its corporate revenue missing, and 0.37% is
// inside 1% — so the table was declared closed and the $458m row that closes it exactly was dropped.
const EXACT = 1e-6;
const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const pad = c => String(c).padStart(10, "0");
// Labels arrive as filed, entities and all: Walmart's segment is "Walmart&#160;U.S." and Caterpillar
// files non-breaking spaces throughout. Left raw they render as literal `&#160;` on the page.
const unent = s => String(s).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
  .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/\s+/g, " ").trim();

async function get(url, json = false) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) { const e = new Error(`SEC answered ${r.status}`); e.status = r.status; throw e; }
  return json ? r.json() : r.text();
}

// Both the prefixed and unprefixed forms, everywhere. Apple's instance declares the XBRL instance
// namespace as the DEFAULT, so its elements are `<context>`; plenty of filers emit `<xbrli:context>`.
// A parser that assumes one finds nothing for the other, and finding nothing is indistinguishable
// from "this filer reports no segments" — the failure would be a blank tab, not an error.
function parseContexts(xml) {
  const out = new Map();
  for (const m of xml.matchAll(/<(?:\w+:)?context id="([^"]+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?context>/g)) {
    const body = m[2], dims = {};
    for (const d of body.matchAll(/<xbrldi:explicitMember dimension="([^"]+)"[^>]*>([^<]+)</g)) dims[d[1]] = d[2].trim();
    const start = (body.match(/<(?:\w+:)?startDate>([^<]+)</) || [])[1];
    const end = (body.match(/<(?:\w+:)?endDate>([^<]+)</) || [])[1];
    const instant = (body.match(/<(?:\w+:)?instant>([^<]+)</) || [])[1];
    out.set(m[1], { dims, n: Object.keys(dims).length, start, end: end || instant, instant: !!instant });
  }
  return out;
}

// Numeric facts only. A filing's text blocks are the footnote's own HTML re-escaped back into the
// instance and run to megabytes of it; requiring a number is what separates a fact from a paragraph.
//
// DEDUPLICATED BY (tag, context), and that is not tidying. Inline XBRL tags a figure everywhere it
// appears in the document, so the extracted instance carries the same fact once per occurrence:
// Apple's services revenue is on the face of the income statement and again in the revenue footnote,
// identical tag, identical context, two elements. Summed as filed, its product breakdown came to
// $525.3bn against a $416.2bn company — the extra $109.1bn being services counted twice. A duplicate
// is the same fact seen twice, not two facts, and nothing downstream can tell the difference.
function parseFacts(xml, want) {
  const out = [], seen = new Set();
  let dupes = 0;
  for (const m of xml.matchAll(/<([\w-]+:[A-Za-z0-9_]+)\s([^>]*?)contextRef="([^"]+)"([^>]*)>([^<]*)<\//g)) {
    if (!want(m[3])) continue;
    const raw = m[5].trim();
    if (!/^-?\d+(\.\d+)?$/.test(raw)) continue;
    if (!KEEP.has(m[1].split(":").pop())) continue;
    const key = `${m[1]} ${m[3]}`;
    if (seen.has(key)) { dupes++; continue; }
    seen.add(key);
    out.push({ tag: m[1], ctx: m[3], unit: ((m[2] + m[4]).match(/unitRef="([^"]+)"/) || [])[1], val: Number(raw) });
  }
  out.dupes = dupes;
  return out;
}

const qname = s => s.replace(/^loc_/, "")
  .replace(/_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(_default)?$/, "")
  .replace(/_/, ":");

// The definition linkbase, split by EXTENDED-LINK ROLE — and the role is the whole reason this
// parses tables rather than axes.
//
// One axis can carry two completely different breakdowns. Apple files revenue by product twice: on
// the income statement as {Product, Service}, and in the revenue footnote as {iPhone, Mac, iPad,
// Wearables, Service}. Both sit on `srt:ProductOrServiceAxis` and each foots to $416.2bn on its own.
// Grouped by axis they summed to $832.3bn — exactly twice the company — and no containment arc says
// so, because the linkbase declares Product and iPhone as SIBLINGS under one domain. What separates
// them is that they belong to different hypercubes: `CONSOLIDATEDSTATEMENTSOFOPERATIONS` and
// `RevenueDisaggregatedNetSales…Details`. So a view is an (axis, role) pair.
//
// Within a role, parent → child arcs still matter, because a table can carry a member that is the
// SUM of others in the same table. UnitedHealth files `TotalOptum` beside Optum Health, Optum
// Insight and OptumRx; Caterpillar files the standard
// `ReportableSegmentAggregationBeforeOtherOperatingSegment` beside the four segments inside it.
// Counted as rows they double the company — UNH summed to $891.6bn against $447.6bn, Caterpillar to
// $136.4bn against $67.6bn. Matching the word "Total" would be the obvious fix and is exactly what
// rule 10 exists to warn against; the filer has already declared it.
//
// Members are NOT required to end in "Member". Apple's geography rows are `country:US` and
// `country:CN`, standard members with no such suffix, and requiring it dropped the United States and
// China from a geographic breakdown while leaving "Other countries" behind.
function parseRoles(xml) {
  const roles = [];
  for (const blk of xml.matchAll(/<link:definitionLink[^>]*xlink:role="([^"]+)"[^>]*>([\s\S]*?)<\/link:definitionLink>/g)) {
    const body = blk[2], axes = new Set(), members = [], kids = new Map(), domains = new Set();
    for (const m of body.matchAll(/<link:definitionArc[^>]*hypercube-dimension[^>]*xlink:to="([^"]+)"/g)) axes.add(qname(m[1]));
    for (const m of body.matchAll(/<link:definitionArc[^>]*dimension-domain[^>]*xlink:to="([^"]+)"/g)) domains.add(qname(m[1]));
    // Arc order is the filer's own presentation order, which is the order the footnote prints.
    const arcs = [...body.matchAll(/<link:definitionArc[^>]*domain-member[^>]*>/g)].map(m => m[0]);
    for (const a of arcs) {
      const from = qname((a.match(/xlink:from="([^"]+)"/) || [])[1] || "");
      const to = qname((a.match(/xlink:to="([^"]+)"/) || [])[1] || "");
      if (!from || !to || from === to || domains.has(to)) continue;
      if (!members.includes(to)) members.push(to);
      if (!kids.has(from)) kids.set(from, new Set());
      kids.get(from).add(to);
    }
    // A role's arcs carry its LINE ITEMS as well as its members, and both are needed. Apple files two
    // geographic tables against the same three countries — net sales, and long-lived assets — so the
    // members alone cannot tell them apart, and every fact on those members landed in both. What
    // separates them is the concept: one table is revenue, the other is property. Members and
    // concepts are told apart later, by which of them a context actually uses.
    if (axes.size && members.length) roles.push({ role: blk[1], axes, members, kids });
  }
  return roles;
}

// `terseLabel` is the filer's own short name — "Americas" where the standard label is the verbose
// "Americas Segment [Member]". The linkbase's `xlink:label` is derivable straight from the QName, so
// no locator chasing is needed.
function parseLabels(xml) {
  const out = {};
  for (const m of xml.matchAll(/<link:label[^>]*xlink:label="lab_([^"]+)"[^>]*xlink:role="[^"]*\/(terseLabel|label)"[^>]*>([\s\S]*?)<\/link:label>/g)) {
    const q = m[1].replace(/_/, ":"), role = m[2];
    const text = unent(m[3]).replace(/\s*\[Member\]\s*$/, "").trim();
    if (!text) continue;
    if (role === "terseLabel" || !out[q]) out[q] = text;      // terse wins where both exist
  }
  return out;
}

// A few members carry the TAXONOMY'S OWN DEFINITION where a name should be, and it is a definition
// rather than a name: JPMorgan's corporate row came out as "Segment Reporting, Reconciling Item,
// Excluding Corporate Nonsegment" — 67 characters into a sticky label column that does not wrap, which
// is how three year-columns got pushed off an eight-year sheet once already. Linde's corporate segment
// reads "Corporate Segment and Other Operating Segment".
//
// Which label is which cannot be told from the ROLE it sits in — Coca-Cola files a terseLabel whose
// text is the standard label verbatim — and it must not be told by overriding the member outright,
// because most filers do supply a real name for exactly these members and it is better than a generic
// one: UnitedHealth calls its intersegment row "Optum Eliminations" and Bank of America calls its
// corporate row "All Other". So the match is on the taxonomy's exact string, collected from the
// linkbases themselves. Anything else is the filer's own words and is kept.
const TAXONOMY_LABEL = {
  "Segment Reporting, Reconciling Item, Corporate Nonsegment": "Corporate",
  "Segment Reporting, Reconciling Item, Excluding Corporate Nonsegment": "Reconciling items",
  "Segment Reporting, Reconciling Item": "Reconciling items",
  "Consolidation, Eliminations": "Eliminations",
  "Corporate Segment and Other Operating Segment": "Corporate and other",
};

export default async function handler(req, res) {
  const cik = String(req.query.cik || "").replace(/\D/g, "");
  if (!cik || cik.length > 10) return res.status(400).json({ error: "cik must be digits" });
  // A 10-K changes once a year. The long shared cache is what keeps a segment lookup — three fetches
  // and up to 20MB of parsing — from being repeated for every reader.
  res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
  try {
    const sub = await get(`https://data.sec.gov/submissions/CIK${pad(cik)}.json`, true);
    const r = (sub.filings && sub.filings.recent) || { form: [] };
    const i = r.form.indexOf("10-K");
    if (i < 0) return res.status(404).json({ error: "no 10-K on file for that company" });
    const accn = r.accessionNumber[i], bare = accn.replace(/-/g, "");
    const dir = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${bare}`;

    const idx = await get(`${dir}/index.json`, true);
    const items = (idx.directory && idx.directory.item) || [];
    const inst = items.find(x => /\.xml$/.test(x.name) && !/^(R\d|FilingSummary|MetaLinks)/.test(x.name)
      && !/_(cal|def|lab|pre)\.xml$/.test(x.name));
    if (!inst) return res.status(404).json({ error: "that filing carries no XBRL instance" });
    const stem = inst.name.replace(/\.xml$/, "").replace(/_htm$/, "");

    // The label linkbase and FilingSummary are nice-to-have and must never fail the request: without
    // them the members render from their QNames and a view is titled by its axis. The DEFINITION
    // linkbase is different — without it there are no roles, so the axis-wide fallback runs and the
    // page says which of the two it is looking at.
    const [xml, defXml, labXml, sumXml] = await Promise.all([
      get(`${dir}/${inst.name}`),
      get(`${dir}/${stem}_def.xml`).catch(() => ""),
      get(`${dir}/${stem}_lab.xml`).catch(() => ""),
      get(`${dir}/FilingSummary.xml`).catch(() => ""),
    ]);

    const ctxs = parseContexts(xml);
    const roles = defXml ? parseRoles(defXml) : [];
    const labels = labXml ? parseLabels(labXml) : {};
    // SEC's own rendering names every table it generates, and that name is the one in the filing's
    // index — "Segment Information and Geographic Data - Information by Reportable Segment (Details)".
    // Deriving a title from the role URI instead gives the same words run together without spaces.
    const roleNames = {};
    for (const m of sumXml.matchAll(/<Report[^>]*>([\s\S]*?)<\/Report>/g)) {
      const role = (m[1].match(/<Role>([^<]+)<\/Role>/) || [])[1];
      const name = (m[1].match(/<ShortName>([^<]+)<\/ShortName>/) || [])[1];
      if (role && name) roleNames[role] = unent(name).replace(/\s*\((Details|Tables)\)\s*$/, "").trim();
    }

    // Annual periods present on ANY breakdown axis, newest first, capped at what a footnote shows.
    const axisSet = new Set(VIEWS.map(v => v.axis));
    const onAxis = c => Object.keys(c.dims).some(d => axisSet.has(d));
    const annual = new Set();
    for (const c of ctxs.values())
      if (onAxis(c) && c.start && days(c.start, c.end) >= ANNUAL_MIN && days(c.start, c.end) <= ANNUAL_MAX) annual.add(c.end);
    const periods = [...annual].sort().slice(-4);            // oldest → newest, as the sheet reads

    // The reconciliation's own rows: contexts carrying the qualifier axis and NOTHING else. They
    // belong to no breakdown axis, so they are collected once and offered to every view — which role
    // they are a row of is settled below, by the definition linkbase, exactly as a member is.
    const reconCtx = new Map();
    for (const [id, c] of ctxs) {
      if (c.instant || !periods.includes(c.end) || c.n !== 1 || !c.dims[QUALIFIER]) continue;
      if (!c.start || days(c.start, c.end) < ANNUAL_MIN || days(c.start, c.end) > ANNUAL_MAX) continue;
      if (SEGMENT_TOTAL.test(c.dims[QUALIFIER])) continue;
      reconCtx.set(id, c);
    }
    const reconFacts = reconCtx.size ? parseFacts(xml, id => reconCtx.has(id)) : [];
    const reconPresent = new Set([...reconCtx.values()].map(c => c.dims[QUALIFIER]));

    // The consolidated value of every concept, from an UNDIMENSIONED context in the same instance.
    // This is what the gate below reconciles against, and taking it from the same document means there
    // is no second source to disagree and no scaling question to get wrong. It is read HERE, before
    // the views are built, because a reconciling row cannot be judged without it — see below.
    const plain = new Set();
    for (const [id, c] of ctxs) if (!c.n && !c.instant && c.start && periods.includes(c.end)) plain.add(id);
    const consolidated = {};
    for (const f of parseFacts(xml, id => plain.has(id))) {
      const end = ctxs.get(f.ctx).end;
      if (days(ctxs.get(f.ctx).start, end) < ANNUAL_MIN) continue;
      (consolidated[f.tag] = consolidated[f.tag] || {})[end] = f.val;
    }

    const views = [];
    const wantedTags = new Set();
    const nameOf = q => TAXONOMY_LABEL[labels[q]]
      || labels[q] || unent(q.split(":").pop().replace(/Member$/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2"));
    // A group's line items, where the role declares any. Applied to a reconciling row for the same
    // reason it is applied to a segment row: a role that declares its concepts is saying which table
    // this is, and a fact for a different one belongs to a different table.
    const wantedHere = (g, tag) => !g.concepts.size || g.concepts.has(tag);

    // ── Rule 9: a cross-tab collapses along its second axis ──────────────────────────────────────
    //
    // Rule 1 keeps one breakdown axis per fact, and for one filer that is the only thing standing
    // between the tab and a table it plainly has. Exxon files NO single-axis segment breakdown worth
    // the name — two members on one impairment concept — and files thirteen concepts three years deep
    // as segment × geography. Summing each segment's cells across geography recovers the row.
    //
    // It is arithmetic, not inference, and it is checkable: Exxon's eight revenue cells sum to
    // $452.209bn, which is EXACTLY the `OperatingSegments` subtotal it files beside them, and its
    // intersegment elimination of −$121.005bn plus corporate revenue of $1.034bn take that to
    // $332.238bn against a consolidated $332.238bn. To the dollar, which is the point — the collapse
    // is fed back into the SAME pipeline, so rule 6's reconciling rows, rule 7's view selection and the
    // gate all apply to it unchanged rather than being re-implemented on a second path.
    //
    // Three things bound it, and the first is the one that would double a company:
    //  - **A TOTAL member on the second axis.** {US, Non-U.S., Worldwide} summed is twice the company,
    //    which is rule 3's failure arriving on an axis rule 3 never looks at. Tested by VALUE, the way
    //    rule 6 tests a reconciling row, and the whole collapse fails closed if one is found — because
    //    a filer that files a geographic total files it for every row, so this is not a row to drop.
    //  - **Exactly ONE other breakdown axis.** Exxon also files segment × geography × product; which
    //    of two axes to collapse along is not answerable from the data, so it is not guessed.
    //  - **Only where the single-axis path produced nothing that survives the gate.** An unqualified
    //    single-axis fact is the figure as the statement presents it; a collapse is a reconstruction,
    //    and a reconstruction never outranks the filing. This is what keeps the change off the 26
    //    filers that already have a table.
    const collapse = v => {
      const cell = new Map(), seconds = new Set();
      for (const [id, c] of ctxs) {
        if (!c.dims[v.axis] || c.instant || !periods.includes(c.end)) continue;
        if (!c.start || days(c.start, c.end) < ANNUAL_MIN || days(c.start, c.end) > ANNUAL_MAX) continue;
        const others = Object.keys(c.dims).filter(d => d !== v.axis && d !== QUALIFIER);
        if (others.length !== 1 || !axisSet.has(others[0])) continue;
        cell.set(id, c); seconds.add(others[0]);
      }
      if (!cell.size || seconds.size !== 1) return null;
      const second = [...seconds][0];
      // Rule 4 before anything is added up. Inline XBRL repeats a fact everywhere it appears in the
      // document, and here a duplicate is not a cosmetic problem — it lands straight in a sum.
      const seen = new Set(), groups = new Map();
      for (const f of parseFacts(xml, id => cell.has(id))) {
        const k = `${f.tag}|${f.ctx}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const c = cell.get(f.ctx);
        const g = `${f.tag} ${c.end} ${c.dims[v.axis]} ${c.dims[QUALIFIER] || ""}`;
        if (!groups.has(g)) groups.set(g, { tag: f.tag, end: c.end, seg: c.dims[v.axis],
          q: c.dims[QUALIFIER] || "", unit: f.unit, parts: new Map() });
        // One cell per second-axis member. A repeat at the same coordinates is the same cell.
        if (!groups.get(g).parts.has(c.dims[second])) groups.get(g).parts.set(c.dims[second], f.val);
      }
      if (!groups.size) return null;
      // The total-member test. Exactly the shape rule 6 uses on reconciling rows: a member carrying
      // the sum of the others is the total restated. Two members cannot be told apart this way, so a
      // pair is left alone — with {US, Non-U.S.} neither is trivially the other.
      for (const g of groups.values()) {
        if (g.parts.size < 3) continue;
        for (const [m, val] of g.parts) {
          const others = [...g.parts].filter(([o]) => o !== m).reduce((n, [, x]) => n + x, 0);
          if (others !== 0 && Math.abs(val - others) <= Math.abs(others) * 1e-6) return null;
        }
      }
      // Synthetic contexts in the shape the single-axis path produces, so nothing downstream can tell
      // the difference and no rule below has to learn about cross-tabs.
      const keep = new Map(), facts = [];
      let n = 0;
      for (const g of groups.values()) {
        const id = ` collapsed${n++}`;
        keep.set(id, { dims: { [v.axis]: g.seg, ...(g.q ? { [QUALIFIER]: g.q } : {}) },
          n: g.q ? 2 : 1, end: g.end, start: null, instant: false });
        facts.push({ tag: g.tag, ctx: id, unit: g.unit,
          val: [...g.parts.values()].reduce((a, x) => a + x, 0) });
      }
      return { keep, facts, along: second };
    };

    for (const v of VIEWS) {
      // Contexts on this axis, one breakdown axis only, with the qualifier permitted.
      const keep = new Map();
      for (const [id, c] of ctxs) {
        if (!c.dims[v.axis] || c.instant || !periods.includes(c.end)) continue;
        if (!c.start || days(c.start, c.end) < ANNUAL_MIN || days(c.start, c.end) > ANNUAL_MAX) continue;
        if (!Object.keys(c.dims).every(d => d === v.axis || d === QUALIFIER)) continue;
        keep.set(id, c);
      }
      const sources = [];
      if (keep.size) {
        const f = parseFacts(xml, id => keep.has(id));
        if (f.length) sources.push({ keep, facts: f, along: null });
      }
      // Built alongside rather than instead: which one survives is decided after the gate, because
      // "the single-axis path produced a table" is not knowable until the gate has ruled on it.
      const col = collapse(v);
      if (col) sources.push(col);
      for (const src of sources) buildViews(v, src);
    }

    function buildViews(v, { keep, facts, along }) {
      const present = new Set([...keep.values()].map(c => c.dims[v.axis]));

      // One group per role that declares this axis. Where the linkbase is missing or declares none,
      // a single axis-wide group is the fallback — which is what shipped before roles were parsed,
      // and is right often enough that losing it would be worse than the double count it can carry.
      const groups = roles.filter(r => r.axes.has(v.axis) && r.members.some(m => present.has(m)))
        .map(r => ({ role: r.role, kids: r.kids,
          members: r.members.filter(m => present.has(m)),
          // A role declares its reconciling members alongside its segments, so which table the
          // corporate row belongs to is the filer's own statement rather than a guess. Where the
          // linkbase is missing the axis-wide fallback takes them all, and the gate below is what
          // decides whether that was right.
          recons: r.members.filter(m => reconPresent.has(m)),
          // Whatever the role declares that is NOT one of this filing's dimension members is a line
          // item of that table. Used to keep Apple's geographic revenue out of its geographic
          // long-lived-assets table, which shares all three of its members.
          concepts: new Set(r.members.filter(m => !present.has(m) && !reconPresent.has(m))) }));
      if (!groups.length) groups.push({ role: null, kids: new Map(), members: [...present],
        recons: [...reconPresent], concepts: new Set() });

      for (const g of groups) {
        // A parent only DOUBLE-COUNTS when its children are also in the same table, and that has to
        // be decided on the members actually present. Deciding it on the linkbase alone removed real
        // segments: Chubb's Overseas General and Global Reinsurance each parent a finer breakdown it
        // does not tag here, taking a $53.0bn premium base to $37.3bn. Chevron is sharper still — its
        // aggregation member is the only row carrying revenue at all, so dropping it left a single
        // $0.6bn "all other" row against a $184bn company.
        const inGroup = new Set(g.members);
        const subtotals = g.members.filter(m => {
          const inside = g.kids.get(m);
          return inside && [...inside].some(c => inGroup.has(c));
        });
        const drop = new Set(subtotals);
        const segMembers = g.members.filter(m => !drop.has(m)).map(q => ({ q, label: nameOf(q) }));
        if (!segMembers.length) continue;
        // Reconciling rows go UNDER the segments, which is where the footnote prints them.
        const members = segMembers.concat(g.recons.map(q => ({ q, recon: true,
          label: nameOf(q) })));
        const mi = new Map(members.map((m, n) => [m.q, n]));

        // One member, one concept, one period is ONE row, and a filer may have filed several views of
        // it. Pick ONE view for the whole column rather than one per row: a total that takes some
        // segments including intersegment sales and others excluding them is neither figure, and it
        // is wrong by an amount nothing on the page can explain.
        //
        // Choosing ONE view for the whole table was tried and is wrong, because different members
        // legitimately carry different views: AT&T's two segments are `OperatingSegments` and its
        // corporate row is `CorporateAndReconcilingItems`, so a table-wide choice dropped the
        // corporate row and left D&A $76m short. The choice is per member, by rank.
        // Per (concept, period): every view of every member, before anything is chosen.
        const cells = new Map();
        for (const f of facts) {
          const c = keep.get(f.ctx), m = mi.get(c.dims[v.axis]);
          if (m == null || !wantedHere(g, f.tag)) continue;
          const k = `${f.tag}|${periods.indexOf(c.end)}`, q = c.dims[QUALIFIER] || "";
          if (!cells.has(k)) cells.set(k, new Map());
          const per = cells.get(k);
          if (!per.has(m)) per.set(m, new Map());
          if (!per.get(m).has(q)) per.get(m).set(q, { t: f.tag, m, p: periods.indexOf(c.end), v: f.val, u: f.unit });
        }
        if (!cells.size) continue;
        const out = [], otherViews = new Set();
        for (const per of cells.values()) {
          // ONE view for the column where possible, then per member where it is not. Choosing
          // per member alone mixes bases and the total is neither figure: Caterpillar tags Power &
          // Energy unqualified at its EXTERNAL sales and its other four segments only at the total
          // including intersegment, so a per-member choice summed 68.94bn against a 67.59bn company —
          // the four segments gross of intersegment and the fifth net of it. Choosing per TABLE alone
          // is worse, because different members legitimately carry different views: AT&T's two
          // segments are `OperatingSegments` and its corporate row is `CorporateAndReconcilingItems`,
          // which a table-wide choice drops entirely. So: the view covering the most members leads,
          // and a member it does not reach keeps its own best by rank.
          const cover = new Map();
          for (const qs of per.values()) for (const q of qs.keys()) cover.set(q, (cover.get(q) || 0) + 1);
          const lead = [...cover].sort((a, b) => b[1] - a[1]
            || QUAL_RANK(a[0]) - QUAL_RANK(b[0]) || (a[0] < b[0] ? -1 : 1))[0][0];
          for (const qs of per.values()) {
            const q = qs.has(lead) ? lead : [...qs.keys()].sort((a, b) => QUAL_RANK(a) - QUAL_RANK(b))[0];
            out.push({ ...qs.get(q), c: q ? q.split(":").pop().replace(/Member$/, "") : null });
            for (const other of qs.keys()) if (other !== q) otherViews.add(other);
          }
        }

        // A reconciling row is an ADDENDUM to the segments, so one carrying their SUM is not a row at
        // all — it is the subtotal restated, and adding it doubles the table. Coca-Cola tags exactly
        // that: its $48.806bn of total reportable-segment revenue is filed under
        // `MaterialReconcilingItemsMember`, the same member every other filer uses for a genuine
        // reconciling item. So the test is the value, not the name — the same reason rule 10 says a
        // member called "Total" proves nothing — and it is decided against the segment rows in this
        // table rather than against the consolidated figure, which is what the gate is for.
        const segSum = {};
        for (const f of out) if (f.m < segMembers.length)
          segSum[`${f.t}|${f.p}`] = (segSum[`${f.t}|${f.p}`] || 0) + f.v;
        const restated = new Set();
        const reconRows = new Map();
        for (const f of reconFacts) {
          const c = reconCtx.get(f.ctx), m = mi.get(c.dims[QUALIFIER]);
          if (m == null || !wantedHere(g, f.tag)) continue;
          const s = segSum[`${f.tag}|${periods.indexOf(c.end)}`];
          if (s != null && s !== 0 && Math.abs(f.val - s) <= Math.abs(s) * 1e-6) restated.add(c.dims[QUALIFIER]);
          const k = `${f.tag}|${periods.indexOf(c.end)}`;
          if (!reconRows.has(k)) reconRows.set(k, new Map());
          reconRows.get(k).set(c.dims[QUALIFIER], f.val);
        }
        // The same subtotal, one level down: a reconciling row can be the SUM OF THE OTHER
        // RECONCILING ROWS. Caterpillar files corporate at −$805m, intersegment eliminations at
        // −$5,888m and `EliminationsAndReconcilingItems` at −$6,693m, which is exactly the other two —
        // so all three go in and the table comes out $6.7bn light. Drop it and Caterpillar foots to
        // the DOLLAR: $74,282m of segments less those two is $67,589m against a $67,589m company.
        //
        // Only where EXACTLY ONE row matches, and only with two or more others to sum: with two rows
        // of equal value each is trivially "the sum of the others" and there is no way to tell which
        // is the total, so nothing is dropped. Ambiguity fails closed, the same as everywhere here.
        for (const [, rowsFor] of reconRows) {
          if (rowsFor.size < 3) continue;
          const hits = [...rowsFor].filter(([q, val]) => {
            const others = [...rowsFor].filter(([o]) => o !== q).reduce((n, [, x]) => n + x, 0);
            return others !== 0 && Math.abs(val - others) <= Math.abs(others) * 1e-6;
          });
          if (hits.length === 1) restated.add(hits[0][0]);
        }
        // A reconciling row belongs to a breakdown that does NOT already close on its own. Where the
        // rows already sum to the consolidated figure, the reconciling item is inside them, and adding
        // it beside them is the same double count the subtotal rule exists to stop — just reached from
        // the other end. AT&T is the case: its revenue categories foot to $122.43bn exactly, and its
        // linkbase also declares `CorporateAndReconcilingItems` on that role, so the corporate $458m
        // went in and left a table summing to $122.89bn under a printed consolidated line of $122.43bn.
        // It survived the gate — 0.38% is inside the tolerance — which is the worst way to be wrong
        // here, because the page's whole claim is that a reader can add the column up.
        //
        // This is decided PER CONCEPT, not per table, and that is not a compromise: it is how a
        // footnote is actually laid out. Apple's revenue by geography foots without a corporate row
        // because every dollar of revenue belongs to a region, while its operating income by geography
        // cannot, because corporate expense is unallocated by construction. Its footnote prints the
        // corporate line against operating income and not against revenue, and so does this.
        const closes = (tag, p) => {
          const con = (consolidated[tag] || {})[periods[p]];
          const s = segSum[`${tag}|${p}`];
          return con != null && con !== 0 && s != null && Math.abs(s / con - 1) <= EXACT;
        };
        for (const f of reconFacts) {
          const c = reconCtx.get(f.ctx), m = mi.get(c.dims[QUALIFIER]);
          if (m == null || restated.has(c.dims[QUALIFIER]) || !wantedHere(g, f.tag)) continue;
          const p = periods.indexOf(c.end);
          // Only concepts the segments themselves report. A reconciling row for a line no segment
          // carries is a footnote of its own, and printing it under a table it does not belong to
          // would break the arithmetic the table is shown for.
          if (segSum[`${f.tag}|${p}`] == null || closes(f.tag, p)) continue;
          out.push({ t: f.tag, m, p, v: f.val, u: f.unit,
            c: c.dims[QUALIFIER].split(":").pop().replace(/Member$/, "") });
        }
        for (const f of out) wantedTags.add(f.t);
        views.push({ id: v.id, axis: v.axis, role: g.role, collapsedAlong: along,
          title: v.title, source: g.role ? (roleNames[g.role] || null) : null,
          members, facts: out, subtotals: subtotals.map(nameOf),
          otherViews: [...otherViews].filter(Boolean).map(q => q.split(":").pop().replace(/Member$/, "")) });
      }
    }

    for (const t of Object.keys(consolidated)) if (!wantedTags.has(t)) delete consolidated[t];

    // ── The gate: a breakdown is shown only if it ADDS UP ──────────────────────────────────────
    //
    // Splitting by role fixed Apple exactly and made everything else noisier, because a role is any
    // table in the filing that happens to touch one of these axes. Caterpillar came out with
    // thirteen, including its long-term debt note and its cash-flow statement, and three of the real
    // ones summed to 142% of the company — a parent and its children in one table, or segment
    // revenue that includes intersegment sales.
    //
    // There is no external truth to appeal to, but a breakdown has an identity of its own: the parts
    // equal the whole. Both failures break it and no correct table does, so it is the rule rather
    // than a filter — every concept is tested against the consolidated figure for the same period in
    // the same filing, and one that does not reconcile is dropped. A table left with nothing goes
    // too. This DOES drop real tables, Microsoft's product disaggregation among them; that is the
    // trade this file keeps making, because "we do not show this" is recoverable and a segment table
    // reading 142% of the company is not.
    const reconciles = (view, tag) => {
      let tested = 0;
      for (let p = periods.length - 1; p >= 0; p--) {
        const con = (consolidated[tag] || {})[periods[p]];
        if (con == null || con === 0) continue;
        const rows = view.facts.filter(f => f.t === tag && f.p === p);
        if (!rows.length) continue;
        tested++;
        if (Math.abs(rows.reduce((n, f) => n + f.v, 0) / con - 1) > TOL) return false;
      }
      return tested > 0;
    };
    const gated = [];
    for (const view of views) {
      const tags = [...new Set(view.facts.map(f => f.t))].filter(t => reconciles(view, t));
      if (!tags.length) continue;
      const keepTag = new Set(tags);
      const facts = view.facts.filter(f => keepTag.has(f.t));
      // A member left with no fact at all is not a row of this table after the gate.
      const used = new Set(facts.map(f => f.m));
      const members = view.members.filter((_, i) => used.has(i));
      const remap = new Map(view.members.map((m, i) => [i, members.indexOf(m)]).filter(([, n]) => n >= 0));
      gated.push({ ...view, members, concepts: tags,
        facts: facts.map(f => ({ ...f, m: remap.get(f.m) })) });
    }
    // Rule 9's other half: a RECONSTRUCTION never outranks the filing. Where an axis produced a table
    // from single-axis facts, the collapsed cross-tab for that axis is dropped even though it too
    // survived the gate — the filer presented one of them and the other is arithmetic done on its
    // behalf. Decided here rather than in the loop above, because "the single-axis path produced a
    // table" is only knowable once the gate has ruled.
    const filed = new Set(gated.filter(v => !v.collapsedAlong).map(v => v.axis));
    const ranked = gated.filter(v => !v.collapsedAlong || !filed.has(v.axis));

    // Two tables can survive the gate with the same members and the same concepts — the same
    // breakdown reached through two roles. Keep the first, which is the filing's own order.
    const seenView = new Set(), out = [];
    for (const v of ranked) {
      const key = `${v.axis}|${v.members.map(m => m.q).join(",")}|${v.concepts.join(",")}`;
      if (seenView.has(key)) continue;
      seenView.add(key);
      out.push(v);
    }
    views.length = 0;
    views.push(...out);
    for (const t of Object.keys(consolidated)) if (!views.some(v => v.concepts.includes(t))) delete consolidated[t];

    return res.status(200).json({
      cik, name: sub.name, accn, period: r.reportDate ? r.reportDate[i] : null, filed: r.filingDate[i],
      filingUrl: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${bare}/${accn}-index.htm`,
      periods, views, consolidated,
      conceptLabels: Object.fromEntries([...new Set(views.flatMap(v => v.concepts))]
        .map(t => [t, LABEL[t.split(":").pop()] || labels[t] || t.split(":").pop()])),
      meta: { instance: inst.name, bytes: Number(inst.size) || xml.length, contexts: ctxs.size,
        linkbases: { definition: !!defXml, label: !!labXml } },
    });
  } catch (e) {
    if (e.status === 404) return res.status(404).json({ error: "SEC has no such filing on file" });
    console.error("segments failed:", e && e.message);
    return res.status(502).json({ error: "couldn't reach SEC — try again in a moment" });
  }
}
