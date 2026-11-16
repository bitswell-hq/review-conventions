// Loads a repository's review-conventions config (JSON) and fills in the
// defaults. Unknown keys are an error, so a typo in a rule fails loudly
// instead of silently checking nothing. README.md "Config reference" documents
// every key.

import { readFileSync } from "node:fs";

export const CONVENTIONAL_TYPES = ["feat", "fix", "perf", "refactor", "revert", "test", "docs", "build", "ci", "chore", "style"];

export const DEFAULTS = {
  header: {
    // "conventional": `type(scope)!: summary`. "area": `Area: summary`
    // (git-style, no types or scopes).
    style: "conventional",
    types: CONVENTIONAL_TYPES,
    scopes: null, // null: any scope
    maxLength: 72,
  },
  commits: {
    bodyTypes: ["feat", "fix", "perf"], // these types need a body
    requireWhy: false, // the body needs a "Why:" paragraph (for bodyTypes)
    bodyMaxLineLength: 100,
    breakingTrailer: "BREAKING-CHANGE", // the one accepted spelling
    requireBreakingTrailer: true, // a `!` subject needs the trailer
    trailers: ["Refs", "Closes", "Fixes", "Security", "Co-authored-by", "Reported-by", "Suggested-by", "Tested-by", "Reviewed-by", "Signed-off-by"],
  },
  body: {
    templates: ".github", // holds pull_request_template.md and PULL_REQUEST_TEMPLATE/
    sections: "templates", // or an explicit list of required headings
    comments: true, // a ready PR may not keep `<!-- -->` template comments
    processHeadings: true, // no "## Intent", "## Review follow-ups (Oct 8)", ...
  },
  skip: {
    authors: [], // e.g. "github-actions[bot]": only the title is checked
    branches: [], // head-branch prefixes, e.g. "release/"
  },
  rules: [],
  help: null, // one line appended to findings, e.g. "See CONTRIBUTING.md#pull-requests."
  module: null, // path to an .mjs exporting createRules({ root, config })
  repo: {}, // free-form settings handed to `module`
};

const RULE_KEYS = ["id", "scope", "when", "message", "requireSections", "requireFiles", "section", "trailer", "match", "notMatch", "flags", "allowNone", "references"];
const WHEN_KEYS = ["paths", "ignorePaths", "template", "notTemplate", "titleType", "type", "breaking", "sections"];
const REFERENCE_KEYS = ["file", "definitions", "pattern", "onlyKnownPrefixes"];

function fail(where, message) {
  throw new Error(`${where}: ${message}`);
}

function checkKeys(object, allowed, where) {
  if (object === null || typeof object !== "object" || Array.isArray(object)) fail(where, "must be an object");
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) fail(where, `unknown key "${key}" (allowed: ${allowed.join(", ")})`);
  }
}

function checkRegex(source, flags, where) {
  try {
    new RegExp(source, flags);
  } catch (error) {
    fail(where, `invalid regex /${source}/${flags}: ${error.message}`);
  }
}

function checkRule(rule, i) {
  const where = `rules[${i}]${rule?.id ? ` (${rule.id})` : ""}`;
  checkKeys(rule, RULE_KEYS, where);
  if (typeof rule.id !== "string" || !rule.id) fail(where, '"id" is required');
  const scope = rule.scope ?? "body";
  if (!["body", "commit"].includes(scope)) fail(where, '"scope" is "body" or "commit"');
  for (const when of [rule.when ?? []].flat()) {
    checkKeys(when, WHEN_KEYS, `${where}.when`);
    if (scope === "commit" && (when.paths || when.ignorePaths || when.template || when.notTemplate || when.sections)) {
      fail(`${where}.when`, "a commit rule sees only the message: use type and breaking");
    }
    for (const re of Object.values(when.sections ?? {})) checkRegex(re, rule.flags ?? "i", `${where}.when.sections`);
  }
  if (scope === "commit" && (rule.requireSections || rule.requireFiles || rule.section)) {
    fail(where, "a commit rule targets a trailer, not sections or files");
  }
  if (scope === "body" && rule.trailer) fail(where, '"trailer" needs "scope": "commit"');
  if ((rule.match || rule.notMatch || rule.references) && !rule.section && !rule.trailer) {
    fail(where, 'match, notMatch and references need a "section" (or a "trailer" for a commit rule)');
  }
  for (const key of ["match", "notMatch"]) if (rule[key] !== undefined) checkRegex(rule[key], rule.flags ?? "i", `${where}.${key}`);
  if (rule.references) {
    checkKeys(rule.references, REFERENCE_KEYS, `${where}.references`);
    for (const key of ["file", "definitions", "pattern"]) {
      if (typeof rule.references[key] !== "string") fail(`${where}.references`, `"${key}" is required`);
    }
    checkRegex(rule.references.definitions, "gm", `${where}.references.definitions`);
    checkRegex(rule.references.pattern, "g", `${where}.references.pattern`);
  }
  const checks = ["requireSections", "requireFiles", "match", "notMatch", "references"].filter((k) => rule[k] !== undefined);
  if (!checks.length) fail(where, "checks nothing: give requireSections, requireFiles, match, notMatch or references");
}

// Merges `raw` over DEFAULTS and validates it. `where` names the source in errors.
export function normalizeConfig(raw = {}, where = "config") {
  const top = Object.keys(DEFAULTS);
  checkKeys(raw, [...top, "$schema", "$comment"], where);
  const config = {};
  for (const key of top) {
    const value = raw[key];
    const base = DEFAULTS[key];
    if (value === undefined) config[key] = structuredClone(base);
    else if (base && typeof base === "object" && !Array.isArray(base) && key !== "repo") {
      checkKeys(value, Object.keys(base), `${where}.${key}`);
      config[key] = { ...structuredClone(base), ...value };
    } else config[key] = value;
  }
  if (!["conventional", "area"].includes(config.header.style)) fail(`${where}.header.style`, 'is "conventional" or "area"');
  if (config.body.sections !== "templates" && !Array.isArray(config.body.sections)) {
    fail(`${where}.body.sections`, 'is "templates" or a list of headings');
  }
  if (!Array.isArray(config.rules)) fail(`${where}.rules`, "must be a list");
  config.rules.forEach(checkRule);
  return config;
}

export function loadConfig(path) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`cannot read config ${path}: ${error.message}`);
  }
  return normalizeConfig(raw, path);
}
