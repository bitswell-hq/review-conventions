// Every fixture PR body in test/fixtures/bodies against test/fixtures/config.json
// (which uses the shared templates/), with the rule IDs it must produce.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkBody, checkCommitMessage, loadContext } from "../src/core.mjs";
import { normalizeConfig } from "../src/config.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = join(root, "test/fixtures");
const ctx = await loadContext(root, "test/fixtures/config.json");
const cases = JSON.parse(readFileSync(join(fixtures, "cases.json"), "utf8"));

for (const c of cases) {
  const name = `${c.body ?? "(empty body)"} ${c.title ?? ""} [${c.files.join(", ")}]${c.draft ? " draft" : ""}`;
  test(name, () => {
    const body = c.body ? readFileSync(join(fixtures, "bodies", c.body), "utf8") : "";
    const findings = checkBody({ body, files: c.files, title: c.title ?? "fix(core): x", draft: c.draft }, ctx);
    assert.deepEqual(findings.map((f) => f.rule).sort(), [...c.expect].sort(), `${c.why ?? ""}\n${JSON.stringify(findings, null, 2)}`);
  });
}

// Commit messages in test/fixtures/commits against this repository's own
// config (.github/review-conventions.json): the self-check is what must fire.
const own = await loadContext(root, ".github/review-conventions.json");
const commitCases = JSON.parse(readFileSync(join(fixtures, "commit-cases.json"), "utf8"));
for (const c of commitCases) {
  test(`commit ${c.message}`, () => {
    const message = readFileSync(join(fixtures, "commits", c.message), "utf8");
    const findings = checkCommitMessage(message, own);
    assert.deepEqual(findings.map((f) => f.rule).sort(), [...c.expect].sort(), `${c.why ?? ""}\n${JSON.stringify(findings, null, 2)}`);
  });
}

test("a narrowed bodyTypes exempts a type from needing a body, not from structuring one", async () => {
  const narrowed = await loadContext(root, "", normalizeConfig({ body: { templates: "templates" }, commits: { bodyTypes: ["feat", "fix", "perf", "ci", "docs"] } }));
  const read = (f) => readFileSync(join(fixtures, "commits", f), "utf8");
  assert.deepEqual(checkCommitMessage(read("chore-no-body.txt"), narrowed), []);
  assert.deepEqual(checkCommitMessage("chore: x\n\nBumped it.", narrowed).map((f) => f.rule), ["body-why"]);
  assert.deepEqual(checkCommitMessage(read("docs-before-rewording.txt"), narrowed).map((f) => f.rule), ["body-required"]);
});

test("bodyExempt exempts a type and scope from needing a body, not from structuring one", async () => {
  const exempting = await loadContext(root, "", normalizeConfig({ body: { templates: "templates" }, commits: { bodyExempt: ["chore(deps)", "chore(ci)"] } }));
  const check = (message) => checkCommitMessage(message, exempting).map((f) => f.rule);
  assert.deepEqual(check(readFileSync(join(fixtures, "commits", "chore-no-body.txt"), "utf8")), [], "the fixture is chore(deps) with no body");
  assert.deepEqual(check("chore(deps): bump lockfile"), []);
  assert.deepEqual(check("chore(deps): bump lockfile\n\nRefs: #12"), [], "trailers alone are fine on an exempt commit");
  assert.deepEqual(check("chore(release): cut v2"), ["body-required"], "another scope of the same type");
  assert.deepEqual(check("chore: tidy"), ["body-required"], "no scope");
  assert.deepEqual(check("build(deps): bump lockfile"), ["body-required"], "the same scope on another type");
  assert.deepEqual(check("chore(deps,ci): bump lockfile and runner"), [], "every scope exempted");
  assert.deepEqual(check("chore(deps, ci): bump lockfile and runner"), [], "spaces after commas");
  assert.deepEqual(check("chore(deps,release): bump and cut"), ["body-required"], "one scope not exempted");
  assert.deepEqual(check("chore(deps)!: drop node 20"), ["body-required", "trailer-breaking"], "a breaking change is never exempt");
  assert.deepEqual(check("chore(deps): bump lockfile\n\nBumped it."), ["body-why"], "a body that is there is still structured");
  assert.deepEqual(check("chore(deps): bump lockfile\n\nWhy: GHSA-xxxx affects the old version."), []);
});

test("every fixture body and commit message is used", async () => {
  const { readdirSync } = await import("node:fs");
  const used = new Set([...cases.map((c) => c.body), ...commitCases.map((c) => c.message)]);
  for (const dir of ["bodies", "commits"]) {
    assert.deepEqual(readdirSync(join(fixtures, dir)).filter((f) => !used.has(f)), [], dir);
  }
});

test("the shared templates are their own good fixtures", async () => {
  // A template with every comment replaced by an answer passes.
  for (const file of ["pull_request_template.md", "PULL_REQUEST_TEMPLATE/stack.md", "PULL_REQUEST_TEMPLATE/mechanical.md", "PULL_REQUEST_TEMPLATE/docs.md"]) {
    const answered = readFileSync(join(root, "templates", file), "utf8").replace(/<!--[\s\S]*?-->/g, "None.");
    assert.deepEqual(checkBody({ body: answered, files: [], title: "fix(core): x" }, ctx), [], file);
  }
});
