## Stack

Part **2 of 3** of #40. Base: `fm/one` (https://github.com/o/r/pull/41). Next: https://github.com/o/r/pull/43.

**Reviewed here:** the grant parser.
**Reviewed elsewhere:** the renamed types (#41).
**Depends on:** the `Grant` type from #41.

## Why

Grants were parsed twice.

## What changes

One parser.

## How to review

Start at `src/grant.js::parse`.

## Evidence

`npm test` 12 passed at this head.

## Decisions for review

None.

## After merge

Merge after #41.
