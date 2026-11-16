// Every fixture PR body in test/fixtures/bodies against test/fixtures/config.json
// (which uses the shared templates/), with the rule IDs it must produce.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkBody, loadContext } from "../src/core.mjs";

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

test("every fixture body is used", async () => {
  const { readdirSync } = await import("node:fs");
  const used = new Set(cases.map((c) => c.body));
  assert.deepEqual(readdirSync(join(fixtures, "bodies")).filter((f) => !used.has(f)), []);
});

test("the shared templates are their own good fixtures", async () => {
  // A template with every comment replaced by an answer passes.
  for (const file of ["pull_request_template.md", "PULL_REQUEST_TEMPLATE/stack.md", "PULL_REQUEST_TEMPLATE/mechanical.md", "PULL_REQUEST_TEMPLATE/docs.md"]) {
    const answered = readFileSync(join(root, "templates", file), "utf8").replace(/<!--[\s\S]*?-->/g, "None.");
    assert.deepEqual(checkBody({ body: answered, files: [], title: "fix(core): x" }, ctx), [], file);
  }
});
