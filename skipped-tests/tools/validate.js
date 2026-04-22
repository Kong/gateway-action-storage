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

const ajv = new Ajv();
addFormats(ajv);

const validate = ajv.compile(schema);

if (!validate(data)) {
  for (const err of validate.errors) {
    console.error(`Validation failed at "${err.instancePath}": ${err.message}`);
  }
  process.exit(1);
}

console.log("skipped.yaml is valid.");
