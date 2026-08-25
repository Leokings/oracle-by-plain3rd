import test from "node:test";
import assert from "node:assert/strict";

import {
  createCaseId,
  evidenceSnapshotCurrent,
  finalityLabel,
  governanceBallotGuidance,
  isPublicHttpsSource,
  isProductionRecordId,
  latestPageWindow,
  mergeUniqueNewest,
  newestFirst,
  normalizePage,
  olderPageWindow,
  parseBallotDurationMinutes,
  shortAddress,
  splitCharter,
  slugify,
  walletConnectionErrorMessage,
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
  assert.equal(isProductionRecordId("release-check-example"), false);
  assert.equal(isProductionRecordId("INTEGRATION_case"), false);
  assert.equal(isProductionRecordId("test-record"), false);
  assert.equal(isProductionRecordId("pilot-legacy-check"), false);
  assert.equal(isProductionRecordId("verify-release-check-governance-123"), false);
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

test("turns wallet provider failures into clear next steps", () => {
  assert.equal(
    walletConnectionErrorMessage({ code: -32002 }),
    "A wallet request is already open. Open your wallet extension and finish it.",
  );
  assert.equal(walletConnectionErrorMessage({ code: 4001 }), "Wallet connection was declined.");
  assert.equal(
    walletConnectionErrorMessage({ message: "Provider unavailable" }),
    "Wallet connection failed: Provider unavailable",
  );
});

test("validates owner-selected StudioNet ballot durations", () => {
  assert.equal(parseBallotDurationMinutes("5"), 5);
  assert.equal(parseBallotDurationMinutes("1440"), 1440);
  assert.equal(parseBallotDurationMinutes("129600"), 129600);
  assert.equal(parseBallotDurationMinutes("4"), null);
  assert.equal(parseBallotDurationMinutes("5.5"), null);
  assert.equal(parseBallotDurationMinutes("129601"), null);
});

test("explains every governance voting state without hiding the next action", () => {
  const base = {
    proposalStatus: "compliant",
    evidenceCurrent: true,
    ballotClosesAt: 2_000,
    governanceAdmin: "0x91B1b2D1f2De66400fcbeAEbadB8a5330eB28DC0",
    now: 1_000,
  };

  assert.equal(
    governanceBallotGuidance({ ...base, connected: true, isOwner: false, isSubmitter: false }),
    "Waiting for Governance admin 0x91B1b…28DC0 to open voting. Vote buttons appear here after it opens.",
  );
  assert.equal(
    governanceBallotGuidance({ ...base, connected: true, isOwner: true }),
    "Governance admin action: open voting below, then set its quorum and duration.",
  );
  assert.equal(
    governanceBallotGuidance({ ...base, connected: true, isOwner: false, isSubmitter: true }),
    "You created this proposal, but only Governance admin 0x91B1b…28DC0 can open voting. Vote buttons appear here after it opens.",
  );
  assert.equal(
    governanceBallotGuidance({ ...base, ballotStatus: "open", connected: true }),
    "Voting is open. Choose Vote for or Vote against below.",
  );
  assert.equal(
    governanceBallotGuidance({ ...base, ballotStatus: "open", connected: false }),
    "Voting is open. Connect a wallet to choose Vote for or Vote against.",
  );
  assert.equal(
    governanceBallotGuidance({ ...base, ballotStatus: "open", ballotClosesAt: 999, connected: true }),
    "Voting has ended. Close the ballot to publish its result.",
  );
  assert.equal(
    governanceBallotGuidance({ ...base, evidenceCurrent: false, connected: true }),
    "Voting is paused because the linked evidence changed. Request a new rules review.",
  );
});

test("detects whether proposal evidence still matches TruthFeed", () => {
  const snapshot = [{ id: "q-1", outcome: "yes", resolution_round: 1, citations: [1] }];
  const current = [{ id: "q-1", status: "resolved", outcome: "yes", resolution_round: 1, citations: [1] }];
  assert.equal(evidenceSnapshotCurrent(snapshot, current), true);
  assert.equal(
    evidenceSnapshotCurrent(snapshot, [{ ...current[0], resolution_round: 2 }]),
    false,
  );
  assert.equal(evidenceSnapshotCurrent([], current), false);
});
