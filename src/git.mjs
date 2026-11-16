// The git lookups behind the views' revisions and file lists. Kept out of
// core.mjs, which stays pure: callers (the CLI, the commitlint config) pass
// what they looked up.

import { execFileSync } from "node:child_process";

const git = (root, ...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 });
const lines = (out) => out.split("\n").filter(Boolean);

export const revParse = (root, rev) => git(root, "rev-parse", "--verify", `${rev}^{commit}`).trim();
export const mergeBase = (root, a, b) => git(root, "merge-base", a, b).trim();

// Paths changed between two revisions (both sides of a rename).
export const diffFiles = (root, from, to) => lines(git(root, "diff", "--name-only", "--no-renames", from, to));

// Paths one commit changed; --root covers a commit with no parent.
export const commitFiles = (root, sha) => lines(git(root, "diff-tree", "--no-commit-id", "--name-only", "--no-renames", "-r", "--root", sha));

// Paths staged for the commit being made (the commit-msg hook's view).
export const stagedFiles = (root) => lines(git(root, "diff", "--cached", "--name-only", "--no-renames"));

// The key a commit message is matched by: git's %B and commitlint's raw
// message differ only in line endings and trailing whitespace.
export const messageKey = (message) => message.replace(/\r\n/g, "\n").replace(/\s+$/, "");

// Non-merge commits in from..to, oldest first: [{ sha, message }].
export function commitsIn(root, from, to) {
  return git(root, "log", "--no-merges", "--reverse", "--format=%H%x00%B%x1e", `${from}..${to}`)
    .split("\x1e")
    .map((rec) => rec.replace(/^\n+/, ""))
    .filter(Boolean)
    .map((rec) => {
      const [sha, message] = rec.split("\0");
      return { sha, message };
    });
}
