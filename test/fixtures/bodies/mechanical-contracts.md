## Why

Upstream released 2.1.

## What was generated, moved or vendored

`contracts/vendor/**` from `scripts/vendor.sh 2.1`.

## Reproduce

`scripts/vendor.sh 2.1 && git diff --exit-code`

## Hand edits

None.

## Provenance

`scripts/check-vendor.sh` compares checksums with the upstream tag.

## After merge

Nothing.
