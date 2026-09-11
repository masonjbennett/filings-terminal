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
createRoot(document.getElementById("root")).render(<App />);
