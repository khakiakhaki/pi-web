import { createTwoFilesPatch } from "diff";
import type { GitFileDiffResponse } from "./git-types";

export type DiffDisplayScope = "changes" | "full";

function lineCount(value: string): number {
  if (!value) return 0;
  return value.split(/\r?\n/).length;
}

export function createDisplayPatch(data: GitFileDiffResponse, scope: DiffDisplayScope): string {
  if (data.oldText === undefined || data.newText === undefined) return data.patch ?? "";

  const context = scope === "full"
    ? Math.max(lineCount(data.oldText), lineCount(data.newText)) + 1
    : 3;
  const generated = createTwoFilesPatch(
    "a/file",
    "b/file",
    data.oldText,
    data.newText,
    undefined,
    undefined,
    { context },
  ).replace(/^(?:Index:.*\n)?=+\n/, "");

  // jsdiff emits a traditional `---/+++` patch. Add the Git file header
  // expected by react-diff-view's parser; real paths remain in API metadata.
  return `diff --git a/file b/file\n${generated}`;
}
