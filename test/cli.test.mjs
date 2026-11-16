// The CLI end to end, in a scratch git repository: changed files come from
// git, the mode decides the exit code, and `commits` runs the real commitlint
// with the shared config (it downloads @commitlint/cli through npx once).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const home = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(home, "bin/review-conventions.mjs");

const repo = mkdtempSync(join(tmpdir(), "review-conventions-"));
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
git("init", "-q", "-b", "main");
git("config", "user.email", "t@example.com");
git("config", "user.name", "T");
cpSync(join(home, "templates"), join(repo, ".github"), { recursive: true });
writeFileSync(
  join(repo, ".github/review-conventions.json"),
  JSON.stringify({
    skip: { branches: ["release/"] },
    rules: [{ id: "api-docs", when: { paths: ["api/"] }, requireFiles: ["docs/api.md"] }],
  }),
);
git("add", ".");
git("commit", "-q", "-m", "chore: start");
const base = git("rev-parse", "HEAD");
writeFileSync(join(repo, "api.txt"), "x");
git("add", ".");
git("commit", "-q", "-m", "fix(api): Reject stale grants.");
writeFileSync(join(repo, "b.txt"), "x");
git("add", ".");
git("commit", "-q", "-m", "feat: add b\n\nWhy: b was missing.\n\nRefs: #1");
const head = git("rev-parse", "HEAD");

const run = (args, env = {}) => {
  const r = spawnSync(process.execPath, [cli, ...args, "--root", repo], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_ACTIONS: "", GITHUB_STEP_SUMMARY: "", GITHUB_EVENT_PATH: "", REVIEW_CONVENTIONS_MODE: "", ...env },
  });
  return { status: r.status, out: r.stdout + r.stderr };
};
const bodyFile = join(repo, "body.md");
writeFileSync(bodyFile, "## Why\n\nStale grants were accepted.\n");

test("title: warn passes with findings, block fails", () => {
  const warn = run(["title", "--title", "Fix grants"]);
  assert.equal(warn.status, 0);
  assert.match(warn.out, /warning: \[header-format\]/);
  assert.equal(run(["title", "--title", "Fix grants", "--mode", "block"]).status, 1);
  assert.equal(run(["title", "--title", "Fix grants", "--mode", "block", "--draft"]).status, 0, "a draft never fails");
  assert.equal(run(["title", "--title", "fix(api): reject stale grants", "--mode", "block"]).status, 0);
});

test("body: reads changed files from git", () => {
  writeFileSync(join(repo, "api.txt"), "moved");
  const r = run(["body", "--body-file", bodyFile, "--base", base, "--head", head, "--mode", "block"]);
  assert.equal(r.status, 1);
  assert.match(r.out, /body-missing-section/);
  assert.doesNotMatch(r.out, /api-docs/, "api.txt is not under api/");
});

test("body: skipped branches check only the title", () => {
  const r = run(["body", "--body-file", bodyFile, "--base", base, "--branch", "release/next", "--mode", "block"]);
  assert.equal(r.status, 0);
  assert.match(r.out, /skipped for branch release\/next/);
});

test("event payload supplies the PR", () => {
  const event = join(repo, "event.json");
  writeFileSync(event, JSON.stringify({ pull_request: { title: "fix: x", body: "", draft: false, base: { sha: base }, head: { sha: head, ref: "fm/x" }, user: { login: "a" } } }));
  const r = run(["body", "--mode", "block"], { GITHUB_EVENT_PATH: event });
  assert.equal(r.status, 1);
  assert.match(r.out, /body-empty/);
});

test("annotations under GitHub Actions", () => {
  const r = run(["title", "--title", "Fix grants"], { GITHUB_ACTIONS: "true" });
  assert.match(r.out, /^::warning title=PR title%3A header-format::/m);
});

test("a broken config is reported, and fails only in block mode", () => {
  const bad = join(repo, "bad.json");
  writeFileSync(bad, '{"heder": {}}');
  assert.equal(run(["title", "--title", "fix: x", "--config", "bad.json"]).status, 0);
  const r = run(["title", "--title", "fix: x", "--config", "bad.json", "--mode", "block"]);
  assert.equal(r.status, 1);
  assert.match(r.out, /check could not run: .*unknown key "heder"/);
});

test("commit-msg hook drops comment lines", () => {
  const msg = join(repo, "COMMIT_EDITMSG");
  writeFileSync(msg, "fix(api): reject stale grants\n\nWhy: they were accepted.\n# Please enter the commit message\n");
  assert.equal(run(["commit-msg", msg, "--mode", "block"]).status, 0);
  writeFileSync(msg, "fix(api): reject stale grants\n# Why: commented out\n");
  const r = run(["commit-msg", msg, "--mode", "block"]);
  assert.equal(r.status, 1);
  assert.match(r.out, /body-required/);
});

test("commits: commitlint with the shared config over merge-base..head", { timeout: 180_000 }, () => {
  const warn = run(["commits", "--base", base, "--head", head]);
  assert.equal(warn.status, 0, warn.out);
  assert.match(warn.out, /subject-case/);
  assert.match(warn.out, /subject-full-stop/);
  assert.match(warn.out, /body-required/);
  assert.match(warn.out, /2 commit\(s\) checked/);
  assert.doesNotMatch(warn.out, /feat: add b"/, "the good commit has no findings");
  const block = run(["commits", "--base", base, "--head", head, "--mode", "block"]);
  assert.equal(block.status, 1, block.out);
  const clean = run(["commits", "--base", git("rev-parse", "HEAD~1"), "--head", head, "--mode", "block"]);
  assert.equal(clean.status, 0, clean.out);
});
