// Manual, read-only check of models.yaml against the live branches of Kong/kong-ee.
// Needs an authenticated `gh` with read access to Kong/kong-ee (an internal repo, so
// the CI token of this repo cannot run it).
//
// Usage: npm run audit [-- --days 60]
//
// Reports:
//   - live release branches with no entry. Each one follows the line it came from (its next
//     line, or a newer listed release), which is right until that line's models change. Add an
//     entry first if the release must keep its current models. Version lines (next/*,
//     aigw-next/*) need no entry: they are lines with the common models unless listed.
//   - entries whose branch no longer exists. Remove them.
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import yaml from "js-yaml";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = { owner: "Kong", name: "kong-ee" };
// Releases are lines only when listed. Version lines and feature or fix branches are not reported.
const LINE_PREFIXES = ["refs/heads/release/", "refs/heads/aigw-release/"];

const daysArg = process.argv.indexOf("--days");
const days = daysArg === -1 ? 60 : Number(process.argv[daysArg + 1]);
if (!Number.isInteger(days) || days <= 0) {
  console.error("--days must be a positive integer");
  process.exit(1);
}
const since = Date.now() - days * 24 * 60 * 60 * 1000;

const data = yaml.load(fs.readFileSync(path.join(ROOT, "models.yaml"), "utf8")) ?? {};
const lines = Object.keys(data.lines ?? {});
const branches = Object.keys(data.branches ?? {});

const graphql = (query, variables) => {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    args.push(value === null ? "-F" : "-f", `${key}=${value === null ? "null" : value}`);
  }
  return JSON.parse(execFileSync("gh", args, { encoding: "utf8" }));
};

// Every branch under one prefix, newest commit first, with its commit date.
const listPrefix = (prefix) => {
  const query = `query($owner: String!, $name: String!, $prefix: String!, $after: String) {
    repository(owner: $owner, name: $name) {
      refs(refPrefix: $prefix, first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { name target { ... on Commit { committedDate } } }
      }
    }
  }`;
  const found = [];
  let after = null;
  do {
    const page = graphql(query, { owner: REPO.owner, name: REPO.name, prefix, after }).data.repository.refs;
    for (const node of page.nodes) {
      found.push({ name: prefix.replace("refs/heads/", "") + node.name, date: node.target?.committedDate });
    }
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return found;
};

// Whether each named branch exists, in one query.
const existing = (names) => {
  if (names.length === 0) return new Set();
  const aliases = names
    .map((name, i) => `b${i}: ref(qualifiedName: ${JSON.stringify(`refs/heads/${name}`)}) { name }`)
    .join("\n");
  const repo = graphql(
    `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${aliases} } }`,
    { owner: REPO.owner, name: REPO.name },
  ).data.repository;
  return new Set(names.filter((_, i) => repo[`b${i}`] !== null));
};

const live = LINE_PREFIXES.flatMap(listPrefix).filter((b) => b.date && Date.parse(b.date) >= since);
const unlisted = live.filter((b) => !lines.includes(b.name)).sort((a, b) => a.name.localeCompare(b.name));

const listed = [...lines, ...branches];
const present = existing(listed);
const stale = listed.filter((name) => !present.has(name));

console.log(`Release branches with a commit in the last ${days} days and no entry in lines:`);
if (unlisted.length === 0) console.log("  none");
for (const b of unlisted) console.log(`  ${b.name} (last commit ${b.date.slice(0, 10)})`);

console.log("\nEntries whose branch does not exist in Kong/kong-ee:");
if (stale.length === 0) console.log("  none");
for (const name of stale) console.log(`  ${name}`);
