// Prints findings: GitHub annotations plus a job-summary table under Actions,
// plain lines elsewhere. In warn mode (and on a draft PR) annotations are
// warnings and nothing fails; in block mode they are errors and the step fails.

import { appendFileSync } from "node:fs";

const escapeData = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProperty = (s) => escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");

export const failing = (mode, draft) => mode === "block" && !draft;

// `findings`: [{ rule, message, where? }]. Returns the exit code.
export function report(findings, { name, mode, draft = false, help }) {
  const fails = failing(mode, draft) && findings.length > 0;
  const level = failing(mode, draft) ? "error" : "warning";
  const actions = process.env.GITHUB_ACTIONS === "true";
  for (const f of findings) {
    const text = f.where ? `${f.where}: ${f.message}` : f.message;
    if (actions) console.log(`::${level} title=${escapeProperty(`${name}: ${f.rule}`)}::${escapeData(text)}`);
    else console.log(`${level}: [${f.rule}] ${text}`);
  }
  const state = mode === "block" ? (draft ? "block, but a draft PR never fails" : "block") : "warn: reported, never fails";
  const lines = [`### ${name}`, ""];
  if (findings.length) {
    lines.push(`${findings.length} finding(s); mode ${state}.${help ? ` ${help}` : ""}`, "", "| Rule | Finding |", "| --- | --- |");
    for (const f of findings) {
      const text = f.where ? `${f.where}: ${f.message}` : f.message;
      lines.push(`| \`${f.rule}\` | ${text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ")} |`);
    }
  } else lines.push(`No findings (mode ${state}).`);
  lines.push("");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  else if (!findings.length) console.log(`${name}: no findings.`);
  return fails ? 1 : 0;
}
