import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// MODELS_FILE is a seam for checking a copy of the map, e.g. one made to test a rule.
const file = process.env.MODELS_FILE || path.join(ROOT, "models.yaml");
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, "schema.json"), "utf8"));
const MERGE = "<<";

// Two views of one file. `data` is what consumers read: merge keys (`<<: *set`) applied, the
// keys a line sets itself winning. `raw` keeps `<<` as a plain key, whose value is the merged
// set itself (js-yaml returns the anchored object for an alias), so the checks below can tell
// a line's own keys from the ones it merges. js-yaml throws on a duplicate key in either view.
let data;
let raw;
try {
  const text = fs.readFileSync(file, "utf8");
  data = yaml.load(text) ?? {};
  raw = yaml.load(text, { schema: yaml.CORE_SCHEMA }) ?? {};
} catch (err) {
  console.error(`Cannot parse ${file}: ${err.message}`);
  process.exit(1);
}

// allErrors: true reports all violations instead of stopping at the first
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

const validate = ajv.compile(schema);

if (!validate(data)) {
  for (const err of validate.errors) {
    // A JSON pointer escapes "/" as "~1"; show branch names as written. A bad key name is
    // reported on its parent, so name the key too.
    const at = err.instancePath.replace(/~1/g, "/").replace(/~0/g, "~");
    const key = err.params?.propertyName ?? err.params?.additionalProperty;
    console.error(`Validation failed at "${at}"${key ? ` (key "${key}")` : ""}: ${err.message}`);
  }
  process.exit(1);
}

const errors = [];
const warnings = [];

// An entry merged with `<<` at entry level, rather than aliased whole, has no `models` of its
// own in the raw view. Ask for the supported form instead of failing on a missing map below.
for (const [section, entries] of [["lines", raw.lines ?? {}], ["branches", raw.branches ?? {}]]) {
  if (MERGE in entries) {
    console.error(`${section}: a merge key directly under ${section} is not supported; list each entry by name`);
    process.exit(1);
  }
  for (const [name, entry] of Object.entries(entries)) {
    if (MERGE in entry || typeof entry.models !== "object" || entry.models === null) {
      console.error(
        `${section}.${name}: give the entry its own reason, owner and models. To reuse another ` +
          `entry as a whole, alias it ("${name}": *anchor); to reuse models, merge a set inside models.`,
      );
      process.exit(1);
    }
  }
}

// Sorted keys keep a diff to the lines that changed, and make a duplicate easy to spot.
// A merge key is not a model key, so it is left out.
const requireSorted = (label, obj) => {
  const keys = Object.keys(obj).filter((key) => key !== MERGE);
  const sorted = [...keys].sort();
  const i = keys.findIndex((key, n) => key !== sorted[n]);
  if (i !== -1) {
    errors.push(`${label}: keys are not in alphabetical order, first at "${keys[i]}"`);
  }
};

const common = data.common;
const lines = data.lines;
const branches = data.branches ?? {};
const rawSets = raw.sets ?? {};

requireSorted("common", common);
requireSorted("sets", rawSets);
requireSorted("lines", raw.lines);
requireSorted("branches", raw.branches ?? {});

// A set is only reachable through a merge, so a merge must point at one, and two sets must not
// share a key: when a line merges both, which one wins would depend on their order in `<<`.
const setNames = new Map(Object.entries(rawSets).map(([name, set]) => [set, name]));
const mergedSets = (models) => {
  const value = models[MERGE];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
};
const owners = new Map();
for (const [name, set] of Object.entries(rawSets)) {
  requireSorted(`sets.${name}`, set);
  // A set merging another set could hide a shared key from the check below.
  if (MERGE in set) {
    errors.push(`sets.${name}: a set cannot merge another set; merge both into the line instead`);
  }
  for (const key of Object.keys(set)) {
    if (key === MERGE) continue;
    // A set freezes keys of common for some lines. A key missing from common is almost always a
    // typo, and a typo would leave those lines on the newer model the set was meant to hold back.
    if (!Object.hasOwn(common, key)) {
      errors.push(`sets.${name}: "${key}" is not in common, check the spelling`);
    }
    if (owners.has(key)) {
      errors.push(`sets: "${key}" is in both "${owners.get(key)}" and "${name}"`);
    }
    owners.set(key, name);
  }
}

const used = new Set();
for (const [section, entries] of [["lines", raw.lines], ["branches", raw.branches ?? {}]]) {
  for (const [name, entry] of Object.entries(entries)) {
    const label = `${section}.${name}.models`;
    const models = entry.models;
    requireSorted(label, models);

    // What the line would get without its own keys: common, then the merged sets.
    const inherited = { ...common };
    for (const set of mergedSets(models)) {
      if (!setNames.has(set)) {
        errors.push(`${label}: merges a map that is not under sets`);
        continue;
      }
      used.add(set);
      Object.assign(inherited, set);
    }

    for (const [key, id] of Object.entries(models)) {
      if (key === MERGE) continue;
      // Old lines keep keys that common dropped, so this is a hint, not an error.
      if (!Object.hasOwn(common, key)) {
        warnings.push(`${section}.${name}: "${key}" is not in common, check the spelling`);
      }
      // A pin equal to what the line inherits changes nothing today. It only freezes the key,
      // and a freeze belongs in a set, where its reason is written once.
      if (inherited[key] === id) {
        warnings.push(`${section}.${name}: "${key}" repeats the value it already gets, remove it`);
      }
    }
  }
}

for (const [set, name] of setNames) {
  if (!used.has(set)) {
    errors.push(`sets: "${name}" is not merged into any line or branch, remove it`);
  }
}

// Every name under lines is a candidate for the branches that come from it, so only maintained
// branches belong there. A feature branch listed as a line would also attract unrelated branches
// that left the trunk at the same point; its models go under branches instead.
const MAINTAINED = /^(master|aigw-master|(next|release|aigw-next|aigw-release)\/[0-9][^\s]*)$/;
// Version lines are lines without an entry, with the common models: the same rule as the kong-ee
// resolver (spec-ee/kong-api-tests/test/shared/resolve-tests-llm-models.ts). Keep the two in sync.
const TRUNKS = ["master", "aigw-master"];
const VERSION_LINE = /^(?:(next)\/(\d+)\.(\d+)\.x\.x|(aigw-next)\/(\d+)\.(\d+)\.x)$/;
const VERSION_FLOORS = { next: [3, 10], "aigw-next": [2, 2] };
const isVersionLine = (name) => {
  if (TRUNKS.includes(name)) return true;
  const match = VERSION_LINE.exec(name);
  if (!match) return false;
  const family = match[1] ?? match[4];
  const major = Number(match[2] ?? match[5]);
  const minor = Number(match[3] ?? match[6]);
  const [floorMajor, floorMinor] = VERSION_FLOORS[family];
  return major > floorMajor || (major === floorMajor && minor >= floorMinor);
};

for (const [name, entry] of Object.entries(lines)) {
  if (!MAINTAINED.test(name)) {
    errors.push(
      `lines: "${name}" is not a maintained branch. Put a feature branch's models under branches, ` +
        "which applies them to that branch only.",
    );
  }
  const empty = Object.keys(entry.models).length === 0;
  if (empty && isVersionLine(name)) {
    warnings.push(`lines: "${name}" is a version line already; an entry with no models is not needed, remove it`);
  }
  // A version line with no entry gets common, not the models of the trunk it was cut from.
  if (!empty && TRUNKS.includes(name)) {
    warnings.push(`lines: "${name}" has models of its own, which the version lines cut from it do not get`);
  }
}

// One name in both sections would apply two layers to the same run.
for (const name of Object.keys(branches)) {
  if (Object.hasOwn(lines, name)) {
    errors.push(`branches: "${name}" is also a line, keep it in lines only`);
  }
}

for (const warning of new Set(warnings)) {
  console.warn(`warning: ${warning}`);
}
if (errors.length > 0) {
  for (const error of new Set(errors)) {
    console.error(error);
  }
  process.exit(1);
}

console.log("models.yaml is valid.");
