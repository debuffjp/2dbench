// Validates a submitted results JSON (from run.mjs or mobile.html) before it joins the dataset.
// Used by the results-intake workflow and by submit.mjs. Exits 1 with the reasons if it's not acceptable.
//   node scripts/validate-results.mjs <file.json>
// As a module: validate(object) → { ok, kind, problems, summary }
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SCENES = new Set(["bunny", "mixed", "particles", "raycaster", "tilemap", "churn", "text", "lowres", "clip", "upload"]);
const ADAPTER = /^[a-z0-9][a-z0-9-]{1,40}$/;
// The default parity gate, and scenes that declare their own (keep in step with `gate` in src/scenes.ts and
// COVERAGE_RANGE / MAX_INTERIOR_PERCENT in src/parity.ts). A gate checked here but not in the page would
// reject honest results: text uses a wider gate because glyph rasterisation differs between libraries.
const DEFAULT_GATE = { coverage: [99.5, 100.5], interior: 0.5 };
const SCENE_GATES = { text: { coverage: [90, 110], interior: 5 } };
const outside = (p, scene) => {
  const g = SCENE_GATES[scene] ?? DEFAULT_GATE;
  return p.coveragePercent < g.coverage[0] || p.coveragePercent > g.coverage[1] || p.interiorDifferingPercent > g.interior;
};
const sane = (ms) => typeof ms === "number" && Number.isFinite(ms) && ms >= 0 && ms < 60_000;

/** Which tool produced it: "runner" (run.mjs, one scene) or "mobile" (mobile.html, every scene). */
function kindOf(r) {
  if (Array.isArray(r?.results) && typeof r?.scene === "string") return "runner";
  if (r?.results && typeof r.results === "object" && !Array.isArray(r.results)) return "mobile";
  return undefined;
}

export function validate(r) {
  const problems = [];
  const kind = kindOf(r);
  if (!kind) return { ok: false, problems: ["Not a 2dbench results file: expected the JSON from run.mjs or mobile.html."] };
  if (typeof r.date !== "string" || Number.isNaN(Date.parse(r.date))) problems.push("`date` is missing or not a date.");
  const env = r.environment ?? {};
  if (typeof env.gpu !== "string" && typeof env.userAgent !== "string") problems.push("`environment` has neither a GPU string nor a user agent.");
  if (/SwiftShader|llvmpipe|softpipe|Microsoft Basic Render/i.test(String(env.gpu ?? "")))
    problems.push(`The GPU is software-rendered (${env.gpu}), so the timings don't measure a GPU. On Linux, run with HEADED=1 (see the README).`);
  let cells = 0;
  const scenes = [];
  if (kind === "runner") {
    if (!SCENES.has(r.scene)) problems.push(`Unknown scene "${r.scene}".`);
    scenes.push(r.scene);
    for (const a of r.results) {
      if (!ADAPTER.test(String(a.adapter))) problems.push(`Bad adapter id "${a.adapter}".`);
      for (const c of a.counts ?? []) {
        cells++;
        if (!sane(c.frameMs)) problems.push(`${a.adapter} @${c.count}: frameMs is not a sane number.`);
      }
      // A runner result is only written when parity passed; check it says so.
      for (const p of Object.values(a.parity ?? {})) {
        if (outside(p, r.scene)) problems.push(`${a.adapter}: parity outside the gate.`);
      }
    }
  } else {
    for (const [scene, byAdapter] of Object.entries(r.results)) {
      if (!SCENES.has(scene)) problems.push(`Unknown scene "${scene}".`);
      scenes.push(scene);
      for (const [adapter, e] of Object.entries(byAdapter ?? {})) {
        if (!ADAPTER.test(adapter)) problems.push(`Bad adapter id "${adapter}".`);
        for (const [count, frames] of Object.entries(e?.counts ?? {})) {
          cells++;
          if (!Array.isArray(frames) || !frames.every(sane)) problems.push(`${scene} ${adapter} @${count}: frame times are not sane numbers.`);
        }
        // Files from before mobile.html ran the gate have no parity; they're accepted and shown as unchecked.
        // When it's there, an adapter outside the gate must not have been timed.
        const parity = Object.values(e?.parity ?? {});
        if (parity.some((p) => ![p?.coveragePercent, p?.interiorDifferingPercent].every((n) => typeof n === "number" && Number.isFinite(n))))
          problems.push(`${scene} ${adapter}: parity values are not numbers.`);
        else if (parity.some((p) => outside(p, scene)) && Object.keys(e?.counts ?? {}).length)
          problems.push(`${scene} ${adapter}: timed although its parity is outside the gate.`);
      }
    }
  }
  if (!cells) problems.push("No measurements in it.");
  const device = String(env.note || env.gpu || env.userAgent || "unknown device").slice(0, 120);
  return { ok: problems.length === 0, kind, problems: problems.slice(0, 20), summary: { device, scenes, cells } };
}

/** A short, safe file-name slug for the device. */
export function slug(r) {
  const env = r.environment ?? {};
  const text = String(env.note || env.gpu || env.userAgent || "device");
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "device"
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node scripts/validate-results.mjs <file.json>");
    process.exit(2);
  }
  const result = validate(JSON.parse(readFileSync(file, "utf8")));
  if (result.ok) console.log(`ok: ${result.kind} result, ${result.summary.cells} measurements, ${result.summary.scenes.join(", ")}, ${result.summary.device}`);
  else console.error(`Not accepted:\n- ${result.problems.join("\n- ")}`);
  process.exit(result.ok ? 0 : 1);
}
