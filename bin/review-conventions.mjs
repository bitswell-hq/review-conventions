#!/usr/bin/env node
// review-conventions: checks a PR's title, description and commits against the
// caller's config. The reusable workflow runs `title`, `body` and `commits`;
// `commit-msg` is a local git hook.
//
//   review-conventions title    [--title T]
//   review-conventions body     [--body-file F] [--base B] [--head H] [--draft]
//   review-conventions commits  [--base B] [--head H]    (runs commitlint)
//   review-conventions commit-msg <file>                 (a commit-msg hook)
//
// Common options: --root (the repository checkout, default .), --config
// (relative to --root, default .github/review-conventions.json), --mode
// warn|block (default $REVIEW_CONVENTIONS_MODE, else warn), --event (a
// pull_request payload, default $GITHUB_EVENT_PATH). With an event, the
// title, body, draft flag, base, head, author and branch come from it.

import { spawnSync, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { checkBody, checkCommitMessage, checkHeader, loadContext } from "../src/core.mjs";
import { failing, report } from "../src/report.mjs";

const HOME = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COMMITLINT = "@commitlint/cli@21.2.4";

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    root: { type: "string", default: "." },
    config: { type: "string", default: ".github/review-conventions.json" },
    mode: { type: "string" },
    event: { type: "string" },
    title: { type: "string" },
    "body-file": { type: "string" },
    base: { type: "string" },
    head: { type: "string" },
    draft: { type: "boolean", default: false },
    author: { type: "string" },
    branch: { type: "string" },
  },
});

const [command, ...rest] = positionals;
const mode = opts.mode || process.env.REVIEW_CONVENTIONS_MODE || "warn";
if (!["warn", "block"].includes(mode)) {
  console.error(`mode must be warn or block, not "${mode}"`);
  process.exit(2);
}
const root = resolve(opts.root);
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

function pullRequest() {
  const eventPath = opts.event ?? process.env.GITHUB_EVENT_PATH;
  const pr = eventPath ? JSON.parse(readFileSync(eventPath, "utf8")).pull_request : undefined;
  return {
    title: opts.title ?? pr?.title ?? "",
    body: opts["body-file"] ? readFileSync(opts["body-file"], "utf8") : (pr?.body ?? ""),
    draft: opts.draft || Boolean(pr?.draft),
    base: opts.base ?? pr?.base?.sha,
    head: opts.head ?? pr?.head?.sha ?? "HEAD",
    author: opts.author ?? pr?.user?.login ?? "",
    branch: opts.branch ?? pr?.head?.ref ?? "",
  };
}

// Bot-written PRs and release branches: only the title, which becomes
// history, is checked.
function skipped(pr, config) {
  if (config.skip.authors.includes(pr.author)) return `author ${pr.author}`;
  const prefix = config.skip.branches.find((p) => pr.branch.startsWith(p));
  return prefix && `branch ${pr.branch} (${prefix})`;
}

async function main() {
  const ctx = await loadContext(root, opts.config);
  const help = ctx.config.help ?? "See the PR template.";

  if (command === "title") {
    const pr = pullRequest();
    return report(checkHeader(pr.title, ctx.config), { name: "PR title", mode, draft: pr.draft, help });
  }

  if (command === "body") {
    const pr = pullRequest();
    const why = skipped(pr, ctx.config);
    if (why) return console.log(`PR description: skipped for ${why}.`), 0;
    const files = pr.base ? git("diff", "--name-only", "--no-renames", `${pr.base}...${pr.head}`).split("\n").filter(Boolean) : [];
    if (!pr.base) console.log("PR description: no --base, so rules tied to changed paths see no files.");
    return report(checkBody({ ...pr, files }, ctx), { name: "PR description", mode, draft: pr.draft, help });
  }

  if (command === "commits") {
    const pr = pullRequest();
    const why = skipped(pr, ctx.config);
    if (why) return console.log(`Commit messages: skipped for ${why}.`), 0;
    if (!pr.base) throw new Error("commits needs --base or a pull_request event");
    const from = git("merge-base", pr.base, pr.head);
    const result = spawnSync(
      "npx",
      ["--yes", COMMITLINT, "--config", join(HOME, "commitlint.config.mjs"), "--cwd", root, "--from", from, "--to", pr.head],
      {
        cwd: root,
        stdio: "inherit",
        env: {
          ...process.env,
          REVIEW_CONVENTIONS_ROOT: root,
          REVIEW_CONVENTIONS_CONFIG: opts.config,
          // A draft never fails; commitlint has no notion of drafts.
          REVIEW_CONVENTIONS_MODE: failing(mode, pr.draft) ? "block" : "warn",
        },
      },
    );
    if (result.error) throw result.error;
    return result.status ?? 1;
  }

  if (command === "commit-msg") {
    const [file] = rest;
    if (!file) throw new Error("commit-msg needs the message file (git passes it as $1)");
    const message = readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => !l.startsWith("#"))
      .join("\n");
    const findings = checkCommitMessage(message, ctx);
    return report(findings, { name: "Commit message", mode, help: ctx.config.help ?? "See .gitmessage." });
  }

  console.error("usage: review-conventions title|body|commits|commit-msg [options] (see the header of bin/review-conventions.mjs)");
  return 2;
}

try {
  process.exitCode = await main();
} catch (error) {
  // A check that cannot run is itself a finding: it never passes silently,
  // and it fails only in block mode.
  const level = mode === "block" ? "error" : "warning";
  console.log(process.env.GITHUB_ACTIONS === "true" ? `::${level} title=review-conventions::check could not run: ${error.message}` : `${level}: check could not run: ${error.message}`);
  process.exitCode = mode === "block" ? 1 : 0;
}
