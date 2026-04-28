import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, "schema.json"), "utf8"));
const raw = fs.readFileSync(path.join(ROOT, "skipped.yaml"), "utf8");
const data = yaml.load(raw) ?? {};

// allErrors: true reports all violations instead of stopping at the first
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

const validate = ajv.compile(schema);

if (!validate(data)) {
  for (const err of validate.errors) {
    console.error(`Validation failed at "${err.instancePath}": ${err.message}`);
  }
  process.exit(1);
}

// a test name must be unique within each section
for (const [section, entries] of [
  ["skips_all_branches", data.skips_all_branches ?? []],
  ["skips", data.skips ?? []],
]) {
  const seen = new Set();
  const dups = new Set();
  for (const { name } of entries) {
    if (seen.has(name)) dups.add(name);
    seen.add(name);
  }
  if (dups.size > 0) {
    console.error(`Duplicate test names in ${section}: ${[...dups].join(", ")}`);
    process.exit(1);
  }
}

// a branch name must appear at most once in reset_branches
const resetBranches = data.reset_branches ?? [];
const seenBranches = new Set();
const dupBranches = new Set();
for (const branch of resetBranches) {
  if (seenBranches.has(branch)) dupBranches.add(branch);
  seenBranches.add(branch);
}
if (dupBranches.size > 0) {
  console.error(`Duplicate reset_branches found: ${[...dupBranches].join(", ")}`);
  process.exit(1);
}

console.log("skipped.yaml is valid.");
