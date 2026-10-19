// Results intake, run by .github/workflows/results-intake.yml on a "results" issue. Reads the issue from
// the GitHub event file (never from the shell), finds every JSON block (one per results file: a desktop
// run makes one per scene), validates each, and writes the valid ones to results/community/.
// Writes step outputs for the workflow: ok, files, device, summary, comment.
// The issue body is untrusted: it is only parsed as JSON, never executed, and file names are slugged.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { slug, validate } from "./validate-results.mjs";

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const issue = event.issue;
const body = String(issue?.body ?? "");
const out = (key, value) => {
  const text = String(value);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}<<__EOF__\n${text}\n__EOF__\n`);
  else console.log(`${key}: ${text}`);
};

/** Issue forms render each field as "### Label\n\nvalue"; JSON comes in fenced blocks. */
const section = (label) => new RegExp(`### ${label}\\s+([\\s\\S]*?)(?=\\n### |$)`).exec(body)?.[1]?.trim() ?? "";
/** Fenced blocks, parsed line by line as Markdown does (a regex pairs one block's closing fence with the next's opening). */
function fencedBlocks(text) {
  const found = [];
  let lang = null;
  let lines = [];
  for (const line of text.split(/\r?\n/)) {
    const fence = /^\s*```\s*([\w-]*)\s*$/.exec(line);
    if (lang === null && fence) {
      lang = fence[1].toLowerCase();
      lines = [];
    } else if (lang !== null && /^\s*```\s*$/.test(line)) {
      found.push({ lang, text: lines.join("\n") });
      lang = null;
    } else if (lang !== null) lines.push(line);
  }
  return found;
}
const blocks = fencedBlocks(body)
  .filter((b) => b.lang === "json" || (b.lang === "" && b.text.trim().startsWith("{")))
  .map((b) => b.text);
if (!blocks.length) {
  const bare = section("Results JSON");
  if (bare.startsWith("{")) blocks.push(bare);
}

const device = section("Device").slice(0, 120);
const conditions = section("Conditions").slice(0, 300);
const problems = [];
const files = [];
const summaries = [];
const dir = join("results", "community");
mkdirSync(dir, { recursive: true });

blocks.forEach((text, i) => {
  const label = blocks.length > 1 ? `JSON block ${i + 1}` : "The results JSON";
  let report;
  try {
    report = JSON.parse(text);
  } catch {
    problems.push(`${label} isn't valid JSON. Paste the whole file, unedited.`);
    return;
  }
  const result = validate(report);
  if (!result.ok) {
    for (const p of result.problems) problems.push(`${label}: ${p}`);
    return;
  }
  report.submission = { issue: issue.number, device, conditions, submittedBy: issue.user?.login ?? "" };
  if (!report.environment.note && device) report.environment.note = device;
  const date = String(report.date).slice(0, 10).replace(/[^0-9-]/g, "") || "undated";
  const scene = report.scene ? `-${String(report.scene).replace(/[^a-z]/g, "")}` : "";
  const name = slug({ environment: { note: device || report.environment.note, gpu: report.environment.gpu, userAgent: report.environment.userAgent } });
  const file = join(dir, `${date}-${name}${scene}-issue-${issue.number}.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  files.push(file);
  summaries.push(`${result.summary.scenes.join(", ")} (${result.summary.cells} measurements)`);
});

if (!blocks.length) problems.push("I couldn't find any results JSON. Paste each results file as its own ```json block.");

if (problems.length || !files.length) {
  out("ok", "false");
  out(
    "comment",
    `Thanks for running 2dbench! These results can't be added yet:\n\n- ${problems.join("\n- ")}\n\nEdit the issue to fix them and this check runs again.`,
  );
  process.exit(0);
}
out("ok", "true");
out("files", files.join("\n"));
out("device", device || "device");
out("summary", summaries.join("; "));
