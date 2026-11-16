## Why

Accounts created twice were funded twice. Closes #12.

## What changes

The factory funds an account once. Nothing else about creation changes.

## How to review

Start at: `src/factory.js::fund`. Risky: the idempotency key. Skim: the fixture rename.

## Evidence

`npm test` 41 passed; `fund twice` fails without this change.

## After merge

Nothing.
