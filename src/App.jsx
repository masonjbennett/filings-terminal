import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import { SECTIONS, INDUSTRY, INDUSTRY_LABEL, COMPS_ROWS, COMPS_MEDIAN, EQUITY_DENOMINATED, CURRENCY_DENOMINATED } from "./template.js";
import { describeSplits, describeAligned } from "./extract.js";
import { buildGrid, sectionsFor, hasAnnualPeriods } from "./grid.js";
import { applyTickerFixes, PREDECESSOR } from "./tickerFixes.js";
import { impliedGrowth, sensitivity, pickBasis, dcfApplicable, REASONS, HORIZONS } from "./reverse.js";
import { NOT_APPLICABLE } from "./template.js";

// Paper & ink, same as masonjbennett.com — this is his tool and it should read as his.
const C = { paper:"#faf3ea", ink:"#262421", ink2:"#33302c", body:"#4a443c", mute:"#6f675c", faint:"#8a8072",
  hair:"#e3d5bf", hair2:"#efe4d2", card:"#fffdf9", teal:"#0d6d56", navy:"#1f5a9e", bronze:"#b0741e", claret:"#990f3d" };
const MONO = "'JetBrains Mono',ui-monospace,Consolas,monospace";
const SERIF = "'Instrument Serif','Palatino Linotype',Georgia,serif";
const SANS = "'Space Grotesk','Segoe UI',system-ui,sans-serif";

// Organised by STATEMENT, not by analysis. A DCF, an LBO and a comps set all run off the same
// revenue, EBITDA, capex and net debt, so tabbing by analysis would print the same twenty lines in
// four places under a taxonomy the data does not have. Bloomberg's FA splits I/S, B/S, C/F and
// Ratios for the same reason: the terminal is the source, the analysis happens in the model.
//
// Sections that are mostly judgement — LBO inputs, precedent transactions, premia — are deliberately
// NOT tabs. As rows inside a sheet they read as honest scope notes; as a tab with your name on it,
// four blank fields read as a tool that cannot do LBOs. They live in the footer instead.
const TABS = [
  { id: "statements", label: "Statements", secs: ["is", "bs", "cf", "sh"] },
  { id: "ratios", label: "Ratios", secs: ["margins", "credit", "returns"] },
  { id: "valuation", label: "Valuation", secs: ["debtlike", "addbacks", "dcf", "dilution"] },
  // Segments is not a slice of the template like the other three. It comes off a different data
  // path entirely — companyfacts carries no dimensional data at all — so it is fetched separately
  // and only when opened, because it costs a 1–17MB XBRL instance to answer.
  { id: "segments", label: "Segments", secs: [] },
];
const FOOTER_SECS = ["lbo", "pta", "premia"];

const fmtNum = (v, unit) => {
  if (v == null) return null;
  if (unit === "pure" || Math.abs(v) < 1000) return (Math.round(v * 100) / 100).toLocaleString();
  return Math.round(v).toLocaleString();
};
const fmtPct = v => (v == null ? null : (v * 100).toFixed(1) + "%");
const fmtX = v => (v == null ? null : v.toFixed(2) + "x");
// Yields are rates and read as percentages; valuation ratios are multiples and read with an x. Left
// out of these sets a number renders bare — a 3% FCF yield printed "0.03" and 26.7x EBITDA printed
// "26.74", which are the two figures most likely to be read off this page out loud.
const PCT = new Set(["grossMargin","ebitdaMargin","ebitMargin","netMargin","fcfMargin","taxRate","cashTaxRate","currentTaxRate","revGrowth","ebitdaGrowth","epsGrowth",
  // The CAGRs were missing from here for as long as they existed, and it never showed because they
  // were declared with a formula and never actually computed — a blank cannot be mis-formatted.
  // The moment comps made them real, Nvidia's 100% three-year CAGR rendered as "1".
  "revCagr3","revCagr5","roic","roe","roa","nwcPctRev","capexPctRev","daPctRev","sbcPctRev","fcfConv","debtCap","fcfYield","divYield",
  "efficiency","niiOnAssets","allowanceToLoans","provisionToLoans","depositsToAssets","equityToAssets",
  // Insurance. A combined ratio printed as "0.89" instead of "88.9%" is the single most likely
  // number on this page to be read out loud, so these matter more than the count suggests.
  "lossRatio","expenseRatio","combinedRatio","pyDevRatio","cededRatio","investmentYield",
  "benefitRatio","creditingRate","mlr","healthSgaRatio","premiumMix",
  "ffoPayout","noiMargin","accumDepPct","debtToGrossRE","compRatio","pretaxMargin","rote"]);
const MULT = new Set(["netLev","grossLev","intCover","fccr","debtEquity","currentRatio","quickRatio","assetTurn","evRev","evEbitda","evEbit","evFcf","pe","pb","loansToDeposits",
  "premiumLeverage","reserveLeverage"]);
const DAYS = new Set(["dso","dio","dpo","ccc","daysClaimsPayable"]);
const display = (k, v, unit) => v == null ? null : PCT.has(k) ? fmtPct(v) : MULT.has(k) ? fmtX(v) : DAYS.has(k) ? Math.round(v) + "d" : fmtNum(v, unit);

// Which Excel number format a value gets, shared by the single sheet's workbook and the comps set's.
// #,##0 would render an EPS of 7.32 as "7", so anything under a thousand — a per-share figure, a
// ratio, a count — takes decimals, the same rule fmtNum uses on screen. Except an exact zero, which
// is overwhelmingly a dollar line the filer reported as nil: "Preferred dividends 0.00" on a sheet
// denominated in billions reads as a broken export. `XF` is passed in rather than imported because
// xlsx.js is lazy-loaded, and it is named XF rather than S because the component already has an `S`
// holding the page's inline styles.
const styleFor = (XF, k, v) => PCT.has(k) ? XF.PCT : MULT.has(k) ? XF.MULT : DAYS.has(k) ? XF.DEC
  : (v != null && v !== 0 && Math.abs(v) < 1000 ? XF.DEC : XF.MONEY);

// Every FETCHED figure knows the accession number it came from, so every fetched figure can open
// it. The page claims in its header that each number is traceable to a filing; until now that was
// true but only provable through a hover tooltip, which is invisible on a phone, in a screenshot,
// and to anyone reading over a shoulder. The strongest claim on the page was the one thing a
// sceptical reader could not check.
//
// Per CELL rather than per column, and the distinction is not cosmetic: rule 2 takes the newest
// filing, so FY2019's figures usually come out of the FY2021 10-K, which restated them. There is no
// single "filing for this column" to link a header to — only a filing per value. A column-level
// link would be quietly wrong in exactly the cases a careful reader tests first.
// Lands on EDGAR's filing-detail page, not the raw directory. The directory always resolves and was
// the first version, but it is a wall of twenty filenames including .xsd and _cal.xml — unconvincing
// to exactly the sceptical reader this exists for. The `-index.htm` page names the form ("Form 10-K
// — Annual report"), the filing date, and the PERIOD OF REPORT, which is the column the reader just
// clicked from, with the document itself one click away. EDGAR generates it for every electronic
// filing, and this tool only ever handles XBRL-era ones.
const secFilingUrl = (cik, accn) =>
  cik && accn
    ? `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${String(accn).replace(/-/g, "")}/${accn}-index.htm`
    : null;

// The cell is nowrap so a label and its status chip stay on one line, and white-space INHERITS — so
// a note was forced onto one line too and set the width of the whole sticky column. Apple's is
// 303px; the insurance notes took Progressive's to 503px and pushed three year columns off the right
// edge of an 8-year sheet. Wrapping inside a fixed measure caps the damage for any note ever added,
// not just the ones that exist today, which is why this is shared rather than written per note.
const NOTE_STYLE = { fontSize: 9, color: "#8a8072", fontStyle: "italic", marginTop: 2, whiteSpace: "normal", maxWidth: 290, lineHeight: 1.4 };

// One stylesheet instead of ~1,300 pairs of inline hover handlers — the sheet is 168 lines by 8
// columns and every cell is a candidate. Restraint is deliberate: underlining a thousand numbers
// would wreck the paper-and-ink page, so a source link is invisible until the cursor asks for it.
const CELL_CSS = `
.srcnum { color: inherit; text-decoration: none; cursor: pointer; border-bottom: 1px dotted transparent; }
.srcnum:hover { color: ${"#0d6d56"}; border-bottom-color: ${"#0d6d5666"}; }
`;

export default function App() {
  const [tickers, setTickers] = useState(null);
  const [q, setQ] = useState("");
  const [co, setCo] = useState(null);          // { cik, ticker, title }
  const [data, setData] = useState(null);      // /api/facts payload
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [sections, setSections] = useState(null); // rendered-statement links for the newest 10-K
  const [copied, setCopied] = useState("");
  // How far in the sticky label column ends, but ONLY while the sheet is scrolled — the x at which a
  // clipped cell needs to be marked. 0 means "nothing is hidden, draw nothing". See `syncEdge`.
  const [edge, setEdge] = useState(0);
  const [tab, setTab] = useState("statements");
  const [quote, setQuote] = useState(null);
  const [quoteNote, setQuoteNote] = useState("");
  const [comps, setComps] = useState([]);      // [{ ticker, title, grid, quote, loading, err }]
  // One member of the set, opened on its own. The set stays in state rather than being torn down,
  // because "open this column's sheet" and "throw away the six companies I just assembled" are not
  // the same instruction — the way back is a button, not a re-typed list.
  const [solo, setSolo] = useState(null);
  const [segs, setSegs] = useState(null);      // { loading } | { err } | payload from /api/segments
  const scroller = useRef(null);

  useEffect(() => { fetch("/tickers.json").then(r => r.json()).then(rows => setTickers(applyTickerFixes(rows))).catch(() => setErr("couldn't load the company list")); }, []);

  // Client-side search over 10,387 companies — the whole map is 432KB and ships once, so there is
  // no round trip and no serverless call just to turn "APPLE" into a CIK.
  const hits = useMemo(() => {
    if (!tickers || q.trim().length < 1) return [];
    const s = q.trim().toUpperCase();
    const exact = [], starts = [], contains = [];
    for (const [cik, tic, title] of tickers) {
      if (tic === s) exact.push([cik, tic, title]);
      else if (tic.startsWith(s) || title.toUpperCase().startsWith(s)) starts.push([cik, tic, title]);
      else if (title.toUpperCase().includes(s)) contains.push([cik, tic, title]);
      if (exact.length + starts.length + contains.length > 400) break;
    }
    return [...exact, ...starts, ...contains].slice(0, 8);
  }, [tickers, q]);

  // The facts lookup with its predecessor fallback, shared by the single sheet and by comps. Shared
  // rather than copied because the fallback is the kind of rule that gets fixed in one caller and
  // left broken in the other — comps would then render an empty column for Exxon.
  const fetchFacts = async (cik, ticker) => {
    const r = await fetch(`/api/facts?cik=${cik}`);
    let d = await r.json(), ok = r.ok, usedCik = cik;
    // A holding-company reorganisation leaves the ticker pointing at an entity that has filed
    // nothing, and the sheet comes out empty — see PREDECESSOR. The fallback runs off the DATA rather
    // than off the table: only a lookup that produced no annual periods triggers a second one, so the
    // day the successor files its own 10-K this stops firing by itself instead of pinning the ticker
    // to stale predecessor figures until someone reviews the list.
    //
    // The !ok half is not defensive padding: an entity that has never filed has no companyfacts
    // document at all, and data.sec.gov answers 404. CBAT's successor is exactly that, so gating the
    // retry on a successful response would have skipped the one case with nothing to show.
    if ((!ok || !hasAnnualPeriods(d)) && PREDECESSOR[ticker]) {
      const p = PREDECESSOR[ticker];
      try {
        const r2 = await fetch(`/api/facts?cik=${p.cik}`);
        const d2 = await r2.json();
        if (r2.ok && hasAnnualPeriods(d2)) { d = d2; ok = true; usedCik = p.cik; }
      } catch {}
    }
    // WHICH SYMBOL TO PRICE THIS FILER WITH — decided here for the same reason the fallback above
    // is: both callers need it, and the comment three lines up is the record of what happens when a
    // rule like this lives in one of them.
    //
    // The filer's OWN ticker list, and no fallback to the string the reader typed. That fallback is
    // how **Paramount Global came to be priced at $1.00**. SEC released PARA when Paramount became
    // PSKY and reassigned it to Banzai International, a sub-dollar microcap; `public/tickers.json` is
    // a snapshot and still points PARA at Paramount's CIK 813828 — whose own submissions file now
    // lists NO ticker — while Finnhub quotes the company holding the symbol today. The page printed
    // Paramount's $29.2bn of revenue beside a **P/E of −0.11x built from Banzai's price and
    // Paramount's −$9.34 EPS**: two companies in one ratio, under a header promising every figure is
    // the value the company filed. README rule 10's own worst case — "points a ticker at another
    // company's financials" — reached through snapshot staleness rather than a bad tickerFixes entry,
    // which is why nothing in that rule caught it.
    //
    // A filer that lists no ticker of its own is quotable ONLY through PREDECESSOR, where the
    // redirect is deliberate and evidence-backed and the typed ticker really does belong to the same
    // company: Exxon's history sits under CIK 34088, which carries no ticker, and quoting XOM against
    // it is right. `usedCik !== cik` is how that path announces itself.
    //
    // Measured over the 160-filer sweep: **158 list the ticker that was typed, 2 list none (XOM and
    // PARA — one of each case), and 0 list tickers without the typed one among them.** Against SEC's
    // current map, exactly 3 of 10,387 local tickers now point at a different CIK: PARA (a different
    // company), REAX (a reorganisation) and SMHD (an ETN that changed issuer).
    const sym = (d.tickers && d.tickers[0]) || (String(usedCik) !== String(cik) ? ticker : null);
    return { ok, d, usedCik, sym };
  };

  // Fetched on demand, once per company, because answering it costs SEC an XBRL instance of up to
  // 17MB — Apple's is 1.4MB and JPMorgan's 14.9MB. A reader who never opens the tab pays nothing,
  // which is the same reason xlsx.js is lazy-imported.
  useEffect(() => {
    if (tab !== "segments" || !data || !data.cik || segs) return;
    setSegs({ loading: true });
    fetch(`/api/segments?cik=${data.cik}`)
      .then(async r => { const j = await r.json(); setSegs(r.ok ? j : { err: j.error || "that lookup failed" }); })
      .catch(() => setSegs({ err: "couldn't reach the filing desk" }));
  }, [tab, data, segs]);

  const load = async (cik, ticker, title) => {
    setCo({ cik, ticker, title }); setQ(""); setErr(""); setBusy(true); setData(null); setSections(null); setQuote(null); setQuoteNote(""); setSegs(null);
    // The sheet becomes a URL you can send to someone. Until now every lookup lived only in the
    // session that made it — "here is Chubb's combined ratio, check the filings yourself" was not
    // something you could paste into an email. replaceState rather than pushState so the back
    // button still leaves the terminal instead of walking back through a search history.
    if (ticker) try { history.replaceState(null, "", `?t=${encodeURIComponent(ticker)}`); } catch {}
    try {
      const { ok, d, usedCik, sym } = await fetchFacts(cik, ticker);
      if (!ok) { setErr(d.error || "that lookup failed"); setBusy(false); return; }
      setData(d);
      const k10 = (d.filings || []).find(f => f.form === "10-K");
      if (k10) fetch(`/api/sections?cik=${usedCik}&accn=${k10.accn}`).then(r => r.json()).then(setSections).catch(() => {});
      // No symbol means the filing record carries no ticker for this company, which has to be SAID —
      // left silent the valuation rows read "needs price", and rule 5's whole complaint is that the
      // wrong kind of blank sends a reader looking for the wrong thing. Here they would go hunting a
      // quote for a company whose ticker now belongs to somebody else.
      if (!sym) setQuoteNote("SEC's filing record for this company lists no ticker, so there is no symbol to price it with — the one you typed may now belong to a different company.");
      // The price is a nice-to-have on top of the filings, so it never blocks the sheet and never
      // fails it: no key, no coverage, no answer — the valuation rows just stay "needs price".
      if (sym) fetch(`/api/quote?symbol=${encodeURIComponent(sym)}`).then(async r => {
        const q = await r.json();
        if (r.ok) setQuote(q);
        else setQuoteNote(q.needsKey ? "valuation rows need FINNHUB_KEY on this deployment" : q.error || "no quote available");
      }).catch(() => setQuoteNote("couldn't reach the quote desk"));
    } catch { setErr("couldn't reach the filing desk"); }
    setBusy(false);
  };

  // ── Comps ────────────────────────────────────────────────────────────────────────────────────
  // Every metric a comps set needs already exists on the single sheet and is produced by the same
  // engine, so this adds a second FETCH PATH and a column-per-company layout, nothing else. In
  // particular the industry overlays carry straight over: a bank in the set has no EV/EBITDA because
  // NOT_APPLICABLE.bank says so, not because comps decided.
  const addComp = async ticker => {
    const t = String(ticker || "").trim().toUpperCase();
    if (!t || comps.some(c => c.ticker === t)) return;
    const row = (tickers || []).find(([, x]) => x === t);
    if (!row) { setErr(`no filer with the ticker "${t}"`); return; }
    setQ(""); setErr("");
    // Placeholder first so the column appears immediately and the set reads as loading rather than
    // as broken — a comps fetch is two round trips per company and they are not instant.
    setComps(cs => [...cs, { ticker: t, title: row[2], loading: true }]);
    let entry;
    try {
      const { ok, d, sym } = await fetchFacts(row[0], t);
      if (!ok) entry = { ticker: t, title: row[2], err: d.error || "lookup failed" };
      else {
        // Unlike the single sheet, comps AWAITS the price: the multiples are most of the point, and a
        // table that reflows as six quotes land one by one is worse than one that arrives whole.
        // The symbol comes from `fetchFacts` rather than being rebuilt here — a set is the one place
        // a mispriced column sits beside correct ones under a shared median, so the Paramount/Banzai
        // mismatch would be harder to see, not easier.
        let quote = null;
        try {
          if (!sym) throw new Error("no ticker on file");
          const qr = await fetch(`/api/quote?symbol=${encodeURIComponent(sym)}`);
          const qj = await qr.json();
          if (qr.ok) quote = qj;
        } catch {}
        // Whether this filer files quarterly reports at all decides what a carried LTM column can
        // honestly say about itself: "nothing filed since the year end" promises a 10-Q that a 20-F
        // filer will never file. Nine of the 180 cached filers have never filed one.
        entry = { ticker: t, title: d.name || row[2], grid: buildGrid(d, quote), quote, interim: (d.filings || []).some(f => /^10-Q/.test(f.form)) };
      }
    } catch { entry = { ticker: t, title: row[2], err: "couldn't reach the filing desk" }; }
    setComps(cs => cs.map(c => (c.ticker === t ? entry : c)));
  };

  // The set is a URL, exactly as a single sheet is: /?c=AAPL,MSFT,NVDA opens it for whoever you send
  // it to. replaceState for the same reason as ?t= — the back button should leave the terminal
  // rather than walk back through every ticker that was added.
  // Skipped while a member is open on its own, or the address bar would advertise the set while the
  // page shows one company — and that is the URL someone copies.
  const setUrl = () => { try { history.replaceState(null, "", `?c=${comps.map(c => c.ticker).join(",")}`); } catch {} };
  useEffect(() => { if (comps.length && !solo) setUrl(); }, [comps, solo]);

  // Open one company from the set as a full sheet. `load` writes ?t= and fetches; `solo` is what
  // makes the sheet render in front of a set that is still there.
  const openSolo = ticker => {
    const row = (tickers || []).find(([, t]) => t === ticker);
    if (!row) return;
    setSolo(ticker);
    load(row[0], row[1], row[2]);
  };

  // Opening ?t=CB loads Chubb before anyone types. Runs once, and only once the company list has
  // arrived — the ticker has to be resolved to a CIK locally, which is the same lookup the search
  // box does. An unknown ticker is left alone rather than shouted about: the search box is right
  // there, and a mistyped share link should land on a usable page, not an error.
  const deepLoaded = useRef(false);
  useEffect(() => {
    if (!tickers || deepLoaded.current) return;
    const params = new URLSearchParams(location.search);
    const set = params.get("c");
    if (set) {
      deepLoaded.current = true;
      // Sequential, not Promise.all: SEC caps at 10 requests/second and each company here is two
      // round trips through our own functions. A six-name set fired at once is the kind of thing
      // that gets an IP throttled, and the columns appear as they land anyway.
      (async () => { for (const t of set.split(",").map(x => x.trim()).filter(Boolean).slice(0, 8)) await addComp(t); })();
      return;
    }
    const want = params.get("t");
    // `&tab=valuation` lands a shared link on the tab it was sent about — the main site's Work Index
    // links straight to the reverse DCF this way. Unknown values are ignored rather than erroring.
    const tb = params.get("tab");
    if (tb && TABS.some(x => x.id === tb)) setTab(tb);
    if (!want) return;
    deepLoaded.current = true;
    const s = want.trim().toUpperCase();
    const row = tickers.find(([, tic]) => tic === s);
    if (row) load(row[0], row[1], row[2]);
    else setErr(`no filer with the ticker "${s}" — try the search box`);
  }, [tickers]);

  // ── Build the grid ───────────────────────────────────────────────────────────────────────────
  // SIC decides the shape of the sheet. Everything downstream — which sections exist, which lines
  // are marked inapplicable — hangs off this one value, so it is read from SEC's own classification
  // rather than inferred from the data. The build itself lives in grid.js, so comps can run it once
  // per company and the offline harness can test the code that actually ships.
  const industry = data ? INDUSTRY(data.sicCode) : "corporate";
  const activeSections = useMemo(() => sectionsFor(industry), [industry]);

  const grid = useMemo(() => buildGrid(data, quote), [data, quote]);

  // After the grid paints, jump to the newest year — but NOT when the table almost fits, which is the
  // case that produced a wrong-looking number on the front page of every large filer.
  //
  // The two edges of this scroller are not symmetric, and that asymmetry is the whole argument. The
  // RIGHT edge is the container boundary: a column cut there runs into open space with a scrollbar
  // under it, and reads as cut. The LEFT edge is the sticky label column, which is opaque and painted
  // ON TOP — a column cut there looks like a column that simply starts there. So the surviving digits
  // of $927,252,000 rendered as `2,000`, in a row beside $858,557,000, on CBL's FY2017. Measured at
  // 1500px: `scrollWidth − clientWidth` is 71px against a ~120px column, and `scrollLeft` was 70.4.
  //
  // So: scroll only when the overflow is at least a column wide. Then the oldest columns are fully
  // off-screen rather than half-hidden — genuinely absent, which no reader misreads — and the jump
  // still does its job on a narrow window or a phone, where it matters most. Measured against the
  // rendered column rather than a constant, because the width depends on the figures in it.
  //
  // THIS DOES NOT COVER EVERY CASE, and the gap is worth knowing before anyone calls it done. Where
  // the overflow sits BETWEEN one and two column widths the sheet still scrolls and still leaves a
  // partial column under the label: Apple is 190px of overflow against a 135px column at every
  // desktop width (the page has a max width, so the overflow does not shrink), and its FY2019 revenue
  // renders as `'4,000,000` — the tail of 260,174,000,000.
  //
  // Snapping to a column boundary instead was considered and is WORSE, which is why it is not here:
  // it would put Apple's scroll at 135 and clip 55px off the RIGHT of FY2025, trading a truncated
  // oldest column for a truncated newest one — the column the valuation card divides into. There is
  // no scroll position that shows every column whole, so closing the rest of this needs the other
  // fix: masking the strip beside the sticky label so a clipped cell reads as clipped. That is a
  // change to how the table looks rather than to when it scrolls, and it is in the README's Next.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const overflow = el.scrollWidth - el.clientWidth;
    if (overflow <= 0) return;
    const firstYear = el.querySelector("thead th:nth-child(2)");
    const colW = firstYear ? firstYear.getBoundingClientRect().width : 0;
    if (overflow >= colW) el.scrollLeft = el.scrollWidth;
    syncEdge();
  }, [data, tab]);

  // The mask has to live OUTSIDE the table. The obvious version — a box-shadow on the sticky label
  // cell — is inert here, and that was established rather than assumed: these tables are
  // `border-collapse: collapse`, where a sticky cell paints at `z-index: auto` and every cell after it
  // in the row paints on top, so an 18px SOLID RED shadow rendered as nothing at all. `z-index: 1` did
  // not change it. Fixing that at the source means `border-collapse: separate`, which re-renders every
  // hairline on every table on the site, and the last change to this column's geometry pushed three
  // year-columns off an eight-year sheet.
  //
  // So the strip is a sibling of the scroller rather than anything inside the table: absolutely
  // positioned in a wrapper that does not scroll, at the x where the label ends, painting over
  // whatever slides under it. Measured from the rendered header cell because the label column is
  // content-sized, and only while `scrollLeft > 0`, because with nothing hidden there is nothing to
  // say and a permanent gradient would just be decoration.
  const syncEdge = () => {
    const el = scroller.current;
    const th = el && el.querySelector("thead th");
    setEdge(el && th && el.scrollLeft > 0 ? th.getBoundingClientRect().width : 0);
  };

  const sectionLink = kind => {
    if (!sections || !sections.reports) return null;
    const r = sections.reports.find(x => (x.kinds || []).includes(kind));
    return r ? r.url : (sections.index || null);
  };
  // Overlay sections declare their own `kind`, which is what makes the "open this statement ↗" link
  // appear for them. It matters most exactly where the overlay fails: Berkshire is SIC 6331 and
  // tags not one insurance concept, so its Underwriting section is entirely blank — and a blank
  // section with a link to the filed income statement is a useful answer, while a blank section
  // without one looks like the tool broke.
  const kindFor = sec => sec.kind || (sec.id === "is" || sec.id === "addbacks" ? "is" : sec.id === "bs" || sec.id === "debtlike" ? "bs" : sec.id === "cf" ? "cf" : sec.id === "dilution" ? "sbc" : sec.id === "dcf" ? "tax" : null);

  // The whole workbook, not the visible tab. Every free competitor shows financials and paywalls
  // getting them OUT — that is the standard business model in this category, and it is the part a
  // finance reader actually needs, because nobody analyses on a website. This is the differentiator,
  // so it exports all three tabs at once with real number formats rather than a CSV dump.
  //
  // The writer is lazy-imported: it and fflate are ~10KB, but nobody who is only reading should pay
  // for them on first paint. Same pattern the main site uses for sql.js in the Query Drill.
  const downloadWorkbook = async () => {
    // A filer with no annual XBRL periods renders the "no periods on file" note and has nothing to
    // export. Returning silently would leave the button looking broken rather than empty.
    if (!grid || !grid.cols || !grid.cols.length) { setCopied("Nothing to export — no annual periods"); setTimeout(() => setCopied(""), 4000); return; }
    setCopied("Building workbook…");
    try {
      // `XF` rather than `S`: the component already has an `S` holding the page's inline styles, and
      // a second one meaning "cell format" inside this function is how the wrong one gets used.
      const { downloadXlsx, S: XF } = await import("./xlsx.js");
      const tic = (data.tickers || [])[0] || (co && co.ticker) || "";
      const newest = grid.cols[grid.cols.length - 1];
      const sheetFor = tabId => {
        const secs = activeSections.filter(s => TABS.find(t => t.id === tabId).secs.includes(s.id) || s.tab === tabId);
        // The page lifts the EV bridge OUT of the year grid into a card above the tabs: there is one
        // price, so it fills one column, and a table row of seven blanks buried the only real value
        // off the right-hand edge of the scroll. A workbook has no such problem — a figure under the
        // newest year with the earlier years empty is how every model on earth reads — and an export
        // that silently dropped enterprise value and EV/EBITDA would be missing the two numbers a
        // banker looks for first. So it is appended here rather than added to TABS, which would put
        // it back on the page. Only when a price actually arrived: with no FINNHUB_KEY every line is
        // null, and eleven blank rows read as a broken export rather than an absent input.
        if (tabId === "valuation" && quote && quote.price) {
          const ev = SECTIONS.find(s => s.id === "ev");
          if (ev) secs.push(ev);
        }
        const rows = [
          [{ v: data.name, s: XF.TITLE }],
          [{ v: `${(data.tickers || []).join(" · ")}${data.sic ? " · " + data.sic : ""}`, s: XF.MUTED }],
          [{ v: `Reported figures from SEC filings · generated ${new Date().toISOString().slice(0, 10)} · filings.masonjbennett.com/?t=${tic}`, s: XF.MUTED }],
          // The currency has to travel WITH the file. On the page it is stated once at the top; a
          // workbook leaves the page behind, gets renamed, and lands in a model beside dollar columns
          // — which is the same argument that puts the EV bridge's price and year on a row of their
          // own down there. Only when it is not USD, for the same reason the page keeps quiet then.
          ...(grid.ccy && grid.ccy !== "USD"
            ? [[{ v: `All figures in ${grid.ccy}, as filed — not converted to USD`, s: XF.MUTED }]] : []),
          [],
          [{ v: "Line item", s: XF.BOLD }, ...grid.cols.map(c => ({ v: `FY${c.period.fy}`, s: XF.BOLD }))],
          // A 53-week year travels with the file, on the row that names the period, because the
          // workbook is where a growth rate gets used and it has no column header to mark.
          [{ v: "Period end", s: XF.MUTED }, ...grid.cols.map(c => ({ v: c.period.end + (c.period.weeks53 ? " (53 weeks)" : ""), s: XF.MUTED }))],
        ];
        // The freeze has to be COUNTED, not written down. It was `y: 6` — correct for the six header
        // rows that existed when it was written, and wrong the moment the currency row above made the
        // header seven for a non-USD filer, which would leave "Period end" inside the frozen data area
        // as text in a column Excel is treating as numeric. That is not hypothetical: it is exactly
        // what the Excel check caught on the comps workbook when a seventh row put company names below
        // the split. A conditional header row and a hardcoded freeze cannot both be right.
        const headerRows = rows.length;
        for (const sec of secs) {
          rows.push([]);
          rows.push([{ v: sec.title, s: XF.BOLD }]);
          // Rule 31: a share-basis change travels with the file, on the section it applies to. The
          // workbook has no cell marker and no tooltip, so the sentence goes in column A above the rows.
          if (sec.id === "sh" && grid.splits && grid.splits.length) rows.push([{ v: `Per-share figures and share counts filed before the ${describeSplits(grid.splits)} are shown on today's share basis; the filings carry them as reported.`, s: XF.MUTED }]);
          // Rule 32, the same way: which columns' balance-sheet totals were read from one filing, and which.
          if (sec.id === "bs" && describeAligned(grid.cols)) rows.push([{ v: describeAligned(grid.cols), s: XF.MUTED }]);
          // Said on its own row, because a spreadsheet has no tooltip and no card header to carry it:
          // these are today's price against the newest year, not a time series. In column A, not
          // beside the title — a year column has to stay numeric all the way down, or the first
          // reader to select it gets a count where they expected a sum.
          if (sec.id === "ev") rows.push([{ v: `$${quote.price.toFixed(2)} today against FY${newest.period.fy} (${newest.period.end}) — newest column only`, s: XF.MUTED }]);
          for (const line of sec.lines) {
            // Judgement lines are blank by design and say so on the page; a blank row in a
            // spreadsheet just looks like the export failed.
            if (line.how === "manual") continue;
            rows.push([{ v: line.label }, ...grid.cols.map(c => ({ v: c.v[line.k], s: styleFor(XF, line.k, c.v[line.k]) }))]);
          }
        }
        return { name: TABS.find(t => t.id === tabId).label, rows,
          widths: [46, ...grid.cols.map(() => 18)], freeze: { x: 1, y: headerRows } };
      };
      // Segments is deliberately not a sheet here. It is not a slice of `grid` like the other three —
      // it comes off a different filing and has its own row set per table, so building it from
      // `activeSections` would produce an empty sheet, which is how an export looks broken.
      downloadXlsx(TABS.filter(t => t.secs.length).map(t => sheetFor(t.id)), `${tic || "filings"}-financials.xlsx`);
      setCopied("Workbook downloaded");
    } catch (e) {
      setCopied("Export failed — " + String((e && e.message) || e).slice(0, 60));
    }
    setTimeout(() => setCopied(""), 4000);
  };

  // Copies the tab you are looking at, not all 168 lines. Kept alongside the download because the
  // two are different jobs: the workbook is the file you keep, this is the block you are working in
  // going straight into a model that is already open.
  const copyTsv = () => {
    // The segments tab has its own shape — several tables, each with its own rows and its own three
    // periods — so it is copied from the payload rather than from the grid.
    if (tab === "segments") {
      if (!segs || !segs.views) return;
      const out = [];
      for (const v of segs.views) {
        out.push([v.source || v.title, ...segs.periods].join("\t"));
        for (const t of v.concepts) {
          out.push(segs.conceptLabels[t] || t);
          // A reconciling row is marked here too. The page distinguishes it with a chip, and a copy
          // that drops the distinction hands someone a column of segments with a corporate line
          // hidden among them — the same mistake as the comps table throwing away a blank's status.
          for (const [mi, m] of v.members.entries())
            out.push([m.label + (m.recon ? " (reconciling item)" : ""),
              ...segs.periods.map((_, pi) => { const f = v.facts.find(x => x.t === t && x.m === mi && x.p === pi); return f ? f.v : ""; })].join("\t"));
          out.push(["Consolidated", ...segs.periods.map(p => (segs.consolidated[t] || {})[p] ?? "")].join("\t"));
        }
        out.push("");
      }
      navigator.clipboard.writeText(out.join("\n")).then(() => { setCopied("Copied — paste into Excel"); setTimeout(() => setCopied(""), 3000); })
        .catch(() => setCopied("Clipboard blocked by the browser"));
      return;
    }
    if (!grid || !grid.cols) return;
    const secs = activeSections.filter(s => (TABS.find(t => t.id === tab).secs).includes(s.id) || s.tab === tab);
    const out = [["Line item", ...grid.cols.map(c => c.period.end + (c.period.weeks53 ? " (53 weeks)" : ""))].join("\t")];
    for (const sec of secs) {
      out.push(sec.title);
      for (const line of sec.lines) {
        if (line.how === "manual" || line.how === "market") continue;
        out.push([line.label, ...grid.cols.map(c => { const v = c.v[line.k]; return v == null ? "" : (PCT.has(line.k) || MULT.has(line.k) ? v : Math.round(v * 100) / 100); })].join("\t"));
      }
    }
    // Rule 31 travels with the paste too: a trailing line, since a TSV has no cell marker either.
    if (grid.splits && grid.splits.length) out.push(`Per-share figures and share counts filed before the ${describeSplits(grid.splits)} are shown on today's share basis; the filings carry them as reported.`);
    if (describeAligned(grid.cols)) out.push(describeAligned(grid.cols));
    navigator.clipboard.writeText(out.join("\n")).then(() => { setCopied("Copied — paste into Excel"); setTimeout(() => setCopied(""), 3000); })
      .catch(() => setCopied("Clipboard blocked by the browser"));
  };

  const S = {
    page: { background: C.paper, minHeight: "100vh", color: C.body, fontFamily: SANS, fontSize: 15 },
    wrap: { maxWidth: 1180, margin: "0 auto", padding: "0 24px 80px" },
    label: { fontSize: 9, fontFamily: MONO, letterSpacing: 2, textTransform: "uppercase", color: C.faint },
  };

  return <div style={S.page}>
    <style>{CELL_CSS}</style>
    <div style={{ height: 6, background: C.ink }} /><div style={{ height: 2, background: C.teal }} />
    <div style={S.wrap}>
      <header style={{ padding: "26px 0 20px", borderBottom: `1px solid ${C.hair}`, marginBottom: 22 }}>
        <div style={{ ...S.label, color: C.teal, marginBottom: 8 }}>masonjbennett.com · Filings Terminal</div>
        <h1 style={{ font: `400 34px/1.1 ${SERIF}`, color: C.ink, letterSpacing: "-.015em", margin: "0 0 8px" }}>Reported financials, straight from EDGAR</h1>
        <p style={{ fontSize: 13, color: C.mute, maxWidth: 620, lineHeight: 1.6, margin: 0 }}>
          Every figure below is the value the company filed with the SEC, traceable to the accession number it came from.
          Nothing is estimated and nothing is written by a model.
        </p>
      </header>

      {/* ── Search ── */}
      <div style={{ position: "relative", marginBottom: 22 }}>
        {/* Ticker leads, and the examples follow the same order. It is what the search actually
            privileges — an exact ticker hit is ranked first — and it is the unambiguous input:
            "Apple" matches three filers, AAPL matches one. */}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={tickers ? "Ticker or company name — try AAPL, or Apple" : "Loading company list…"} disabled={!tickers}
          style={{ width: "100%", background: C.card, border: `1px solid ${C.hair}`, borderRadius: 10, padding: "13px 16px", fontSize: 15, fontFamily: MONO, color: C.ink2, outline: "none" }} />
        {hits.length > 0 && <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20, marginTop: 4, background: C.card, border: `1px solid ${C.hair}`, borderRadius: 10, overflow: "hidden", boxShadow: "0 12px 34px rgba(64,52,32,.13)" }}>
          {/* With a comps set open the search box ADDS rather than replaces: having built a set, the
              next thing anyone types is another name for it, and swapping the whole page out for a
              single sheet would throw the set away without asking. */}
          {hits.map(([cik, tic, title]) => <button key={cik + tic} onClick={() => (solo ? openSolo(tic) : comps.length ? addComp(tic) : load(cik, tic, title))}
            style={{ display: "flex", gap: 12, alignItems: "baseline", width: "100%", padding: "10px 15px", background: "none", border: "none", borderBottom: `1px solid ${C.hair2}`, cursor: "pointer", textAlign: "left", fontFamily: SANS }}
            onMouseEnter={e => e.currentTarget.style.background = "#0d6d5608"} onMouseLeave={e => e.currentTarget.style.background = "none"}>
            <span style={{ font: `600 12px ${MONO}`, color: C.teal, minWidth: 62 }}>{tic}</span>
            <span style={{ fontSize: 13.5, color: C.ink2 }}>{title}</span>
          </button>)}
        </div>}
      </div>

      {err && <p style={{ color: C.claret, fontFamily: MONO, fontSize: 12 }}>{err}</p>}
      {busy && <p style={{ color: C.faint, fontFamily: MONO, fontSize: 12 }}>Reading EDGAR…</p>}

      {comps.length > 0 && !solo && <CompsTable comps={comps} S={S} onOpen={openSolo}
        onRemove={t => setComps(cs => cs.filter(c => c.ticker !== t))}
        onClear={() => { setComps([]); try { history.replaceState(null, "", location.pathname); } catch {} }} />}

      {/* The way back out of a sheet opened from a set. Above the company name rather than beside it,
          because it is a change of view and not another action on this company. */}
      {solo && comps.length > 0 && <button onClick={() => { setSolo(null); setUrl(); }}
        style={{ background: "none", border: `1px solid ${C.hair}`, borderRadius: 8, padding: "6px 12px", marginBottom: 12, color: C.teal, font: `600 10px ${MONO}`, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}>
        ← Back to the set of {comps.length}</button>}

      {(!comps.length || solo) && data && grid && <>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap", marginBottom: 6 }}>
          <h2 style={{ font: `400 26px/1.2 ${SERIF}`, color: C.ink, margin: 0 }}>{data.name}</h2>
          <span style={{ font: `600 12px ${MONO}`, color: C.teal }}>{(data.tickers || []).join(" · ")}</span>
          <span style={{ fontSize: 11, color: C.faint }}>{data.sic}</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {/* Download leads and is the filled button: the whole workbook is what a reader wants,
                and it is the thing every free competitor charges for. Copy stays for the case where
                you only want the tab in front of you pasted straight into an open model. */}
            <button onClick={downloadWorkbook} style={{ background: `${C.teal}0e`, border: `1px solid ${C.teal}55`, borderRadius: 8, padding: "7px 14px", color: C.teal, font: `600 10px ${MONO}`, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}>↓ Download Excel workbook</button>
            <button onClick={copyTsv} style={{ background: "none", border: `1px solid ${C.hair}`, borderRadius: 8, padding: "7px 14px", color: C.mute, font: `600 10px ${MONO}`, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}>Copy {TABS.find(t => t.id === tab).label}</button>
            {/* The way into comps. Starting from a company you are already looking at is the natural
                move — you find one name, then ask who it trades against — and it saves retyping the
                ticker that is on screen. */}
            <button onClick={() => addComp(co && co.ticker ? co.ticker : (data.tickers || [])[0])}
              style={{ background: "none", border: `1px solid ${C.hair}`, borderRadius: 8, padding: "7px 14px", color: C.mute, font: `600 10px ${MONO}`, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}>+ Compare</button>
          </div>
        </div>
        <p style={{ fontSize: 11, color: C.faint, fontFamily: MONO, marginBottom: 18 }}>
          {data.meta.tagsKept} tagged concepts kept · {data.meta.tagsDropped} outside the template · {(data.filings || []).length} filings on file
          {/* The instruction manual for the click-through, placed beside the claim it proves rather
              than in a footer. A sceptical reader forms the doubt AT a number, not at a bibliography
              168 rows below it, so this sits at the top and the proof itself sits in the cell. */}
          <span style={{ color: C.ink2, marginLeft: 12 }}>· click any reported figure to open the filing it came from</span>
          {/* A figure with no currency on it is a claim that it is dollars, and for 45 of the 426
              filers swept that claim is false — ASML's revenue is €32.67bn and rendered in exactly
              the typography a dollar figure gets. Said once, at the top, rather than on 279 rows:
              a sheet has one reporting currency by construction now (see `reportingCurrency`), so
              one statement covers all of it. USD is left unsaid because it is the default a reader
              already assumes and marking it would train the eye to ignore the marker. */}
          {grid && grid.ccy && grid.ccy !== "USD" &&
            <span style={{ color: C.bronze, marginLeft: 12 }}>· every figure below is in <b>{grid.ccy}</b>, as filed — not converted</span>}
          {quote && <span style={{ color: C.teal, marginLeft: 12 }}>${quote.price.toFixed(2)} — valuation on the newest year only, one price to divide with</span>}
          {quoteNote && <span style={{ color: C.bronze, marginLeft: 12 }}>{quoteNote}</span>}
          {copied && <span style={{ color: C.teal, marginLeft: 12 }}>{copied}</span>}
        </p>

        {/* Named all three causes after the sweep found Exxon rendering empty under a message that
            confidently blamed the first one. A wrong diagnosis is worse than none here: it sends the
            reader away believing the data does not exist, when for a holdco reorganisation it exists
            in full under the predecessor's CIK. The EDGAR link is the way to check in one click. */}
        {grid.empty && <p style={{ color: C.bronze, fontFamily: MONO, fontSize: 12 }}>
          No annual XBRL periods on file. That usually means the filer reports under IFRS (20-F), predates tagging,
          or is a newly registered holding company whose history sits under a predecessor CIK.{" "}
          <a href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${Number(data.cik)}&type=10-K`}
            target="_blank" rel="noopener noreferrer" style={{ color: C.teal }}>check this CIK's filings on EDGAR ↗</a>
        </p>}

        {/* The empty sheet above says the data is not here. This says something worse and quieter:
            the data IS here, it foots, it reconciles, and it is about a different decade. National
            Steel's us-gaap facts stop at 2009 because every 20-F since is IFRS, so the terminal
            rendered FY2007–FY2009 for a company with a 2025 annual report on file — the exact failure
            rule 6 exists to prevent, reached by a route rule 6 cannot see.

            It goes ABOVE the valuation card rather than beside the year headers, because a reader who
            does not notice it will divide today's share price into a sixteen-year-old profit. Loud,
            once, at the top. The claim is only what is known — an annual report exists for a period
            these figures do not cover — with the usual cause named as a cause rather than a verdict. */}
        {/* Three forms can reach this banner and they do not mean the same thing, so it does not say
            the same thing. It shipped worded for the case that produced it — a foreign issuer that
            moved to IFRS — and once api/facts.js stopped dropping transition reports it began firing
            on eleven filers whose newest report is a 10-KT. "An annual report ... for the year to
            2025-12-31" is a FALSE claim about Ferguson, whose 10-KT covers five months, and naming
            IFRS as the cause on a domestic form is a non-sequitur. The fact is the same in all three
            cases and is stated first; only the cause is conditional, and it is named only where the
            form itself establishes it. */}
        {grid.behind && (() => {
          const isT = /T(\/A)?$/.test(grid.behind.form);          // a transition report — the period is a stub
          const isForeign = /^(20-F|40-F)/.test(grid.behind.form);
          return <div style={{ border: `1px solid ${C.bronze}55`, background: "#b0741e0d", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
            <span style={{ ...S.label, color: C.bronze }}>These figures stop before the filer does</span>
            <p style={{ fontSize: 12.5, color: C.ink2, margin: "7px 0 0", lineHeight: 1.65 }}>
              The newest year below is <b>{grid.cols[grid.cols.length - 1].period.end}</b>, and this company has since
              filed {isT ? "a transition report" : "an annual report"} on Form <b>{grid.behind.form}</b>{" "}
              {isT ? "for the period ended" : "for the year to"} <b>{grid.behind.period}</b> that none of these
              figures include.{" "}
              {isForeign && <>On a foreign form that is usually IFRS — SEC&rsquo;s company-facts data carries the
                US GAAP taxonomy only, so a filer that moves to IFRS simply stops appearing in it.{" "}</>}
              {isT && <>A transition report is what a company files when it changes its fiscal year end, so the
                period it covers is a stub rather than twelve months — which is why it gets no column of its
                own below.{" "}</>}
              What is below is what the company reported for those years, and it is correct for them.{" "}
              <a href={`https://www.sec.gov/Archives/edgar/data/${Number(data.cik)}/${String(grid.behind.accn || "").replace(/-/g, "")}/${grid.behind.accn}-index.htm`}
                target="_blank" rel="noopener noreferrer" style={{ color: C.teal }}>open the {grid.behind.period} filing ↗</a>
            </p>
          </div>;
        })()}

        {/* The valuation summary rides above every tab on purpose. It is four numbers a banker reads
            first — EV, the multiple, the price it came from — and burying it one click deep would
            make the headline of the page something you have to go looking for. */}
        {grid.cols && <ValuationCard grid={grid} quote={quote} note={quoteNote} S={S} />}

        {grid.cols && <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
          {TABS.map(t => <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: "7px 16px", borderRadius: 8, cursor: "pointer", border: "1px solid",
              font: `600 11px ${MONO}`, letterSpacing: 1, textTransform: "uppercase",
              background: tab === t.id ? "#0d6d5610" : "transparent",
              borderColor: tab === t.id ? `${C.teal}45` : C.hair,
              color: tab === t.id ? C.teal : C.faint }}>{t.label}</button>)}
        </div>}

        {/* Opens pinned to the right-hand edge — the current year, which is what you came to see —
            and scrolling left walks back through history. Model order without making the newest
            year the one you have to go looking for. */}
        {/* The reverse DCF rides above the Valuation tab's year grid: the two judgement rows that grid
            prints as "never auto-filled" — WACC and terminal growth — are exactly the inputs this plate
            asks the reader for, so it sits where those rows are and nowhere else. */}
        {tab === "valuation" && grid.cols && <PricedIn grid={grid} industry={industry} note={quoteNote} S={S} />}

        {tab === "segments" && <SegmentTables segs={segs || { loading: true }} S={S} />}

        {tab !== "segments" && grid.cols && <div style={{ position: "relative" }}>
          {/* The boundary of the sticky column, drawn as a HAIRLINE and nothing more.
              It shipped as a darkening gradient and that was wrong for this page: every rule on this
              site is a 1px hairline on paper and there is no other soft-edged element anywhere, so a
              26px grey fade read as a smudge — a rendering artifact rather than an edge.
              A fade cannot win here anyway. To stop a clipped figure being legible it would have to
              cover the whole fragment, which is up to a column wide and changes size as you scroll;
              an opaque block that size would also break the row rules running under the label. The
              honest scope is therefore to MARK the boundary, not to erase what is behind it — and the
              case that actually mattered is already gone, because the sheet no longer auto-scrolls
              when the table nearly fits, so a partial column now only appears while a reader is
              actively scrolling and can see the columns moving. */}
          {edge > 0 && <div aria-hidden="true" style={{ position: "absolute", left: edge, top: 1, bottom: 1, width: 1,
            pointerEvents: "none", zIndex: 3, background: C.hair }} />}
        <div ref={scroller} onScroll={syncEdge} style={{ overflowX: "auto", border: `1px solid ${C.hair}`, borderRadius: 10, background: C.card }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            {/* This row orients the whole sheet, so it is the last place to be economical with size.
                It was 9px uppercase at 2px letter-spacing over an 8px date at 60% opacity — spaced-out
                digits are the hardest thing to read quickly, and the year is the one thing you scan
                for. Year now leads at 13px in full ink; the date sits under it at 10px in a quieter
                colour rather than a transparency, so it stays legible instead of washing out. */}
            <thead><tr style={{ background: "#f6eee1" }}>
              <th style={{ textAlign: "left", padding: "11px 14px", position: "sticky", left: 0, background: "#f6eee1", minWidth: 230, fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: 1.5, textTransform: "uppercase", color: C.mute, borderBottom: `1px solid ${C.hair}` }}>Line item</th>
              {grid.cols.map(c => <th key={c.period.end} style={{ textAlign: "right", padding: "11px 14px", whiteSpace: "nowrap", fontFamily: MONO, fontSize: 13, fontWeight: 600, letterSpacing: .5, color: C.ink, borderBottom: `1px solid ${C.hair}` }}>
                FY{c.period.fy}
                <div style={{ fontSize: 10, fontWeight: 400, letterSpacing: .3, color: C.faint, marginTop: 3 }}>{c.period.end}</div>
                {/* Months that appear in NO column, between this one and the one to its left. The
                    figures here are right; every growth rate across the boundary is blank, and this is
                    the one place that can say why for all of them at once, because the discontinuity
                    belongs to the boundary rather than to any row.

                    It states the FACT and not the cause, which is rule 10's lesson: the cause is a
                    fiscal-year change at most of these filers, but Thermo Fisher's is a seven-year hole
                    with an unmoved December year end and Diebold's is a Chapter 11 year split into two
                    stubs. A confident "year end moved" would be wrong on both, and a wrong diagnosis
                    sends the reader somewhere that does not exist. */}
                {c.period.gapBefore > 0 && <div title={`${c.period.gapBefore} days between the previous column's period end and this one's start appear in no column. Usually a fiscal-year change — the stub period is not twelve months, so it gets no column — or years the filer did not tag. Growth rates across the break are left blank rather than comparing two different windows.`}
                  style={{ fontSize: 9, fontWeight: 400, letterSpacing: .2, color: C.bronze, marginTop: 3 }}>
                  {Math.round(c.period.gapBefore / 30.4)} mo not covered
                </div>}
                {/* The other thing a column header can say once for every row beneath it. A 52/53-week
                    filer's long year is a genuine fiscal year and 1.9% longer than its neighbours, so
                    every growth rate into and out of it carries the extra week; the growth rows say
                    what that does, and this says which column it is. Shown as reported, never
                    adjusted — see `weeks53` in grid.js for the measurement. */}
                {c.period.weeks53 && <div title="This fiscal year ran 53 weeks (370 days): the extra week a 52/53-week calendar adds every five or six years, filed as one fiscal year. Growth into it carries about 1.9 points more than a like-for-like year and growth out of it about 1.9 points less. Both are genuine fiscal years, so the rates are shown as reported, not adjusted."
                  style={{ fontSize: 9, fontWeight: 400, letterSpacing: .2, color: C.bronze, marginTop: 3 }}>
                  53-week year
                </div>}
              </th>)}
            </tr></thead>
            <tbody>
              {/* Valuation is lifted out into its own card above. There is ONE price, so it produces
                  one column of figures — spreading it across eight year-columns printed seven blanks
                  and hid the only real value off the right-hand edge of the scroll. */}
              {activeSections.filter(s => TABS.find(t => t.id === tab).secs.includes(s.id) || s.tab === tab)
                .map(sec => <SectionRows key={sec.id} sec={sec} grid={grid} S={S} link={sectionLink(kindFor(sec))} cik={data.cik}
                  naLabel={INDUSTRY_LABEL[industry] ? `n/a for a ${INDUSTRY_LABEL[industry]}` : "n/a"} />)}
            </tbody>
          </table>
        </div>
        </div>}

        {/* Stated plainly rather than hidden. These are the lines no filing contains — a sponsor's
            add-backs, a maintenance/growth capex split, deal terms — and a tool that quietly leaves
            them blank invites you to assume it tried and failed. Knowing where to stop is the part
            a finance reader will actually check. */}
        <div style={{ marginTop: 18, border: `1px solid ${C.hair}`, borderRadius: 10, padding: "12px 16px", background: "#f6eee180" }}>
          <span style={{ ...S.label, color: C.bronze }}>Deliberately not computed</span>
          <div style={{ fontSize: 11.5, color: C.mute, lineHeight: 1.65, marginTop: 6 }}>
            {SECTIONS.filter(s => FOOTER_SECS.includes(s.id)).map(s =>
              s.lines.filter(l => l.how === "manual").map(l => l.label).join(" · ")).filter(Boolean).join(" · ")}
            <div style={{ fontSize: 10.5, color: C.faint, marginTop: 5, fontStyle: "italic" }}>
              None of these exist in any filing — they are judgement or deal terms. The tool will find the relevant 8-K or merger proxy, but it will not invent the number.
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: 18, flexWrap: "wrap", fontSize: 10, fontFamily: MONO, color: C.faint }}>
          <span><b style={{ color: C.ink2 }}>reported</b> — filed value</span>
          <span><b style={{ color: C.bronze }}>÷K · ×K</b> — a filed figure carried to today's share basis after a split; the link opens the filing that shows it as reported</span>
          <span><b style={{ color: C.navy }}>computed</b> — derived here</span>
          <span><b style={{ color: C.bronze }}>not tagged</b> — disclosed but untagged; use the section link</span>
          <span><b style={{ color: C.faint }}>n/a</b> — this filer has never reported it</span>
          <span><b style={{ color: C.teal }}>judgement</b> — never auto-filled</span>
        </div>
      </>}
    </div>
  </div>;
}

// One price divided into one year, so it reads as one block. Says out loud which year it divided
// into, because "EV/EBITDA 26.7x" is meaningless without knowing whether the EBITDA is FY2025 or
// a stale year — and that ambiguity is exactly what a valuation row buried in a year grid creates.
// Companies across, metrics down — the transpose of the single sheet, off the same engine.
//
// The honesty problem specific to comps is the FISCAL YEAR. Apple's 2025 ends in September and
// Microsoft's in June, and a table that lines them up under one "FY2025" heading is quietly
// comparing different twelve-month windows — the most common way a comps page misleads. Across the
// 97-filer corporate sample those year ends spread over ELEVEN months.
//
// So the default basis is the TRAILING TWELVE MONTHS, stitched from each company's most recent 10-Q,
// which closes that spread to three months. It does not close it to zero and the page never claims
// it does: the through-date sits under every ticker and the actual spread across the set is printed
// in words above the table. Street practice is exactly this — LTM comps with the through-date
// disclosed — and the filed fiscal year stays one click away, because the reported year is what a
// reader will want when they go to check a figure against the 10-K itself.
function CompsTable({ comps, S, onRemove, onClear, onOpen }) {
  // Same mask as the single sheet, and the reason it is here and NOT on the segment tables is a
  // measurement rather than a preference. Segments never overflow — scope is the newest 10-K, so
  // three columns, and `scrollWidth - clientWidth` is 0 at 1500, 1180 and 900px on Apple, JPMorgan
  // and Caterpillar alike. A mask there would be markup that can never fire, which is the same defect
  // as the shadow that rendered as nothing.
  //
  // Comps does overflow: 0 with three companies at any width, 64px with six at 1180px, and 264px with
  // eight at 1500px. It is a weaker case than the sheet's and worth saying why — this table has no
  // scroller ref and never auto-scrolls, so it opens at 0 with nothing hidden and a reader only
  // reaches the bad state by scrolling there deliberately. But the rows it would truncate are Revenue,
  // EBITDA and Net income, absolute figures where a fragment reads as a smaller company, so the same
  // misreading is available once they scroll.
  const scroller = useRef(null);
  const [edge, setEdge] = useState(0);
  const syncEdge = () => {
    const el = scroller.current;
    const th = el && el.querySelector("thead th");
    setEdge(el && th && el.scrollLeft > 0 ? th.getBoundingClientRect().width : 0);
  };
  const [basis, setBasis] = useState("ltm");
  const [saved, setSaved] = useState("");
  // The LTM column is built by the same buildGrid as the year columns, so switching basis picks a
  // different column out of the same grid rather than refetching anything.
  const colOf = c => !c.grid ? null
    : basis === "ltm" ? c.grid.ltm
    : (c.grid.cols && c.grid.cols.length ? c.grid.cols[c.grid.cols.length - 1] : null);
  const ready = comps.filter(c => colOf(c));
  const val = (c, k) => { const col = colOf(c); return col ? col.v[k] : null; };
  const why = (c, k) => { const col = colOf(c); return col && col.meta[k] ? col.meta[k].status : null; };

  // Rule 5 on the single sheet — a blank is not one thing — applied to a table that has nowhere to
  // put a status chip. Stitching introduces a blank the fiscal-year basis never had: the filer
  // reports the concept annually but not in its 10-Qs, so there is no comparable twelve months.
  // Costco's revenue is the case, and unmarked it reads as the tool breaking on Costco while $91bn
  // and $199bn sit in the columns beside it. The cell turns bronze — the sheet's colour for "there
  // is something to go and look at" — and the companies and lines are named underneath, because a
  // colour alone does not say why and there are rarely more than two of them in a set.
  const GAP = {
    "no-interim": (tic, lines) => `${tic} reports ${lines} only in its annual filing, so there is no comparable twelve months`,
    "restated-basis": (tic, lines) => `${tic} has re-presented its prior year without the annual figure catching up, so stitching ${lines} would mix two bases`,
  };
  const gaps = {};
  for (const c of ready) for (const g of COMPS_ROWS) for (const r of g.rows) {
    const st = why(c, r.k);
    if (val(c, r.k) != null || !GAP[st]) continue;
    (gaps[st] = gaps[st] || {})[c.ticker] = [...(gaps[st][c.ticker] || []), r.label];
  }
  // The same obligation one row further on, and the same lesson: a cell can be CORRECT and still read
  // as the tool breaking. Colgate's ROE sits at 863.6% beside P&G's 29.5% because its equity has very
  // nearly cancelled, which the single sheet explains at length and this table said nothing about.
  // Bronze here means what it means everywhere else — there is something to go and look at.
  const thin = c => { const col = colOf(c); return !!(col && col.v.equityThin); };
  const thinSet = ready.filter(thin);
  // A set is the one place two currencies legitimately sit side by side. One currency throughout needs
  // no marking anywhere — the amounts are comparable and saying so would be noise — so this is the
  // gate for both the cell marks and the note under the table. See `CURRENCY_DENOMINATED`.
  const ccySet = [...new Set(ready.map(c => (c.grid || {}).ccy).filter(Boolean))];
  const mixedCcy = ccySet.length > 1;
  // Mark the ODD ONE OUT rather than the whole row. Marking every cell was the first version and it
  // overstates: in a set of two dollar filers and one euro filer, the two dollar figures ARE
  // comparable with each other, and colouring all three reads as "everything here is broken" instead
  // of "this one is different". Same shape as the near-cancelled-equity mark, which colours the filer
  // it is about and leaves the rest alone. Ties go to USD, which is the currency the price is in and
  // the one a reader assumes.
  const domCcy = (() => {
    const n = {};
    for (const c of ready) { const k = (c.grid || {}).ccy; if (k) n[k] = (n[k] || 0) + 1; }
    return Object.keys(n).sort((a, b) => n[b] - n[a] || (a === "USD" ? -1 : b === "USD" ? 1 : 0))[0];
  })();

  // Median over the companies that HAVE the figure, never over the set. A bank contributes no
  // EV/EBITDA and a filer with no operating income contributes no margin; counting those as zero, or
  // dividing by the full column count, would drag the median toward whichever names are missing.
  const median = k => {
    const xs = ready.map(c => val(c, k)).filter(v => v != null && isFinite(v)).sort((a, b) => a - b);
    if (!xs.length) return null;
    const m = Math.floor(xs.length / 2);
    return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
  };

  const anyPriced = ready.some(c => c.quote && c.quote.price);
  // Measured from the set on screen rather than asserted, because the whole argument for LTM is that
  // it narrows the spread and the reader is entitled to see by how much for THESE names. A set of
  // three December filers lines up exactly and should say so; a set spanning January and June ends
  // should not be flattered by a generic sentence about calendarisation.
  const ends = ready.map(c => colOf(c).period.end).sort();
  const spreadDays = ends.length > 1 ? Math.round((new Date(ends[ends.length - 1]) - new Date(ends[0])) / 864e5) : 0;
  const carried = ready.filter(c => basis === "ltm" && !c.grid.ltmStitched);

  const exportSet = async () => {
    setSaved("Building workbook…");
    try {
      const { downloadXlsx, S: XF } = await import("./xlsx.js");
      const cols = ready;
      const groups = COMPS_ROWS.filter(g => anyPriced || !g.market);
      const rows = [
        [{ v: "Comparable companies", s: XF.TITLE }],
        // Names here rather than in a row of their own beneath the header. Six header rows is the
        // single sheet's shape and the data has to start at row 7 in both: a seventh header row put
        // company names INSIDE the frozen data area, where every cell below is a number, and the
        // Excel check that opens these files flagged it as text in a numeric column — which is the
        // same complaint it would make about a real defect.
        [{ v: cols.map(c => c.title || c.ticker).join(" · "), s: XF.MUTED }],
        // The basis sentence used to say every column was "stitched from each company's most recent
        // 10-Q", which was false for a column carried from its fiscal year and for a 20-F filer that
        // has never filed a 10-Q. The sentence states the method; the per-column row below states
        // which columns it applied to.
        [{ v: `${basis === "ltm" ? "Trailing twelve months: each company's last full year plus its latest year-to-date, less the prior year to the same date; a column marked 'reported FY' has nothing to stitch" : "Each company's most recent reported fiscal year"} · generated ${new Date().toISOString().slice(0, 10)} · filings.masonjbennett.com/?c=${cols.map(c => c.ticker).join(",")}`, s: XF.MUTED }],
        [],
        [{ v: "Metric", s: XF.BOLD }, ...cols.map(c => ({ v: c.ticker, s: XF.BOLD })), { v: "Median", s: XF.BOLD }],
        // The period end goes in a row of its own and not into the ticker header, because the columns
        // do not share a window and a workbook has no subtitle to say so. A reader who sorts or
        // filters this file must still be able to see which twelve months each column covers.
        [{ v: basis === "ltm" ? "Twelve months ended" : "Fiscal year ended", s: XF.MUTED },
          ...cols.map(c => ({ v: colOf(c).period.end + (colOf(c).period.weeks53 ? " (53 weeks)" : ""), s: XF.MUTED }))],
        // What each column IS, on the LTM basis, since the columns do not share one: stitched, or the
        // fiscal year carried because nothing has been filed since, or carried because the filer never
        // files a quarterly report. The page says this under each ticker; the workbook leaves the page.
        ...(basis === "ltm" ? [[{ v: "Basis", s: XF.MUTED }, ...cols.map(c => ({ v: c.grid.ltmStitched ? "stitched" : c.interim ? `reported FY${colOf(c).period.fy}, nothing filed since` : `reported FY${colOf(c).period.fy}, no quarterly report on file`, s: XF.MUTED }))]] : []),
        // A set is the one place two currencies sit side by side, and the single sheet's "All figures
        // in EUR" line has no equivalent here because the figures are not all in anything. Per column,
        // and only when the set is mixed — one currency throughout needs no marking, as on the page.
        ...(mixedCcy ? [[{ v: "Currency", s: XF.MUTED }, ...cols.map(c => ({ v: (c.grid.ccy || "USD") + (c.grid.ccy && c.grid.ccy !== "USD" ? ", as filed — not converted" : ""), s: XF.MUTED }))]] : []),
      ];
      // Counted, not written down — the single sheet's lesson: two conditional rows above and a
      // hardcoded `y: 6` cannot both be right, and the Excel check flags text inside the data area.
      const headerRows = rows.length;
      for (const g of groups) {
        rows.push([]);
        rows.push([{ v: g.group, s: XF.BOLD }]);
        for (const r of g.rows) {
          if (r.market && !anyPriced) continue;
          const med = COMPS_MEDIAN.has(r.k) ? median(r.k) : null;
          rows.push([{ v: r.label },
            ...cols.map(c => ({ v: val(c, r.k), s: styleFor(XF, r.k, val(c, r.k)) })),
            { v: med, s: styleFor(XF, r.k, med) }]);
        }
      }
      downloadXlsx([{ name: "Comps", rows, widths: [30, ...cols.map(() => 16), 16], freeze: { x: 1, y: headerRows } }],
        `comps-${cols.map(c => c.ticker).join("-").slice(0, 60) || "set"}.xlsx`);
      setSaved("Workbook downloaded");
    } catch (e) { setSaved("Export failed — " + String((e && e.message) || e).slice(0, 60)); }
    setTimeout(() => setSaved(""), 4000);
  };

  const pill = (id, label) => <button key={id} onClick={() => setBasis(id)}
    style={{ padding: "6px 13px", borderRadius: 8, cursor: "pointer", border: "1px solid",
      font: `600 10px ${MONO}`, letterSpacing: 1, textTransform: "uppercase",
      background: basis === id ? "#0d6d5610" : "transparent",
      borderColor: basis === id ? `${C.teal}45` : C.hair, color: basis === id ? C.teal : C.faint }}>{label}</button>;

  return <div style={{ marginBottom: 24 }}>
    <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
      <h2 style={{ font: `400 26px/1.2 ${SERIF}`, color: C.ink, margin: 0 }}>Comparable companies</h2>
      <div style={{ display: "flex", gap: 6 }}>{pill("ltm", "LTM")}{pill("fy", "Reported FY")}</div>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        <button onClick={exportSet} style={{ background: `${C.teal}0e`, border: `1px solid ${C.teal}55`, borderRadius: 8, padding: "6px 12px", color: C.teal, font: `600 10px ${MONO}`, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}>↓ Download Excel</button>
        <button onClick={onClear} style={{ background: "none", border: `1px solid ${C.hair}`, borderRadius: 8, padding: "6px 12px", color: C.mute, font: `600 10px ${MONO}`, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}>Clear set</button>
      </div>
    </div>
    {/* The claim and its measurement in one line. "Calendarised" is the word that would be a lie
        here — LTM narrows the windows, it does not align them, and the number saying by how much is
        cheap to compute and impossible to argue with. */}
    <p style={{ fontSize: 11, color: C.faint, fontFamily: MONO, marginBottom: 14, lineHeight: 1.7 }}>
      {basis === "ltm"
        ? <>trailing twelve months to each company's latest quarter{spreadDays > 0 && <> — the windows still differ, by <span style={{ color: C.ink2 }}>{spreadDays} days</span> across this set</>}{spreadDays === 0 && ends.length > 1 && <> — every company in this set ends on the same date</>}</>
        : <>each company's own most recent fiscal year — the ends spread <span style={{ color: C.ink2 }}>{spreadDays} days</span>, which is what LTM exists to narrow</>}
      <br />{ready.length} of {comps.length} loaded · search above to add another · click a ticker to open its sheet
      {!anyPriced && <span style={{ color: C.bronze, marginLeft: 12 }}>· multiples need FINNHUB_KEY on this deployment</span>}
      {saved && <span style={{ color: C.teal, marginLeft: 12 }}>{saved}</span>}
    </p>

    <div style={{ position: "relative" }}>
    {edge > 0 && <div aria-hidden="true" style={{ position: "absolute", left: edge, top: 1, bottom: 1, width: 1,
      pointerEvents: "none", zIndex: 3, background: C.hair }} />}
    <div ref={scroller} onScroll={syncEdge} style={{ overflowX: "auto", border: `1px solid ${C.hair}`, borderRadius: 10, background: C.card }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
        <thead><tr style={{ background: "#f6eee1" }}>
          <th style={{ textAlign: "left", padding: "11px 14px", position: "sticky", left: 0, background: "#f6eee1", minWidth: 210, fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: 1.5, textTransform: "uppercase", color: C.mute, borderBottom: `1px solid ${C.hair}` }}>Metric</th>
          {comps.map(c => { const col = colOf(c); return <th key={c.ticker} style={{ textAlign: "right", padding: "11px 14px", whiteSpace: "nowrap", fontFamily: MONO, fontSize: 13, fontWeight: 600, color: C.ink, borderBottom: `1px solid ${C.hair}` }}>
            {/* A column is a company, and the obvious next question about any column is "what does its
                own sheet say" — which is where every blank in it gets explained. A real anchor, so
                ctrl-click opens a second tab and the address is copyable, with the in-page load
                intercepted so the set survives behind a back button. */}
            <a href={`?t=${encodeURIComponent(c.ticker)}`} onClick={e => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); onOpen(c.ticker); }}
              className="srcnum" style={{ color: C.ink }}>{c.ticker}</a>
            <button onClick={() => onRemove(c.ticker)} title={`remove ${c.ticker}`}
              style={{ marginLeft: 6, background: "none", border: "none", color: C.faint, cursor: "pointer", fontSize: 12, padding: 0 }}>×</button>
            <div style={{ fontSize: 9, fontWeight: 400, color: C.faint, marginTop: 3, maxWidth: 150, whiteSpace: "normal", lineHeight: 1.3 }}>
              {c.loading ? "loading…" : c.err ? c.err : !col ? "no annual periods"
                : basis === "fy" ? `FY${col.period.fy} · ${col.period.end}`
                : `12m to ${col.period.end}`}
              {/* Said on the column it applies to, not in a footnote. A company whose year has just
                  closed has nothing to stitch, so its LTM IS that fiscal year — true, and a different
                  statement from the eight companies beside it. */}
              {col && basis === "ltm" && !c.grid.ltmStitched &&
                <div style={{ color: C.bronze }}>= FY{col.period.fy}, {c.interim ? "nothing filed since" : "no quarterly report on file"}</div>}
              {/* Same mark the single sheet's header carries, on the one column a set compares. A
                  53-week window is 1.9% longer than the ones beside it, and a growth rate built on
                  it is not like-for-like with the next column's. */}
              {col && col.period.weeks53 &&
                <div style={{ color: C.bronze }}>{basis === "fy" ? "53-week year" : "53-week window"}</div>}
              {/* Currency belongs on the COLUMN here, not once at the top as it is on a single sheet:
                  a set is the one place two currencies legitimately sit side by side, and ASML's
                  €32.67bn of revenue beside a US filer's dollars is the Costco blank wearing a
                  populated cell. The ratio and multiple rows are dimensionless and compare fine —
                  which is also why the median, taken only over those, is unaffected. */}
              {col && c.grid.ccy && c.grid.ccy !== "USD" &&
                <div style={{ color: C.bronze }}>figures in {c.grid.ccy}</div>}
            </div>
          </th>; })}
          <th style={{ textAlign: "right", padding: "11px 14px", whiteSpace: "nowrap", fontFamily: MONO, fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: C.teal, borderBottom: `1px solid ${C.hair}`, borderLeft: `1px solid ${C.hair}` }}>
            Median
            <div style={{ fontSize: 9, fontWeight: 400, color: C.faint, marginTop: 3 }}>of those reporting</div>
          </th>
        </tr></thead>
        <tbody>
          {COMPS_ROWS.map(g => <Fragment key={g.group}>
            <tr><td colSpan={comps.length + 2} style={{ padding: 0, borderTop: `1px solid ${C.hair}` }}>
              <div style={{ position: "sticky", left: 0, display: "inline-block", padding: "13px 14px 5px" }}>
                <span style={{ ...S.label, color: C.teal }}>{g.group}</span>
              </div>
            </td></tr>
            {g.rows.map(r => {
              const med = COMPS_MEDIAN.has(r.k) ? median(r.k) : null;
              return <tr key={r.k} style={{ borderTop: `1px solid ${C.hair2}` }}>
                <td style={{ padding: "6px 14px", position: "sticky", left: 0, background: C.card, whiteSpace: "nowrap", color: C.ink2 }}>{r.label}</td>
                {comps.map(c => {
                  const v = val(c, r.k), gap = v == null && GAP[why(c, r.k)];
                  const soft = v != null && EQUITY_DENOMINATED.has(r.k) && thin(c);
                  // An AMOUNT in a set that holds more than one currency is not comparable to the
                  // amounts beside it, and unmarked it reads as a bigger or smaller company. The
                  // header already names each column's currency; this is the same statement arriving
                  // on the cell, which is where the comparison is actually made. Only when the set is
                  // mixed — one currency throughout needs no marking at all.
                  const cc = (c.grid || {}).ccy;
                  const ccyOdd = v != null && mixedCcy && CURRENCY_DENOMINATED.has(r.k) && cc && cc !== domCcy ? cc : null;
                  return <td key={c.ticker} title={gap ? gap(c.ticker, r.label.toLowerCase())
                    : soft ? `${c.ticker}'s equity is a near-cancelled residual, so this ratio is not comparable to the others`
                    : ccyOdd ? `${c.ticker} reports in ${ccyOdd}, as filed — this amount is not in the same currency as the others in this row` : ""}
                    style={{ padding: "7px 14px", textAlign: "right", fontFamily: MONO, fontSize: 13, color: v == null ? (gap ? C.bronze : C.hair) : (soft || ccyOdd) ? C.bronze : C.ink2, whiteSpace: "nowrap" }}>
                    {display(r.k, v) || "—"}
                  </td>;
                })}
                <td style={{ padding: "7px 14px", textAlign: "right", fontFamily: MONO, fontSize: 13, fontWeight: 600, color: med == null ? C.hair : C.teal, whiteSpace: "nowrap", borderLeft: `1px solid ${C.hair2}` }}>
                  {med == null ? "—" : display(r.k, med)}
                </td>
              </tr>;
            })}
          </Fragment>)}
        </tbody>
      </table>
    </div>
    </div>

    <p style={{ fontSize: 10.5, color: C.faint, fontFamily: MONO, marginTop: 12, lineHeight: 1.6 }}>
      Same engine as the single sheet, so the industry rules carry over: a bank in the set has no
      EV/EBITDA because a bank is levered on capital ratios, not because the figure is missing. A blank
      is a blank for the reason the company's own sheet gives — click the ticker to open it.
      {thinSet.length > 0 && <span style={{ color: C.bronze }}>
        {" "}{thinSet.map(c => `${c.ticker} (${(Math.abs(colOf(c).v.equity / colOf(c).v.totalAssets) * 100).toFixed(2)}%)`).join(", ")}
        {thinSet.length > 1 ? " hold" : " holds"} shareholders' equity worth almost nothing against total assets, so the
        equity-denominated ratios above are correct and are not comparable with the rest of the set.
      </span>}
      {/* Named under the table as well as on each cell, because the cell mark answers "why is this one
          bronze" and this answers "what am I looking at" — the same split the near-cancelled-equity
          note above makes. Nothing is converted anywhere on this site. */}
      {mixedCcy && <span style={{ color: C.bronze }}>
        {" "}This set spans {ccySet.join(", ")}: {ready.filter(c => (c.grid || {}).ccy && (c.grid || {}).ccy !== "USD")
          .map(c => `${c.ticker} reports in ${c.grid.ccy}`).join(", ")}. The marked amounts are as filed and are not
        converted, so they are not comparable across the row — the ratios and multiples are dimensionless and are.
      </span>}
      {basis === "ltm" && <><br />An LTM line is the last full year plus this year to date less last year to the same date,
      all three from the same tag the annual column used, with the balance sheet read at the quarter end rather than summed.
      {carried.some(c => c.interim) && ` ${carried.filter(c => c.interim).map(c => c.ticker).join(", ")} ${carried.filter(c => c.interim).length > 1 ? "have" : "has"} nothing filed since the year end, so the fiscal year is the trailing twelve months.`}
      {carried.some(c => !c.interim) && ` ${carried.filter(c => !c.interim).map(c => c.ticker).join(", ")} ${carried.filter(c => !c.interim).length > 1 ? "file" : "files"} no quarterly report, so the fiscal year is the only twelve months on file.`}
      {Object.entries(gaps).map(([st, byTicker]) => <span key={st} style={{ color: C.bronze }}>
        {" "}{Object.entries(byTicker).map(([tic, labels]) => GAP[st](tic, labels.join(" and ").toLowerCase())).join("; ")} — open the sheet for the reported year.
      </span>)}</>}
    </p>
  </div>;
}

// Breakdowns by segment, product and geography — the only part of this terminal whose numbers do not
// come from companyfacts, because companyfacts carries no dimensional data at all.
//
// The one claim the tab makes is that EVERY TABLE HERE ADDS UP: api/segments.js drops any breakdown
// whose rows do not sum to the consolidated figure for the same period in the same filing, to within
// 0.1%. That costs real tables — 26 of 30 filers swept keep a reportable-segment table — and the ones
// it drops are dropped for a reason worth stating rather than hidden, because a segment table reading
// 142% of the company is the failure this whole project exists to avoid.
function SegmentTables({ segs, S }) {
  if (segs.loading) return <p style={{ color: C.faint, fontFamily: MONO, fontSize: 12, padding: "18px 0" }}>Reading the XBRL instance…</p>;
  if (segs.err) return <p style={{ color: C.claret, fontFamily: MONO, fontSize: 12, padding: "18px 0" }}>{segs.err}</p>;

  const fmt = v => v == null ? null : Math.abs(v) < 1000 ? (Math.round(v * 100) / 100).toLocaleString() : Math.round(v).toLocaleString();
  const cell = { padding: "7px 14px", textAlign: "right", fontFamily: MONO, fontSize: 13, whiteSpace: "nowrap" };

  return <div>
    <p style={{ fontSize: 11, color: C.faint, fontFamily: MONO, marginBottom: 14, lineHeight: 1.7 }}>
      From the XBRL instance of the {segs.period} 10-K — the three years that filing presents, not eight:
      a segment structure is usually reorganised before it is eight years old.{" "}
      <a href={segs.filingUrl} target="_blank" rel="noopener noreferrer" style={{ color: C.teal }}>open the filing ↗</a>
      <br />
      <span style={{ color: C.ink2 }}>Every table below sums to the consolidated figure beneath it.</span>{" "}
      A breakdown that does not reconcile is not shown — a subtotal row counted twice, or segment revenue that
      includes intersegment sales, both read as a company half again its real size. Where a filer reports
      corporate, eliminations or an "all other" line to close that reconciliation, it is a row here too,
      marked <em style={{ color: C.bronze, fontStyle: "normal" }}>recon</em>, because a table that adds up
      without them would be leaving out the part that makes it add up.
    </p>

    {!segs.views.length && (() => {
      // Why this tab is empty, from api/segments.js's `empty` (README Segments). Two of the reasons are opposites —
      // a breakdown checked against the company that failed, and one with nothing in the company's statements to
      // check it against — and the old single sentence said the first about both: it told a reader Blackstone's
      // segments "do not add up" when the measures its segment table leads with have no company-wide figure to add up to.
      //
      // A payload WITHOUT `empty` keeps the sentence that shipped before, and that branch is not dead code. The
      // payload lives only in this component's state, never in storage, so a tab left open across a deploy holds
      // the old shape until the next company loads; and an instant rollback serves the old deployment, whose
      // payloads never carry the field. Measured Sep 15 2026 on production: the browser receives
      // `Cache-Control: public` with no max-age and no Last-Modified (Vercel strips s-maxage), so a browser has no
      // stale copy of its own to serve. Do not add one: a persisted payload is how yesterday's shape outlives a deploy.
      const e = segs.empty || {}, cs = e.concepts || [];
      const names = <span style={{ fontFamily: MONO, fontSize: 11, color: C.ink2 }}>{cs.map(c => c.label).join(" · ")}</span>;
      const COPY = {
        "unreconciled": ["Nothing that reconciles", <>This filer tags a breakdown of {names}{e.more ? ` and ${e.more} more` : ""}, but
          its rows do not add up to the consolidated figure in the same filing — the nearest is{" "}
          {cs.length ? Math.min(...cs.map(c => c.offPct)) : "?"}% away — and a table that does not add up is not shown. Most
          often that is segment revenue that includes intersegment sales, or a reconciling line filed where this tab does not
          look. The footnote itself has the numbers.</>],
        "no-consolidated-figure": ["Nothing to reconcile against", <>This company reports its breakdown on {names}
          {e.more ? ` and ${e.more} other measures` : ""} — its own measures, none of which the filing reports as a figure for
          the company as a whole. A table here is shown only when its rows add up to such a figure, so there is nothing to
          check these against. The footnote itself reports them in full.</>],
        "outside-allow-list": ["Not a line this tab reads", <>This filer's breakdown is tagged on {names}, which this tab does
          not read: it reads the standard revenue, profit, cost and capital-spending lines, the ones a table can be
          added up against. The footnote itself has the numbers.</>],
        "one-member": ["A single row", <>Every breakdown this filer tags has one row, so there is no split to add up.</>],
        "no-breakdown": ["No breakdown filed", <>The latest 10-K tags no annual figure by segment, product line or geography
          that stands on its own, so there is no breakdown to show.</>],
      };
      const [head, body] = COPY[e.reason] || ["Nothing that reconciles", <>This filer tags no breakdown that adds up to its
        own consolidated figures — most often because its segment revenue includes intersegment sales, or because the top
        line by segment is a company-specific tag rather than a standard one. The footnote itself has the numbers.</>];
      return <div style={{ border: `1px solid ${C.hair}`, borderRadius: 10, padding: "16px 18px", background: "#f6eee180" }}>
        <span style={{ ...S.label, color: C.bronze }}>{head}</span>
        <p style={{ fontSize: 12, color: C.mute, margin: "8px 0 0", lineHeight: 1.6 }}>{body}</p>
      </div>;
    })()}

    {segs.views.map((v, vi) => <div key={vi} style={{ marginBottom: 26 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 7 }}>
        <span style={{ ...S.label, color: C.teal }}>{v.title}</span>
        {/* The filing's own name for the table. Apple discloses revenue by product twice — on the
            income statement and again in the revenue footnote — and they are different breakdowns of
            the same axis, so naming which is which is the difference between two tables and a
            duplicate. */}
        {v.source && v.source !== v.title && <span style={{ fontSize: 10, color: C.faint, fontFamily: MONO }}>{v.source}</span>}
        {v.subtotals.length > 0 && <span style={{ fontSize: 10, color: C.faint, fontFamily: MONO }}>
          subtotal {v.subtotals.length > 1 ? "rows" : "row"} removed: {v.subtotals.join(", ")}
        </span>}
        {/* A filer routinely files the same row two or three ways for one period — external sales, the
            intersegment elimination, and the total of the two — and summing them counted Caterpillar
            about 2.4 times. One is shown, and which ones were not is worth saying, because it is the
            reason a figure here can differ from the same line in the footnote. */}
        {v.otherViews && v.otherViews.length > 0 && <span style={{ fontSize: 10, color: C.faint, fontFamily: MONO }}>
          also filed on another basis: {v.otherViews.map(o => o.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()).join(", ")}
        </span>}
        {/* Rule 9's table is the only one here whose CELLS the filer did not file. Exxon files no
            single-axis segment row at all — it files segment × geography, and each row above is that
            segment's cells added across the geographies. Every other figure on this site is a value
            taken from a filing, and the header says so in those words, so a reconstruction cannot sit
            among them unmarked. The claim it still makes is the one the gate enforces and the one
            worth having: the arithmetic is the filer's own and it foots to the filer's own total. */}
        {v.collapsedAlong && <span style={{ fontSize: 10, color: C.bronze, fontFamily: MONO }}>
          summed from this filer's {v.collapsedAlong.split(":").pop().replace(/^Statement|Axis$/g, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()} cross-tab
          — it files no single-axis breakdown here, so each row is its cells added across that axis
        </span>}
      </div>
      <div style={{ overflowX: "auto", border: `1px solid ${C.hair}`, borderRadius: 10, background: C.card }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
          <thead><tr style={{ background: "#f6eee1" }}>
            <th style={{ textAlign: "left", padding: "10px 14px", position: "sticky", left: 0, background: "#f6eee1", minWidth: 210, fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: 1.5, textTransform: "uppercase", color: C.mute, borderBottom: `1px solid ${C.hair}` }}>Line</th>
            {segs.periods.map(p => <th key={p} style={{ textAlign: "right", padding: "10px 14px", whiteSpace: "nowrap", fontFamily: MONO, fontSize: 12, fontWeight: 600, color: C.ink, borderBottom: `1px solid ${C.hair}` }}>{p}</th>)}
          </tr></thead>
          <tbody>
            {v.concepts.map(t => <Fragment key={t}>
              <tr><td colSpan={segs.periods.length + 1} style={{ padding: 0, borderTop: `1px solid ${C.hair}` }}>
                <div style={{ position: "sticky", left: 0, display: "inline-block", padding: "12px 14px 4px" }}>
                  <span style={{ ...S.label, color: C.bronze }}>{segs.conceptLabels[t] || t}</span>
                </div>
              </td></tr>
              {v.members.map((m, mi) => {
                const cells = segs.periods.map((_, pi) => (v.facts.find(f => f.t === t && f.m === mi && f.p === pi) || {}).v);
                if (cells.every(x => x == null)) return null;
                // A reconciling row is not an operating segment and must not read as one. It is the
                // corporate, elimination or "all other" line that closes the reconciliation, so it
                // says so and sits in the muted weight the consolidated line below it uses.
                return <tr key={mi} style={{ borderTop: `1px solid ${C.hair2}` }}>
                  <td style={{ padding: "6px 14px", position: "sticky", left: 0, background: C.card, whiteSpace: "nowrap", color: m.recon ? C.mute : C.ink2 }}>
                    {m.label}
                    {/* The space is inside the span deliberately: the margin is the visual gap, but
                        the text layer has no margins, and without it the row reads "CorporateRECON"
                        to anything that takes the page as text. */}
                    {m.recon && <span style={{ fontSize: 8, fontFamily: MONO, color: C.bronze, marginLeft: 6, letterSpacing: 1 }}>{" RECON"}</span>}
                  </td>
                  {cells.map((x, i) => <td key={i} style={{ ...cell, color: x == null ? C.hair : m.recon ? C.mute : C.ink2 }}>{fmt(x) || "—"}</td>)}
                </tr>;
              })}
              {/* The consolidated line the rows above add up to, printed rather than asserted. It is
                  the whole basis on which the table is shown at all, so it belongs on the page where
                  a reader can add the column up and check it. */}
              <tr style={{ borderTop: `1px solid ${C.hair}` }}>
                <td style={{ padding: "6px 14px", position: "sticky", left: 0, background: C.card, whiteSpace: "nowrap", color: C.mute, fontStyle: "italic" }}>
                  Consolidated <span style={{ fontSize: 8, fontFamily: MONO, color: C.teal, marginLeft: 6 }}>= Σ above</span>
                </td>
                {segs.periods.map(p => <td key={p} style={{ ...cell, color: C.mute, fontWeight: 600 }}>
                  {fmt((segs.consolidated[t] || {})[p]) || "—"}
                </td>)}
              </tr>
            </Fragment>)}
          </tbody>
        </table>
      </div>
    </div>)}
  </div>;
}

function ValuationCard({ grid, quote, note, S }) {
  const sec = SECTIONS.find(s => s.id === "ev");
  const c = grid.cols[grid.cols.length - 1];
  const rows = sec.lines.map(l => ({ k: l.k, label: l.label, v: c.v[l.k], formula: l.formula })).filter(r => r.v != null);
  if (!rows.length) return <div style={{ border: `1px solid ${C.hair}`, borderRadius: 10, background: C.card, padding: "14px 18px", marginBottom: 16 }}>
    <span style={{ ...S.label, color: C.teal }}>Current Valuation</span>
    <p style={{ fontSize: 12, color: C.bronze, margin: "8px 0 0", fontFamily: MONO }}>{note || "no price available, so nothing to divide with"}</p>
  </div>;
  return <div style={{ border: `1px solid ${C.hair}`, borderRadius: 10, background: C.card, padding: "14px 18px", marginBottom: 16 }}>
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
      <span style={{ ...S.label, color: C.teal }}>Current Valuation</span>
      <span style={{ fontSize: 10, color: C.faint, fontFamily: MONO }}>
        {quote ? `$${quote.price.toFixed(2)} today` : ""} · against FY{c.period.fy} ({c.period.end})
      </span>
    </div>
    {/* 250px, not 190px. At 190 the grid gave six 211px columns and a mega-cap did not fit in one:
        "Market capitalisation" is the only label here long enough to wrap to two lines, and a
        13-digit market cap is 133px of unbreakable digits, so the row needed 224px and the number ran
        into "Enterprise value" beside it. Measured, not guessed — every desktop width overlapped, and
        the ƒ added above cost another 10px on top. Widening the minimum drops it to four columns, and
        because that row was already two lines tall the card is exactly as tall at 1280 and 1440 as it
        was while overlapping: 157px either way. "Market capitalisation" is still the one label that
        wraps; it simply has room for its number now. It costs 17px at 1024 and 49px at 768, which is
        where the collision was worst. Letting the VALUE wrap instead was measured too and is worse — it clears
        the overlap but adds height at every width and puts the figure on its own line, in a card whose
        whole point is four numbers read at a glance. Abbreviating the figure was not considered
        seriously: the sheet prints what the filer filed, everywhere else. */}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: "9px 22px" }}>
      {/* Every line in this section declares its arithmetic, and until now nothing could print it.
          The ƒ marker and its tooltip are the row renderer's, and this section never reaches the row
          renderer — it is lifted out of the year grid into this card — so twelve `formula` strings
          were written down where no reader could see them, including the EV bridge itself. That is
          the one most worth showing: `mktCap + totalDebt + preferred + nciBs - cash - sti` is the
          line a reader checks on a page whose whole argument is provenance, and a computed figure
          that does not say how it was computed is the Exxon collapsed-table obligation again. Same
          glyph, same navy, same tooltip-only treatment as the sheet, so the two read as one system.
          Found by `t-declared`, which asserts the absence can't come back. */}
      {rows.map(r => <div key={r.k} style={{ display: "flex", justifyContent: "space-between", gap: 12, borderBottom: `1px solid ${C.hair2}`, paddingBottom: 5 }}>
        <span style={{ fontSize: 12, color: C.mute }}>
          {r.label}
          {r.formula && <span style={{ fontSize: 8, fontFamily: MONO, color: C.navy, marginLeft: 5 }} title={r.formula}>ƒ</span>}
        </span>
        <span style={{ fontSize: 13, fontFamily: MONO, color: C.ink2, fontWeight: 600 }}>{display(r.k, r.v)}</span>
      </div>)}
    </div>
    {/* P/B and book value per share divide by the same near-cancelled residual the ratio rows carry a
        note about, and this card is the only place either of them appears. One compact line rather
        than the full note the sheet uses: the card is deliberately four numbers read at a glance, and
        a five-line explanation inside it would cost the thing it is for. See `thinEquity`. */}
    {c.v.equityThin && <p style={{ fontSize: 11, color: C.bronze, margin: "11px 0 0", fontFamily: MONO, lineHeight: 1.5 }}>
      Book value here is a near-cancelled residual — shareholders' equity is {(Math.abs(c.v.equity / c.v.totalAssets) * 100).toFixed(2)}% of
      total assets — so P/B and book value per share describe the buyback history rather than the valuation.
    </p>}
    {/* Rule 20 suppresses the priced rows for a filer reporting in another currency, and this card
        drops any row that came out null — so on ASML it rendered "$1890.00 today" beside a book value
        of 50.89 with nothing between them saying one is dollars and the other euros. The row-level
        "reported in EUR" status cannot help here: the EV bridge is deliberately NOT in the year grid,
        so those keys have no row to carry a status on. Found by looking at PRODUCTION, which is the
        only place a real quote exists — the same route the $155bn Chubb enterprise value was caught. */}
    {c.meta.ev && c.meta.ev.status === "currency-mismatch" && <p style={{ fontSize: 11, color: C.bronze, margin: "11px 0 0", fontFamily: MONO, lineHeight: 1.5 }}>
      The price is in dollars and these figures are in {c.meta.ev.ccy}, as filed — so market cap,
      enterprise value and every multiple built on them are left out rather than mixed. Nothing here
      is converted. The book values above are in {c.meta.ev.ccy} too.
    </p>}
  </div>;
}

// What's priced in — the reverse DCF, on the Valuation tab. Takes the enterprise value the card above
// already built (one price, newest column, the Goldman EA-proxy bridge) and the newest year's free
// cash flow, and solves for the growth in that cash flow the price implies. The solve is in
// src/reverse.js and tested there; this only formats it.
//
// Two decisions carry the whole thing. (1) The cost of capital and terminal growth are the READER'S:
// the template rules that the `wacc` row is judgement and never auto-filled, and a reverse DCF that
// quietly picked one would be printing an opinion in the typography of a filed figure. Damodaran's
// industry table sits beside the box as a reference a reader can copy in with a click — a reference
// is not a default. (2) The output is a computed figure, so it carries the ƒ marker and links to
// nothing, and every case with no honest answer — negative cash flow, WACC below terminal growth, a
// price outside the bracket — prints a sentence rather than a number.
function PricedIn({ grid, industry, note, S }) {
  const c = grid.cols[grid.cols.length - 1];
  const ev = c.v.ev, evMeta = c.meta.ev || {};
  const basis = pickBasis(c);
  // The template's own verdict on whether the DCF apparatus applies to this filer — see dcfApplicable.
  const applicable = dcfApplicable(NOT_APPLICABLE[industry]);
  const [wacc, setWacc] = useState("");
  const [tg, setTg] = useState("");
  const [years, setYears] = useState(10);
  const [ref, setRef] = useState(null);
  const [pick, setPick] = useState("");
  // Loaded once the plate mounts — the Valuation tab only — so a reader on Statements never fetches it.
  useEffect(() => {
    let on = true;
    fetch("/damodaran-wacc.json").then(r => (r.ok ? r.json() : null)).then(j => { if (on && j && Array.isArray(j.industries)) setRef(j); }).catch(() => {});
    return () => { on = false; };
  }, []);
  const num = s => (String(s).trim() === "" ? NaN : parseFloat(s) / 100);
  const w = num(wacc), t = num(tg);
  const ready = applicable && ev != null && !!basis;
  const res = ready && Number.isFinite(w) && Number.isFinite(t) ? impliedGrowth({ ev, fcf: basis.v, wacc: w, tg: t, years }) : null;
  const sens = res && res.ok ? sensitivity({ ev, fcf: basis.v, wacc: w, tg: t, years }) : null;
  const picked = ref && pick ? (pick === "__market" ? ref.totalMarket : ref.industries.find(i => i.name === pick)) : null;
  const pct = v => (v == null ? "—" : (v * 100).toFixed(1) + "%");
  const inputStyle = { width: 74, background: "#f6eee1", border: `1px solid ${C.hair}`, borderRadius: 6, padding: "5px 8px", font: `600 13px ${MONO}`, color: C.ink2, outline: "none", textAlign: "right" };
  const Label = ({ children }) => <span style={{ ...S.label, color: C.faint, marginRight: 8 }}>{children}</span>;
  return <div style={{ border: `1px solid ${C.hair}`, borderRadius: 10, background: C.card, padding: "14px 18px", marginBottom: 16 }}>
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
      <span style={{ ...S.label, color: C.teal }}>What's priced in</span>
      <span style={{ fontSize: 10, color: C.faint, fontFamily: MONO }}>reverse DCF · newest column only, FY{c.period.fy} ({c.period.end})</span>
    </div>
    {!ready && <p style={{ fontSize: 12, color: C.bronze, margin: "4px 0 0", fontFamily: MONO, lineHeight: 1.6 }}>
      {/* The plate has room the row status does not, so it names the business in full. SIC 6200-6299
          is one bucket holding bulge-bracket dealers, advisory boutiques and alternative managers,
          and the sticky-column measurement is why that only gets said here. */}
      {/* One sentence per industry that reaches this branch. The carriers fell through to the
          broker-dealer sentence until the REIT one was added — Chubb was "funded by client payables
          and repo" — because the ternary only ever told a bank from everything else. */}
      {!applicable ? `A reverse DCF is n/a for a ${industry === "advisory" ? "broker-dealer or asset manager" : INDUSTRY_LABEL[industry] || "filer of this kind"} — ${industry === "bank" ? "a depository is valued on capital ratios and book value, and its cash from operations swings with deposits and trading; there is no unlevered cash flow to grow."
        : industry === "pc" || industry === "life" ? "a carrier's liabilities are the business, so enterprise value and unlevered cash flow are category errors here, not gaps; carriers are valued on book value and return on equity."
        : industry === "reit" ? "no capital-expenditure concept means the same thing across REITs (development at one, redevelopment at another, recurring at a third), so there is no free cash flow to grow; FFO is the cash measure the sector is valued on."
        : "it is funded by client payables, repo and consolidated fund liabilities, which total debt cannot see — so enterprise value and unlevered cash flow are category errors here, not gaps."}`
        : ev == null && evMeta.status === "not-applicable" ? "Enterprise value is n/a for this filer's industry — it is a category error for a bank or a carrier, so there is nothing to solve against."
        : ev == null && evMeta.status === "currency-mismatch" ? `The price is in dollars and these figures are in ${evMeta.ccy}, as filed — no enterprise value is built across the two, so there is nothing to solve against.`
        // The price arrived and the bridge still did not close, which is a different sentence. Saying
        // "no price available" here is false and sends a reader looking for a quote that is on the page
        // above — rule 5 on the plate, and the same mistake the currency branch above exists to avoid.
        // It reaches ~26 filers: Alphabet, Meta, Shopify and Snap file no undimensioned cover count at
        // all, and UPS, Comcast, Nike and Simon Property are refused under rule 26. `c.v.price` rather
        // than the quote object, which this component is not given — and which is the right test
        // anyway, since it is the price that actually reached the column.
        : ev == null && evMeta.status === "no-share-count" ? "SEC's company-facts API carries no current share count for this filer — it reports one per class of stock, and only the undimensioned figure is in this data — so there is no market capitalisation to build an enterprise value on. The price above is fine."
        : ev == null && c.v.price != null ? "The filer's total debt is not tagged for this period, so the enterprise-value bridge cannot close. The price above is fine."
        : ev == null ? (note || "No price available, so no enterprise value to solve against.")
        : "No free cash flow on the newest column — nothing to grow."}
    </p>}
    {ready && <>
      <p style={{ fontSize: 12.5, color: C.body, margin: "4px 0 12px", lineHeight: 1.65 }}>
        Enterprise value of <b style={{ fontFamily: MONO }}>{display("ev", ev)}</b> against {basis.label} of{" "}
        <b style={{ fontFamily: MONO }}>{display("fcf", basis.v)}</b>
        <span style={{ fontSize: 8, fontFamily: MONO, color: C.navy, marginLeft: 5 }} title={basis.note}>ƒ</span>.
        Give it a cost of capital and a terminal growth rate, and it solves for the constant growth in that cash flow the price implies over the horizon.
        {basis.k === "fcf" && <span style={{ color: C.bronze }}> Unlevered free cash flow is blank for this filer, so this grows cash from operations less capex, which is after interest.</span>}
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: "10px 22px", flexWrap: "wrap", marginBottom: 10 }}>
        <span><Label>WACC</Label><input type="number" step="0.1" min="0" max="99" value={wacc} onChange={e => setWacc(e.target.value)} placeholder="—" style={inputStyle} aria-label="Cost of capital, percent" /><span style={{ fontFamily: MONO, fontSize: 12, color: C.faint, marginLeft: 4 }}>%</span></span>
        <span><Label>Terminal growth</Label><input type="number" step="0.1" min="-5" max="10" value={tg} onChange={e => setTg(e.target.value)} placeholder="—" style={inputStyle} aria-label="Terminal growth, percent" /><span style={{ fontFamily: MONO, fontSize: 12, color: C.faint, marginLeft: 4 }}>%</span></span>
        <span><Label>Horizon</Label>{HORIZONS.map(h => <button key={h} onClick={() => setYears(h)} style={{ background: years === h ? "#0d6d5610" : "transparent", border: `1px solid ${years === h ? C.teal + "45" : C.hair}`, borderRadius: 6, padding: "4px 10px", marginRight: 4, cursor: "pointer", font: `600 11px ${MONO}`, color: years === h ? C.teal : C.faint }}>{h} yrs</button>)}</span>
      </div>
      {/* The reference, beside the box and never in it. A `select` rather than a lookup off the SIC: the
          filer's SIC would have to be mapped onto Damodaran's 94 names by hand, and a wrong mapping
          reads as a default the terminal chose. The reader picks the row and copies the figure in. */}
      {ref && <div style={{ display: "flex", alignItems: "center", gap: "6px 12px", flexWrap: "wrap", marginBottom: 12, fontSize: 11, color: C.mute }}>
        <Label>Reference</Label>
        <select value={pick} onChange={e => setPick(e.target.value)} style={{ background: "#f6eee1", border: `1px solid ${C.hair}`, borderRadius: 6, padding: "4px 8px", font: `11px ${MONO}`, color: C.ink2, maxWidth: 260 }} aria-label="Damodaran industry">
          <option value="">Damodaran industry cost of capital…</option>
          <option value="__market">Total market</option>
          {ref.industries.map(i => <option key={i.name} value={i.name}>{i.name}</option>)}
        </select>
        {picked && <span style={{ fontFamily: MONO, fontSize: 11 }}>
          cost of capital <b style={{ color: C.ink2 }}>{pct(picked.costOfCapital)}</b> · cost of equity {pct(picked.costOfEquity)} · D/(D+E) {pct(picked.debtWeight)} · β {picked.beta}
          <button onClick={() => setWacc((picked.costOfCapital * 100).toFixed(2))} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, marginLeft: 10, font: `600 10px ${MONO}`, letterSpacing: 1, textTransform: "uppercase", color: C.teal, textDecoration: "underline dotted", textUnderlineOffset: 3 }}>use {pct(picked.costOfCapital)} as WACC</button>
        </span>}
      </div>}
      {!res && <p style={{ fontSize: 10, color: C.faint, fontFamily: MONO, margin: 0, letterSpacing: .5 }}>Both inputs are judgement — the plate solves once both are in.</p>}
      {res && !res.ok && <p style={{ fontSize: 12, color: C.bronze, margin: 0, fontFamily: MONO, lineHeight: 1.6 }}>{REASONS[res.reason]}</p>}
      {res && res.ok && <div>
        <p style={{ font: `400 19px/1.4 ${SERIF}`, color: C.ink, margin: "2px 0 4px" }}>
          The price implies <b style={{ fontFamily: MONO, fontSize: 17, color: res.g < 0 ? C.bronze : C.teal }}>{pct(res.g)}</b> a year growth in {basis.label} for {res.years} years
          <span style={{ fontSize: 9, fontFamily: MONO, color: C.navy, marginLeft: 6 }} title="Computed from the enterprise value and your inputs — it exists in no filing and links to nothing">ƒ</span>
        </p>
        <p style={{ fontSize: 10.5, color: C.faint, fontFamily: MONO, margin: "0 0 10px", lineHeight: 1.6 }}>
          terminal value is {pct(res.tvShare)} of enterprise value · year-{res.years} cash flow {display("fcf", res.fcfN)} · at {pct(w)} WACC and {pct(t)} terminal growth
        </p>
        {sens && <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontFamily: MONO, fontSize: 12 }}>
            <thead><tr>
              <th style={{ textAlign: "left", padding: "4px 10px 4px 0", fontSize: 9, fontWeight: 600, letterSpacing: 1.5, textTransform: "uppercase", color: C.faint }}>WACC \ terminal</th>
              {sens.tgs.map(g => <th key={g} style={{ textAlign: "right", padding: "4px 12px", fontSize: 11, fontWeight: 600, color: C.mute, borderBottom: `1px solid ${C.hair}` }}>{pct(g)}</th>)}
            </tr></thead>
            <tbody>{sens.rows.map((row, i) => <tr key={i}>
              <td style={{ padding: "5px 10px 5px 0", color: C.mute, fontSize: 11, borderBottom: `1px solid ${C.hair2}` }}>{pct(sens.waccs[i])}</td>
              {row.map((g, j) => { const centre = i === 1 && j === 1; return <td key={j} style={{ textAlign: "right", padding: "5px 12px", color: g == null ? C.hair : centre ? C.ink : C.ink2, fontWeight: centre ? 700 : 400, borderBottom: `1px solid ${C.hair2}`, background: centre ? "#0d6d5610" : "transparent" }}>{g == null ? "—" : pct(g)}</td>; })}
            </tr>)}</tbody>
          </table>
        </div>}
      </div>}
      <p style={{ fontSize: 10, color: C.faint, margin: "12px 0 0", lineHeight: 1.6 }}>
        A plain DCF run backwards: {years} years of cash flow at one growth rate, then a Gordon terminal value. The inputs are yours, the answer is only as good as they are, and nothing here is a price target or advice.
        {ref && <> Reference rates: <a href={ref.url} target="_blank" rel="noopener noreferrer" style={{ color: C.teal }}>Damodaran, NYU Stern</a>, {ref.asOf}.</>}
      </p>
    </>}
  </div>;
}

function SectionRows({ sec, grid, S, link, naLabel = "n/a", cik }) {
  const anyValue = sec.lines.some(l => grid.cols.some(c => c.v[l.k] != null));
  return <>
    {/* The cell spans the whole table, so its contents scroll away with the years — and since the
        sheet opens pinned to the newest year, the section titles were off-screen from the moment it
        loaded. The inner div sticks to the left edge of the scroll container instead, so the title
        stays put exactly like the line-item column beside it. Sticky has to go on the DIV: a
        full-width td has nowhere to stick to. */}
    <tr><td colSpan={grid.cols.length + 1} style={{ padding: 0, borderTop: `1px solid ${C.hair}` }}>
      <div style={{ position: "sticky", left: 0, display: "inline-block", padding: "14px 14px 6px", whiteSpace: "nowrap" }}>
        <span style={{ ...S.label, color: C.teal }}>{sec.title}</span>
        <span style={{ fontSize: 9, color: C.faint, fontFamily: MONO, marginLeft: 10 }}>feeds {sec.feeds}</span>
        {link && !anyValue && <a href={link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 9, color: C.bronze, fontFamily: MONO, marginLeft: 10 }}>open this statement ↗</a>}
      </div>
    </td></tr>
    {sec.lines.map(line => {
      const cells = grid.cols.map(c => ({ v: c.v[line.k], m: c.meta[line.k] || {} }));
      const has = cells.some(x => x.v != null);
      // A value that arrived outranks every label. This used to test `how` first, so a valuation
      // line read "needs price" forever — including when the price had arrived and the multiple was
      // printed in the cell beside the label, which reads as a broken deployment rather than a
      // mislabelled row. Whether a figure is THERE is the first question; why it isn't comes second.
      // "not tagged" means "disclosed somewhere in the filing — go and look", so it must never
      // land on a COMPUTED line. Nobody tags an underwriting profit, an insurance float or a
      // three-year revenue CAGR; those are blank because an input above them is blank, and the
      // input is already carrying its own label. Sending a reader into a 10-K to hunt for a figure
      // that exists in no filing is the most expensive kind of wrong label on this page.
      const newest = cells[cells.length - 1];
      const newestBlank = !!newest && newest.v == null && newest.m.status !== "not-applicable";
      // A valuation row blanked because the filer reports in another currency must NOT read "needs
      // price": the price arrived and is fine, and sending a reader to look for a missing quote is
      // rule 5's complaint exactly — the wrong kind of blank. It names the currency instead, which
      // is also the answer to "why is this the one company with no EV".
      const ccyBlocked = newest && newest.m.status === "currency-mismatch" ? newest.m.ccy : null;
      // Rule 5's fifth kind. The filer tagged this line, for this period, in another currency — so it
      // is not "not tagged" (go and look) and not "n/a" (does not exist); it is findable, in dollars,
      // on a sheet denominated in something else. Keyed to the newest column like `blankNote`, since
      // that is the column the question is asked of.
      const ccyOther = newest && newest.m.status === "other-currency" ? newest.m.ccy : null;
      // Rule 5's SIXTH kind, and it arrived the same way the fifth did — by a new refusal falling
      // through to "not tagged", which means *disclosed but untagged, go and look*. For a working
      // capital movement the engine declined to total, that is exactly wrong twice over: the filer
      // DID tag it, for this period, and what is missing is a leg no amount of looking will find in
      // the filing, because the filer folded it into another line. The row is not empty for want of
      // a number; it is empty because the numbers on file do not add up to the one it is named for.
      const wcPartial = newest && newest.m.status === "wc-partial";
      // The cover-page share count, refused as stale or as zero. Both must be said in words: the
      // count IS on the cover of the latest filing, so "not tagged" would send a reader to look at
      // something that is right there and disagrees with the page. What is missing is the count in
      // SEC's company-facts API, which carries only the undimensioned figure.
      const coverBad = newest && (newest.m.status === "cover-stale" ? `cover count from ${String(newest.m.filed || "").slice(0, 4)}`
        : newest.m.status === "cover-zero" ? "cover count filed as zero" : null);
      // ...and every row the market-cap bridge could not reach because of it. "needs price" is false
      // here — the price arrived and is fine.
      const noShares = newest && newest.m.status === "no-share-count";
      const status = has ? null
        : cells[0] && cells[0].m.status === "not-applicable" ? naLabel
        : ccyBlocked ? `reported in ${ccyBlocked}`
        : ccyOther ? `filed in ${ccyOther}`
        : coverBad ? coverBad
        : noShares ? "no share count"
        : wcPartial ? "partly tagged"
        : line.how === "manual" ? "judgement"
        : line.how === "market" ? "needs price"
        : line.how === "computed" ? null
        : cells[0] && cells[0].m.status === "never-tagged" ? "n/a" : "not tagged";
      const statusColor = status === "judgement" ? C.teal : status === naLabel || status === "n/a" ? C.faint : status === "needs price" ? C.navy : C.bronze;
      return <tr key={line.k} style={{ borderTop: `1px solid ${C.hair2}` }}>
        <td style={{ padding: "6px 14px", position: "sticky", left: 0, background: C.card, whiteSpace: "nowrap" }}>
          <span style={{ color: has ? C.ink2 : C.faint }}>{line.label}</span>
          {line.how === "computed" && <span style={{ fontSize: 8, fontFamily: MONO, color: C.navy, marginLeft: 7 }} title={line.formula}>ƒ</span>}
          {status && <span style={{ fontSize: 8, fontFamily: MONO, color: statusColor, marginLeft: 8, letterSpacing: .5 }}>{status}</span>}
          {line.note && <div style={NOTE_STYLE}>{line.note}</div>}
          {/* A note that only exists when the row is empty. Keyed off the NEWEST column rather than
              the whole row, because the case that misleads is the half-blank one: Schlumberger's EBIT
              populates through FY2023 and stops exactly at the column the valuation block divides
              into, so a row-wide test would stay silent on the filers it matters most for. Never
              shown where NOT_APPLICABLE did the blanking — a bank's EBIT is already saying "n/a for
              a bank", which is a different and better answer. */}
          {newestBlank && line.blankNote && <div style={NOTE_STYLE}>{line.blankNote}</div>}
          {/* And its opposite: a note for a row that IS populated, but from a tag that does not mean
              what the label says. A mortgage REIT's "Total revenue" is its interest income and a
              BDC's is its investment income, because neither files a revenue concept at all. Keyed
              off the newest column's resolved tag, so it appears only for the filers it describes. */}
          {newest && newest.m.tag && line.tagNote && line.tagNote[newest.m.tag]
            && <div style={NOTE_STYLE}>{line.tagNote[newest.m.tag]}</div>}
          {/* And the third kind: a note conditioned on something the ENGINE worked out rather than on
              a tag or a blank. The current portion of long-term debt is a real filed figure that is
              sometimes already inside the long-term figure beneath it, so it is shown and not summed
              — which a reader adding the column up would otherwise read as an arithmetic error.

              ANY column, not the newest one — and that is the opposite of `blankNote` above for a
              reason. A blank note answers "why is this row empty", which is a question the reader asks
              about the column the valuation divides into, so keying it to the newest column is what
              makes it fire on the half-blank case. A flag note discharges an obligation instead: a
              column whose rows do not add up to its own total has to say why, and that debt is owed by
              whichever column carries the flag. Keyed to the newest, three filers went silent on it —
              Old Dominion drops the current portion from six columns and its newest is not one of them,
              so the row rule 15 exists to explain rendered with no explanation at all, and UPS's
              duplicate sits in its oldest column. */}
          {/* The text may be a FUNCTION of the newest flagged column, so a note can print the filer's
              own figure instead of asserting a category. The near-cancelled-equity mark needs that:
              its threshold is a judgement rather than a reading, so the threshold decides only when to
              speak and the number the reader is shown is Colgate's actual 0.33%. */}
          {line.flagNote && Object.entries(line.flagNote).map(([k, text]) => {
            let hit = null;
            for (const c of grid.cols) if (c.v[k]) hit = c;
            return hit ? <div key={k} style={NOTE_STYLE}>{typeof text === "function" ? text(hit) : text}</div> : null;
          })}
        </td>
        {cells.map((x, i) => {
          const shown = display(line.k, x.v, x.m.unit);
          // Only a REPORTED figure carries an accession, and only a reported figure should claim to
          // be verifiable. A computed line has no single source — EBITDA is not in any filing — and
          // linking it would be the one dishonest thing on a page whose whole argument is
          // provenance. Those keep the ƒ marker and stay plain text.
          const url = shown != null && x.m.accn ? secFilingUrl(cik, x.m.accn) : null;
          return <td key={i} style={{ padding: "7px 14px", textAlign: "right", fontFamily: MONO, fontSize: 13, color: x.v == null ? C.hair : C.ink2, whiteSpace: "nowrap" }}
            title={x.m.tag ? `${x.m.status === "split-adjusted" ? `filed as ${x.m.filedValue}; shown ${x.m.splitMark} on today's share basis after a split — ` : ""}${x.m.displaced ? `read from the ${x.m.form} filed ${x.m.filed}, the newest filing presenting the whole balance sheet at this date; the newest filing for this line alone (${x.m.displaced.form} filed ${x.m.displaced.filed}) carries ${x.m.displaced.value === x.v ? "the same figure" : display(line.k, x.m.displaced.value, x.m.unit)} — ` : ""}${x.m.tag} · ${x.m.form} filed ${x.m.filed}${url ? " — click to open this filing on sec.gov" : ""}` : ""}>
            {url
              ? <a className="srcnum" href={url} target="_blank" rel="noopener noreferrer">{shown}</a>
              : (shown || (x.m.status === "not-meaningful" ? "n/m" : "—"))}
            {/* Rule 31: a figure carried to today's share basis is marked ON THE CELL, not only in the
                tooltip, because a phone has no hover and the header says every figure is as filed. The
                marker is what was done to this number; the row's note says why and names the split. */}
            {x.m.status === "split-adjusted" && <span style={{ fontSize: 8, fontFamily: MONO, color: C.bronze, marginLeft: 4, letterSpacing: .3 }}>{x.m.splitMark}</span>}
          </td>;
        })}
      </tr>;
    })}
  </>;
}
