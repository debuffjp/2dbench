// Results intake, run by .github/workflows/results-intake.yml on a "results" issue. Reads the issue from
// the GitHub event file (never from the shell), finds the JSON block, validates it, and writes it to
// results/community/. Writes step outputs for the workflow: ok, file, device, comment.
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

/** Issue forms render each field as "### Label\n\nvalue"; the JSON field is a fenced block. */
const section = (label) => new RegExp(`### ${label}\\s+([\\s\\S]*?)(?=\\n### |$)`).exec(body)?.[1]?.trim() ?? "";
const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(body)?.[1] ?? section("Results JSON");

let report;
try {
  report = JSON.parse(fenced);
} catch {
  out("ok", "false");
  out(
    "comment",
    "Thanks for running 2dbench! I couldn't read the results: the **Results JSON** field isn't valid JSON. Please edit the issue and paste the whole JSON from **Copy results** (mobile.html) or the results file (run.mjs), unedited.",
  );
  process.exit(0);
}

const result = validate(report);
if (!result.ok) {
  out("ok", "false");
  out("comment", `Thanks for running 2dbench! These results can't be added yet:\n\n- ${result.problems.join("\n- ")}\n\nEdit the issue to fix them and this will run again.`);
  process.exit(0);
}

// Fill in what the form asked for, without overwriting what the tool recorded.
const device = section("Device").slice(0, 120);
const conditions = section("Conditions").slice(0, 300);
report.submission = { issue: issue.number, device, conditions, submittedBy: issue.user?.login ?? "" };
if (!report.environment.note && device) report.environment.note = [device, conditions].filter(Boolean).join(", ");

const dir = join("results", "community");
mkdirSync(dir, { recursive: true });
const date = String(report.date).slice(0, 10).replace(/[^0-9-]/g, "") || "undated";
const file = join(dir, `${date}-${slug({ environment: { note: device || report.environment.note, gpu: report.environment.gpu, userAgent: report.environment.userAgent } })}-issue-${issue.number}.json`);
writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);

out("ok", "true");
out("file", file);
out("device", device || result.summary.device);
out("summary", `${result.kind} result: ${result.summary.cells} measurements across ${result.summary.scenes.join(", ")}`);
