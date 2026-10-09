# gateway-action-storage

CI configuration and E2E skip management for gateway tests.

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
