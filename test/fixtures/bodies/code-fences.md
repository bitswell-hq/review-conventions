## Why

Accounts created twice were funded twice. Closes #12.

## What changes

The factory funds an account once. Nothing else about creation changes.

## How to review

Start at: `src/factory.js::fund`. Risky: the idempotency key. Skim: the fixture rename.

## Evidence

`npm test` 41 passed; `fund twice` fails without this change.

## Decisions for review

Should the key include the network? I left it out because accounts are per network already.

## After merge

Nothing.

The template uses `<!-- -->` comments, and a fenced example:

```markdown
## Intent
<!-- not a leftover -->
```

