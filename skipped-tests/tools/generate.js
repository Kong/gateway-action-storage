import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const raw = fs.readFileSync(path.join(ROOT, "skipped.yaml"), "utf8");
const data = yaml.load(raw) ?? {};

const parts = [];

const allBranches = data.skips_all_branches ?? [];
if (allBranches.length > 0) {
  parts.push(`all:${allBranches.map((e) => e.name).join(",")}`);
}

const byBranch = {};
for (const entry of data.skips ?? []) {
  for (const branch of entry.branches ?? []) {
    (byBranch[branch] ??= []).push(entry.name);
  }
}
for (const [branch, names] of Object.entries(byBranch)) {
  parts.push(`${branch}:${names.join(",")}`);
}

for (const branch of data.reset_branches ?? []) {
  parts.push(`${branch}:reset`);
}

console.log(parts.join(";"));
