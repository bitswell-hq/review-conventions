// commitlint formatter: the shared reporter's output (annotations under
// Actions, a job-summary table, plain lines locally) for commit messages.

import { report } from "./report.mjs";

export default function format(results) {
  const findings = [];
  for (const r of results.results ?? []) {
    const subject = (r.input ?? "").split("\n", 1)[0];
    for (const p of [...(r.errors ?? []), ...(r.warnings ?? [])]) {
      findings.push({ rule: p.name.replace(/^review-conventions\//, ""), message: p.message, where: `"${subject}"` });
    }
  }
  const mode = process.env.REVIEW_CONVENTIONS_MODE === "block" ? "block" : "warn";
  report(findings, { name: "Commit messages", mode, help: "See .gitmessage." });
  const checked = results.results?.length ?? 0;
  return `${checked} commit(s) checked, ${findings.length} finding(s).`;
}
