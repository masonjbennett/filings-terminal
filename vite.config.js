import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vercel runs api/*.js as serverless functions in production; Vite alone does not, which would make
// the whole app untestable locally. This mounts the same handler files on the dev server with a
// minimal req/res shim, so `npm run dev` exercises the real code path against real SEC responses
// rather than a stub that can drift from what ships.
const apiDev = () => ({
  name: "api-dev",
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url.startsWith("/api/")) return next();
      const url = new URL(req.url, "http://localhost");
      const name = url.pathname.replace("/api/", "").replace(/\.js$/, "");
      try {
        const mod = await server.ssrLoadModule(`/api/${name}.js`);
        const shim = {
          statusCode: 200,
          setHeader: (k, v) => res.setHeader(k, v),
          status(c) { this.statusCode = c; return this; },
          json(body) { res.statusCode = this.statusCode; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(body)); return this; },
        };
        await mod.default({ query: Object.fromEntries(url.searchParams), method: req.method, headers: req.headers }, shim);
      } catch (e) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: String((e && e.message) || e) }));
      }
    });
  },
});

// PORT is honoured so the dev server can be told where to bind rather than picking the next free port
// itself. Vite's default is to auto-increment off 5173, which means a second session gets a port
// nobody told it about — and a tool pointed at 5173 then quietly loads whatever is already there.
export default defineConfig({
  plugins: [react(), apiDev()],
  server: { port: Number(process.env.PORT) || 5173 },
});
