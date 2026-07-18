import assert from "node:assert/strict";
import test from "node:test";
import { parseDiff, markEdits, tokenize } from "react-diff-view";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { createDisplayPatch } = await jiti.import("./diff-display.ts");

function response(oldText, newText) {
  return {
    repoRoot: "/repo",
    branch: "main",
    path: "src/file.ts",
    status: "modified",
    fullViewAvailable: true,
    maxTextBytes: 521 * 1024,
    oldSize: Buffer.byteLength(oldText),
    newSize: Buffer.byteLength(newText),
    oldText,
    newText,
  };
}

test("creates a Git patch accepted by react-diff-view", () => {
  const patch = createDisplayPatch(
    response("const timeout = 1000;\n", "const timeout = 5000;\n"),
    "changes",
  );
  const parsed = parseDiff(patch, { nearbySequences: "zip" });

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].hunks.length, 1);
  assert.match(patch, /^diff --git /);

  const tokens = tokenize(parsed[0].hunks, {
    enhancers: [markEdits(parsed[0].hunks, { type: "line" })],
  });
  assert.ok(tokens.old.length > 0);
  assert.ok(tokens.new.length > 0);
});

test("full scope keeps unchanged lines that context scope collapses", () => {
  const oldLines = Array.from({ length: 30 }, (_, index) => `line ${index}`);
  const newLines = [...oldLines];
  newLines[15] = "line 15 changed";
  const data = response(`${oldLines.join("\n")}\n`, `${newLines.join("\n")}\n`);

  const contextPatch = createDisplayPatch(data, "changes");
  const fullPatch = createDisplayPatch(data, "full");

  assert.doesNotMatch(contextPatch, / line 0\n/);
  assert.match(fullPatch, / line 0\n/);
  assert.match(fullPatch, / line 29\n/);
});

test("uses the server patch for a large context-only file", () => {
  const data = {
    ...response("", ""),
    fullViewAvailable: false,
    oldText: undefined,
    newText: undefined,
    patch: "diff --git a/file b/file\n--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new\n",
  };

  assert.equal(createDisplayPatch(data, "changes"), data.patch);
});
