// The shared commitlint config. Every rule is a check from src/core.mjs, so a
// commit subject and a PR title meet the same rules and wording, and the
// caller's config (types, scopes, trailers, commit rules) applies to both.
//
// Self-contained (no `extends`): running it needs only @commitlint/cli.
// `review-conventions commits` runs it in CI; locally, from the repository:
//
//   npx @commitlint/cli@21.2.4 --config <this file> --from origin/main
//
// Environment: REVIEW_CONVENTIONS_ROOT (default: the working directory),
// REVIEW_CONVENTIONS_CONFIG (relative to the root, default
// .github/review-conventions.json), REVIEW_CONVENTIONS_MODE (warn | block;
// warn reports at level 1, block at level 2, which fails).

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCommitMessage, loadContext } from "./src/core.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.env.REVIEW_CONVENTIONS_ROOT ?? process.cwd());
const ctx = await loadContext(root, process.env.REVIEW_CONVENTIONS_CONFIG ?? ".github/review-conventions.json");
const level = process.env.REVIEW_CONVENTIONS_MODE === "block" ? 2 : 1;

const CORE_RULES = [
  "header-empty",
  "header-autosquash",
  "header-max-length",
  "header-wip",
  "header-format",
  "type-enum",
  "scope-enum",
  "subject-case",
  "subject-full-stop",
  "body-leading-blank",
  "body-max-line-length",
  "body-required",
  "body-why",
  "body-process-heading",
  "trailer-breaking",
  "trailer-case",
];

// commitlint calls each rule separately; check each message once.
const cache = new Map();
const findingsOf = (raw) => {
  if (!cache.has(raw)) cache.set(raw, checkCommitMessage(raw, ctx));
  return cache.get(raw);
};
// `repo` reports the caller's own commit rules (config "rules" and "module").
const rule = (name) => (parsed) => {
  const hits = findingsOf(parsed.raw ?? "").filter((f) => (name === "repo" ? !CORE_RULES.includes(f.rule) : f.rule === name));
  return [hits.length === 0, hits.map((f) => (name === "repo" ? `[${f.rule}] ${f.message}` : f.message)).join(" ")];
};

const names = [...CORE_RULES, "repo"];

export default {
  // commitlint's default ignores skip fixup!/squash! commits, which should be
  // squashed before merge; only merge commits are skipped here.
  defaultIgnores: false,
  ignores: [(message) => /^Merge (?:branch|pull request|remote-tracking branch|commit|tag) /.test(message)],
  formatter: join(here, "src/commitlint-format.mjs"),
  plugins: [{ rules: Object.fromEntries(names.map((n) => [`review-conventions/${n}`, rule(n)])) }],
  rules: Object.fromEntries(names.map((n) => [`review-conventions/${n}`, [level, "always"]])),
};
