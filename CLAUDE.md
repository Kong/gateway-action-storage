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
3. `.ci/tests-llm-models.json` and `.ci/tests-llm-models-overrides/`, the LLM
   model map that the gateway API suite reads. They replaced the
   `TESTS_LLM_MODELS_JSON*` repository variables of `kong-ee`.

## Layout

| Path | Purpose |
|------|---------|
| `skipped-tests/skipped.yaml` | The skip list. The only file meant to be hand-edited for skip work. |
| `skipped-tests/schema.json` | JSON Schema (draft-07) for `skipped.yaml`, enforced by `validate.js`. |
| `skipped-tests/tools/validate.js` | Schema check plus duplicate-name and duplicate-`reset_branches` checks. |
| `skipped-tests/tools/generate.js` | Renders the compact skip string consumed by CI. Prints to stdout only. |
| `skipped-tests/tools/report.js` | Renders a Slack digest of current skips, with per-entry age from git history. Prints to stdout only. |
| `.githooks/pre-commit` | Fast local checks, runs only when `skipped.yaml` is staged. |
| `.githooks/pre-push` | Validates the LLM models map in the revision a push would publish. Runs only when that commit touches the map. |
| `.github/workflows/validate-skipped-tests.yml` | CI validation on any push touching `skipped-tests/**`. |
| `.github/workflows/slack-skip-digest.yml` | Weekly Monday cron posting the skip digest to Slack. Manual dispatch defaults to dry-run. |
| `.ci/runtimes*.json` | Generated test-duration indexes, one variant per CI job/suite. |
| `.ci/tests-llm-models.json` | The shared LLM model map. Every lane of the gateway API suite reads it. |
| `.ci/tests-llm-models-overrides/<SANITIZED_BRANCH>.json` | Per-branch model overrides. One file per branch, holding only the keys that diverge. |
| `.ci/tools/validate-tests-llm-models.mjs` | Zero-dependency validator for the two rows above. |
| `.github/workflows/validate-llm-models.yml` | CI validation on any push touching the models map. |
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

## Working on the LLM models map

The map is a flat JSON object: an abstract key maps to the concrete model id the
tests call, for example `"openai.chat.small": "gpt-4o-mini"`. The suite asks for
the abstract key and never for the model id.

- `.ci/tests-llm-models.json` is the shared map. It applies to every branch.
- `.ci/tests-llm-models-overrides/<SANITIZED_BRANCH>.json` is one branch's
  override. It holds only the keys that diverge, and it wins over the shared map.
- Do not edit either by hand. `kong-ee` owns the writer,
  `scripts/push-tests-llm-models.sh`. It validates the content, prints the added,
  deleted and changed keys, asks for confirmation, and pushes one file per run.
- An override file name is the branch name in uppercase, with every other
  character replaced by `_`. Example: `next/3.16.x.x` becomes
  `NEXT_3_16_X_X.json`.
- The name is lossy. Two branch names can produce the same file name, and one
  file then serves both branches. No collision exists today. The validator
  cannot see this; run `scripts/audit-tests-llm-models.sh` in `kong-ee` to list
  the files whose branch does not exist.
- A file may exist before its branch. Preparing an override for a release branch
  that is not cut yet is normal, so the validator does not reject it.
- The values are public model ids. Never commit a key, a token or any other
  secret here, because this repository is public.
- The shared file is read by every lane, including long-term support branches. A
  bad shared file affects all of them at once.
- Run `node .ci/tools/validate-tests-llm-models.mjs` after a hand edit. A clone
  that set `core.hooksPath` also gets the same check from `.githooks/pre-push`,
  which validates the revision a push would publish.

### Format

Every file holds exactly one JSON object:

- Keys in alphabetical order. The push script writes them sorted, and the
  validator rejects a hand edit that is out of order.
- Every value is a non-empty string. No nested objects, no numbers, no nulls.
- Two-space indent, and a newline at the end of the file.

`node .ci/tools/validate-tests-llm-models.mjs` checks all of it, and
`.github/workflows/validate-llm-models.yml` runs the same command on any push
that touches the map.

### File to branch table

| File | Branch |
|------|--------|
| `AG_1882_VERTEX_SONNET_5_5.json` | none. Left over from the variable era; the branch is gone. |
| `AIGW_NEXT_2_2_X.json` | `aigw-next/2.2.x` |
| `NEXT_3_10_X_X.json` | `next/3.10.x.x` |
| `NEXT_3_13_X_X.json` | `next/3.13.x.x` |
| `NEXT_3_15_X_X.json` | `next/3.15.x.x` |
| `NEXT_3_16_X_X.json` | `next/3.16.x.x` |
| `RELEASE_3_14_0_17.json` | `release/3.14.0.17` |
| `RELEASE_3_15_0_7.json` | `release/3.15.0.7` |
| `RELEASE_3_15_0_7_TESTS_FIX.json` | `release-3.15.0.7-tests-fix` |
| `RELEASE_3_16_0_2.json` | `release/3.16.0.2` |

Update this table when you add or remove an override file.

## CI

`.github/workflows/validate-skipped-tests.yml` runs on pushes touching
`skipped-tests/**` and on manual dispatch. It installs with `npm ci`, runs
`npm run validate`, then runs `npm run generate` and fails if the output does
not match the format above. It does not check `.ci/**`.
`.github/workflows/validate-llm-models.yml` checks the models map on any push
that touches it. Nothing checks `.ci/runtimes*.json`, which is generated data.

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
- Do not edit the LLM models map from the consumer side either. The writer,
  `scripts/push-tests-llm-models.sh`, lives in `kong-ee` and pushes here.
- Change one branch's model ids with an override file, never by editing the
  shared map, because the shared map applies to every branch including long-term
  support ones.
