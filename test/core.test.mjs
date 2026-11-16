import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeConfig } from "../src/config.mjs";
import { checkCommitMessage, checkHeader, loadContext, matchTemplate } from "../src/core.mjs";
import { globToRegExp } from "../src/rules.mjs";
import { failing, report } from "../src/report.mjs";
import { isNone, noneReason, parseMessage, parseSections } from "../src/text.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ctx = await loadContext(root, "test/fixtures/config.json");
const rules = (findings) => findings.map((f) => f.rule).sort();
const header = (h, config = ctx.config) => rules(checkHeader(h, config));
const commit = (m) => rules(checkCommitMessage(m, ctx));

test("titles: Conventional Commits", () => {
  assert.deepEqual(header("fix(core): fund each new account once"), []);
  assert.deepEqual(header("feat(core,deps)!: drop v1 accounts"), []);
  assert.deepEqual(header("docs: fix the README link"), []);
  assert.deepEqual(header("fix: update README and CI badges"), [], "all-caps words may lead");
  assert.deepEqual(header("Fix the thing"), ["header-format"]);
  assert.deepEqual(header("feature(core): x"), ["type-enum"]);
  assert.deepEqual(header("fix(wallet): x"), ["scope-enum"]);
  assert.deepEqual(header("fix(core): Fund accounts"), ["subject-case"]);
  assert.deepEqual(header("fix(core): fund accounts."), ["subject-full-stop"]);
  assert.deepEqual(header(`fix(core): ${"x".repeat(70)}`), ["header-max-length"]);
  assert.deepEqual(header("WIP fix(core): x"), ["header-format", "header-wip"]);
  assert.deepEqual(header("fix(core): x DO NOT MERGE"), ["header-wip"]);
  assert.deepEqual(header("fixup! fix(core): x"), ["header-autosquash"]);
  assert.deepEqual(header(""), ["header-empty"]);
});

test("titles: area style (no types or scopes)", () => {
  const area = normalizeConfig({ header: { style: "area" } });
  assert.deepEqual(header("Galactic Reach: Harbors refit Fleets", area), []);
  assert.deepEqual(header("Harbors refit Fleets", area), ["header-format"]);
  assert.deepEqual(header("Viewport check: wait for web fonts.", area), ["subject-full-stop"]);
});

test("commit messages mirror the PR structure", () => {
  const why = "\n\nWhy: accounts were funded twice.";
  assert.deepEqual(commit("chore(deps): bump lockfile"), [], "a chore needs no body");
  assert.deepEqual(commit(`fix(core): fund once${why}\n\nRefs: #12`), []);
  assert.deepEqual(commit("fix(core): fund once"), ["body-required"]);
  assert.deepEqual(commit("fix(core): fund once\n\nRefs: #12"), ["body-required"], "trailers alone are not a body");
  assert.deepEqual(commit("fix(core): fund once\n\nAccounts were funded twice."), ["body-why"], "requireWhy");
  assert.deepEqual(commit("fix(core): fund once\nWhy: no gap"), ["body-leading-blank"]);
  assert.deepEqual(commit(`fix(core): fund once${why}\n\n${"x".repeat(101)}`), ["body-max-line-length"]);
  assert.deepEqual(commit(`fix(core): fund once${why} See https://example.com/${"x".repeat(100)}`), [], "URLs may run long");
  assert.deepEqual(commit(`fix(core): fund once${why}\n\n## Review follow-ups (Oct 8)`), ["body-process-heading"]);
});

test("trailers: breaking-change spelling and case", () => {
  const why = "\n\nWhy: v1 is gone.";
  assert.deepEqual(commit(`feat(core)!: drop v1${why}\n\nBREAKING-CHANGE: v1 accounts stop working.`), []);
  assert.deepEqual(commit(`feat(core)!: drop v1${why}\n\nBREAKING CHANGE: v1 accounts stop working.`), []);
  assert.deepEqual(commit(`feat(core)!: drop v1${why}`), ["trailer-breaking"]);
  assert.deepEqual(commit(`feat(core): drop v1${why}\n\nBreaking-Change: v1 accounts stop working.`), ["trailer-breaking"]);
  assert.deepEqual(commit(`fix(core): x${why}\n\nrefs: #12\nCo-Authored-By: A <a@example.com>`), ["trailer-case", "trailer-case"]);
  const mixed = { ...ctx, config: normalizeConfig({ commits: { breakingTrailer: "Breaking-Change" } }) };
  assert.deepEqual(rules(checkCommitMessage(`feat: x${why}\n\nBreaking-Change: saves reset.`, mixed)), []);
  assert.deepEqual(rules(checkCommitMessage(`feat: x${why}\n\nBREAKING CHANGE: saves reset.`, mixed)), ["trailer-breaking"]);
});

test("commit rules check trailer values", () => {
  const why = "\n\nWhy: the nonce was reusable.";
  assert.deepEqual(commit(`fix(core): reject spent nonces${why}\n\nSecurity: F2`), []);
  assert.deepEqual(commit(`fix(core): reject spent nonces${why}\n\nSecurity: none`), [], "allowNone");
  assert.deepEqual(commit(`fix(core): reject spent nonces${why}\n\nSecurity: F9`), ["security-trailer"]);
  assert.deepEqual(commit(`fix(core): reject spent nonces${why}\n\nSecurity: replay`), ["security-trailer"]);
});

test("globs", () => {
  const m = (g, f) => globToRegExp(g).test(f);
  assert(m("contracts/", "contracts/a/b.rs"));
  assert(!m("contracts/", "contracts-old/a.rs"));
  assert(m("deploy/**/*.sh", "deploy/run.sh"));
  assert(m("deploy/**/*.sh", "deploy/a/b/run.sh"));
  assert(!m("deploy/*.sh", "deploy/a/run.sh"));
  assert(m("**/*.md", "README.md"));
  assert(m("src/?.js", "src/a.js"));
  assert(!m("src/a.js", "src/aXjs"), "dots are literal");
});

test("text helpers", () => {
  assert(isNone("None."));
  assert(isNone("<!-- hint -->\nNot applicable: prose only"));
  assert(!isNone("Nonexistent paths are skipped"));
  assert.equal(noneReason("None: the scripts only gained comments"), "the scripts only gained comments");
  assert.equal(noneReason("A table"), undefined);
  assert.deepEqual(parseSections("intro\n## A\nx\n```\n## not\n```\n## B ##\ny").map((s) => s.heading), ["A", "B"]);
  const m = parseMessage("fix: x\n\nWhy: y.\n\nRefs: #1\nSecurity: F1");
  assert.equal(m.prose, "Why: y.");
  assert.deepEqual(m.trailers, [{ token: "Refs", value: "#1" }, { token: "Security", value: "F1" }]);
  assert.deepEqual(parseMessage("fix: x\n\nWhy: only a why.").trailers, [], "a Why: paragraph is prose");
});

test("template matching prefers the most shared headings, then the fewest missing", () => {
  const templates = { default: ["Why", "How"], "stack.md": ["Stack", "Why", "How"] };
  assert.equal(matchTemplate(["Why", "How"], templates).name, "default");
  assert.equal(matchTemplate(["Stack", "Why"], templates).name, "stack.md");
  assert.equal(matchTemplate(["Other"], templates).name, "default");
});

test("config: defaults, explicit sections, and loud errors", async () => {
  const config = normalizeConfig({});
  assert.equal(config.header.maxLength, 72);
  assert.equal(config.commits.breakingTrailer, "BREAKING-CHANGE");
  const explicit = await loadContext(root, "", normalizeConfig({ body: { sections: ["How to review"] } }));
  assert.deepEqual(explicit.templates, { default: ["How to review"] });
  const bad = (raw, re) => assert.throws(() => normalizeConfig(raw), re);
  bad({ heder: {} }, /unknown key "heder"/);
  bad({ header: { maxLen: 3 } }, /unknown key "maxLen"/);
  bad({ header: { style: "loose" } }, /"conventional" or "area"/);
  bad({ rules: [{ requireFiles: ["x"] }] }, /"id" is required/);
  bad({ rules: [{ id: "a" }] }, /checks nothing/);
  bad({ rules: [{ id: "a", match: "x" }] }, /need a "section"/);
  bad({ rules: [{ id: "a", section: "S", match: "(" }] }, /invalid regex/);
  bad({ rules: [{ id: "a", scope: "commit", when: { paths: ["x"] }, trailer: "T", match: "x" }] }, /sees only the message/);
  bad({ rules: [{ id: "a", trailer: "T", match: "x" }] }, /needs "scope": "commit"/);
  bad({ rules: [{ id: "a", requireFiles: ["x"], when: { path: ["x"] } }] }, /unknown key "path"/);
});

test("mode: warn never fails, block fails ready PRs only", () => {
  const log = console.log;
  console.log = () => {};
  const summary = process.env.GITHUB_STEP_SUMMARY;
  delete process.env.GITHUB_STEP_SUMMARY;
  try {
    const one = [{ rule: "r", message: "m" }];
    assert.equal(report(one, { name: "t", mode: "warn" }), 0);
    assert.equal(report(one, { name: "t", mode: "block" }), 1);
    assert.equal(report(one, { name: "t", mode: "block", draft: true }), 0);
    assert.equal(report([], { name: "t", mode: "block" }), 0);
    assert.equal(failing("block", false), true);
  } finally {
    console.log = log;
    if (summary !== undefined) process.env.GITHUB_STEP_SUMMARY = summary;
  }
});

test("README examples: drawing_board's rules as config", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { checkBody } = await import("../src/core.mjs");
  const dir = mkdtempSync(join(tmpdir(), "rc-db-"));
  writeFileSync(join(dir, "rulebook.html"), '<h2 id="movement">Movement</h2><h2 id="combat">Combat</h2>');
  const config = normalizeConfig({
    body: { sections: ["Rules grounding", "Gameplay impact", "How to review", "Decisions for review"] },
    rules: [
      { id: "gameplay-impact", section: "Gameplay impact", match: "^(None|Changed):\\s*\\S[\\s\\S]{20,}" },
      {
        id: "rulebook-updated",
        when: [{ paths: ["prototypes/galactic-reach/app.js", "crates/game-core/src/**/*.rs"] }, { sections: { "Gameplay impact": "^Changed:" } }],
        requireFiles: ["rulebook.html"],
      },
      { id: "rulebook-anchors", section: "Rules grounding", references: { file: "rulebook.html", definitions: '\\bid="([^"]+)"', pattern: "rulebook\\.html#([a-z0-9-]+)" } },
    ],
  });
  const dbctx = await loadContext(dir, "", config);
  const body = (grounding, impact) =>
    `## Rules grounding\n\n${grounding}\n\n## Gameplay impact\n\n${impact}\n\n## How to review\n\nStart at app.js.\n\n## Decisions for review\n\nNone.\n`;
  const check = (b, files) => rules(checkBody({ body: b, files, title: "Map: fit" }, dbctx));
  assert.deepEqual(check(body("[Movement](rulebook.html#movement)", "None: layout only, no rule touched here."), ["styles.css"]), []);
  assert.deepEqual(check(body("[Movement](rulebook.html#moving)", "None: layout only, no rule touched here."), ["styles.css"]), ["rulebook-anchors"]);
  assert.deepEqual(check(body("x", "Changed: fleets now refit at harbors."), ["styles.css"]), ["rulebook-updated"]);
  assert.deepEqual(check(body("x", "Changed: fleets now refit at harbors."), ["rulebook.html"]), []);
  assert.deepEqual(check(body("x", "None: layout only, no rule touched here."), ["crates/game-core/src/fleet.rs"]), ["rulebook-updated"]);
  assert.deepEqual(check(body("x", "Maybe"), []), ["gameplay-impact"]);
});
