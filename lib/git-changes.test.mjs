import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { listGitChanges, loadGitFileDiff } = await jiti.import("./git-changes.ts");
const { MAX_DIFF_TEXT_BYTES } = await jiti.import("./git-types.ts");

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

function createRepo() {
  const cwd = mkdtempSync(join(tmpdir(), "pi-web-git-changes-"));
  git(cwd, "init", "-q");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "config", "user.name", "Test User");
  return cwd;
}

function commitAll(cwd) {
  git(cwd, "add", "-A");
  git(cwd, "commit", "-qm", "test");
}

test("lists text changes and excludes binary files", async (t) => {
  const cwd = createRepo();
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  writeFileSync(join(cwd, "modified.txt"), "old\n");
  writeFileSync(join(cwd, "deleted.txt"), "deleted\n");
  writeFileSync(join(cwd, "rename-old.txt"), "renamed\n");
  writeFileSync(join(cwd, "tracked.bin"), Buffer.from([0, 1, 2, 3]));
  commitAll(cwd);

  writeFileSync(join(cwd, "modified.txt"), "new\n");
  unlinkSync(join(cwd, "deleted.txt"));
  git(cwd, "mv", "rename-old.txt", "rename-new.txt");
  writeFileSync(join(cwd, "untracked.txt"), "hello\n");
  writeFileSync(join(cwd, "untracked.bin"), Buffer.from([0, 4, 5, 6]));
  writeFileSync(join(cwd, "invalid-utf8.bin"), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
  writeFileSync(join(cwd, "tracked.bin"), Buffer.from([0, 9, 9, 9]));

  const result = await listGitChanges(cwd);
  const statuses = new Map(result.files.map((file) => [file.path, file]));

  assert.equal(result.isGit, true);
  assert.ok(result.repoRoot);
  assert.equal(statuses.get("modified.txt")?.status, "modified");
  assert.equal(statuses.get("deleted.txt")?.status, "deleted");
  assert.equal(statuses.get("rename-new.txt")?.status, "renamed");
  assert.equal(statuses.get("rename-new.txt")?.oldPath, "rename-old.txt");
  assert.equal(statuses.get("untracked.txt")?.status, "untracked");
  assert.equal(statuses.has("tracked.bin"), false);
  assert.equal(statuses.has("untracked.bin"), false);
  assert.equal(statuses.has("invalid-utf8.bin"), false);
});

test("loads complete old and new text only after a file is requested", async (t) => {
  const cwd = createRepo();
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  writeFileSync(join(cwd, "file.txt"), "before\nline two\n");
  commitAll(cwd);
  writeFileSync(join(cwd, "file.txt"), "after\nline two\n");

  const diff = await loadGitFileDiff(cwd, "file.txt");
  assert.ok(diff);
  assert.equal(diff.fullViewAvailable, true);
  assert.equal(diff.oldText, "before\nline two\n");
  assert.equal(diff.newText, "after\nline two\n");
  assert.equal(diff.patch, undefined);
});

test("large text files are context-only and use a bounded patch", async (t) => {
  const cwd = createRepo();
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const lines = Array.from({ length: 40_000 }, (_, index) => `line ${index.toString().padStart(5, "0")} padding`);
  assert.ok(Buffer.byteLength(lines.join("\n")) > MAX_DIFF_TEXT_BYTES);
  writeFileSync(join(cwd, "large.txt"), `${lines.join("\n")}\n`);
  commitAll(cwd);
  lines[20_000] = "line 20000 changed";
  writeFileSync(join(cwd, "large.txt"), `${lines.join("\n")}\n`);

  const diff = await loadGitFileDiff(cwd, "large.txt");
  assert.ok(diff);
  assert.equal(diff.fullViewAvailable, false);
  assert.equal(typeof diff.patch, "string");
  assert.match(diff.patch, /line 20000 changed/);
  assert.ok(Buffer.byteLength(diff.patch) < MAX_DIFF_TEXT_BYTES);
});

test("uses the active worktree instead of the main checkout", async (t) => {
  const cwd = createRepo();
  const worktree = `${cwd}-worktree`;
  t.after(() => {
    try { git(cwd, "worktree", "remove", "--force", worktree); } catch { /* already removed */ }
    rmSync(worktree, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  writeFileSync(join(cwd, "file.txt"), "base\n");
  commitAll(cwd);
  git(cwd, "branch", "feature");
  git(cwd, "worktree", "add", "-q", worktree, "feature");
  writeFileSync(join(worktree, "file.txt"), "worktree change\n");

  const result = await listGitChanges(worktree);
  assert.equal(result.repoRoot, worktree);
  assert.equal(result.branch, "feature");
  assert.deepEqual(result.files.map((file) => file.path), ["file.txt"]);
  assert.equal((await listGitChanges(cwd)).files.length, 0);
});

test("combines staged and unstaged state while diffing against HEAD", async (t) => {
  const cwd = createRepo();
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  writeFileSync(join(cwd, "file.txt"), "HEAD\n");
  commitAll(cwd);
  writeFileSync(join(cwd, "file.txt"), "staged\n");
  git(cwd, "add", "file.txt");
  writeFileSync(join(cwd, "file.txt"), "working tree\n");

  const [file] = (await listGitChanges(cwd)).files;
  assert.equal(file.staged, true);
  assert.equal(file.unstaged, true);
  const diff = await loadGitFileDiff(cwd, "file.txt");
  assert.equal(diff.oldText, "HEAD\n");
  assert.equal(diff.newText, "working tree\n");
});

test("supports staged text before the repository has its first commit", async (t) => {
  const cwd = createRepo();
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  writeFileSync(join(cwd, "first.txt"), "first commit content\n");
  git(cwd, "add", "first.txt");

  const result = await listGitChanges(cwd);
  assert.equal(result.files[0]?.status, "added");
  const diff = await loadGitFileDiff(cwd, "first.txt");
  assert.equal(diff.oldText, "");
  assert.equal(diff.newText, "first commit content\n");
});

test("returns a non-git result for ordinary directories", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-web-not-git-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  assert.deepEqual(await listGitChanges(cwd), {
    isGit: false,
    repoRoot: null,
    branch: null,
    files: [],
  });
});
