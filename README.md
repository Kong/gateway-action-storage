# gateway-action-storage

Storage repository for gateway CI configuration and actions.

## Contents

### `.ci/`

Runtime configuration for CI test suites (expected durations, test groupings). These files are machine-generated.

### `skipped-tests/`

Structured list of E2E tests that are currently skipped in CI. This replaces the `SKIP_E2E_TEST` GitHub Actions variable with a version-controlled, auditable approach.

#### File structure

```
skipped-tests/
  skipped.yaml    # the skip list
  schema.json     # validation schema
  validate.js     # validation script (used by PR check)
  generate.js     # outputs SKIP_E2E_TEST-compatible string
  package.json
```

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

#### Consuming in kong-ee

`generate.js` reads `skipped.yaml` and outputs a `SKIP_E2E_TEST`-compatible string:

```
all:test1,test2;branch1:test3;branch2:reset
```

Usage in a kong-ee workflow:

```yaml
- uses: actions/checkout@v4
  with:
    repository: Kong/gateway-action-storage
    path: gateway-action-storage

- name: Get skip list
  id: skip
  run: echo "value=$(node gateway-action-storage/skipped-tests/tools/generate.js)" >> $GITHUB_OUTPUT

- name: Run tests
  env:
    SKIP_E2E_TEST: ${{ steps.skip.outputs.value }}
```

If `generate.js` fails, the job fails immediately and no tests are run. This is intentional — running tests without the skip list would cause known-broken tests to run and fail.
