<!--
Title: `type(scope): imperative summary`, at most 72 characters. It becomes the
commit subject and the changelog line.
Answer any section "None." rather than deleting its heading, and delete every
comment like this one before you mark the PR ready. Review back-and-forth goes in
PR comments, not in this description.
Other shapes (`gh pr create --template <name>.md`, or `?template=<name>.md` on the
compare URL):
  stack.md       one member of a stacked series
  mechanical.md  regenerated, moved or vendored content, re-pins, lockfile bumps
  docs.md        documentation only
-->

## Why

<!-- The problem, in a reader's terms, and why this approach. Closes #N / Refs #N.
Name known shortcomings. One short paragraph. -->

## What changes

<!-- Behaviour, not a file list: what a user, caller or operator sees differently.
Then one line on what deliberately does NOT change. -->

## How to review

<!-- Start at: `path::symbol`.
Risky: the 1-3 places where a bug would hurt, and why.
Skim: what is mechanical, moved or generated, and the command that produced it.
Commits: "review commit by commit" if the history is curated, otherwise "review the diff". -->

## Evidence

<!-- What ran, where, and the result, with counts: `npm test`, 41 passed.
Name a test that FAILS without this change. Name what was NOT run, and why. -->

## Decisions for review

<!-- Choices a reviewer could reasonably make differently: the alternative and why it
was rejected. Ask the specific question you want answered. "None." is fine. -->

## After merge

<!-- Release, deploy, migration or follow-up steps, and who owns each. "Nothing." -->
