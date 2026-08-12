// "Where do I find this by hand?" — answered with a link, not a page number.
//
// Every filing ships a FilingSummary.xml listing each rendered section and its R#.htm file: the
// income statement, the balance sheet, the cash flow statement, and every footnote as its own page.
// For a line the filer never tagged, that is a far better answer than "somewhere around page 47" —
// it opens the exact table the number lives in.
//
// Filings are immutable once accepted, so this caches hard.
const UA = { "User-Agent": "Mason Bennett masonjbennett.com bennettmasonj@gmail.com" };

// Which rendered section a template line belongs to, so a missing value can point at one. Matched
// against SEC's own ShortName text, which is the filer's wording and therefore varies — the
// patterns are deliberately loose and the caller falls back to the filing index when nothing hits.
const SECTION_PATTERNS = {
  // The exclusion has to lead: a trailing (?!.*comprehensive) is satisfied by "COMPREHENSIVE
  // INCOME" because nothing follows the match, so it tagged the wrong statement.
  // "Earnings" belongs here with "operations" and "income": Berkshire files "Consolidated
  // Statements of Earnings" and matched none of the three, so a blank line in its income statement
  // fell back to the filing index instead of opening the statement itself.
  is: /^(?!.*comprehensive).*(statement.*(operation|income|earnings)|^income statement)/i,
  bs: /balance sheet|statement.*financial position/i,
  cf: /statement.*cash flow/i,
  eq: /statement.*(equity|stockholders)/i,
  tax: /income tax/i,
  debt: /\bdebt\b|borrowing/i,
  leases: /lease/i,
  segments: /segment|geographic/i,
  sbc: /share-based|stock-based|compensation/i,
  pension: /pension|retirement benefit/i,
};

export default async function handler(req, res) {
  const cik = String(req.query.cik || "").replace(/\D/g, "");
  const accn = String(req.query.accn || "");
  if (!cik) return res.status(400).json({ error: "cik required" });
  // The accession number becomes part of a URL path, so it is validated rather than trusted.
  if (!/^\d{10}-\d{2}-\d{6}$/.test(accn)) return res.status(400).json({ error: "accn must look like 0000320193-25-000079" });
  res.setHeader("Cache-Control", "public, s-maxage=604800, stale-while-revalidate=604800");

  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replace(/-/g, "")}`;
  try {
    const r = await fetch(`${base}/FilingSummary.xml`, { headers: UA });
    // Older filings predate the Financial Report renderer. That is not an error — the caller just
    // links to the filing index instead, which always exists.
    if (!r.ok) return res.status(200).json({ base, index: `${base}/`, reports: [], rendered: false });
    const xml = await r.text();
    const reports = [];
    for (const m of xml.matchAll(/<Report[^>]*>([\s\S]*?)<\/Report>/g)) {
      const name = (m[1].match(/<ShortName>([\s\S]*?)<\/ShortName>/) || [])[1];
      const file = (m[1].match(/<HtmlFileName>([\s\S]*?)<\/HtmlFileName>/) || [])[1];
      if (!name || !file) continue;
      const clean = name.replace(/&amp;/g, "&").trim();
      const kinds = Object.entries(SECTION_PATTERNS).filter(([, re]) => re.test(clean)).map(([k]) => k);
      reports.push({ name: clean, url: `${base}/${file}`, kinds });
    }
    return res.status(200).json({ base, index: `${base}/`, reports, rendered: true });
  } catch (e) {
    console.error("sections failed:", e && e.message);
    return res.status(200).json({ base, index: `${base}/`, reports: [], rendered: false });
  }
}
