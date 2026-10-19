import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * `npm run phone` serves the built pages on the LAN. This lets mobile.html send its results back:
 * POST /results saves the JSON to results/<date>-device-<slug>.json, so nothing has to be copied by hand.
 * Only the preview server has it; the GitHub Pages copy is static and mobile.html says so.
 */
function receiveResults(): Plugin {
  return {
    name: "2dbench-receive-results",
    configurePreviewServer(server) {
      server.middlewares.use("/results", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
          if (body.length > 5_000_000) req.destroy();
        });
        req.on("end", () => {
          try {
            const report = JSON.parse(body);
            const note = String(report?.environment?.note ?? "") || String(report?.environment?.userAgent ?? "device");
            const slug = note.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "device";
            const dir = join(process.cwd(), "results");
            mkdirSync(dir, { recursive: true });
            const file = join(dir, `${String(report.date ?? new Date().toISOString()).slice(0, 10)}-device-${slug}.json`);
            writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
            console.log(`Saved phone results: ${file}`);
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ saved: file }));
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "not JSON" }));
          }
        });
      });
    },
  };
}

// Two pages: index.html (one adapter, driven by run.mjs or mobile.html) and mobile.html (self-running).
// BASE is set for GitHub Pages (/2dbench/); everything else serves from the root.
export default defineConfig({
  base: process.env.BASE ?? "/",
  plugins: [receiveResults()],
  build: { rollupOptions: { input: { main: "index.html", mobile: "mobile.html" } } },
});
