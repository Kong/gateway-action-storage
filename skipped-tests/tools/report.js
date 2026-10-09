import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import yaml from "js-yaml";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FILE = "skipped-tests/skipped.yaml";
const NEW_DAYS = 7;
const STALE_DAYS = 21;

const data = yaml.load(fs.readFileSync(path.join(REPO, FILE), "utf8")) ?? {};

function firstSeenTimestamps() {
  let commits;
  try {
    commits = execFileSync(
      "git",
      ["log", "--reverse", "--format=%H %ct", "--", FILE],
      { cwd: REPO, encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha, ts] = line.split(" ");
        return { sha, ts: Number(ts) * 1000 };
      });
  } catch {
    return {};
  }

  const firstSeen = {};
  for (const { sha, ts } of commits) {
    let doc;
    try {
      doc = yaml.load(
        execFileSync("git", ["show", `${sha}:${FILE}`], {
          cwd: REPO,
          encoding: "utf8",
          maxBuffer: 10 * 1024 * 1024,
        }),
      );
    } catch {
      continue;
    }
    if (!doc || typeof doc !== "object") continue;
    for (const section of ["skips_all_branches", "skips"]) {
      for (const entry of doc[section] ?? []) {
        const key = `${section}:${entry.name}`;
        if (!(key in firstSeen)) firstSeen[key] = ts;
      }
    }
  }
  return firstSeen;
}

const firstSeen = firstSeenTimestamps();

function withAge(section, entries) {
  return entries.map((entry) => {
    const ts = firstSeen[`${section}:${entry.name}`];
    const days = ts == null ? null : Math.floor((Date.now() - ts) / 86400000);
    return { ...entry, section, addedDays: days };
  });
}

const allBranch = withAge("skips_all_branches", data.skips_all_branches ?? []);
const perBranch = withAge("skips", data.skips ?? []);
const resets = data.reset_branches ?? [];

function ageTag(days) {
  if (days == null) return "_age unknown_";
  if (days <= NEW_DAYS) return `🆕 ${days}d`;
  if (days >= STALE_DAYS) return `⚠️ ${days}d`;
  return `${days}d`;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const blocks = [];

function header(text) {
  blocks.push({ type: "header", text: { type: "plain_text", text, emoji: true } });
}

function md(text) {
  blocks.push({ type: "section", text: { type: "mrkdwn", text } });
}

function divider() {
  blocks.push({ type: "divider" });
}

function bullet(entry) {
  let head = `• \`${esc(entry.name)}\` — ${esc(entry.owner)} — ${ageTag(entry.addedDays)}`;
  if (entry.section === "skips") {
    head += ` — ${esc((entry.branches ?? []).join(", "))}`;
  }
  return head;
}

function entryList(entries) {
  return entries
    .sort((a, b) => (b.addedDays ?? -1) - (a.addedDays ?? -1) || a.name.localeCompare(b.name))
    .map(bullet)
    .join("\n");
}

const date = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  dateStyle: "short",
}).format(new Date());

const newCount = [...allBranch, ...perBranch].filter(
  (e) => e.addedDays != null && e.addedDays <= NEW_DAYS,
).length;
const staleCount = [...allBranch, ...perBranch].filter(
  (e) => e.addedDays != null && e.addedDays >= STALE_DAYS,
).length;

header(`Skipped tests digest — ${date}`);

let summary = `${allBranch.length} skipped on all branches · ${perBranch.length} on specific branches · ${resets.length} reset branches`;
if (newCount > 0 || staleCount > 0) {
  const bits = [];
  if (newCount > 0) bits.push(`🆕 ${newCount} new`);
  if (staleCount > 0) bits.push(`⚠️ ${staleCount} older than ${STALE_DAYS} days`);
  summary += `\n${bits.join(" · ")} — <!here> let's clean these up`;
}
md(summary);

if (allBranch.length > 0) {
  divider();
  md(`*Skipped on all branches (${allBranch.length})*\n${entryList(allBranch)}`);
}

if (perBranch.length > 0) {
  divider();
  md(`*Skipped on specific branches (${perBranch.length})*\n${entryList(perBranch)}`);
}

if (resets.length > 0) {
  divider();
  md(
    `*Reset branches (${resets.length})* — runs with no skips applied\n${resets
      .map((b) => `\`${esc(b)}\``)
      .join(" · ")}`,
  );
}

divider();
blocks.push({
  type: "context",
  elements: [
    {
      type: "mrkdwn",
      text: `See <https://github.com/Kong/gateway-action-storage/blob/main/skipped-tests/skipped.yaml|skipped.yaml> for details`,
    },
  ],
});

const empty = allBranch.length === 0 && perBranch.length === 0 && resets.length === 0;
const text = empty
  ? "Skipped tests digest — no skipped tests 🎉"
  : `Skipped tests digest — ${allBranch.length + perBranch.length} skips, ${staleCount} stale, ${newCount} new`;

console.log(JSON.stringify({ text, blocks: empty ? [blocks[0]] : blocks }, null, 2));
