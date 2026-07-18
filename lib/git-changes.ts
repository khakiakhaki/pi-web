import { execFile } from "node:child_process";
import { lstat, readFile, readlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  MAX_DIFF_TEXT_BYTES,
  type GitChangedFile,
  type GitChangesResponse,
  type GitChangeStatus,
  type GitFileDiffResponse,
} from "./git-types";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 15_000;
const METADATA_MAX_BUFFER = 2 * 1024 * 1024;
const BINARY_PROBE_BYTES = 8 * 1024;

interface GitCheckout {
  repoRoot: string;
  branch: string | null;
  baseline: string;
}

async function git(cwd: string, args: string[], maxBuffer = METADATA_MAX_BUFFER): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    maxBuffer,
    env: { ...process.env, LC_ALL: "C" },
  });
  return stdout;
}

async function resolveCheckout(cwd: string): Promise<GitCheckout | null> {
  try {
    const repoRoot = (await git(cwd, ["rev-parse", "--path-format=absolute", "--show-toplevel"])).trim();
    if (!repoRoot) return null;

    let branch: string | null = null;
    try {
      branch = (await git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"])).trim() || null;
    } catch {
      branch = null;
    }

    let baseline = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"; // Git's empty tree
    try {
      await git(cwd, ["rev-parse", "--verify", "HEAD"]);
      baseline = "HEAD";
    } catch {
      // A repository without its first commit compares against the empty tree.
    }

    return { repoRoot, branch, baseline };
  } catch {
    return null;
  }
}

function statusFromXY(x: string, y: string): GitChangeStatus {
  const pair = `${x}${y}`;
  if (["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(pair) || x === "U" || y === "U") {
    return "conflicted";
  }
  if (pair === "??") return "untracked";
  if (x === "R" || y === "R") return "renamed";
  if (x === "C" || y === "C") return "copied";
  if (y === "D" || x === "D") return "deleted";
  if (x === "A" || y === "A") return "added";
  if (x === "T" || y === "T") return "typeChanged";
  return "modified";
}

function parsePorcelainStatus(output: string): GitChangedFile[] {
  const records = output.split("\0");
  const files: GitChangedFile[] = [];

  for (let index = 0; index < records.length;) {
    const record = records[index++];
    if (!record || record.length < 4) continue;
    const x = record[0];
    const y = record[1];
    const currentPath = record.slice(3);
    let oldPath: string | undefined;

    // With porcelain v1 -z, rename/copy records are: XY newPath\0oldPath\0.
    if (x === "R" || x === "C" || y === "R" || y === "C") {
      oldPath = records[index++] || undefined;
    }

    files.push({
      path: currentPath,
      ...(oldPath ? { oldPath } : {}),
      status: statusFromXY(x, y),
      staged: x !== " " && x !== "?",
      unstaged: y !== " " || x === "?",
    });
  }

  return files;
}

function parseBinaryNumstat(output: string): Set<string> {
  const binaryPaths = new Set<string>();
  for (const record of output.split("\0")) {
    if (!record) continue;
    const firstTab = record.indexOf("\t");
    const secondTab = firstTab < 0 ? -1 : record.indexOf("\t", firstTab + 1);
    if (firstTab < 0 || secondTab < 0) continue;
    const added = record.slice(0, firstTab);
    const deleted = record.slice(firstTab + 1, secondTab);
    if (added === "-" && deleted === "-") {
      binaryPaths.add(record.slice(secondTab + 1));
    }
  }
  return binaryPaths;
}

function resolveRepoPath(repoRoot: string, relativePath: string): string {
  const fullPath = path.resolve(repoRoot, relativePath);
  const relative = path.relative(repoRoot, fullPath);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Changed file is outside the Git checkout");
  }
  return fullPath;
}

async function workingFileLooksBinary(repoRoot: string, relativePath: string): Promise<boolean> {
  try {
    const fullPath = resolveRepoPath(repoRoot, relativePath);
    if ((await lstat(fullPath)).isSymbolicLink()) return false;
    const handle = await import("node:fs/promises").then(({ open }) => open(fullPath, "r"));
    try {
      const buffer = Buffer.alloc(BINARY_PROBE_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const sample = buffer.subarray(0, bytesRead);
      if (sample.includes(0)) return true;
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(sample);
        return false;
      } catch {
        return true;
      }
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

async function hasTextFileShape(checkout: GitCheckout, file: GitChangedFile): Promise<boolean> {
  if (file.status !== "deleted") {
    try {
      const info = await lstat(resolveRepoPath(checkout.repoRoot, file.path));
      return info.isFile() || info.isSymbolicLink();
    } catch {
      // Delete/delete conflicts can have no working-tree file; inspect HEAD.
      if (file.status === "added" || file.status === "untracked") return false;
    }
  }

  try {
    const objectType = (await git(
      checkout.repoRoot,
      ["cat-file", "-t", `${checkout.baseline}:${file.oldPath ?? file.path}`],
      64 * 1024,
    )).trim();
    return objectType === "blob";
  } catch {
    return false;
  }
}

async function filterBinaryFiles(checkout: GitCheckout, files: GitChangedFile[]): Promise<GitChangedFile[]> {
  let binaryPaths = new Set<string>();
  try {
    const numstat = await git(checkout.repoRoot, [
      "diff", "--numstat", "-z", "--no-renames", checkout.baseline, "--",
    ]);
    binaryPaths = parseBinaryNumstat(numstat);
  } catch {
    // Keep status usable even when numstat cannot classify an unusual conflict.
  }

  const filtered: GitChangedFile[] = [];
  for (const file of files) {
    if (!await hasTextFileShape(checkout, file)) continue;
    if (binaryPaths.has(file.path) || (file.oldPath && binaryPaths.has(file.oldPath))) continue;
    if (file.status === "untracked" && await workingFileLooksBinary(checkout.repoRoot, file.path)) continue;
    filtered.push(file);
  }
  return filtered;
}

export async function listGitChanges(cwd: string): Promise<GitChangesResponse> {
  const checkout = await resolveCheckout(cwd);
  if (!checkout) return { isGit: false, repoRoot: null, branch: null, files: [] };

  const status = await git(checkout.repoRoot, [
    "status", "--porcelain=v1", "-z", "--untracked-files=all",
  ]);
  const files = await filterBinaryFiles(checkout, parsePorcelainStatus(status));
  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    isGit: true,
    repoRoot: checkout.repoRoot,
    branch: checkout.branch,
    files,
  };
}

async function gitObjectSize(cwd: string, revisionPath: string): Promise<number> {
  try {
    const value = (await git(cwd, ["cat-file", "-s", revisionPath], 64 * 1024)).trim();
    const size = Number(value);
    return Number.isFinite(size) && size >= 0 ? size : 0;
  } catch {
    return 0;
  }
}

async function workingFileSize(repoRoot: string, relativePath: string): Promise<number> {
  try {
    return (await lstat(resolveRepoPath(repoRoot, relativePath))).size;
  } catch {
    return 0;
  }
}

async function readWorkingText(repoRoot: string, relativePath: string): Promise<string> {
  const fullPath = resolveRepoPath(repoRoot, relativePath);
  const info = await lstat(fullPath);
  if (info.isSymbolicLink()) return await readlink(fullPath);
  const content = await readFile(fullPath);
  if (content.length > MAX_DIFF_TEXT_BYTES) throw new Error("Working file exceeds the text limit");
  return content.toString("utf8");
}

async function readGitText(cwd: string, revisionPath: string): Promise<string> {
  return await git(cwd, ["cat-file", "blob", revisionPath], MAX_DIFF_TEXT_BYTES + 1);
}

function isAddedStatus(status: GitChangeStatus): boolean {
  return status === "added" || status === "untracked";
}

export async function loadGitFileDiff(cwd: string, requestedPath: string): Promise<GitFileDiffResponse | null> {
  const checkout = await resolveCheckout(cwd);
  if (!checkout) return null;

  const changes = await listGitChanges(cwd);
  const file = changes.files.find((item) => item.path === requestedPath);
  if (!file) return null;

  // Resolve once up front to reject traversal even for deleted files.
  resolveRepoPath(checkout.repoRoot, file.path);
  if (file.oldPath) resolveRepoPath(checkout.repoRoot, file.oldPath);

  const oldPath = file.oldPath ?? file.path;
  const hasOldVersion = !isAddedStatus(file.status) && checkout.baseline !== "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
  let hasNewVersion = file.status !== "deleted";
  if (hasNewVersion) {
    try { await lstat(resolveRepoPath(checkout.repoRoot, file.path)); }
    catch { hasNewVersion = false; }
  }
  const oldRevisionPath = `${checkout.baseline}:${oldPath}`;
  const [oldSize, newSize] = await Promise.all([
    hasOldVersion ? gitObjectSize(checkout.repoRoot, oldRevisionPath) : Promise.resolve(0),
    hasNewVersion ? workingFileSize(checkout.repoRoot, file.path) : Promise.resolve(0),
  ]);
  const fullViewAvailable = oldSize <= MAX_DIFF_TEXT_BYTES && newSize <= MAX_DIFF_TEXT_BYTES;

  const base: Omit<GitFileDiffResponse, "oldText" | "newText" | "patch"> = {
    repoRoot: checkout.repoRoot,
    branch: checkout.branch,
    path: file.path,
    ...(file.oldPath ? { oldPath: file.oldPath } : {}),
    status: file.status,
    fullViewAvailable,
    maxTextBytes: MAX_DIFF_TEXT_BYTES,
    oldSize,
    newSize,
  };

  if (fullViewAvailable) {
    const [oldText, newText] = await Promise.all([
      hasOldVersion ? readGitText(checkout.repoRoot, oldRevisionPath) : Promise.resolve(""),
      hasNewVersion ? readWorkingText(checkout.repoRoot, file.path) : Promise.resolve(""),
    ]);
    return { ...base, oldText, newText };
  }

  if (file.status === "untracked") {
    return {
      ...base,
      limitedReason: `New file exceeds the ${MAX_DIFF_TEXT_BYTES} byte text limit`,
    };
  }

  try {
    const paths = file.oldPath ? [file.oldPath, file.path] : [file.path];
    const patch = await git(checkout.repoRoot, [
      "diff", "--no-ext-diff", "--no-color", "--find-renames", "--unified=3",
      checkout.baseline, "--", ...paths,
    ], MAX_DIFF_TEXT_BYTES);
    return {
      ...base,
      patch,
      limitedReason: `Full file view is disabled above ${MAX_DIFF_TEXT_BYTES} bytes`,
    };
  } catch {
    return {
      ...base,
      limitedReason: `Diff output exceeds the ${MAX_DIFF_TEXT_BYTES} byte limit`,
    };
  }
}
