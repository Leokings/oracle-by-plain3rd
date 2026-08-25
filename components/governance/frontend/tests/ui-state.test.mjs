import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";


test("hidden connection state cannot be overridden by component display rules", async () => {
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(styles, /\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
});
