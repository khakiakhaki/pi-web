import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  clearLastSessionId,
  loadLastSessionId,
  saveLastSessionId,
} = await jiti.import("./last-session-store.ts");

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test("stores and loads the last session id", () => {
  const storage = createStorage();

  saveLastSessionId("session-123", storage);

  assert.equal(loadLastSessionId(storage), "session-123");
});

test("only clears the session id that was deleted", () => {
  const storage = createStorage();
  saveLastSessionId("session-123", storage);

  clearLastSessionId("another-session", storage);
  assert.equal(loadLastSessionId(storage), "session-123");

  clearLastSessionId("session-123", storage);
  assert.equal(loadLastSessionId(storage), null);
});

test("silently handles unavailable browser storage", () => {
  const storage = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); },
  };

  assert.equal(loadLastSessionId(storage), null);
  assert.doesNotThrow(() => saveLastSessionId("session-123", storage));
  assert.doesNotThrow(() => clearLastSessionId("session-123", storage));
});
