# Browser Support Budget

Offline, read-only comparison of an exported browser target matrix and an exported JS/CSS feature inventory against the package's pinned local compatibility table. This is a bounded evidence check, not browser execution, bundle analysis, or a live compatibility feed. The small bundled table is an example snapshot; maintainers must validate and update its values before using this tool for a real release decision.

Run with Node 22+ and no dependencies:

```sh
node bin/browser-support-budget.mjs --root examples/passing --matrix matrix.json --inventory inventory.json
node bin/browser-support-budget.mjs --root examples/failing --matrix matrix.json --inventory inventory.json
```

The first command exits 0; the second exits 1 and traces an unsupported feature to `/features/0/usages/0` in `@inventory`. `@matrix`, `@inventory`, and `@dataset` are logical source roles, not host paths. The pointer resolves within the named input document. No source text or filesystem path is echoed in findings.

## Input contract

`matrix.json`: `{"schemaVersion":"1","browsers":[{"browser":"chrome","version":120}]}`. Browser versions are positive integer majors. No duplicate browser IDs.

`inventory.json`: `{"schemaVersion":"1","complete":true,"features":[{"feature":"fetch","usages":[{"file":"src/app.js","pointer":"/calls/0"}]}]}`. `complete` must explicitly be true for a passing result. Feature and browser IDs are lowercase ASCII dotted/sluggable identifiers. Usage files must be relative paths. The optional feature fields `polyfill:"declared"` and `load:"dynamic"` explicitly mark uncertainty; this tool never assumes the polyfill executes or a dynamic import is loaded on all target paths.

The pinned `data/compatibility.json` maps a feature and browser to its minimum supported major version. `false` means unsupported; absent/null means unknown. Its `datasetId` identifies the snapshot. This simple threshold model intentionally does not capture partial releases, flags, platform editions, or conditional polyfill runtime behavior; evidence in those cases must be modeled as unknown rather than treated as supported.

## Rules and results

| Rule | Severity | Meaning |
| --- | --- | --- |
| `unsupported-feature` | error | Observed usage is unsupported by a target. |
| `matrix-invalid`, `inventory-invalid`, `dataset-invalid` | warning | Schema or supported shape unusable. |
| `inventory-incomplete`, `no-evidence` | warning | Coverage is partial or vacuous. |
| `compatibility-unknown`, `polyfill-uncertain`, `dynamic-import-uncertain` | warning | Support cannot be established. |
| `limit-exceeded`, `input-unreadable` | warning | Bounded evaluation or input read failed. |

Warnings make status `incomplete` and exit 2, even if another target is unsupported. Otherwise errors make status `fail` and exit 1; a fully observed and supported inventory makes status `pass` and exit 0. Invalid CLI usage/configuration (unknown option, invalid root, escaped/symlinked input) exits 2 with empty stdout and a short stderr diagnostic. An unreadable, undecodable, oversized or unparseable subject emits an `incomplete` JSON report on stdout, exit 2. Stdout contains only one JSON report; output is deterministic and ordered by source role, pointer, rule and message using code-unit order.

## Limits and non-goals

Matrix 262,144 bytes; inventory 1,048,576 bytes; JSON depth 16; 20 browser targets; 1,000 feature records; 5,000 usage records; evaluation time 5,000 ms from an injected clock. Limits are inclusive; N+1 yields `incomplete`. Inputs are UTF-8 decoded strictly. CLI inputs are realpath-confined inside the declared root. The CLI writes no files and makes no network calls. No browser, source scanner, dependency resolver, telemetry, or auto-polyfill is included. The library exports `TOOL_ID`, `LIMITS`, `RULES`, and pure `evaluateBudget(matrix, inventory, dataset, {now, deadline})`.

Run `npm run check` for syntax and behavioral tests.
