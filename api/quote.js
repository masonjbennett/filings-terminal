// Share price, and only share price.
//
// Market capitalisation is deliberately NOT taken from the quote vendor. It is computed as price ×
// the cover-page share count from the company's own filing, so the entire EV bridge stays traceable
// to SEC documents with exactly one outside input. A vendor's market cap is a black box that
// silently disagrees with the filing about diluted vs basic, treasury shares and multiple classes —
// and "where did that number come from" is the question this whole tool exists to answer.
//
// Needs FINNHUB_KEY in the Vercel project. Absent, it says so plainly rather than failing as a
// network error: the valuation rows then read "needs price", which is true and actionable.
export default async function handler(req, res) {
  const symbol = String(req.query.symbol || "").toUpperCase();
  if (!/^[A-Z.\-]{1,12}$/.test(symbol)) return res.status(400).json({ error: "bad symbol" });
  // Quotes move; the filings they are divided into do not. A short cache keeps this inside the free
  // tier's rate limit when several lookups land together, without showing a stale tape.
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  const key = process.env.FINNHUB_KEY;
  if (!key) return res.status(503).json({ error: "no FINNHUB_KEY set on this deployment", needsKey: true });
  try {
    const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`);
    if (!r.ok) return res.status(502).json({ error: `the quote desk answered ${r.status}` });
    const d = await r.json();
    // Finnhub answers 200 with zeroes for a symbol it does not cover, which would otherwise become
    // a market cap of zero and an EV that quietly equals net debt.
    if (!d || typeof d.c !== "number" || d.c === 0) return res.status(404).json({ error: `no quote for ${symbol}` });
    return res.status(200).json({ symbol, price: d.c, change: d.dp, high: d.h, low: d.l, prevClose: d.pc, at: Date.now() });
  } catch (e) {
    console.error("quote failed:", e && e.message);
    return res.status(502).json({ error: "couldn't reach the quote desk" });
  }
}
