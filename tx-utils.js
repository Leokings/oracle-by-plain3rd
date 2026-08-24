const STATUS_BY_NUMBER = Object.freeze({
  0: "UNINITIALIZED",
  1: "PENDING",
  2: "PROPOSING",
  3: "COMMITTING",
  4: "REVEALING",
  5: "ACCEPTED",
  6: "UNDETERMINED",
  7: "FINALIZED",
  8: "CANCELED",
  9: "APPEAL_REVEALING",
  10: "APPEAL_COMMITTING",
  11: "READY_TO_FINALIZE",
  12: "VALIDATORS_TIMEOUT",
  13: "LEADER_TIMEOUT",
});

const EXECUTION_BY_NUMBER = Object.freeze({
  0: "NOT_VOTED",
  1: "FINISHED_WITH_RETURN",
  2: "FINISHED_WITH_ERROR",
});

const DEFAULT_SUCCESS_STATUSES = new Set(["ACCEPTED", "READY_TO_FINALIZE", "FINALIZED"]);
const EXECUTION_ALIASES = Object.freeze({
  SUCCESS: "FINISHED_WITH_RETURN",
  ERROR: "FINISHED_WITH_ERROR",
  CONTRACT_ERROR: "FINISHED_WITH_ERROR",
});

function normalizeEnum(value, numberMap) {
  if (value === undefined || value === null || value === "") return "";
  const mapped = numberMap[Number(value)];
  if (mapped && /^\d+$/.test(String(value))) return mapped;
  return String(value).trim().toUpperCase();
}

function normalizeExecution(value) {
  const normalized = normalizeEnum(value, EXECUTION_BY_NUMBER);
  return EXECUTION_ALIASES[normalized] || normalized;
}

export function receiptStatusName(receipt) {
  return normalizeEnum(
    receipt?.statusName ?? receipt?.status_name ?? receipt?.status,
    STATUS_BY_NUMBER,
  );
}

export function receiptExecutionName(receipt) {
  const topLevel =
    receipt?.txExecutionResultName ??
    receipt?.tx_execution_result_name ??
    receipt?.txExecutionResult ??
    receipt?.tx_execution_result;
  const normalized = normalizeExecution(topLevel);
  if (normalized) return normalized;

  const rawLeader = receipt?.consensus_data?.leader_receipt;
  const leaderReceipts = Array.isArray(rawLeader) ? rawLeader : rawLeader ? [rawLeader] : [];
  for (const leader of leaderReceipts) {
    const value = leader?.execution_result_name ?? leader?.execution_result;
    const leaderResult = normalizeExecution(value);
    if (leaderResult) return leaderResult;
  }
  return "";
}

function describePayload(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string") return value.trim();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function extractExecutionError(receipt) {
  const rawLeader = receipt?.consensus_data?.leader_receipt;
  const leaderReceipts = Array.isArray(rawLeader) ? rawLeader : rawLeader ? [rawLeader] : [];
  for (const leader of leaderReceipts) {
    for (const value of [leader?.error, leader?.message, leader?.result, leader?.genvm_result]) {
      if (value && typeof value === "object") {
        for (const key of ["error", "message", "details"]) {
          const nested = describePayload(value[key]);
          if (nested) return nested;
        }
      }
      const text = describePayload(value);
      if (text && /error|expected|external|transient|llm_error|revert/i.test(text)) return text;
    }
  }
  for (const value of [receipt?.result, receipt?.data?.error, receipt?.data?.message]) {
    const text = describePayload(value);
    if (text && /error|expected|external|transient|llm_error|revert/i.test(text)) return text;
  }
  return "";
}

export function receiptFailure(receipt, allowedStatuses = DEFAULT_SUCCESS_STATUSES) {
  const status = receiptStatusName(receipt);
  if (!status) return "Transaction receipt is missing its consensus status.";
  if (!allowedStatuses.has(status)) {
    return `Consensus status is ${status}, not an accepted/finalized success state.`;
  }

  const execution = receiptExecutionName(receipt);
  if (execution !== "FINISHED_WITH_RETURN") {
    const detail = extractExecutionError(receipt);
    if (execution === "FINISHED_WITH_ERROR") {
      return `Contract execution failed${detail ? `: ${detail}` : "."}`;
    }
    return `Receipt did not prove successful contract execution (execution result: ${execution || "missing"}).`;
  }
  return null;
}

export function isConfiguredAddress(value) {
  const address = String(value || "").trim();
  return /^0x[0-9a-fA-F]{40}$/.test(address) && !/^0x0{40}$/i.test(address);
}

export function isConfiguredRpcUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || /YOUR_|REPLACE_|PLACEHOLDER/i.test(raw)) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}
