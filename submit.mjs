// Submit desktop results to the public dataset: validates the file, then opens a "results" issue on GitHub
// (with the gh CLI), which a workflow turns into a pull request. Nothing is sent without your confirmation.
//   node submit.mjs results/2026-10-19-win32-particles.json
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { validate } from "./scripts/validate-results.mjs";

const REPO = "debuffjp/2dbench";
const file = process.argv[2];
if (!file) {
  console.error("usage: node submit.mjs <results file>");
  process.exit(2);
}
const report = JSON.parse(readFileSync(file, "utf8"));
const check = validate(report);
if (!check.ok) {
  console.error(`Can't submit ${file}:\n- ${check.problems.join("\n- ")}`);
  process.exit(1);
}

const env = report.environment ?? {};
const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log(`\n${check.kind} result: ${check.summary.cells} measurements (${check.summary.scenes.join(", ")}).`);
console.log("This will be public, under CC0, in github.com/debuffjp/2dbench:");
console.log(`  GPU: ${env.gpu ?? "-"}\n  CPU: ${env.cpu ?? "-"}\n  OS: ${env.os ?? "-"}\n  Browser: ${env.browser ?? "-"}\n  Power: ${env.power ?? "-"}\n  Note: ${env.note || "-"}`);
const device = (await rl.question("\nDevice (model, e.g. 'ThinkPad T14 Gen 3'): ")).trim();
const conditions = (await rl.question("Conditions (plugged in? anything else running?): ")).trim();
const yes = (await rl.question(`Open a public issue on ${REPO} with these results? [y/N] `)).trim().toLowerCase();
rl.close();
if (yes !== "y" && yes !== "yes") {
  console.log("Not submitted.");
  process.exit(0);
}

// The same layout GitHub's issue form produces, so the intake workflow reads it the same way.
const body = `### Device\n\n${device || "_No response_"}\n\n### Conditions\n\n${conditions || "_No response_"}\n\n### Results JSON\n\n\`\`\`json\n${JSON.stringify(report)}\n\`\`\`\n`;
const title = `Results: ${device || env.gpu || "desktop"}, ${report.scene ?? "all scenes"}`;
try {
  const url = execFileSync("gh", ["issue", "create", "--repo", REPO, "--title", title, "--label", "results", "--body-file", "-"], {
    input: body,
    encoding: "utf8",
  }).trim();
  console.log(`Submitted: ${url}\nA workflow will validate it and open a pull request; you'll get a comment there.`);
} catch {
  console.log(`The GitHub CLI (gh) isn't available or isn't signed in. Submit by hand instead:\n  https://github.com/${REPO}/issues/new?template=results.yml\nand paste the contents of ${file} into "Results JSON".`);
}
