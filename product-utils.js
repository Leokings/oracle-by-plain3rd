export const LIVING_KIND = "livingconstitution.proposal.v2";
export const TRUTH_KIND = "truthfeed.question.v2";

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

export function parseBallotDurationMinutes(value) {
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= 5 && minutes <= 129_600
    ? minutes
    : null;
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
