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

const byBranch = new Map();
for (const entry of data.skips ?? []) {
  for (const branch of entry.branches ?? []) {
    const includeDescendants = entry.include_descendants === true;
    if (includeDescendants && branch.includes("*")) {
      throw new Error(`include_descendants requires exact branch names: ${branch}`);
    }

    for (const ruleBranch of includeDescendants ? [branch, `${branch}^`] : [branch]) {
      const names = byBranch.get(ruleBranch) ?? [];
      names.push(entry.name);
      byBranch.set(ruleBranch, names);
    }
  }
}
for (const [branch, names] of byBranch) {
  parts.push(`${branch}:${names.join(",")}`);
}

for (const branch of data.reset_branches ?? []) {
  parts.push(`${branch}:reset`);
}

console.log(parts.join(";"));
