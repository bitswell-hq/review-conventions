# review-conventions

Shared PR description, PR title and commit message conventions, and the checks that enforce them:

- **Templates.** A default PR template with six sections, and variants for a stack member, a mechanical change and a docs change. Repositories copy them and edit the examples.
- **A validator.** It checks the PR description against the caller's own templates and against the diff. It is dependency-free Node.
- **A shared commitlint config.** It holds commit subjects to the same rules as the PR title.
- **A `.gitmessage` commit template.**
- **A reusable workflow.** It runs all of the above in **warn** mode, and one input makes it **block**.

Each repository keeps one caller workflow, one config file and its own templates. Rules only one repository needs go in that config, not here.

## Contents

| Path | What it is |
|---|---|
| `.github/workflows/review-conventions.yml` | The reusable workflow (`on: workflow_call`) |
| `bin/review-conventions.mjs` | CLI: `title`, `body`, `commits` (runs commitlint), `commit-msg` (git hook) |
| `src/` | The validator: `core.mjs` (checks), `rules.mjs` (declarative repo rules), `config.mjs` (defaults and validation), `text.mjs`, `report.mjs` |
| `commitlint.config.mjs` | Shared commitlint config; every rule is a check from `src/core.mjs` |
| `templates/pull_request_template.md` | Default PR template: Why · What changes · How to review · Evidence · Decisions for review · After merge |
| `templates/PULL_REQUEST_TEMPLATE/` | Variants: `stack.md`, `mechanical.md`, `docs.md` |
| `templates/.gitmessage` | Commit template, the PR structure in miniature |
| `examples/review-conventions.caller.yml` | The caller workflow to copy |
| `test/` | Tests, and fixture PR bodies with the findings each must produce |

## Adopting it

**1. Add the caller workflow** as `.github/workflows/review-conventions.yml` (a copy of [`examples/review-conventions.caller.yml`](examples/review-conventions.caller.yml)):

```yaml
name: Review conventions

on:
  pull_request:
    types: [opened, edited, synchronize, reopened, ready_for_review]

permissions:
  contents: read

concurrency:
  group: review-conventions-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  review-conventions:
    uses: bitswell-hq/review-conventions/.github/workflows/review-conventions.yml@v1
    with:
      mode: warn # the one switch: `block` fails the check on any finding
```

Keep `edited` in the triggers so that fixing the title or body re-runs the check. The job takes seconds and builds nothing. Leave `edited` out of your expensive workflows: a stack's retargeting also fires it.

**2. Add the config** as `.github/review-conventions.json`. An empty object `{}` is a valid config: Conventional Commits titles, the required sections taken from your templates, and no repository rules. A typical one:

```json
{
  "header": { "scopes": ["api", "web", "infra", "docs", "deps"] },
  "skip": { "authors": ["github-actions[bot]", "dependabot[bot]"] },
  "help": "See CONTRIBUTING.md#pull-requests-and-commits.",
  "rules": []
}
```

**3. Copy the templates** and edit their examples (the `<!-- -->` hints) for your repository:

```sh
ref=v1
base="https://raw.githubusercontent.com/bitswell-hq/review-conventions/$ref/templates"
mkdir -p .github/PULL_REQUEST_TEMPLATE
curl -fsSL "$base/pull_request_template.md" -o .github/pull_request_template.md
for v in stack mechanical docs; do
  curl -fsSL "$base/PULL_REQUEST_TEMPLATE/$v.md" -o ".github/PULL_REQUEST_TEMPLATE/$v.md"
done
curl -fsSL "$base/.gitmessage" -o .gitmessage
```

Keep the `## ` headings; reword the hints freely. The validator reads **your** templates: it matches a PR body to the template it shares the most headings with, and requires that template's headings. Adding a heading to a template therefore makes it required, and adding a variant file adds a variant. A repository-specific variant (perch's `contract.md`, nido's `wallet.md`) is just another file in `PULL_REQUEST_TEMPLATE/`.

To re-sync after a new release, re-run the commands above with the new `ref` and review the diff against your edits.

### Switching from warn to block

`mode` in the caller workflow is the only switch:

- **`warn`** (the default): findings appear as annotations on the PR and as a table in the job summary, and the job always passes.
- **`block`**: any finding fails the job. To stop merges, make the job a required status check (`review-conventions / Title, description and commits`).
- **Draft PRs** never fail in either mode. Their template comments aren't reported until the PR is marked ready.

A config file that can't be read is itself reported. It fails the job only in `block` mode.

### Versioning

Releases are tagged `vX.Y.Z`. The moving tag `v1` points at the newest `v1.*.*`.

- **Pin `@v1`** to receive fixes and new optional checks.
- **Pin `@v1.2.3`** or a commit SHA for exact reproducibility.
- **A new required section or a new default finding is a major version.** A repository in block mode can't start failing because of an upgrade it didn't choose.

The workflow fetches its own code at the ref it was called with, using `job.workflow_ref` and `job.workflow_sha` (current runners). If a runner doesn't provide those, it uses the `conventions-ref` input, and falls back to `v1` when that is empty.

| Input | Default | Meaning |
|---|---|---|
| `mode` | `warn` | `warn` or `block` |
| `config` | `.github/review-conventions.json` | The config file in the calling repository |
| `conventions-ref` | the called ref, else `v1` | Run a specific ref of this repository (testing a branch) |
| `conventions-repository` | the called repository | Run a fork of this repository |

## What is checked

Every finding carries a rule ID; the job summary lists them.

**PR title** (`title`, and each commit subject):

| Rule | Finding |
|---|---|
| `header-format` | Not `type(scope)!: summary` (or `Area: summary` with `"style": "area"`) |
| `type-enum`, `scope-enum` | Type or scope not in the config's lists (scopes: any, unless listed) |
| `header-max-length` | Longer than `header.maxLength` (72) |
| `subject-case` | Summary starts with a capitalised word (all-caps words such as `README` may lead) |
| `subject-full-stop` | Summary ends with a full stop |
| `header-wip` | Says WIP or DO NOT MERGE; a draft PR says that instead |
| `header-autosquash` | A `fixup!` / `squash!` / `amend!` commit; autosquash it before review |

**PR description** (`body`):

| Rule | Finding |
|---|---|
| `body-empty` | No description |
| `body-missing-section` | A heading of the matched template is missing; answer "None." rather than delete it |
| `body-empty-section` | A heading is present but answered only by template comments |
| `body-comments` | `<!-- -->` template comments are left in a ready PR (comments inside code are fine) |
| `body-process-heading` | A heading that records process rather than the change (`## Intent`, `## Pipeline`, `## Review follow-ups (Oct 8)`, anything dated): these belong in PR comments |
| *your rule IDs* | The config's `rules` (below) |

"None.", "Nothing.", "Unchanged" and "Not applicable: <reason>" all count as answers. A rule can require a reason of a minimum length after "None:" (`allowNone`).

**Commit messages** (`commits`, via commitlint over `merge-base..head`; merge commits are skipped). They get the title rules above, plus:

| Rule | Finding |
|---|---|
| `body-leading-blank` | No blank line after the subject |
| `body-max-line-length` | A body line over `commits.bodyMaxLineLength` (100; URLs exempt) |
| `body-required` | A commit of a `commits.bodyTypes` type (default: every type) has no body; trailers alone are not one |
| `body-why` | With `commits.requireWhy` (default on), a body is present but has no `Why:` paragraph, whatever the type |
| `body-process-heading` | As for the description |
| `trailer-breaking` | A `!` subject without the breaking-change trailer, or the trailer misspelled (`Breaking-Change:` is ignored by git-cliff and commitlint) |
| `trailer-case` | A known trailer in the wrong case (`refs:`, `Co-Authored-By:`) |

Commit bodies mirror the PR: a `Why:` paragraph, then `What changes:` and `Evidence:` where they add something, then trailers such as `Refs:`, `Security:` and `BREAKING-CHANGE:`. See [`templates/.gitmessage`](templates/.gitmessage).

**Every commit type needs a body by default, `ci`, `docs` and `chore` included.** A type doesn't tell you whether the change needs explaining: a `ci:` commit that changes a release gate needs a why as much as a `fix:` does. The why is also the part of a commit message most often missing (Tian et al., ICSE 2022). A small, obvious change needs one `Why:` line, not three paragraphs. A repository whose history has a type that never needs a why can narrow `commits.bodyTypes` (for example, to leave out `chore`). Even then, any body a commit does have must still be structured.

PRs from `skip.authors`, or from branches starting with a `skip.branches` prefix, have only their title checked. Bot-written bodies (release PRs, re-pins) are shaped by the workflow that writes them.

## Config reference

All keys are optional; unknown keys are an error.

```jsonc
{
  "header": {
    "style": "conventional",       // or "area": `Area: summary`, no types or scopes
    "types": ["feat", "fix", "perf", "refactor", "revert", "test", "docs", "build", "ci", "chore", "style"],
    "scopes": null,                // a list to restrict scopes
    "maxLength": 72
  },
  "commits": {
    "bodyTypes": "all",            // or the types that need a body, e.g. ["feat", "fix", "perf", "ci", "docs"]
    "requireWhy": true,            // a body present needs a "Why:" paragraph
    "bodyMaxLineLength": 100,
    "breakingTrailer": "BREAKING-CHANGE",   // the accepted spelling ("BREAKING CHANGE" too, when upper-case)
    "requireBreakingTrailer": true,
    "trailers": ["Refs", "Closes", "Fixes", "Security", "Co-authored-by", "Reported-by", "Suggested-by", "Tested-by", "Reviewed-by", "Signed-off-by"]
  },
  "body": {
    "templates": ".github",        // holds pull_request_template.md and PULL_REQUEST_TEMPLATE/
    "sections": "templates",       // or an explicit list of required headings
    "comments": true,
    "processHeadings": true
  },
  "skip": { "authors": [], "branches": [] },
  "help": null,                    // one line added to the job summary
  "rules": [],                     // repository rules, below
  "module": null,                  // an .mjs for rules that need code, below
  "repo": {}                       // free-form settings handed to `module`
}
```

### Repository rules

A rule ties a condition on the PR to a requirement on its description. The rule's `id` names its findings, and `message` (optional) prefixes them.

**Conditions** go in `when`. An object needs all of its keys to hold; a list of objects needs any one of them. With no `when`, the rule always applies.

| `when` key | Holds when |
|---|---|
| `paths` | A changed file matches one of these globs (`dir/` = everything under it, `**/`, `*`, `?`) |
| `ignorePaths` | (with `paths`) files matching these don't count |
| `template` / `notTemplate` | The body was matched to (or not to) one of these templates: `"default"`, `"stack.md"`, … |
| `titleType` | The title's type is one of these |
| `breaking` | The title has (`true`) or lacks (`false`) a `!` |
| `sections` | `{ "Heading": "regex" }`: each section is present and matches |

**Requirements:**

| Key | Requires |
|---|---|
| `requireSections` | These sections are present and answered |
| `requireFiles` | For each glob, a changed file matches it (e.g. the rulebook changes with the engine) |
| `section` + `match` | The section (or each listed section) is present and its text matches the regex |
| `section` + `notMatch` | The section's text does not match |
| `section` + `references` | Every ID the section cites (`pattern`, first group) is defined in `file` (`definitions`, first group). With `onlyKnownPrefixes`, only IDs sharing a letter prefix with a defined one are checked (so `D7` passes when the file defines only `F*` and `W*`) |
| `allowNone` | `true`: a "None…" answer satisfies `match`/`notMatch`/`references`. A number additionally requires that many characters of reason after "None:" |
| `flags` | Regex flags (default `i`) |

Examples, from the repositories that use this:

```jsonc
// nido: security-relevant paths need the contract sections, except in a re-pin.
{ "id": "contract-sections",
  "when": { "paths": ["contracts/", "packages/passkey-sdk/src/perch/", "infra/relayer/"], "notTemplate": ["mechanical.md"] },
  "requireSections": ["Security impact", "Invariants"] },

// nido: cited invariant IDs must exist.
{ "id": "invariant-ids", "section": ["Invariants", "Security impact"],
  "references": { "file": "docs/SECURITY_INVARIANTS.md", "definitions": "^\\| ([A-Z]+\\d+[a-z]?) \\|",
                  "pattern": "\\b([A-Z]{1,2}\\d{1,3}[a-z]?)\\b", "onlyKnownPrefixes": true } },

// drawing_board: gameplay impact starts with None: or Changed:, and a change ships with the rulebook.
{ "id": "gameplay-impact", "section": "Gameplay impact", "match": "^(None|Changed):\\s*\\S[\\s\\S]{20,}" },
{ "id": "rulebook-updated",
  "when": [{ "paths": ["prototypes/galactic-reach/app.js", "crates/game-core/src/**/*.rs"] },
           { "sections": { "Gameplay impact": "^Changed:" } }],
  "requireFiles": ["prototypes/galactic-reach/rulebook.html"] },

// drawing_board: rulebook anchors must exist.
{ "id": "rulebook-anchors", "section": "Rules grounding",
  "references": { "file": "prototypes/galactic-reach/rulebook.html", "definitions": "\\bid=\"([^\"]+)\"",
                  "pattern": "rulebook\\.html#([a-z0-9-]+)" } }
```

**Commit rules** (`"scope": "commit"`) check the value of a trailer (`"trailer": "Security"`) with `match`, `notMatch`, `references` and `allowNone`. Their `when` takes only `type` and `breaking`, because commitlint sees the message and not the files. A trailer that is absent is not a finding.

```jsonc
{ "id": "security-trailer", "scope": "commit", "trailer": "Security", "allowNone": true,
  "references": { "file": "docs/SECURITY_INVARIANTS.md", "definitions": "^\\| ([A-Z]+\\d+[a-z]?) \\|",
                  "pattern": "\\b([A-Z]{1,2}\\d{1,3}[a-z]?)\\b", "onlyKnownPrefixes": true } }
```

**Rules that need code** go in `module`. It is an `.mjs` file in your repository that exports `createRules({ root, config })`, where `config` is the config's `repo` object. `createRules` returns `{ body(view), commit(view) }`, and each function returns `[{ rule, message }]`.

- **Body view:** `{ body, files, base, head, draft, template, title, sections, section(heading) }`.
  - `files` is the paths changed between `base` and `head`.
  - `base` is the merge-base SHA of the PR's base and head, and `head` is the head SHA. A rule can hand them to a repository script, for example "did a locked dependency this contract links move between `base` and `head`?". Both are `undefined` when the check runs without a base (`body` with no `--base` and no event).
  - `title` is the parsed header `{ type, scope, bang, subject }`, and `section(heading)` returns the answer text without comments.
- **Commit view:** `{ type, bang, header, body, prose, trailers, sha, files }`.
  - `sha` is the commit's SHA and `files` the paths it changed (`git diff-tree`). In the `commit-msg` hook, `files` is the staged paths and `sha` is `undefined`.
  - Either may be `undefined`: a commit linted outside `review-conventions commits`, or a message shared by two commits in the range, which is ambiguous and so gets neither. Rules should treat `undefined` as "unknown" and skip.
  - `files` is computed only when a rule reads it.

For example, perch's "a contract's release scope changed ⇒ `## Wasm impact`" parses its `release.yml` and asks a script about `base..head`, so it belongs in a module. So does "a `chore` commit that changes a contract's wasm inputs needs a `Wasm:` trailer", which reads the commit's `files`.

## Local use

```sh
git config commit.template .gitmessage

# check a description before opening the PR (from your repository's root)
npx --yes github:bitswell-hq/review-conventions#v1 body --body-file body.md --base origin/main
npx --yes github:bitswell-hq/review-conventions#v1 title --title "fix(api): reject stale grants"

# commit-msg hook (.git/hooks/commit-msg)
exec npx --yes github:bitswell-hq/review-conventions#v1 commit-msg "$1" --mode block
```

## Developing

```sh
npm test    # node --test: unit tests, fixture bodies, the CLI end to end (downloads @commitlint/cli once)
```

To add a body case, put the body in `test/fixtures/bodies/` and list it in `test/fixtures/cases.json` with the changed files and the rule IDs it must produce. `test/fixtures/config.json` exercises every rule kind against the shared `templates/`. This repository adopts itself (`.github/workflows/review-conventions-self.yml`, `.github/review-conventions.json`), calling the workflow from the PR's own commit.

## Why these sections

- **Few sections.** Each one answers a question a reviewer would otherwise have to ask. Long templates aren't associated with faster PR resolution, and their main complaint is irrelevant questions (Li et al., TSE 2023). "None." is always an answer.
- **"How to review"** names where to start, what's risky and what to skim. **"Decisions for review"** asks for a specific kind of feedback, the description element most strongly associated with merge in an 80K-PR study (Pirouzkhah et al., MSR 2026).
- **Checks compare the description with the diff,** not just that headings exist: "this path changed, so that section is answered". A filled-in heading isn't evidence of a good description; a mismatch is a real defect.
