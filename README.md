# gateway-action-storage

CI configuration, shared test data and E2E skip management for gateway tests.

This repo replaces the legacy `SKIP_E2E_TEST` variable with a version-controlled skip list in `skipped-tests/skipped.yaml`.

## skipped.yaml Format

```yaml
skips_all_branches:
  - name: "test-name"
    reason: "why it is skipped"
    owner: "email@konghq.com"
    note: "optional extra context"

skips:
  - name: "test-name"
    reason: "why it is skipped"
    owner: "email@konghq.com"
    branches:
      - "branch-name"

reset_branches:
  - "branch-name"
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| name | Yes | Test name as used in CI |
| reason | Yes | Why the test is skipped |
| owner | Yes | Who is responsible for re-enabling it (email) |
| note | No | Additional context, ticket links, etc. |
| branches | Yes (in skips only) | Branches this skip applies to |

All top-level sections are optional. If a section is absent or empty, no skips are applied for that category.

## Update Flow (Repo Mode)

When updating `skipped-tests/skipped.yaml`:

- Pre-commit hook performs local format checks.
- CI runs `validate.js` for schema + duplicate validation.
- CI runs `generate.js` to ensure final skip list output can be generated.

## Pre-commit Hook

Run once in repository root:

```bash
git config core.hooksPath .githooks
```

The hook:

- Performs lightweight format checks
- Provides fast local feedback

## Local Tool Setup

Before running validation locally:

```bash
cd skipped-tests/tools
npm install
```

This is required for:

- validate.js
- generate.js
- report.js

## Skip Digest Bot

A scheduled workflow (`.github/workflows/slack-skip-digest.yml`) posts a weekly
(Monday) summary of the current skip list to Slack: one line per entry
(`name — owner — age`, branch-specific entries also list their branches),
sorted oldest first, and `<!here>` pings only when there are new or
stale (21+ days) skips. It requires the `SLACK_BOT_TOKEN` secret
(bot token with `chat:write`) and the `SLACK_CHANNEL` variable on the repo.

Preview the message locally without posting:

```bash
cd skipped-tests/tools
npm run report
```

## LLM Models Map

The gateway API suite in `kong-ee` reads LLM model ids from a map that lives
here, not from a repository variable.

| Path | Purpose |
|------|---------|
| `.ci/tests-llm-models.json` | The shared map. Every branch reads it. |
| `.ci/tests-llm-models-overrides/<SANITIZED_BRANCH>.json` | One branch's override. Holds only the keys that diverge. |

The suite asks for an abstract key, for example `openai.chat.small`, and the map
returns the concrete model id. A branch override wins over the shared map.

Update flow: run `scripts/push-tests-llm-models.sh` from a `kong-ee` clone. It
validates the file, prints the keys it adds, deletes and changes, asks for
confirmation, and pushes one file per run. Do not edit these files by hand.

An override file name is the branch name in uppercase with every other character
replaced by `_`, so `next/3.16.x.x` becomes `NEXT_3_16_X_X.json`. The mapping is
lossy, and the file list is the only record of it;
[`CLAUDE.md`](./CLAUDE.md) keeps the table.

Each file holds one JSON object, with keys in alphabetical order and non-empty
string values. The validator rejects anything else.

Validate locally:

```bash
node .ci/tools/validate-tests-llm-models.mjs
```

Run `git config core.hooksPath .githooks` once and the pre-push hook applies the
same check to the revision a push would publish, so a malformed or out-of-order
map is stopped before it reaches `main`. CI runs the check again on any push that
touches the map.
