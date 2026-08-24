import test from "node:test";
import assert from "node:assert/strict";

import {
  createCaseId,
  finalityLabel,
  isPublicHttpsSource,
  isProductionRecordId,
  latestPageWindow,
  mergeUniqueNewest,
  newestFirst,
  normalizePage,
  olderPageWindow,
  shortAddress,
  splitCharter,
  slugify,
} from "../product-utils.js";


test("creates bounded human-readable case ids", () => {
  const id = createCaseId("q", "Does Example Domain identify itself?", 1_700_000_000_000, 0.25);
  assert.match(id, /^q-does-example-domain-identify-itself-/);
  assert.ok(id.length <= 80);
});

test("slugifies untrusted titles without preserving markup", () => {
  assert.equal(slugify("<script>Pay me</script>"), "script-pay-me-script");
});

test("accepts public HTTPS evidence and rejects local network targets", () => {
  assert.equal(isPublicHttpsSource("https://example.com/"), true);
  assert.equal(isPublicHttpsSource("https://news.ycombinator.com/item?id=1"), true);
  assert.equal(isPublicHttpsSource("http://example.com"), false);
  assert.equal(isPublicHttpsSource("https://127.0.0.1/private"), false);
  assert.equal(isPublicHttpsSource("https://192.168.1.8/private"), false);
  assert.equal(isPublicHttpsSource("https://user:pass@example.com"), false);
});

test("normalizes array and paginated contract responses", () => {
  assert.deepEqual(normalizePage([{ id: "a" }]), { total: 1, items: [{ id: "a" }] });
  assert.deepEqual(normalizePage({ total: 9, items: [{ id: "b" }] }), {
    total: 9,
    items: [{ id: "b" }],
  });
});

test("loads the newest contract page and walks backward without overlap", () => {
  assert.deepEqual(latestPageWindow(137, 50), { offset: 87, limit: 50 });
  assert.deepEqual(latestPageWindow(12, 50), { offset: 0, limit: 12 });
  assert.deepEqual(olderPageWindow(87, 50), { offset: 37, limit: 50 });
  assert.deepEqual(olderPageWindow(37, 50), { offset: 0, limit: 37 });
});

test("sorts and merges decision records newest-first", () => {
  const older = { id: "old", created_at: "2026-01-01T00:00:00Z" };
  const newer = { id: "new", created_at: "2026-01-02T00:00:00Z" };
  assert.deepEqual(newestFirst([older, newer]).map((item) => item.id), ["new", "old"]);
  assert.deepEqual(
    mergeUniqueNewest([newer], [older, { ...newer, title: "updated" }]).map((item) => [item.id, item.title]),
    [["new", "updated"], ["old", undefined]],
  );
});

test("keeps non-production records out of the public interface", () => {
  assert.equal(isProductionRecordId("pilot-example"), false);
  assert.equal(isProductionRecordId("DEMO_case"), false);
  assert.equal(isProductionRecordId("sample"), false);
  assert.equal(isProductionRecordId("q-community-budget-abc12"), true);
  assert.equal(isProductionRecordId(""), false);
});

test("splits compact and newline-delimited charters into articles", () => {
  assert.deepEqual(splitCharter("Article 1: First. Article 2: Second."), [
    "Article 1: First.",
    "Article 2: Second.",
  ]);
  assert.deepEqual(splitCharter("Rule A\nRule B"), ["Rule A", "Rule B"]);
});

test("formats compact addresses and registry finality", () => {
  assert.equal(shortAddress("0x1111111111111111111111111111111111111111"), "0x11111…11111");
  assert.equal(finalityLabel({ finality: { label: "Final" } }), "Final");
  assert.equal(finalityLabel(null), "Not tracked");
});
