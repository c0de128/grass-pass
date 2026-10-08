/**
 * Round 10 (RULES-10-01 / SEC-10-02): scripts/check-commit-emails.mjs, the CI step that fails on any commit whose
 * author or committer is not a GitHub noreply address. Run against small throwaway git repos built in the test.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts", "check-commit-emails.mjs");
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function repo(emails: string[]): string {
  const d = mkdtempSync(join(tmpdir(), "gp-emails-"));
  dirs.push(d);
  execFileSync("git", ["init", "-q"], { cwd: d });
  for (const [i, e] of emails.entries()) {
    execFileSync("git", ["-c", `user.email=${e}`, "-c", "user.name=Test", "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", `c${i}`], { cwd: d });
  }
  return d;
}
const run = (cwd: string) => spawnSync(process.execPath, [SCRIPT, "HEAD"], { cwd, encoding: "utf8" });

describe("check-commit-emails", () => {
  it("passes when every commit uses a GitHub noreply address (id+name form, name form, web-flow)", () => {
    const r = run(repo(["11350738+c0de128@users.noreply.github.com", "c0de128@users.noreply.github.com", "noreply@github.com"]));
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("all 3 commits use GitHub noreply addresses");
  });

  it("fails on one other address anywhere in the history, and never prints the address", () => {
    const r = run(repo(["11350738+c0de128@users.noreply.github.com", "someone@example.com", "11350738+c0de128@users.noreply.github.com"]));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("1 of 3 commits");
    expect(r.stderr).not.toContain("example.com");
  });

  it("fails on look-alikes", () => {
    for (const e of ["x@users.noreply.github.com.evil.example", "x@noreply.github.com", "x@users-noreply.github.com"]) {
      expect(run(repo([e])).status, e).toBe(1);
    }
  });
});
