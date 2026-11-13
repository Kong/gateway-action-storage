// Prints every model id in models.yaml as one JSON object, for checks that look at model ids
// rather than at one line's map (kong-ee's model availability and hardcoded-model checks).
// Keys say where each id comes from: "common:<key>", "sets/<set>:<key>", "lines/<line>:<key>",
// "branches/<branch>:<key>". Prints to stdout only.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = process.env.MODELS_FILE || path.join(ROOT, "models.yaml");
const data = yaml.load(fs.readFileSync(file, "utf8")) ?? {};

const ids = {};
const add = (where, models) => {
  for (const [key, id] of Object.entries(models ?? {})) ids[`${where}:${key}`] = id;
};
add("common", data.common);
for (const [name, set] of Object.entries(data.sets ?? {})) add(`sets/${name}`, set);
for (const section of ["lines", "branches"]) {
  for (const [name, entry] of Object.entries(data[section] ?? {})) add(`${section}/${name}`, entry.models);
}
process.stdout.write(JSON.stringify(ids, null, 2) + "\n");
