# CLAUDE.md

Guidance for agents working in this repository.

## What this repo is

`gateway-action-storage` is not an application. It is shared CI data for the Kong
gateway test pipelines (`kong-ee` and the gateway API suites). Other repos' CI
workflows read files from here at a pinned ref, so the file paths, formats and
semantics below are a public interface. Changing them can break CI in repos you
cannot see from here.

It holds three independent data sets:

1. `skipped-tests/skipped.yaml`, the version-controlled E2E skip list that
   replaced the legacy `SKIP_E2E_TEST` environment variable.
2. `.ci/runtimes*.json`, per-file test durations used by the gateway CI to
   balance and shard test runs.
3. `llm-models/models.yaml`, the model ids the AI e2e tests call, which
   replaced the `TESTS_LLM_MODELS_JSON*` repository variables of kong-ee.

## Layout

| Path | Purpose |
|------|---------|
| `skipped-tests/skipped.yaml` | The skip list. The only file meant to be hand-edited for skip work. |
| `skipped-tests/schema.json` | JSON Schema (draft-07) for `skipped.yaml`, enforced by `validate.js`. |
| `skipped-tests/tools/validate.js` | Schema check plus duplicate-name and duplicate-`reset_branches` checks. |
| `skipped-tests/tools/generate.js` | Renders the compact skip string consumed by CI. Prints to stdout only. |
| `skipped-tests/tools/report.js` | Renders a Slack digest of current skips, with per-entry age from git history. Prints to stdout only. |
| `.githooks/pre-commit` | Fast local checks, runs only when `skipped.yaml`, or `models.yaml`, its schema or its tools, are staged. |
| `.github/workflows/validate-skipped-tests.yml` | CI validation on any push touching `skipped-tests/**`. |
| `.github/workflows/slack-skip-digest.yml` | Weekly Monday cron posting the skip digest to Slack. Manual dispatch defaults to dry-run. |
| `.ci/runtimes*.json` | Generated test-duration indexes, one variant per CI job/suite. |
| `llm-models/models.yaml` | The model map. The only file meant to be hand-edited for model work. |
| `llm-models/schema.json` | JSON Schema (draft-07) for `models.yaml`, enforced by `validate.js`. |
| `llm-models/tools/validate.js` | Schema check plus sorted keys, line names (maintained branches only), set rules, and no name in both `lines` and `branches`. |
| `llm-models/tools/ids.js` | Prints every model id in `models.yaml` as JSON (`npm run ids`); kong-ee's `ai-model-check.yml` checks them all. |
| `llm-models/tools/audit.js` | Manual, read-only report against the live kong-ee branches. Needs an authenticated `gh`. |
| `.github/workflows/validate-llm-models.yml` | CI validation on any push touching `llm-models/**`. |
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
- `include_descendants` (skips entries only): also skip on branches whose head
  contains the listed branch's tip, re-resolved via GitHub compare at each job
  start. Use it only on frozen or slow-moving branches; a new commit on the
  listed branch stops the skip for existing descendants until they rebase. A
  deleted branch or a fork PR fails open (the spec runs). README.md has the full
  usage guide.
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
- `include_descendants` is a boolean, only valid in `skips` entries, and cannot
  combine with wildcard branch names.
- No extra top-level or per-entry keys (`additionalProperties: false`).
- The pre-commit hook rejects tab indentation.

### Output contract of generate.js

One line, `key:value;key:value`, where a key is `all`, a branch name, or a branch
name suffixed with `^` (an internal marker for `include_descendants` entries, not
Git revision syntax; the descendant-aware filter expands it to "heads containing
this branch's tip", older filters ignore it because no real branch name contains
`^`), and a value is a comma-separated list of test names, or the literal `reset`.
Empty output is valid and means "no skips". The CI workflow asserts this shape
with a regex, so do not change the separator, the `all` key, the `reset` token or
the `^` marker without coordinating with consumer repos.

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

## Working on llm-models/models.yaml

### Setup (once per clone)

```bash
git config core.hooksPath .githooks
cd llm-models/tools && npm ci
```

### Validate

```bash
cd llm-models/tools
npm run validate   # prints "models.yaml is valid."; warnings do not fail it
npm run audit      # optional: live line branches with no entry, entries with no branch
npm run ids        # optional: every model id in the file, as JSON
```

### Semantics

- `common`: the model ids every branch uses, keyed by the abstract key that kong-ee
  passes to `getModel()`.
- `lines`: only the lines whose models differ from `common`. A run uses exactly one
  line, and its `models` go on top of `common`. The lines are:
  - the version lines, always, with no entry needed: `master`, `aigw-master`,
    `next/X.Y.x.x` from 3.10, `aigw-next/X.Y.x` from 2.2. Unlisted, they use `common`;
  - the releases (`release/*`, `aigw-release/*`) listed here. An unlisted release is
    not a line: its branches land on the line closest to them (its next line, or a
    newer listed release of the same version).

  kong-ee picks the line in this order:
  1. `TESTS_LLM_MODELS_LINE`, a manual choice for a run.
  2. The pull request target branch, when it is a line.
  3. The branch under test, when it is a line (a push or a dispatch on a line).
  4. The line closest to the tested commit in git history: the fewest commits the
     commit has that the line does not, then the fewest the line has that the
     commit does not. This is what lets a fix branch such as
     `release-3.16.0.2-tests-fix` get the `release/3.16.0.2` models with no entry of
     its own. When `master` or `aigw-master` is among the closest, it wins: the
     commit left the trunk before the other lines were cut from it.

  The version-line rule is duplicated in kong-ee's resolver
  (`spec-ee/kong-api-tests/test/shared/resolve-tests-llm-models.ts`) and in
  `validate.js`; change both together.
- `branches`: exact branch names, applied after the line. Use one to try new model
  ids on a feature branch, and remove it when the branch merges.
- `sets`: named groups of models that several lines pin, such as the Gemini 2.5
  models for lines without the Gemini 3 fix. A line merges one with a YAML merge
  key, `<<: *anchor` or `<<: [*a, *b]`, and a key the line sets itself wins over
  the merged one. Consumers see only the merged result. Lines whose entry would be
  identical share it through an alias (`"release/3.16.0.2": *release_3_15_and_3_16`).
- Before you change a `next/*` entry, add an entry for each release of that line
  that must keep its current models. `npm run audit` lists the live releases with
  no entry.
- A new version line (e.g. `next/3.17.x.x`) needs nothing here.

### Rules enforced by schema.json and validate.js

- `common` and `lines` are required (`lines` may be empty). `reason`, `owner` and `models` are required
  in every entry. `owner` must be a valid email.
- Keys are sorted alphabetically in `common`, in `sets` and each set, in `lines`,
  in `branches` and in each `models` map.
- Branch names are exact: no wildcards.
- A name under `lines` must be a maintained branch (`master`, `aigw-master`,
  `next/…`, `release/…`, `aigw-next/…`, `aigw-release/…`): an error otherwise. A
  feature branch listed as a line would also attract unrelated branches that left
  the trunk at the same point; its models go under `branches`.
- An entry with no models for a version line is a warning: it is a line already.
  Models of its own on `master`/`aigw-master` are a warning: the version lines cut
  from them get `common`, not those models.
- A key in a `models` map that is not in `common` is a warning, not an error, since
  old lines keep keys that `common` dropped.
- A key a line sets to the value it already gets from `common` or its sets is a
  warning: it changes nothing. A freeze of today's value belongs in a set, where
  its reason is written once.
- A merge must point at a set; every set must be merged somewhere; two sets must
  not share a key; a set cannot merge another set.
- Every key in a set must be in `common` (an error, unlike in a line): a set freezes
  keys of `common`, and a typo would leave its lines on the newer model.
- A merge goes inside `models`. To reuse a whole entry, alias it
  (`"release/3.16.0.2": *release_3_15_and_3_16`); `<<` at entry level is rejected.
- Duplicate keys fail the YAML parse.

### Editing conventions

- Two-space indent, double-quoted keys and values, as in the rest of the file.
- Pin only keys the line's tests call (`getModel('<key>')` on that branch). A pin
  for a key nobody calls is dead weight that every model change has to read past.
- Put the merge key first in a `models` map. Explain a set in a comment above it.
- Write a `reason` that says why the line differs from `common`, and link the
  evidence (the fix the line lacks, a CI run, `https://konghq.atlassian.net/browse/AG-xxxx`).
- Keep unrelated model changes in separate commits.

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

`.github/workflows/validate-llm-models.yml` runs on pushes touching
`llm-models/**` and on manual dispatch. It installs with `npm ci` and runs
`npm run validate`.

`.github/workflows/validate-skipped-tests.yml` runs on pushes touching
`skipped-tests/**` and on manual dispatch. It installs with `npm ci`, runs
`npm run validate`, then runs `npm run generate` and fails if the output does
not match the format above. It does not check `.ci/**`.

## Slack digest

`.github/workflows/slack-skip-digest.yml` runs on Monday mornings (Beijing
time) and posts `npm run report` output to Slack. It needs the `SLACK_BOT_TOKEN`
secret (a Bot User OAuth Token, `xoxb-…`, with `chat:write`; the bot must be a
member of the channel or the app needs `chat:write.public`) and the
`SLACK_CHANNEL` variable. `report.js` derives each entry's age from the git
history of `skipped.yaml` (the most recent commit that introduced the entry to
its section, so an entry that is unskipped and later re-skipped has its age
reset to the re-skip date), so the workflow needs full history
(`fetch-depth: 0`). Entries are tagged 🆕 when
added within 7 days and ⚠️ when older than 21 days; the message `<!here>`s only
when at least one entry is new or stale. Manual dispatch defaults to dry-run,
which prints the message to the step summary instead of posting. Test changes
locally with `npm run report` from `skipped-tests/tools`.
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
- Model ids come from `llm-models/models.yaml`. Change them only with a PR here.
  The run log line `[tests-llm-models] line=...` says which line a run used.
