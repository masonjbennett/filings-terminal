// The three brand typefaces, self-hosted — the same @fontsource packages and the same faces the main
// site uses, so filings.masonjbennett.com and masonjbennett.com are one publication rather than two
// that resemble each other.
//
// They were never loaded. `App.jsx` has declared Instrument Serif, Space Grotesk and JetBrains Mono
// since the first version, and nothing on the page had ever asked a browser for any of them: no
// @fontsource dependency, no <link>, no @font-face, no stylesheet in `dist/` at all. The site
// rendered in whatever each machine happened to fall back to — Palatino Linotype / Segoe UI /
// Consolas on Windows, and the computed body font in production was **Times New Roman**. It looked
// deliberate everywhere, which is why nothing caught it, and it is hard constraint 5 (keep the
// paper/ink editorial brand) failing quietly for the life of the project.
//
// It also corrects a recorded lesson: the README's `↧` story — a glyph "JetBrains Mono lacks", which
// drew as a serif capital I and read "I DOWNLOAD EXCEL WORKBOOK" through a green build — was never
// about JetBrains Mono. That font was not on the page. The glyph was missing from **Consolas**.
//
// Only the weights App.jsx actually uses: 400 and 600 are the only two values in the file, and the
// serif is used at 400 for headings alone. Importing the rest would ship font files for faces nothing
// asks for. `test/t-assets.mjs` asserts this stays true.
import "@fontsource/instrument-serif/400.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";

import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { Boundary } from "./boundary.js";

// The last resort, and the one fallback on this site that is a PAGE rather than an agate line:
// rendering nothing at the root IS the white page the boundary exists to prevent.
//
// It catches what no boundary inside App()'s return can — App's own render body, where the grid is
// built and where JSX written inline in the return runs. Everything below it should mean this never
// fires; it firing means something upstream of every card went wrong.
//
// The way back is "/" with no query string, and that matters more than it looks: a poisoned payload
// is keyed to "?t=TICKER" through a shared edge cache, so "/" is a different cache key and a
// genuinely different outcome rather than a hopeful reload. Brand colours are inlined because this
// module deliberately imports nothing from App.jsx — a fallback that depends on the thing that just
// failed is not a fallback.
const lastResort = (
  <div style={{ background: "#faf3ea", color: "#262421", minHeight: "100vh", padding: "48px 24px", fontFamily: "'Space Grotesk',system-ui,sans-serif" }}>
    <div style={{ maxWidth: 680, margin: "0 auto" }}>
      <p style={{ font: "600 10px 'JetBrains Mono',monospace", letterSpacing: 2, textTransform: "uppercase", color: "#0d6d56", margin: 0 }}>
        masonjbennett.com · filings terminal
      </p>
      <h1 style={{ fontFamily: "'Instrument Serif',Georgia,serif", fontWeight: 400, fontSize: 40, lineHeight: 1.1, margin: "14px 0 0" }}>
        This page could not be rendered
      </h1>
      <p style={{ fontSize: 14, lineHeight: 1.7, color: "#4a443c", margin: "14px 0 0" }}>
        The fault is this tool&rsquo;s, not the filer&rsquo;s, and nothing below it was a figure from a
        filing. Start again from the search box; the filings themselves are unaffected.
      </p>
      <p style={{ margin: "20px 0 0" }}>
        <a href="/" style={{ color: "#0d6d56", font: "600 11px 'JetBrains Mono',monospace", letterSpacing: 1, textTransform: "uppercase" }}>start again ↗</a>
      </p>
    </div>
  </div>
);

createRoot(document.getElementById("root")).render(
  <Boundary name="Filings Terminal" fallback={lastResort}><App /></Boundary>
);
