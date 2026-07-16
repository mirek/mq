# Performance and finite defaults

Run the reproducible generated-workload benchmark after building the workspace:

```sh
pnpm benchmark
```

The script measures median parse, select, unchanged render, edit/reparse, and
validation times over seven measured runs. It covers 100, 1,000, and 10,000
headings plus blockquote nesting depths 8, 32, and 96. Results are informative;
they are not release promises or CI pass/fail thresholds until hosted runners
provide a stable baseline.

Baseline captured on 2026-07-16 with Node v26.4.0 on macOS x64:

| Workload | Bytes | Parse ms | Select ms | Render ms | Edit ms | Validate ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 headings | 2,326 | 8.520 | 0.239 | 0.000 | 7.106 | 0.160 |
| 1,000 headings | 25,276 | 72.656 | 1.726 | 0.000 | 79.226 | 1.875 |
| 10,000 headings | 272,776 | 797.936 | 19.388 | 0.000 | 1,022.108 | 21.703 |
| 8 nested quotes | 29 | 0.401 | 0.006 | 0.000 | 0.388 | 0.008 |
| 32 nested quotes | 77 | 0.530 | 0.011 | 0.000 | 0.586 | 0.011 |
| 96 nested quotes | 205 | 1.024 | 0.023 | 0.000 | 1.066 | 0.026 |

`resourceLimits` is the exported immutable source of truth for production
defaults. Markdown's 16 MiB/100,000-node/128-depth caps admit substantial docs
while bounding semantic work. Selector and expression 64 KiB source caps and
256-step/stage caps are far above interactive queries but stop adversarial
program growth. Schemas allow 1 MiB, depth 64, 100,000 JSON values, and 256
rules; validation emits at most 1,000 diagnostics. Loader diagnostics cap at
100. Limit tests pin every value and rejection boundary.
