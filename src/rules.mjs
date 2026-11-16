// Declarative repository rules: the config's "rules" list. Each rule ties a
// condition on the PR (changed paths, template, title type, a section's text)
// to a requirement on its description (sections answered, files changed in the
// same PR, a section matching a pattern, IDs that a reference file defines).
// A commit rule ("scope": "commit") checks a trailer's value instead.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { answered, isNone, noneReason } from "./text.mjs";

// `dir/` matches everything under dir; `**/` any depth (including none); `*`
// and `?` stay inside one path segment.
export function globToRegExp(glob) {
  const pattern = glob.endsWith("/") ? `${glob}**` : glob;
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") {
      if (pattern[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

const matcher = (globs = []) => {
  const res = globs.map(globToRegExp);
  return (file) => res.some((re) => re.test(file));
};

function loadReferences(spec, root) {
  const text = readFileSync(join(root, spec.file), "utf8");
  const ids = new Set([...text.matchAll(new RegExp(spec.definitions, "gm"))].map((m) => m[1]).filter(Boolean));
  const prefixes = new Set([...ids].map((id) => id.match(/^[A-Za-z]*/)[0]));
  return { ...spec, ids, prefixes };
}

// Cited IDs (spec.pattern's first group) that spec.file does not define.
export function unknownReferences(text, refs) {
  const cited = [...text.matchAll(new RegExp(refs.pattern, "g"))].map((m) => m[1] ?? m[0]);
  const relevant = refs.onlyKnownPrefixes ? cited.filter((id) => refs.prefixes.has(id.match(/^[A-Za-z]*/)[0])) : cited;
  return [...new Set(relevant.filter((id) => !refs.ids.has(id)))];
}

export function compileRules(rules, root) {
  return rules.map((rule) => {
    const flags = rule.flags ?? "i";
    const whens = rule.when === undefined ? [] : [rule.when].flat();
    return {
      ...rule,
      scope: rule.scope ?? "body",
      targets: [rule.section ?? rule.trailer ?? []].flat(),
      when: whens.map((w) => ({
        ...w,
        inPaths: w.paths && matcher(w.paths),
        ignored: matcher(w.ignorePaths),
        sectionRes: Object.entries(w.sections ?? {}).map(([h, re]) => [h, new RegExp(re, flags)]),
      })),
      matchRe: rule.match !== undefined && new RegExp(rule.match, flags),
      notMatchRe: rule.notMatch !== undefined && new RegExp(rule.notMatch, flags),
      fileMatchers: (rule.requireFiles ?? []).map((g) => [g, matcher([g])]),
      refs: rule.references && loadReferences(rule.references, root),
    };
  });
}

// `view` for a body rule: { files, template, title, section(heading) -> text|undefined }.
// For a commit rule: { type, bang }.
function holds(when, view) {
  if (when.inPaths && !view.files.some((f) => !when.ignored(f) && when.inPaths(f))) return false;
  if (when.template && !when.template.includes(view.template)) return false;
  if (when.notTemplate && when.notTemplate.includes(view.template)) return false;
  const type = view.title?.type ?? view.type;
  if (when.titleType && !when.titleType.includes(type)) return false;
  if (when.type && !when.type.includes(type)) return false;
  const bang = Boolean(view.title?.bang ?? view.bang);
  if (when.breaking !== undefined && when.breaking !== bang) return false;
  for (const [heading, re] of when.sectionRes) {
    const text = view.section?.(heading);
    if (text === undefined || !re.test(text)) return false;
  }
  return true;
}

const applies = (rule, view) => !rule.when.length || rule.when.some((w) => holds(w, view));

function escaped(rule, text) {
  if (!rule.allowNone) return false;
  if (rule.allowNone === true) return isNone(text);
  return (noneReason(text) ?? "").length >= rule.allowNone;
}

const noneHint = (rule) =>
  rule.allowNone ? `, or "None: <reason>"${rule.allowNone === true ? "" : ` (at least ${rule.allowNone} characters of reason)`}` : "";

// Checks one target text (a section or a trailer value) against match,
// notMatch and references; `label` names it in messages.
function checkTarget(rule, text, label, add) {
  if (escaped(rule, text)) return;
  if (rule.matchRe && !rule.matchRe.test(text)) add(`${label} does not match /${rule.match}/${noneHint(rule)}`);
  if (rule.notMatchRe && rule.notMatchRe.test(text)) add(`${label} must not match /${rule.notMatch}/`);
  if (rule.refs) {
    const unknown = unknownReferences(text, rule.refs);
    if (unknown.length) add(`${label} cites ${unknown.join(", ")}, which ${rule.refs.file} does not define`);
  }
}

function finding(rule, detail) {
  return { rule: rule.id, message: rule.message ? `${rule.message} (${detail})` : `${detail}.` };
}

export function evaluateBodyRules(rules, view) {
  const findings = [];
  for (const rule of rules.filter((r) => r.scope === "body" && applies(r, view))) {
    const add = (detail) => findings.push(finding(rule, detail));
    for (const heading of rule.requireSections ?? []) {
      const text = view.section(heading);
      if (text === undefined) add(`needs a "## ${heading}" section`);
      else if (!answered(text)) add(`"## ${heading}" is empty; answer it, or write "None."`);
    }
    for (const [glob, test] of rule.fileMatchers) {
      if (!view.files.some(test)) add(`needs a change to ${glob} in the same PR`);
    }
    for (const heading of rule.targets) {
      const text = view.section(heading);
      if (text === undefined) {
        if (rule.matchRe) add(`needs a "## ${heading}" section${noneHint(rule)}`);
        continue;
      }
      checkTarget(rule, text, `"## ${heading}"`, add);
    }
  }
  return findings;
}

// `view`: { type, bang, trailers: [{ token, value }] }. A commit rule checks
// the trailers it names that are present; an absent trailer is not a finding.
export function evaluateCommitRules(rules, view) {
  const findings = [];
  for (const rule of rules.filter((r) => r.scope === "commit" && applies(r, view))) {
    const add = (detail) => findings.push(finding(rule, detail));
    for (const token of rule.targets) {
      for (const t of view.trailers.filter((t) => t.token.toLowerCase() === token.toLowerCase())) {
        checkTarget(rule, t.value, `"${t.token}: ${t.value}"`, add);
      }
    }
  }
  return findings;
}
