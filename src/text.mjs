// Markdown and commit-message helpers shared by the checks and by repository
// rule modules.

export const norm = (s) => s.trim().toLowerCase();

// Template comments, including one left unterminated at the end.
export const stripComments = (s) => s.replace(/<!--[\s\S]*?(?:-->|$)/g, "");

// Fenced blocks and inline code: text written *about* a heading or a comment
// is not one.
export const stripCode = (s) => s.replace(/^[ \t]*(```|~~~)[\s\S]*?^[ \t]*\1[^\n]*$/gm, "").replace(/`[^`\n]*`/g, "");

// Level-2 sections ({ heading, text }), ignoring headings inside code fences.
// `text` keeps its comments; use stripComments() to read the answer.
export function parseSections(markdown) {
  const sections = [];
  let fence = null;
  for (const line of markdown.split(/\r?\n/)) {
    const f = line.match(/^\s*(```|~~~)/);
    if (f) fence = fence === f[1] ? null : (fence ?? f[1]);
    const m = !fence && !f && line.match(/^##[ \t]+(.+?)[ \t]*#*[ \t]*$/);
    if (m) sections.push({ heading: m[1], lines: [] });
    else if (sections.length) sections.at(-1).lines.push(line);
  }
  return sections.map((s) => ({ heading: s.heading, text: s.lines.join("\n") }));
}

// A section is answered when something other than template comments is left.
export const answered = (text) => stripComments(text).trim().length > 0;

// The escape hatches: "None.", "Nothing.", "Unchanged", "Not applicable: ...".
const NONE = /^(?:none|nothing|unchanged|not applicable)\b/i;
export const isNone = (text) => NONE.test(stripComments(text).trim());

// The reason after "None:" / "Not applicable:", or undefined if the answer is
// not an escape hatch.
export function noneReason(text) {
  const m = stripComments(text).trim().match(/^(?:none|nothing|unchanged|not applicable)\s*[:.\-–—]?\s*([\s\S]*)$/i);
  return m ? m[1].trim() : undefined;
}

const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?";
const PROCESS_HEADING = new RegExp(
  "^#{1,6}\\s+(?:" +
    [
      "(?:intent|pipeline|prompt|agent (?:log|notes))\\b",
      "review (?:follow-?ups?|log|notes|rounds?|comments addressed)\\b",
      `.*(?:\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b${MONTH} \\d{1,2}\\b|\\bround \\d+\\b)`,
    ].join("|") +
    ")",
  "i",
);

// Headings that record how a change was made rather than what it is: agent
// prompts, pipeline output, dated review logs. In a body or commit that
// becomes history they outlive the review they describe.
export function findProcessHeadings(text) {
  return stripCode(stripComments(text))
    .split(/\r?\n/)
    .filter((line) => PROCESS_HEADING.test(line))
    .map((line) => line.trim());
}

// Body paragraphs that open with these are prose, not trailers.
const BODY_LABELS = ["why", "evidence"];
const TRAILER_LINE = /^([A-Za-z][A-Za-z0-9-]*|BREAKING CHANGE): ?(.*)$/;

// Splits a commit message into { header, body, prose, trailers }: `prose` is
// the body without its final trailer paragraph, `trailers` that paragraph's
// { token, value } pairs (git trailer syntax).
export function parseMessage(message) {
  const lines = message.replace(/\r\n/g, "\n").replace(/\s+$/, "").split("\n");
  const header = lines[0] ?? "";
  const body = lines.slice(1).join("\n").replace(/^\n+/, "");
  const paragraphs = body.split(/\n[ \t]*\n/).filter((p) => p.trim());
  const last = paragraphs.at(-1)?.split("\n") ?? [];
  const isTrailers =
    last.length > 0 &&
    last.every((l) => TRAILER_LINE.test(l) || /^\s+\S/.test(l)) &&
    !last.some((l) => BODY_LABELS.includes(l.match(TRAILER_LINE)?.[1].toLowerCase()));
  const trailers = isTrailers
    ? last.filter((l) => TRAILER_LINE.test(l)).map((l) => {
        const [, token, value] = l.match(TRAILER_LINE);
        return { token, value: value.trim() };
      })
    : [];
  const prose = (isTrailers ? paragraphs.slice(0, -1) : paragraphs).join("\n\n");
  return { header, body, prose, trailers };
}
