# Contributing

Issues and pull requests are welcome. A few things that make a change easy to accept:

- **Run the tests.** `npm test` — Node's built-in runner, no dependencies to install. CI runs the
  same thing on Node 18, 20 and 22.
- **Add a test with the fix.** The fixtures live in `tests/fixtures/`; a new one is a folder with a
  couple of files. Regressions in the detection or handoff logic are silent, which is exactly why
  they need a test.
- **Keep the two boundaries.** The skill never modifies the audited repo, and it never executes it
  without explicit consent (`--yes`). A change that blurs either one needs to say so in the PR.
- **Both languages stay in sync.** Any user-facing string added to `handoff.mjs` or `tarjetas.mjs`
  needs its English and Spanish form; the analysis itself must not depend on the language.
- **No runtime dependencies.** The scripts are meant to run anywhere Node runs, without an install
  step. Playwright is the one optional extra, and its absence must never fail a run.

For a behavior change in the lenses or the report format, open an issue first — those decisions are
about what counts as a finding, and that discussion is worth having before the code.
