import { useState, useEffect, useMemo, useRef } from "react";
import { SECTIONS } from "./template.js";
import { annualPeriods, pickFact, latestFact, DERIVED, YOY } from "./extract.js";

// Paper & ink, same as masonjbennett.com — this is his tool and it should read as his.
const C = { paper:"#faf3ea", ink:"#262421", ink2:"#33302c", body:"#4a443c", mute:"#6f675c", faint:"#8a8072",
  hair:"#e3d5bf", hair2:"#efe4d2", card:"#fffdf9", teal:"#0d6d56", navy:"#1f5a9e", bronze:"#b0741e", claret:"#990f3d" };
const MONO = "'JetBrains Mono',ui-monospace,Consolas,monospace";
const SERIF = "'Instrument Serif','Palatino Linotype',Georgia,serif";
const SANS = "'Space Grotesk','Segoe UI',system-ui,sans-serif";

// Balance-sheet style lines are INSTANTS (a value at a date); income and cash-flow lines are
// DURATIONS (a value over a span). Getting this wrong is how a full-year balance sheet ends up
// beside nine months of earnings, so it is declared rather than guessed.
const INSTANT_SECTIONS = new Set(["bs", "debtlike", "dilution"]);
const INSTANT_LINES = new Set(["sharesOut", "nol", "taxCredits"]);
const isInstant = (sec, k) => INSTANT_LINES.has(k) || INSTANT_SECTIONS.has(sec);

const REV_TAGS = SECTIONS[0].lines[0].tags;

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
const PCT = new Set(["grossMargin","ebitdaMargin","ebitMargin","netMargin","fcfMargin","taxRate","cashTaxRate","revGrowth","ebitdaGrowth","epsGrowth","roic","roe","roa","nwcPctRev","capexPctRev","daPctRev","sbcPctRev","fcfConv","debtCap","fcfYield","divYield","premium1d"]);
const MULT = new Set(["netLev","grossLev","intCover","fccr","debtEquity","currentRatio","quickRatio","assetTurn","evRev","evEbitda","evEbit","evFcf","pe","pb"]);
const DAYS = new Set(["dso","dio","dpo","ccc"]);
const display = (k, v, unit) => v == null ? null : PCT.has(k) ? fmtPct(v) : MULT.has(k) ? fmtX(v) : DAYS.has(k) ? Math.round(v) + "d" : fmtNum(v, unit);

export default function App() {
  const [tickers, setTickers] = useState(null);
  const [q, setQ] = useState("");
  const [co, setCo] = useState(null);          // { cik, ticker, title }
  const [data, setData] = useState(null);      // /api/facts payload
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [sections, setSections] = useState(null); // rendered-statement links for the newest 10-K
  const [copied, setCopied] = useState("");
  const [quote, setQuote] = useState(null);
  const [quoteNote, setQuoteNote] = useState("");
  const scroller = useRef(null);

  useEffect(() => { fetch("/tickers.json").then(r => r.json()).then(setTickers).catch(() => setErr("couldn't load the company list")); }, []);

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

  const load = async (cik, ticker, title) => {
    setCo({ cik, ticker, title }); setQ(""); setErr(""); setBusy(true); setData(null); setSections(null); setQuote(null); setQuoteNote("");
    try {
      const r = await fetch(`/api/facts?cik=${cik}`);
      const d = await r.json();
      if (!r.ok) { setErr(d.error || "that lookup failed"); setBusy(false); return; }
      setData(d);
      const k10 = (d.filings || []).find(f => f.form === "10-K");
      if (k10) fetch(`/api/sections?cik=${cik}&accn=${k10.accn}`).then(r => r.json()).then(setSections).catch(() => {});
      // The price is a nice-to-have on top of the filings, so it never blocks the sheet and never
      // fails it: no key, no coverage, no answer — the valuation rows just stay "needs price".
      const sym = (d.tickers && d.tickers[0]) || ticker;
      if (sym) fetch(`/api/quote?symbol=${encodeURIComponent(sym)}`).then(async r => {
        const q = await r.json();
        if (r.ok) setQuote(q);
        else setQuoteNote(q.needsKey ? "valuation rows need FINNHUB_KEY on this deployment" : q.error || "no quote available");
      }).catch(() => setQuoteNote("couldn't reach the quote desk"));
    } catch { setErr("couldn't reach the filing desk"); }
    setBusy(false);
  };

  // ── Build the grid ───────────────────────────────────────────────────────────────────────────
  const grid = useMemo(() => {
    if (!data) return null;
    const facts = data.facts || {};
    // annualPeriods returns newest-first because "the most recent 8 years" is the natural way to
    // take a slice. Models read the other way — oldest on the left, this year on the right, so a
    // growth row reads forward — so the columns are flipped once, here, and everything downstream
    // (the sheet, the Excel copy) inherits the right order rather than each fixing it separately.
    const periods = annualPeriods(facts, REV_TAGS, 8).reverse();
    if (!periods.length) return { periods: [], rows: [], empty: true };

    // Column at a time: fetch every tagged line, then derive, so derived lines can read the ones
    // above them in the same column.
    const cols = periods.map(p => {
      const v = {}, meta = {};
      for (const sec of SECTIONS) for (const line of sec.lines) {
        if (line.how !== "fetched" || !line.tags) continue;
        const inst = isInstant(sec.id, line.k);
        const got = line.latest ? latestFact(facts, line.tags) : pickFact(facts, line.tags, inst ? { end: p.end } : p);
        v[line.k] = got.value; meta[line.k] = got;
      }
      for (const [k, fn] of Object.entries(DERIVED)) { const out = fn(v); if (out != null) { v[k] = out; meta[k] = { status: "computed" }; } else if (!(k in v)) { v[k] = null; meta[k] = { status: "computed" }; } }
      return { period: p, v, meta };
    });
    // Growth lines need the PRIOR year, which now sits to the LEFT. Getting this index backwards
    // would invert every growth rate silently — the number would still look plausible.
    cols.forEach((c, i) => {
      const prev = cols[i - 1];
      for (const [k, src] of Object.entries(YOY)) {
        const a = c.v[src], b = prev && prev.v[src];
        c.v[k] = a != null && b != null && b !== 0 ? a / b - 1 : null;
        c.meta[k] = { status: "computed" };
      }
    });
    // Valuation lands on the NEWEST column only, and that restraint is the point. There is one
    // price — today's — so an EV/EBITDA against FY2019 would be today's enterprise value over a
    // six-year-old profit: a number that looks like a multiple and means nothing. Historical
    // multiples need historical prices, which the free quote tier does not carry.
    if (quote && quote.price && cols.length) {
      const c = cols[cols.length - 1], v = c.v;
      const mark = (k, val) => { v[k] = val == null || !isFinite(val) ? null : val; c.meta[k] = { status: "market" }; };
      mark("price", quote.price);
      const mktCap = v.sharesOut != null ? quote.price * v.sharesOut : null;
      mark("mktCap", mktCap);
      const ev = mktCap == null || v.totalDebt == null ? null
        : mktCap + v.totalDebt + (v.preferred || 0) + (v.nciBs || 0) - (v.cash || 0) - (v.sti || 0);
      mark("ev", ev);
      mark("evRev", ev && v.revenue ? ev / v.revenue : null);
      mark("evEbitda", ev && v.ebitda ? ev / v.ebitda : null);
      mark("evEbit", ev && v.ebit ? ev / v.ebit : null);
      mark("evFcf", ev && v.fcf ? ev / v.fcf : null);
      mark("pe", v.epsDil ? quote.price / v.epsDil : null);
      mark("pb", mktCap && v.equity ? mktCap / v.equity : null);
      mark("fcfYield", mktCap && v.fcf != null ? v.fcf / mktCap : null);
      mark("divYield", v.dps ? v.dps / quote.price : null);
    }
    return { periods, cols };
  }, [data, quote]);

  // After the grid paints, jump to the newest year. Runs on the data rather than on mount, because
  // the table does not exist yet when the fetch is still in flight.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [data]);

  const sectionLink = kind => {
    if (!sections || !sections.reports) return null;
    const r = sections.reports.find(x => (x.kinds || []).includes(kind));
    return r ? r.url : (sections.index || null);
  };
  const kindFor = secId => (secId === "is" || secId === "addbacks" ? "is" : secId === "bs" || secId === "debtlike" ? "bs" : secId === "cf" ? "cf" : secId === "dilution" ? "sbc" : secId === "dcf" ? "tax" : null);

  const copyTsv = () => {
    if (!grid || !grid.cols) return;
    const out = [["Line item", ...grid.cols.map(c => c.period.end)].join("\t")];
    for (const sec of SECTIONS) {
      out.push(sec.title);
      for (const line of sec.lines) {
        if (line.how === "manual" || line.how === "market") continue;
        out.push([line.label, ...grid.cols.map(c => { const v = c.v[line.k]; return v == null ? "" : (PCT.has(line.k) || MULT.has(line.k) ? v : Math.round(v * 100) / 100); })].join("\t"));
      }
    }
    navigator.clipboard.writeText(out.join("\n")).then(() => { setCopied("Copied — paste into Excel"); setTimeout(() => setCopied(""), 3000); })
      .catch(() => setCopied("Clipboard blocked by the browser"));
  };

  const S = {
    page: { background: C.paper, minHeight: "100vh", color: C.body, fontFamily: SANS, fontSize: 15 },
    wrap: { maxWidth: 1180, margin: "0 auto", padding: "0 24px 80px" },
    label: { fontSize: 9, fontFamily: MONO, letterSpacing: 2, textTransform: "uppercase", color: C.faint },
  };

  return <div style={S.page}>
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
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={tickers ? "Company name or ticker — try APPLE" : "Loading company list…"} disabled={!tickers}
          style={{ width: "100%", background: C.card, border: `1px solid ${C.hair}`, borderRadius: 10, padding: "13px 16px", fontSize: 15, fontFamily: MONO, color: C.ink2, outline: "none" }} />
        {hits.length > 0 && <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20, marginTop: 4, background: C.card, border: `1px solid ${C.hair}`, borderRadius: 10, overflow: "hidden", boxShadow: "0 12px 34px rgba(64,52,32,.13)" }}>
          {hits.map(([cik, tic, title]) => <button key={cik + tic} onClick={() => load(cik, tic, title)}
            style={{ display: "flex", gap: 12, alignItems: "baseline", width: "100%", padding: "10px 15px", background: "none", border: "none", borderBottom: `1px solid ${C.hair2}`, cursor: "pointer", textAlign: "left", fontFamily: SANS }}
            onMouseEnter={e => e.currentTarget.style.background = "#0d6d5608"} onMouseLeave={e => e.currentTarget.style.background = "none"}>
            <span style={{ font: `600 12px ${MONO}`, color: C.teal, minWidth: 62 }}>{tic}</span>
            <span style={{ fontSize: 13.5, color: C.ink2 }}>{title}</span>
          </button>)}
        </div>}
      </div>

      {err && <p style={{ color: C.claret, fontFamily: MONO, fontSize: 12 }}>{err}</p>}
      {busy && <p style={{ color: C.faint, fontFamily: MONO, fontSize: 12 }}>Reading EDGAR…</p>}

      {data && grid && <>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap", marginBottom: 6 }}>
          <h2 style={{ font: `400 26px/1.2 ${SERIF}`, color: C.ink, margin: 0 }}>{data.name}</h2>
          <span style={{ font: `600 12px ${MONO}`, color: C.teal }}>{(data.tickers || []).join(" · ")}</span>
          <span style={{ fontSize: 11, color: C.faint }}>{data.sic}</span>
          <button onClick={copyTsv} style={{ marginLeft: "auto", background: "none", border: `1px solid ${C.teal}40`, borderRadius: 8, padding: "7px 14px", color: C.teal, font: `600 10px ${MONO}`, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}>Copy sheet for Excel</button>
        </div>
        <p style={{ fontSize: 11, color: C.faint, fontFamily: MONO, marginBottom: 18 }}>
          {data.meta.tagsKept} tagged concepts kept · {data.meta.tagsDropped} outside the template · {(data.filings || []).length} filings on file
          {quote && <span style={{ color: C.teal, marginLeft: 12 }}>${quote.price.toFixed(2)} — valuation on the newest year only, one price to divide with</span>}
          {quoteNote && <span style={{ color: C.bronze, marginLeft: 12 }}>{quoteNote}</span>}
          {copied && <span style={{ color: C.teal, marginLeft: 12 }}>{copied}</span>}
        </p>

        {grid.empty && <p style={{ color: C.bronze, fontFamily: MONO, fontSize: 12 }}>No annual XBRL periods on file — this filer may report under IFRS (20-F) or predate tagging.</p>}

        {/* Opens pinned to the right-hand edge — the current year, which is what you came to see —
            and scrolling left walks back through history. Model order without making the newest
            year the one you have to go looking for. */}
        {grid.cols && <div ref={scroller} style={{ overflowX: "auto", border: `1px solid ${C.hair}`, borderRadius: 10, background: C.card }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead><tr style={{ background: "#f6eee1" }}>
              <th style={{ ...S.label, textAlign: "left", padding: "10px 14px", position: "sticky", left: 0, background: "#f6eee1", minWidth: 230 }}>Line item</th>
              {grid.cols.map(c => <th key={c.period.end} style={{ ...S.label, textAlign: "right", padding: "10px 14px", whiteSpace: "nowrap" }}>FY{c.period.fy || c.period.end.slice(0, 4)}<div style={{ fontSize: 8, opacity: .6, letterSpacing: 1 }}>{c.period.end}</div></th>)}
            </tr></thead>
            <tbody>
              {SECTIONS.map(sec => <SectionRows key={sec.id} sec={sec} grid={grid} S={S} link={sectionLink(kindFor(sec.id))} />)}
            </tbody>
          </table>
        </div>}

        <div style={{ marginTop: 16, display: "flex", gap: 18, flexWrap: "wrap", fontSize: 10, fontFamily: MONO, color: C.faint }}>
          <span><b style={{ color: C.ink2 }}>reported</b> — filed value</span>
          <span><b style={{ color: C.navy }}>computed</b> — derived here</span>
          <span><b style={{ color: C.bronze }}>not tagged</b> — disclosed but untagged; use the section link</span>
          <span><b style={{ color: C.faint }}>n/a</b> — this filer has never reported it</span>
          <span><b style={{ color: C.teal }}>judgement</b> — never auto-filled</span>
        </div>
      </>}
    </div>
  </div>;
}

function SectionRows({ sec, grid, S, link }) {
  const anyValue = sec.lines.some(l => grid.cols.some(c => c.v[l.k] != null));
  return <>
    <tr><td colSpan={grid.cols.length + 1} style={{ padding: "14px 14px 6px", borderTop: `1px solid ${C.hair}` }}>
      <span style={{ ...S.label, color: C.teal }}>{sec.title}</span>
      <span style={{ fontSize: 9, color: C.faint, fontFamily: MONO, marginLeft: 10 }}>feeds {sec.feeds}</span>
      {link && !anyValue && <a href={link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 9, color: C.bronze, fontFamily: MONO, marginLeft: 10 }}>open this statement ↗</a>}
    </td></tr>
    {sec.lines.map(line => {
      const cells = grid.cols.map(c => ({ v: c.v[line.k], m: c.meta[line.k] || {} }));
      const has = cells.some(x => x.v != null);
      const status = line.how === "manual" ? "judgement" : line.how === "market" ? "needs price" :
        has ? null : cells[0] && cells[0].m.status === "never-tagged" ? "n/a" : "not tagged";
      const statusColor = status === "judgement" ? C.teal : status === "n/a" ? C.faint : status === "needs price" ? C.navy : C.bronze;
      return <tr key={line.k} style={{ borderTop: `1px solid ${C.hair2}` }}>
        <td style={{ padding: "6px 14px", position: "sticky", left: 0, background: C.card, whiteSpace: "nowrap" }}>
          <span style={{ color: has ? C.ink2 : C.faint }}>{line.label}</span>
          {line.how === "computed" && <span style={{ fontSize: 8, fontFamily: MONO, color: C.navy, marginLeft: 7 }} title={line.formula}>ƒ</span>}
          {status && <span style={{ fontSize: 8, fontFamily: MONO, color: statusColor, marginLeft: 8, letterSpacing: .5 }}>{status}</span>}
          {line.note && <div style={{ fontSize: 9, color: C.faint, fontStyle: "italic", marginTop: 1 }}>{line.note}</div>}
        </td>
        {cells.map((x, i) => <td key={i} style={{ padding: "6px 14px", textAlign: "right", fontFamily: MONO, fontSize: 12, color: x.v == null ? C.hair : C.ink2, whiteSpace: "nowrap" }}
          title={x.m.tag ? `${x.m.tag} · ${x.m.form} filed ${x.m.filed}` : ""}>
          {display(line.k, x.v, x.m.unit) || "—"}
        </td>)}
      </tr>;
    })}
  </>;
}
