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
| include_descendants | No (in skips only) | Also skip branches whose head contains a listed branch's tip. Frozen or slow-moving branches only — see below |

All top-level sections are optional. If a section is absent or empty, no skips are applied for that category.

## include_descendants

A branch-scoped skip with `include_descendants: true` skips the spec on the listed
branch **and on every branch whose head contains the listed branch's current tip**
— i.e. backport / stacked PR branches cut from it — without naming them one by one.
It replaces hand-maintained PR-branch lists (`backport-21114-to-next/3.12.x.x`,
`21494/merge`, …).

**Use it only on frozen or slow-moving branches** (old release / patch lines). Do
**not** use it on `aigw-master` or active release branches.

### The one rule that decides everything

At the moment each CI job starts, the filter asks: **does the SHA being tested
contain the listed branch's tip right now?** (GitHub compare; skip iff `ahead` or
`identical`.) The tip is re-resolved on every job execution — it is not captured
when the branch is cut.

| Time | Event | Result for a PR cut from the base branch |
|---|---|---|
| 10:00 | base branch tip = T0 | — |
| 10:05 | you cut your PR branch from T0 | — |
| 10:06 | your PR's first check runs (tip still T0) | **skipped** — your head contains the tip |
| 11:00 | another PR merges to the base (tip → T1) | — |
| 11:05+ | any check / re-run / dispatch on your branch | **runs** — `diverged`; your head only knows T0 |
| 16:00 | you rebase onto the current tip | **skipped again**, until the next base merge |

On a branch that merges several times a day (`aigw-master`), the skip covers a PR
for about an hour and then silently stops. On a frozen branch the 11:00 row never
happens, so the skip covers the PR's whole life. That asymmetry is the entire
usage rule.

### What this means per run type

- **PR's own check** — uses the PR **head SHA** from the event payload (never the
  `pull/N/merge` ref the job checks out). Fires on push / re-run / reopen;
  base-branch movement alone does not trigger it, but any trigger after a base
  merge will run the spec.
- **Manual dispatch** — same verdict, always evaluated fresh at click time.
  `e2e_skip_source=none` bypasses the skip list entirely.
- **Re-run of an old job** — re-uses the **original event's head SHA**. After you
  rebase, a re-run of an old job still compares the pre-rebase head and can run
  the spec even though your branch is now up to date. A fresh push or new dispatch
  gives the current answer.
- **Merging** — your PR merges with the spec skipped only while it is up to date
  with the tip when its final check runs; between rebases the spec comes back, so
  long-lived PRs will see it run.

### Restrictions and edge behavior

- Exact branch names only — wildcards are rejected with this flag.
- Not valid in `skips_all_branches` (the schema rejects it; that section already
  covers everything).
- The listed branch must exist: a deleted branch 404s the compare and the rule
  **fails open** (the spec runs). Fork PRs fail open too (head unavailable in the
  base repo).
- Requires the descendant-aware filter (Kong/kong-ee#24201) on the branch.
  Branches with an older filter still get the exact-branch rule: `generate.js`
  emits both `branch:spec` and `branch^:spec`, and an old filter ignores the
  `branch^` key because no real branch name contains `^`.

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
