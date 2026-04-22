# gateway-action-storage

Storage repository for gateway CI configuration and actions.

## Contents

### `.ci/`

Runtime configuration for CI test suites (expected durations, test groupings). These files are machine-generated.

### `skipped-tests/`

Structured list of E2E tests that are currently skipped in CI. This replaces the `SKIP_E2E_TEST` GitHub Actions variable with a version-controlled, auditable approach.

#### `skipped.yaml` format

```yaml
skips_all_branches:       # skipped on every branch
  - name: "test-name"
    reason: "why it is skipped"
    owner: "email@konghq.com"
    note: "optional extra context"

skips:                    # skipped on specific branches only
  - name: "test-name"
    reason: "why it is skipped"
    owner: "email@konghq.com"
    branches:
      - "branch-name"

reset_branches:           # branches that skip nothing
  - "branch-name"
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Test name as used in CI |
| `reason` | Yes | Why the test is skipped |
| `owner` | Yes | Who is responsible for re-enabling it (email) |
| `note` | No | Additional context, ticket links, etc. |
| `branches` | Yes (in `skips` only) | Branches this skip applies to |

All three top-level sections are optional. If a section is absent or empty, no skips are applied for that category.

#### Adding or removing a skip

Open a PR modifying `skipped-tests/skipped.yaml`. The PR check will automatically validate the file against the schema and fail if the format is invalid.
