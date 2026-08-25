export const LIVING_KIND = "livingconstitution.proposal.v3";
export const TRUTH_KIND = "truthfeed.question.v3";

export function shortAddress(value) {
  const address = String(value || "");
  return address.length > 14 ? `${address.slice(0, 7)}…${address.slice(-5)}` : address;
}

export function walletConnectionErrorMessage(error) {
  const code = Number(error?.code ?? error?.data?.originalError?.code);
  if (code === -32002) {
    return "A wallet request is already open. Open your wallet extension and finish it.";
  }
  if (code === 4001) return "Wallet connection was declined.";
  const detail = String(error?.shortMessage || error?.message || error || "Unknown wallet error");
  return `Wallet connection failed: ${detail}`;
}

export function ballotPolicyLabel(policy) {
  const seconds = Number(policy?.duration_seconds || 0);
  const quorum = Number(policy?.quorum || 0);
  if (!Number.isInteger(seconds) || seconds < 1 || !Number.isInteger(quorum) || quorum < 1) {
    return "Voting policy unavailable";
  }
  let duration = `${Math.ceil(seconds / 60)} min`;
  if (seconds % 86_400 === 0) {
    const days = seconds / 86_400;
    duration = `${days} ${days === 1 ? "day" : "days"}`;
  } else if (seconds % 3_600 === 0) {
    const hours = seconds / 3_600;
    duration = `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `Quorum ${quorum} · ${duration}`;
}

export function governanceBallotGuidance({
  proposalStatus,
  evidenceCurrent,
  ballotStatus,
  ballotClosesAt,
  connected,
  isSubmitter,
  proposalCreator,
  now = Math.floor(Date.now() / 1000),
}) {
  const proposal = String(proposalStatus || "").toLowerCase();
  const ballot = String(ballotStatus || "").toLowerCase();

  if (ballot === "open") {
    if (!evidenceCurrent) {
      return connected
        ? "Voting is paused because the linked evidence changed. Invalidate this ballot before requesting a new review."
        : "Voting is paused because the linked evidence changed. Connect a wallet to invalidate this ballot.";
    }
    if (Number(ballotClosesAt || 0) <= Number(now)) {
      return connected
        ? "Voting has ended. Close the ballot to publish its result."
        : "Voting has ended. Connect a wallet and close the ballot to publish its result.";
    }
    return connected
      ? "Voting is open. Choose Vote for or Vote against below."
      : "Voting is open. Connect a wallet to choose Vote for or Vote against.";
  }

  if (ballot === "closed") {
    return "Voting is closed. The result is recorded in the ballot status above.";
  }

  if (["canceled", "cancelled"].includes(ballot)) {
    return "This ballot was canceled. The proposal creator must request a new review before voting can reopen.";
  }

  if (proposal === "submitted") {
    return "Run the rules review first. A ballot can open only after the proposal is compliant.";
  }

  if (proposal === "compliant" && !evidenceCurrent) {
    return isSubmitter
      ? "The linked evidence changed. Request a new rules review before opening voting."
      : "The linked evidence changed. The proposal creator must request a new rules review.";
  }

  if (proposal === "compliant") {
    if (isSubmitter) {
      return "Creator action: open voting below. Quorum and duration are fixed by the contract.";
    }
    const creator = shortAddress(proposalCreator);
    const creatorLabel = creator ? `Proposal creator ${creator}` : "The proposal creator";
    return connected
      ? `Waiting for ${creatorLabel} to open voting. Vote buttons appear here after it opens.`
      : `Voting has not opened. ${creatorLabel} must start it first.`;
  }

  if (proposal === "non_compliant") {
    return "This proposal did not pass its rules review, so it cannot go to a vote.";
  }

  return "Voting is not available for this proposal yet.";
}

export function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || "decision";
}

export function createCaseId(prefix, value, timestamp = Date.now(), randomValue = Math.random()) {
  const suffix = Math.floor(Math.abs(randomValue) * 0xffffff)
    .toString(36)
    .padStart(5, "0")
    .slice(0, 5);
  return `${prefix}-${slugify(value)}-${Number(timestamp).toString(36)}-${suffix}`.slice(0, 80);
}

export function isPublicHttpsSource(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:" || url.username || url.password) return false;
    if (url.port && url.port !== "443") return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!host || !host.includes(".")) return false;
    if (/\.(local|localhost|internal|test|invalid|example|onion)$/.test(host)) {
      return host === "example.com";
    }
    if (/^(localhost|0\.0\.0\.0|127\.|10\.|169\.254\.|192\.168\.)/.test(host)) return false;
    const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (match) {
      const octets = match.slice(1).map(Number);
      if (octets.some((part) => part > 255)) return false;
      if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return false;
      if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) return false;
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function normalizePage(value) {
  if (Array.isArray(value)) return { total: value.length, items: value };
  const items = Array.isArray(value?.items) ? value.items : [];
  return { total: Number(value?.total ?? items.length) || 0, items };
}

export function latestPageWindow(total, pageSize = 50) {
  const safeTotal = Math.max(Number(total) || 0, 0);
  const safeSize = Math.max(Number(pageSize) || 1, 1);
  return {
    offset: Math.max(safeTotal - safeSize, 0),
    limit: Math.min(safeSize, safeTotal),
  };
}

export function olderPageWindow(currentOffset, pageSize = 50) {
  const safeOffset = Math.max(Number(currentOffset) || 0, 0);
  const safeSize = Math.max(Number(pageSize) || 1, 1);
  const offset = Math.max(safeOffset - safeSize, 0);
  return { offset, limit: safeOffset - offset };
}

export function newestFirst(items, dateField = "created_at") {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => ({ item, index, time: Date.parse(item?.[dateField] || "") }))
    .sort((left, right) => {
      const leftTime = Number.isFinite(left.time) ? left.time : -Infinity;
      const rightTime = Number.isFinite(right.time) ? right.time : -Infinity;
      return rightTime - leftTime || right.index - left.index;
    })
    .map(({ item }) => item);
}

export function mergeUniqueNewest(current, incoming, key = "id", dateField = "created_at") {
  const records = new Map();
  for (const item of [...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    const id = String(item?.[key] || "");
    if (id) records.set(id, item);
  }
  return newestFirst([...records.values()], dateField);
}

export function isProductionRecordId(value) {
  const id = String(value || "").trim();
  return (
    Boolean(id) &&
    !/^(?:verify-)?(?:pilot|release-check|integration|test-record)(?:[-_]|$)/i.test(id)
  );
}

export function splitCharter(value) {
  return String(value || "")
    .split(/\r?\n+|(?=Article\s+\d+\s*:)/i)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function evidenceSnapshotCurrent(snapshot, questions) {
  if (!Array.isArray(snapshot) || !snapshot.length) return false;
  const byId = new Map(
    (Array.isArray(questions) ? questions : []).map((question) => [String(question?.id || ""), question]),
  );
  return snapshot.every((item) => {
    const current = byId.get(String(item?.id || ""));
    return Boolean(current) &&
      String(current.status || "").toLowerCase() === "resolved" &&
      String(current.outcome || "").toLowerCase() === String(item?.outcome || "").toLowerCase() &&
      Number(current.resolution_round || 0) === Number(item?.resolution_round || 0) &&
      JSON.stringify(current.citations || []) === JSON.stringify(item?.citations || []);
  });
}

export function finalityLabel(item) {
  if (!item?.finality) return "Not tracked";
  return item.finality.label || item.finality.status || "Unknown";
}
