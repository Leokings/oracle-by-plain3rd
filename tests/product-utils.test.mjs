import test from "node:test";
import assert from "node:assert/strict";

import {
  createCaseId,
  finalityLabel,
  isPublicHttpsSource,
  isProductionRecordId,
  normalizePage,
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
