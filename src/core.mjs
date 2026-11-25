// Repository-neutral checks for a PR title, a PR description and a commit
// message. Nothing here knows about any one repository: settings and rules
// come from the caller's config (config.mjs), required sections from the
// caller's PR templates, and code-only rules from the config's "module".
//
// Every check returns findings ({ rule, message }); none throws or exits.

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.mjs";
import { compileRules, evaluateBodyRules, evaluateCommitRules } from "./rules.mjs";
import { answered, findProcessHeadings, norm, parseMessage, parseSections, stripCode, stripComments } from "./text.mjs";

// ---------------------------------------------------------------- context

// The required `## ` headings of each template, keyed by file name
// ("default" for pull_request_template.md). The templates are the single
// source of truth: adding a heading there makes it required here.
export function loadTemplates(dir) {
  const headings = (file) => parseSections(readFileSync(file, "utf8")).map((s) => s.heading);
  const templates = {};
  try {
    templates.default = headings(join(dir, "pull_request_template.md"));
  } catch {
    // No default template; variants (if any) still apply.
  }
  let files = [];
  try {
    files = readdirSync(join(dir, "PULL_REQUEST_TEMPLATE"));
  } catch {
    // No variants.
  }
  for (const file of files.filter((f) => f.endsWith(".md")).sort()) {
    templates[file] = headings(join(dir, "PULL_REQUEST_TEMPLATE", file));
  }
  return templates;
}

// Everything a check needs: { root, config, templates, rules, module }.
// `configPath` is relative to `root` (the caller's checkout).
export async function loadContext(root, configPath, config = loadConfig(resolve(root, configPath))) {
  const templates = Array.isArray(config.body.sections)
    ? { default: config.body.sections }
    : loadTemplates(resolve(root, config.body.templates));
  if (!Object.keys(templates).length) {
    throw new Error(`no PR templates under ${config.body.templates}/ (pull_request_template.md or PULL_REQUEST_TEMPLATE/*.md); set body.sections to list the required headings instead`);
  }
  let module = {};
  if (config.module) {
    const mod = await import(pathToFileURL(resolve(root, config.module)).href);
    module = (await mod.createRules({ root, config: config.repo })) ?? {};
  }
  return { root, config, templates, rules: compileRules(config.rules, root), module };
}

// ---------------------------------------------------------------- headers

const CONVENTIONAL = /^(?<type>[a-z]+)(?:\((?<scope>[^()]+)\))?(?<bang>!)?: (?<subject>\S.*)$/;
const AREA = /^(?<area>[^:\n]+?): (?<subject>\S.*)$/;
const AUTOSQUASH = /^(?:fixup|squash|amend)! /;

// { type, scope, bang, subject } (or { area, subject }), or null.
export function parseHeader(header, config) {
  const m = header.match(config.header.style === "area" ? AREA : CONVENTIONAL);
  return m ? { ...m.groups, bang: Boolean(m.groups.bang) } : null;
}

// A PR title or a commit subject. `what` names it in messages.
export function checkHeader(header, config, what = "Title") {
  const findings = [];
  const add = (rule, message) => findings.push({ rule, message });
  const { style, types, scopes, maxLength } = config.header;
  if (!header.trim()) {
    add("header-empty", `${what} is empty.`);
    return findings;
  }
  if (AUTOSQUASH.test(header)) {
    add("header-autosquash", `${what} "${header}" is a fixup; run \`git rebase -i --autosquash\` before review.`);
    return findings;
  }
  if (header.length > maxLength) add("header-max-length", `${what} is ${header.length} characters; keep it to ${maxLength}.`);
  if (/^wip\b|\b(?:WIP|DO NOT MERGE)\b/i.test(header)) {
    add("header-wip", `${what} says WIP / DO NOT MERGE; use a draft PR instead, so the title stays fit for history.`);
  }
  const parsed = parseHeader(header, config);
  if (!parsed) {
    const shape = style === "area" ? "`Area: summary`" : "`type(scope): summary` (Conventional Commits)";
    add("header-format", `${what} "${header}" is not ${shape}.`);
    return findings;
  }
  if (style === "conventional") {
    if (!types.includes(parsed.type)) add("type-enum", `Type "${parsed.type}" is not one of: ${types.join(", ")}.`);
    if (scopes && parsed.scope) {
      for (const s of parsed.scope.split(",").map((x) => x.trim())) {
        if (!scopes.includes(s)) add("scope-enum", `Scope "${s}" is not one of: ${scopes.join(", ")}.`);
      }
    }
    // "README", "CI" and other all-caps words may lead.
    const first = parsed.subject.split(/\s/, 1)[0];
    if (/^[A-Z]/.test(first) && first !== first.toUpperCase()) add("subject-case", `Start the summary lower-case: "${parsed.subject}".`);
  }
  if (/\.$/.test(parsed.subject)) add("subject-full-stop", "Drop the full stop at the end of the summary.");
  return findings;
}

// ---------------------------------------------------------------- bodies

// Picks the template the body was written from: the one sharing the most
// headings, then the one missing the fewest. A body sharing no heading with
// any template is held to the default.
export function matchTemplate(headings, templates) {
  const have = new Set(headings.map(norm));
  let best;
  for (const [name, required] of Object.entries(templates)) {
    const matched = required.filter((h) => have.has(norm(h))).length;
    const missing = required.length - matched;
    if (!best || matched > best.matched || (matched === best.matched && missing < best.missing)) {
      best = { name, required, matched, missing };
    }
  }
  if (!best.matched && templates.default) return { name: "default", required: templates.default };
  return best;
}

// The PR description. `pr`: { body, files (changed paths), title (string),
// draft, base, head }. `base` is the merge-base SHA the files were diffed
// from and `head` the head SHA; both undefined when the caller has no base.
export function checkBody(pr, ctx) {
  const findings = [];
  const add = (rule, message) => findings.push({ rule, message });
  const { config, templates } = ctx;
  const body = pr.body ?? "";
  const files = pr.files ?? [];

  if (!body.trim()) {
    add("body-empty", "The description is empty: start from the PR template.");
    return findings;
  }

  if (config.body.comments && !pr.draft) {
    const comments = (stripCode(body).match(/<!--/g) || []).length;
    if (comments) add("body-comments", `${comments} template comment(s) (\`<!-- -->\`) left in the description; delete them once the sections are answered.`);
  }

  if (config.body.processHeadings) {
    for (const heading of findProcessHeadings(body)) {
      add("body-process-heading", `"${heading}" records process, not the change; move it to a PR comment.`);
    }
  }

  const sections = parseSections(body);
  const byName = new Map(sections.map((s) => [norm(s.heading), s]));
  const template = matchTemplate(sections.map((s) => s.heading), templates);
  const label = template.name === "default" ? "the default template" : `template ${template.name}`;
  const missing = template.required.filter((h) => !byName.has(norm(h)));
  if (missing.length) {
    add("body-missing-section", `Missing ${missing.map((h) => `"## ${h}"`).join(", ")} (from ${label}). Answer "None." rather than delete a heading.`);
  }
  for (const h of template.required) {
    const s = byName.get(norm(h));
    if (s && !answered(s.text)) add("body-empty-section", `"## ${h}" is empty; answer it, or write "None."`);
  }

  const view = {
    body,
    files,
    base: pr.base,
    head: pr.head,
    draft: Boolean(pr.draft),
    template: template.name,
    title: parseHeader(pr.title ?? "", config),
    sections: byName,
    section: (heading) => {
      const s = byName.get(norm(heading));
      return s && stripComments(s.text).trim();
    },
  };
  findings.push(...evaluateBodyRules(ctx.rules, view));
  findings.push(...(ctx.module.body?.(view) ?? []));
  return findings;
}

// ---------------------------------------------------------------- commits

// One commit message, held to the PR description's structure in miniature.
// `commit` is what the caller knows beyond the message: { sha, files }, where
// `files` is a list or a function returning one (called at most once, and
// only if a rule reads view.files). Either may be absent.
export function checkCommitMessage(message, ctx, commit = {}) {
  const { config } = ctx;
  const c = config.commits;
  const { header, body, prose, trailers } = parseMessage(message);
  const findings = checkHeader(header, config, "Subject");
  if (findings.some((f) => f.rule === "header-autosquash")) return findings;
  const add = (rule, msg) => findings.push({ rule, message: msg });
  const parsed = parseHeader(header, config);
  const lines = message.replace(/\r\n/g, "\n").split("\n");

  if (lines.length > 1 && lines[1].trim()) add("body-leading-blank", "Leave a blank line between the subject and the body.");
  const long = lines.slice(1).find((l) => l.length > c.bodyMaxLineLength && !l.includes("://"));
  if (long) add("body-max-line-length", `A body line is ${long.length} characters; wrap at 72 (limit ${c.bodyMaxLineLength}).`);

  // A body is required by type ("all" includes area-style subjects, which
  // have none), unless bodyExempt names the type with every one of the
  // commit's scopes; a `!` commit is never exempt. A body that is there must
  // be structured, whatever the type.
  const type = parsed?.type;
  const kind = type ? `A ${type} commit` : "This commit";
  const scopes = parsed?.scope?.split(",").map((s) => s.trim()) ?? [];
  const exempt = scopes.length > 0 && !parsed.bang && scopes.every((s) => c.bodyExempt.includes(`${type}(${s})`));
  const needsBody = !exempt && (c.bodyTypes === "all" || (type !== undefined && c.bodyTypes.includes(type)));
  if (needsBody && !prose.trim()) {
    add("body-required", `${kind} needs a body with a "Why:" paragraph (trailers alone are not one); see .gitmessage.`);
  } else if (prose.trim() && c.requireWhy && !/^Why:/m.test(prose)) {
    add("body-why", `${kind}'s body has no "Why:" paragraph; structure it as Why: / What changes: / Evidence: (see .gitmessage).`);
  }

  for (const heading of findProcessHeadings(body)) add("body-process-heading", `"${heading}" records process, not the change.`);

  const canonical = c.breakingTrailer;
  const accepted = new Set([canonical, ...(canonical.toUpperCase() === canonical ? ["BREAKING CHANGE", "BREAKING-CHANGE"] : [])]);
  let breaking = false;
  for (const line of body.split("\n")) {
    const b = line.match(/^(breaking[- ]change)\s*:/i);
    if (b) {
      if (accepted.has(b[1])) breaking = true;
      else add("trailer-breaking", `Write the trailer as "${canonical}:", not "${b[1]}:"; tools ignore other spellings.`);
      continue;
    }
    const t = line.match(/^([A-Za-z][A-Za-z-]*): /);
    const known = t && c.trailers.find((k) => k.toLowerCase() === t[1].toLowerCase());
    if (known && known !== t[1]) add("trailer-case", `Write the trailer as "${known}:", not "${t[1]}:".`);
  }
  if (c.requireBreakingTrailer && parsed?.bang && !breaking) {
    add("trailer-breaking", `A "!" subject needs a "${canonical}:" trailer saying what breaks and how to migrate.`);
  }

  const view = { type, bang: parsed?.bang ?? false, header, body, prose, trailers, sha: commit.sha };
  let files = commit.files;
  Object.defineProperty(view, "files", {
    enumerable: true,
    get: () => (typeof files === "function" ? (files = files()) : files),
  });
  findings.push(...evaluateCommitRules(ctx.rules, view));
  findings.push(...(ctx.module.commit?.(view) ?? []));
  return findings;
}
