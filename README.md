# gateway-action-storage

CI configuration and E2E skip management for gateway tests.

This repo replaces the legacy `SKIP_E2E_TEST` variable with a version-controlled skip list in `skipped-tests/skipped.yaml`,
and the `TESTS_LLM_MODELS_JSON*` variables with a version-controlled model map in `llm-models/models.yaml`.

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

## llm-models/models.yaml

The model ids the kong-ee AI e2e tests call. A test asks for an abstract key such as
`getModel('gemini-vertex.chat.small')`, and this file maps the key to a model id.

```yaml
common:
  "gemini-vertex.chat.small": "gemini-3.8-flash"

sets:
  # For lines without the Gemini 3 fix (#23109).
  "gemini-2.5": &gemini_2_5
    "gemini-vertex.chat.small": "gemini-2.5-flash"

lines:
  "release/3.16.0.2":
    reason: "Lacks the Gemini 3 fix (#23109)."
    owner: "email@konghq.com"
    models:
      <<: *gemini_2_5

branches: {}
```

| Section | Required | Description |
|---------|----------|-------------|
| common | Yes | Model ids every branch uses |
| sets | No | Named groups of models that lines merge with `<<: *anchor` |
| lines | Yes (may be empty) | Only the lines whose models differ from `common`; a run uses exactly one line |
| branches | No | Exact branch names, applied last, to try new model ids on a feature branch |

A line pins only the keys its tests call, and only where the value differs from
`common`. A group of pins that several lines share goes in `sets`, with the reason
in a comment, and each line merges it; a key the line sets itself wins over the
merged one. Lines whose entry would be identical share it through an alias. The
validator warns about a pin that changes nothing.

Each entry has `reason`, `owner` and `models` (required), and `note` (optional).

### Which branches are lines

| Branch | Is a line | Models |
|---|---|---|
| `master`, `aigw-master`, `next/X.Y.x.x` (from 3.10), `aigw-next/X.Y.x` (from 2.2) | always, with no entry needed | `common`, unless listed |
| `release/*`, `aigw-release/*` | only when listed in `lines` | the listed models |
| fix, feature, backport branches | never | the line found below |

So `lines` lists only exceptions, and a new `next/X.Y.x.x` needs nothing here. A
name under `lines` must be a maintained branch: the validator rejects anything else.

### Which line a run uses

kong-ee takes the first that applies:

1. `TESTS_LLM_MODELS_LINE`, set by hand for one run.
2. The pull request target branch, when it is a line.
3. The branch under test, when it is a line (a push or a dispatch on a line).
4. The line closest to the tested commit in git history: the fewest commits the
   commit has that the line lacks, then the fewest the line has that the commit
   lacks. kong-ee counts both with git (see below). When `master` or `aigw-master`
   is among the closest, it wins: the commit left the trunk before the other lines
   were cut from it.

Rule 4 is why a fix branch needs no entry: `release-3.16.0.2-tests-fix`, cut from
`release/3.16.0.2`, is 3 commits ahead of that line and 66 ahead of `next/3.16.x.x`,
so it gets the release's models. The branch name plays no part.

A release with no entry is not a line, so its branches land on its `next` line, or
on a newer listed release of the same version. Before you change a `next/*` entry,
add an entry for each release of that line that must keep its current models.

The run log shows the result, for example
`[tests-llm-models] line=release/3.16.0.2 via=history a=3 b=9; runner-up next/3.16.x.x a=66 b=204`.

kong-ee makes no GitHub API call for this. In CI it reads `models.yaml` from a git
checkout of this repo, and counts commits in a scratch repository it fills over git,
so no API or anonymous rate limit applies. Locally it downloads `models.yaml` once an
hour and counts with the developer's clone.

### Validate and audit

```bash
cd llm-models/tools
npm ci
npm run validate   # schema, sorted keys, maintained-branch line names, set rules, no-op pins
npm run audit      # live kong-ee releases with no entry, entries with no branch (needs gh)
npm run ids        # every model id in the file as JSON, for kong-ee's model availability check
```
