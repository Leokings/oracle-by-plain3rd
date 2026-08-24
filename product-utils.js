export const LIVING_KIND = "livingconstitution.proposal.v1";
export const TRUTH_KIND = "truthfeed.question.v1";

export function shortAddress(value) {
  const address = String(value || "");
  return address.length > 14 ? `${address.slice(0, 7)}…${address.slice(-5)}` : address;
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

export function splitCharter(value) {
  return String(value || "")
    .split(/\r?\n+|(?=Article\s+\d+\s*:)/i)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function finalityLabel(item) {
  if (!item?.finality) return "Not tracked";
  return item.finality.label || item.finality.status || "Unknown";
}
