import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "bun:test";
import { checkWorkingTreeClean } from "../src/application/doctor/doctor";

describe("doctor", () => {
  test("fails when the main checkout has non-runtime changes", async () => {
    const projectDir = await createGitRepo();
    await writeFile(join(projectDir, "package.json"), "{\"name\":\"changed\"}\n");

    const check = checkWorkingTreeClean(projectDir);

    expect(check.ok).toBe(false);
    expect(check.severity).toBe("error");
    expect(check.message).toContain("Main checkout has uncommitted non-runtime changes");
    expect(check.message).toContain("package.json");
  });

  test("ignores shipper runtime files when checking the working tree", async () => {
    const projectDir = await createGitRepo();
    await writeFile(
      join(projectDir, ".gitignore"),
      [
        ".openspec-shipper/queue.md",
        ".openspec-shipper/runs/",
        "",
      ].join("\n"),
    );
    runGit(projectDir, ["add", ".gitignore"]);
    runGit(projectDir, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "ignore runtime"]);

    await mkdir(join(projectDir, ".openspec-shipper/runs"), { recursive: true });
    await writeFile(join(projectDir, ".openspec-shipper/queue.md"), "- [ ] deliver add-name-greeting\n");
    await writeFile(join(projectDir, ".openspec-shipper/runs/run.log"), "log\n");

    const check = checkWorkingTreeClean(projectDir);

    expect(check.ok).toBe(true);
  });
});

async function createGitRepo(): Promise<string> {
  const projectDir = await mkdtemp(join(tmpdir(), "shipper-doctor-"));
  runGit(projectDir, ["init"]);
  await writeFile(join(projectDir, "package.json"), "{\"name\":\"demo\"}\n");
  runGit(projectDir, ["add", "package.json"]);
  runGit(projectDir, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"]);
  return projectDir;
}

function runGit(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  }
}
