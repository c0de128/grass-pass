#!/usr/bin/env node
/**
 * Round 10 (RULES-10-01 / SEC-10-02): fail when any commit's author or committer email is not a GitHub noreply
 * address. The repo is public, and builder clones without a repo-local user.email once committed with a work address.
 *
 * Checks every commit reachable from the given rev (default HEAD), which covers any pushed range. Needs the full
 * history (CI: actions/checkout with fetch-depth: 0). Allowed: <id>+<name>@users.noreply.github.com, <name>@users.noreply.github.com
 * and noreply@github.com (GitHub's own web-flow committer for merges and edits made on github.com).
 *
 * Usage: node scripts/check-commit-emails.mjs [rev-or-range]
 * Prints only the commit sha and which field failed (never the address itself, so the log does not repeat it).
 */
import { execFileSync } from "node:child_process";

const ALLOWED = [/^[A-Za-z0-9._+-]+@users\.noreply\.github\.com$/i, /^noreply@github\.com$/i];
export const allowedEmail = (email) => ALLOWED.some((re) => re.test(email.trim()));

function main() {
  const rev = process.argv[2] ?? "HEAD";
  const out = execFileSync("git", ["log", "--format=%H%x09%ae%x09%ce", rev], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const lines = out.split("\n").filter(Boolean);
  const bad = [];
  for (const line of lines) {
    const [sha, author, committer] = line.split("\t");
    const fields = [];
    if (!allowedEmail(author ?? "")) fields.push("author");
    if (!allowedEmail(committer ?? "")) fields.push("committer");
    if (fields.length) bad.push(`${sha.slice(0, 12)} ${fields.join("+")}`);
  }
  if (lines.length === 0) {
    console.error(`check-commit-emails: no commits found for ${rev}`);
    process.exit(2);
  }
  if (bad.length) {
    console.error(`check-commit-emails: ${bad.length} of ${lines.length} commits use an email that is not a GitHub noreply address:`);
    for (const b of bad) console.error(`  ${b}`);
    console.error("Fix: git config user.email <id>+<name>@users.noreply.github.com in this clone, then re-author those commits.");
    process.exit(1);
  }
  console.log(`check-commit-emails: all ${lines.length} commits use GitHub noreply addresses.`);
}

if (process.argv[1]?.endsWith("check-commit-emails.mjs")) main();
