#!/usr/bin/env node
// Validates the LLM models map that the gateway E2E suites read.
//
// The map is a public interface. kong-ee generates
// scripts/test-fixtures/tests_llm_models_json.json from these files at run
// time, so a malformed file, or a name that no branch can resolve, breaks CI in
// that repo. Only the single writer, scripts/push-tests-llm-models.sh, produces
// these files; this check is the backstop for a hand edit.
//
// Format and name shape only. The check cannot tell whether an override file
// belongs to a branch that exists, because a file is often created before its
// branch. That audit lives in kong-ee, in scripts/audit-tests-llm-models.sh.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Defaults to the .ci directory that holds the map. --root points it at another
// copy of that directory, which is how .githooks/pre-push validates the revision
// it is about to push rather than the working tree.
let ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  if (args[index] === "--root") {
    const value = args[index + 1];
    if (!value) {
      console.error("ERROR: --root needs the directory that holds tests-llm-models.json");
      process.exit(2);
    }
    ROOT = path.resolve(value);
    index++;
  } else {
    console.error(`ERROR: unknown argument: ${args[index]}`);
    console.error("Usage: validate-tests-llm-models.mjs [--root DIR]");
    process.exit(2);
  }
}

const SHARED_PATH = path.join(ROOT, "tests-llm-models.json");
const OVERRIDES_DIR = path.join(ROOT, "tests-llm-models-overrides");

// kong-ee uppercases a branch name and replaces every other character with "_",
// so an override file outside this shape can never be resolved by any branch.
const OVERRIDE_NAME_PATTERN = /^[A-Z0-9]+(_[A-Z0-9]+)*\.json$/;

const errors = [];
const validated = [];

function check(filePath, label) {
  const before = errors.length;
  const count = readMap(filePath, label);

  if (errors.length === before) {
    validated.push(`${label} (${count} ${count === 1 ? "key" : "keys"})`);
  }
}

function fail(label, message) {
  errors.push(`${label}: ${message}`);
}

function readMap(filePath, label) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    fail(label, `cannot read the file (${err.code ?? err.message})`);
    return null;
  }

  if (raw.trim() === "") {
    fail(label, "is empty");
    return null;
  }

  if (!raw.endsWith("\n")) {
    fail(label, "does not end with a newline");
  }

  let data;
  try {
    // A second JSON value after the first one makes this throw, which is what
    // rejects a file that holds two objects.
    data = JSON.parse(raw);
  } catch (err) {
    fail(label, `is not valid JSON (${err.message})`);
    return null;
  }

  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    fail(label, "is not a single JSON object");
    return null;
  }

  const keys = Object.keys(data);

  if (keys.length === 0) {
    fail(label, "has no keys");
  }

  for (const key of keys) {
    const value = data[key];
    if (typeof value !== "string" || value.length === 0) {
      fail(label, `key "${key}" does not hold a non-empty string`);
    }
  }

  const sorted = [...keys].sort();
  if (sorted.some((key, index) => key !== keys[index])) {
    fail(label, "keys are not in alphabetical order; the push script writes them sorted");
  }

  return keys.length;
}

check(SHARED_PATH, "tests-llm-models.json");

if (!fs.existsSync(OVERRIDES_DIR)) {
  console.log("No overrides directory. The shared map covers every branch.");
} else {
  const files = fs
    .readdirSync(OVERRIDES_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort();

  for (const name of files) {
    const label = `tests-llm-models-overrides/${name}`;
    if (!OVERRIDE_NAME_PATTERN.test(name)) {
      fail(label, "name does not match the shape kong-ee derives from a branch name");
      continue;
    }
    check(path.join(OVERRIDES_DIR, name), label);
  }
}

if (errors.length > 0) {
  console.error(`${errors.length} problem(s) found:`);
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
}

for (const line of validated) {
  console.log(`  ok  ${line}`);
}

console.log(`\n${validated.length} file(s) valid.`);
