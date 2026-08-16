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

    const views = [];
    const wantedTags = new Set();
    const nameOf = q => labels[q] || unent(q.split(":").pop().replace(/Member$/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2"));

    for (const v of VIEWS) {
      // Contexts on this axis, one breakdown axis only, with the qualifier permitted.
      const keep = new Map();
      for (const [id, c] of ctxs) {
        if (!c.dims[v.axis] || c.instant || !periods.includes(c.end)) continue;
        if (!c.start || days(c.start, c.end) < ANNUAL_MIN || days(c.start, c.end) > ANNUAL_MAX) continue;
        if (!Object.keys(c.dims).every(d => d === v.axis || d === QUALIFIER)) continue;
        keep.set(id, c);
      }
      if (!keep.size) continue;
      const facts = parseFacts(xml, id => keep.has(id));
      if (!facts.length) continue;
      const present = new Set([...keep.values()].map(c => c.dims[v.axis]));

      // One group per role that declares this axis. Where the linkbase is missing or declares none,
      // a single axis-wide group is the fallback — which is what shipped before roles were parsed,
      // and is right often enough that losing it would be worse than the double count it can carry.
      const groups = roles.filter(r => r.axes.has(v.axis) && r.members.some(m => present.has(m)))
        .map(r => ({ role: r.role, kids: r.kids,
          members: r.members.filter(m => present.has(m)),
          // Whatever the role declares that is NOT one of this filing's dimension members is a line
          // item of that table. Used to keep Apple's geographic revenue out of its geographic
          // long-lived-assets table, which shares all three of its members.
          concepts: new Set(r.members.filter(m => !present.has(m))) }));
      if (!groups.length) groups.push({ role: null, kids: new Map(), members: [...present], concepts: new Set() });

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
        const members = g.members.filter(m => !drop.has(m)).map(q => ({ q, label: nameOf(q) }));
        if (!members.length) continue;
        const mi = new Map(members.map((m, n) => [m.q, n]));

        const out = [];
        for (const f of facts) {
          const c = keep.get(f.ctx), m = mi.get(c.dims[v.axis]);
          if (m == null) continue;
          if (g.concepts.size && !g.concepts.has(f.tag)) continue;
          wantedTags.add(f.tag);
          out.push({ t: f.tag, m, p: periods.indexOf(c.end), v: f.val, u: f.unit,
            c: c.dims[QUALIFIER] ? c.dims[QUALIFIER].split(":").pop().replace(/Member$/, "") : null });
        }
        if (!out.length) continue;
        views.push({ id: v.id, axis: v.axis, role: g.role,
          title: v.title, source: g.role ? (roleNames[g.role] || null) : null,
          members, facts: out, subtotals: subtotals.map(nameOf) });
      }
    }

    // The consolidated value of every concept a view uses, from an UNDIMENSIONED context in the same
    // instance. This is what everything below reconciles against, and taking it from the same
    // document means there is no second source to disagree and no scaling question to get wrong.
    const plain = new Set();
    for (const [id, c] of ctxs) if (!c.n && !c.instant && c.start && periods.includes(c.end)) plain.add(id);
    const consolidated = {};
    for (const f of parseFacts(xml, id => plain.has(id))) {
      if (!wantedTags.has(f.tag)) continue;
      const end = ctxs.get(f.ctx).end;
      if (days(ctxs.get(f.ctx).start, end) < ANNUAL_MIN) continue;
      (consolidated[f.tag] = consolidated[f.tag] || {})[end] = f.val;
    }

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
    const TOL = 0.01;
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
    // Two tables can survive the gate with the same members and the same concepts — the same
    // breakdown reached through two roles. Keep the first, which is the filing's own order.
    const seenView = new Set(), out = [];
    for (const v of gated) {
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
