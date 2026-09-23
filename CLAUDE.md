# CLAUDE.md

Guidance for agents working in this repository.

## What this repo is

`gateway-action-storage` is not an application. It is shared CI data for the Kong
gateway test pipelines (`kong-ee` and the gateway API suites). Other repos' CI
workflows read files from here at a pinned ref, so the file paths, formats and
semantics below are a public interface. Changing them can break CI in repos you
cannot see from here.

It holds two independent data sets:

1. `skipped-tests/skipped.yaml`, the version-controlled E2E skip list that
   replaced the legacy `SKIP_E2E_TEST` environment variable.
2. `.ci/runtimes*.json`, per-file test durations used by the gateway CI to
   balance and shard test runs.

## Layout

| Path | Purpose |
|------|---------|
| `skipped-tests/skipped.yaml` | The skip list. The only file meant to be hand-edited for skip work. |
| `skipped-tests/schema.json` | JSON Schema (draft-07) for `skipped.yaml`, enforced by `validate.js`. |
| `skipped-tests/tools/validate.js` | Schema check plus duplicate-name and duplicate-`reset_branches` checks. |
| `skipped-tests/tools/generate.js` | Renders the compact skip string consumed by CI. Prints to stdout only. |
| `.githooks/pre-commit` | Fast local checks, runs only when `skipped.yaml` is staged. |
| `.github/workflows/validate-skipped-tests.yml` | CI validation on any push touching `skipped-tests/**`. |
| `.ci/runtimes*.json` | Generated test-duration indexes, one variant per CI job/suite. |
| `README.md` | Human-facing summary of the skip flow and YAML format. |

## Working on skipped.yaml

### Setup (once per clone)

```bash
git config core.hooksPath .githooks
cd skipped-tests/tools && npm ci
```

The pre-commit hook refuses to run, and fails the commit, if
`skipped-tests/tools/node_modules` is missing. Node 20 matches CI.

### Validate and render

```bash
cd skipped-tests/tools
npm run validate   # schema + duplicate checks, prints "skipped.yaml is valid."
npm run generate   # prints the CI skip string on one line
```

Always run both before committing. `generate.js` is deliberately dumb: it never
writes a file, and it prints an empty line when there is nothing to skip.

### Semantics

- `skips_all_branches`: applied to every branch. Use sparingly.
- `skips`: applied only to the branches named in the entry's `branches` list.
  Branch values are the names CI reports, which can be a real branch
  (`ai-next/2.0.x`) or a PR merge ref (`refs/pull/22651/merge`).
- `reset_branches`: a branch listed here runs with no skips applied at all.
  Use it to clear inherited skips on a hotfix or release branch.
- All three sections are optional; a missing or empty section means no skips of
  that kind.

### Rules enforced by schema.json and validate.js

- `name`, `reason` and `owner` are required everywhere. `owner` must be a valid
  email (use `@konghq.com`).
- `branches` is required in `skips` and must be non-empty.
- `note` is optional, and is the place for ticket links and unskip conditions.
- Test names must be unique within each section. A test needing different skips
  on different branches goes in one `skips` entry listing all those branches.
- `reset_branches` values must be unique.
- No extra top-level or per-entry keys (`additionalProperties: false`).
- The pre-commit hook rejects tab indentation.

### Output contract of generate.js

One line, `key:value;key:value`, where a key is `all` or a branch name and a
value is a comma-separated list of test names, or the literal `reset`.
Empty output is valid and means "no skips". The CI workflow asserts this shape
with a regex, so do not change the separator, the `all` key, or the `reset`
token without coordinating with consumer repos.

### Editing conventions

- Two-space indent, double-quoted scalars, one test per entry, matching the
  existing style.
- Names are lowercase kebab-case and must match the test name CI reports.
- Write a `reason` that a reader can act on, and link the evidence when you have
  it (CI run URL, PR, or `https://konghq.atlassian.net/browse/AG-xxxx`).
- Skips are temporary. When the underlying fix lands, remove the entry instead
  of adding a note about it. Recent commits here are mostly unship work.
- Keep unrelated skip changes in separate commits with a clear message
  (for example `unskip opa tests`).

## Working on .ci/runtimes*.json

These are generated data, not hand-maintained. They are JSON Lines, one object
per line: `{"suite":"...","filename":"...","expectedDuration":<seconds>}`.
Populated by an automated job (commit messages look like
`Updated .ci/runtimes-ee.json`).

- Do not hand-edit or reformat them, and do not "fix" the size.
- Placeholders are intentional and valid: `runtimes.json` and
  `runtimes-migration.json` are empty files, and the FIPS and normal-build
  variants contain `[]`. Empty means "no measurements yet".
- Suite values seen in `runtimes-ee.json` include `unit`, `plugins`,
  `integration`, `dbless`, `integration_fips`, `normal_build`, `plugin`.
- A rewrite of one of these files in a PR should be treated as bot output and
  left alone unless you know why it changed.

## CI

`.github/workflows/validate-skipped-tests.yml` runs on pushes touching
`skipped-tests/**` and on manual dispatch. It installs with `npm ci`, runs
`npm run validate`, then runs `npm run generate` and fails if the output does
not match the format above. It does not check `.ci/**`.

## Notes for consumer repos

If you are an agent working in a gateway repo that consumes this one:

- Treat `skipped-tests/skipped.yaml`, `skipped-tests/schema.json` and the
  `generate.js` output format as a stable interface. Read them; do not vendor,
  copy or re-implement them locally.
- Never edit skip data from the consumer side. The skip list is only changed by
  opening a PR here, which keeps ownership and history in one place.
- A test skip must name an owner and a reason, so when a test starts failing,
  check `skipped.yaml` for the name before debugging the test itself. An entry
  whose `owner` is you is your responsibility to remove once the fix lands.
- Missing skips on a branch are usually a `reset_branches` entry, not a bug in
  the skip list.
- Read `.ci/runtimes*.json` for the suite/file you are running to pick which
  job a given spec belongs to; do not regenerate them.
