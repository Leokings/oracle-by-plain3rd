import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { neon } from "@neondatabase/serverless";
import { abi, createClient, chains } from "../vendor/genlayer-js/index.js";


const NETWORK = "studionet";
const LIVING_KIND = "livingconstitution.proposal.v3";
const TRUTH_KIND = "truthfeed.question.v3";
const CHAIN_PAGE_SIZE = 100;
const MAX_CHAIN_PAGES = 5;
const MAX_QUERY_ITEMS = 200;
const PUBLIC_SYNC_MIN_AGE_SECONDS = 15;
const TRANSACTION_STATUS_BY_NUMBER = Object.freeze({
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
const TRANSACTION_RESULT_BY_NUMBER = Object.freeze({
  0: "IDLE",
  1: "AGREE",
  2: "DISAGREE",
  3: "TIMEOUT",
  4: "DETERMINISTIC_VIOLATION",
  5: "NO_MAJORITY",
  6: "MAJORITY_AGREE",
  7: "MAJORITY_DISAGREE",
});
const EXECUTION_RESULT_BY_NUMBER = Object.freeze({
  0: "NOT_VOTED",
  1: "FINISHED_WITH_RETURN",
  2: "FINISHED_WITH_ERROR",
});
const EXECUTION_RESULT_ALIASES = Object.freeze({
  SUCCESS: "FINISHED_WITH_RETURN",
  ERROR: "FINISHED_WITH_ERROR",
  CONTRACT_ERROR: "FINISHED_WITH_ERROR",
});

const TRACKED_OPERATIONS = {
  [LIVING_KIND]: {
    submit_proposal: "submit_proposal",
    check_proposal: "check_proposal",
    request_recheck_with_reason: "request_recheck_with_reason",
    reset_check: "reset_check",
    open_ballot: "open_ballot",
    cast_vote_for: "cast_vote",
    cast_vote_against: "cast_vote",
    close_ballot: "close_ballot",
    sync_outcome_verification: "sync_outcome_verification",
    retry_outcome_verification: "retry_outcome_verification",
    invalidate_stale_ballot: "invalidate_stale_ballot",
  },
  [TRUTH_KIND]: {
    create_question: "create_question",
    create_question_scheduled: "create_question_scheduled",
    resolve_question: "resolve_question",
    void_question: "void_question",
    request_recheck: "request_recheck",
    request_recheck_with_sources: "request_recheck_with_sources",
  },
};

let sqlClient;
let chainClient;

function env(name) {
  return String(process.env[name] || "").trim();
}

function configuredAddress(name) {
  const value = env(name);
  return /^0x[0-9a-fA-F]{40}$/.test(value) ? value : "";
}

function database() {
  if (!env("DATABASE_URL")) throw new Error("DATABASE_URL is not configured");
  if (!sqlClient) sqlClient = neon(env("DATABASE_URL"));
  return sqlClient;
}

function genlayer() {
  if (!chainClient) {
    const endpoint = env("GENLAYER_RPC_URL") || "https://studio.genlayer.com/api";
    chainClient = createClient({ chain: chains.studionet, endpoint });
  }
  return chainClient;
}

function jsonValue(value) {
  return JSON.stringify(value ?? null);
}

function statusText(value) {
  if (value === null || value === undefined) return "UNKNOWN";
  const raw = typeof value === "object"
    ? value.statusName ?? value.status_name ?? value.tx_status ?? value.status ?? value.name
    : value;
  const text = String(raw ?? "").trim();
  if (/^\d+$/.test(text) && TRANSACTION_STATUS_BY_NUMBER[Number(text)]) {
    return TRANSACTION_STATUS_BY_NUMBER[Number(text)];
  }
  return text ? text.toUpperCase() : "UNKNOWN";
}

function transactionPayload(value) {
  const raw = value?.tx_payload;
  if (raw && typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
}

function consensusResultText(value) {
  const payload = transactionPayload(value);
  for (const source of [value, payload]) {
    const named = String(
      source?.resultName ?? source?.result_name ?? source?.transaction_result_name ?? ""
    ).trim().toUpperCase();
    if (Object.values(TRANSACTION_RESULT_BY_NUMBER).includes(named)) return named;
    const raw = source?.result;
    if ((typeof raw === "number" || /^\d+$/.test(String(raw ?? "")))) {
      const mapped = TRANSACTION_RESULT_BY_NUMBER[Number(raw)];
      if (mapped) return mapped;
    }
  }
  return "";
}

function executionResultText(value) {
  const payload = transactionPayload(value);
  for (const source of [value, payload]) {
    let raw =
      source?.txExecutionResultName ??
      source?.tx_execution_result_name ??
      source?.execution_result_name ??
      source?.txExecutionResult ??
      source?.tx_execution_result;
    if (raw !== undefined && raw !== null && raw !== "") {
      if (typeof raw === "number" || /^\d+$/.test(String(raw))) {
        raw = EXECUTION_RESULT_BY_NUMBER[Number(raw)] || raw;
      }
      const named = String(raw).trim().toUpperCase();
      return EXECUTION_RESULT_ALIASES[named] || named;
    }

    const leaderRaw = source?.consensus_data?.leader_receipt;
    const leaders = Array.isArray(leaderRaw) ? leaderRaw : leaderRaw ? [leaderRaw] : [];
    for (const leader of leaders) {
      const leaderRawResult = leader?.execution_result_name ?? leader?.execution_result;
      if (leaderRawResult === undefined || leaderRawResult === null) continue;
      const named = String(leaderRawResult).trim().toUpperCase();
      return EXECUTION_RESULT_ALIASES[named] || named;
    }
  }
  return "";
}

function normalizeLiving(proposal, address) {
  const status = String(proposal?.status || "submitted").toLowerCase();
  return {
    network: NETWORK,
    contract_address: address.toLowerCase(),
    kind: LIVING_KIND,
    case_id: String(proposal?.id || ""),
    source_name: "LivingConstitution",
    status,
    decision: status === "submitted" ? "" : status,
    rule_version: `constitution-v${Number(proposal?.constitution_version || 0)}`,
    support_refs: Array.isArray(proposal?.rule_refs)
      ? proposal.rule_refs.map(String)
      : Array.isArray(proposal?.violations)
        ? proposal.violations.map(String)
        : [],
    decided_at: proposal?.checked_at || null,
    title: String(proposal?.title || ""),
    content: String(proposal?.body || ""),
    payload: proposal,
  };
}

function normalizeTruth(question, address) {
  return {
    network: NETWORK,
    contract_address: address.toLowerCase(),
    kind: TRUTH_KIND,
    case_id: String(question?.id || ""),
    source_name: "TruthFeed",
    status: String(question?.status || "open").toLowerCase(),
    decision: String(question?.outcome || "").toLowerCase(),
    rule_version: "question-criteria-v1",
    support_refs: Array.isArray(question?.citations) ? question.citations : [],
    decided_at: question?.resolved_at || null,
    title: String(question?.text || ""),
    content: String(question?.criteria || ""),
    payload: question,
  };
}

async function readChainDecisions() {
  const livingAddress = configuredAddress("GENLAYER_CONTRACT_ADDRESS");
  const truthAddress = configuredAddress("TRUTHFEED_CONTRACT_ADDRESS");
  const reads = [];
  if (livingAddress) {
    reads.push(
      readContractPages(livingAddress, "list_proposals").then(({ items, truncated }) => ({
        items: items.map((item) => normalizeLiving(item, livingAddress)),
        warnings: truncated ? ["LivingConstitution index reached its 500-item safety bound"] : [],
      }))
    );
  }
  if (truthAddress) {
    reads.push(
      readContractPages(truthAddress, "list_questions").then(({ items, truncated }) => ({
        items: items.map((item) => normalizeTruth(item, truthAddress)),
        warnings: truncated ? ["TruthFeed index reached its 500-item safety bound"] : [],
      }))
    );
  }
  if (!reads.length) throw new Error("No GenLayer contract addresses are configured");
  const settled = await Promise.allSettled(reads);
  const successes = settled.filter((item) => item.status === "fulfilled");
  if (!successes.length) {
    throw settled[0]?.reason || new Error("All contract reads failed");
  }
  return {
    items: successes.flatMap((item) => item.value.items),
    errors: [
      ...successes.flatMap((item) => item.value.warnings),
      ...settled
        .filter((item) => item.status === "rejected")
        .map((item) => String(item.reason?.message || item.reason)),
    ],
  };
}

async function readContractPages(address, functionName) {
  const items = [];
  let truncated = false;
  for (let page = 0; page < MAX_CHAIN_PAGES; page += 1) {
    const value = await genlayer().readContract({
      address,
      functionName,
      args: [items.length, CHAIN_PAGE_SIZE],
    });
    const pageItems = Array.isArray(value) ? value : value?.items || [];
    items.push(...pageItems);
    const total = Array.isArray(value) ? null : Number(value?.total);
    if (!pageItems.length || pageItems.length < CHAIN_PAGE_SIZE) break;
    if (Number.isFinite(total) && items.length >= total) break;
    if (page === MAX_CHAIN_PAGES - 1) truncated = true;
  }
  return { items, truncated };
}

function decisionChanged(previous, next) {
  if (!previous) return true;
  return (
    previous.status !== next.status ||
    previous.decision !== next.decision ||
    previous.rule_version !== next.rule_version ||
    jsonValue(previous.support_refs) !== jsonValue(next.support_refs) ||
    jsonValue(previous.payload) !== jsonValue(next.payload)
  );
}

async function upsertDecision(item) {
  const sql = database();
  const previousRows = await sql`
    SELECT status, decision, rule_version, support_refs, payload
    FROM decisions
    WHERE network = ${item.network}
      AND contract_address = ${item.contract_address}
      AND kind = ${item.kind}
      AND case_id = ${item.case_id}
    LIMIT 1
  `;
  const previous = previousRows[0] || null;
  const changed = decisionChanged(previous, item);
  await sql`
    INSERT INTO decisions (
      network, contract_address, kind, case_id, source_name, status, decision,
      rule_version, support_refs, decided_at, title, content, payload,
      observed_at, created_at, updated_at
    ) VALUES (
      ${item.network}, ${item.contract_address}, ${item.kind}, ${item.case_id},
      ${item.source_name}, ${item.status}, ${item.decision}, ${item.rule_version},
      ${jsonValue(item.support_refs)}::jsonb, ${item.decided_at}::timestamptz,
      ${item.title}, ${item.content}, ${jsonValue(item.payload)}::jsonb,
      now(), now(), now()
    )
    ON CONFLICT (network, contract_address, kind, case_id) DO UPDATE SET
      source_name = EXCLUDED.source_name,
      status = EXCLUDED.status,
      decision = EXCLUDED.decision,
      rule_version = EXCLUDED.rule_version,
      support_refs = EXCLUDED.support_refs,
      decided_at = EXCLUDED.decided_at,
      title = EXCLUDED.title,
      content = EXCLUDED.content,
      payload = EXCLUDED.payload,
      observed_at = now(),
      updated_at = CASE
        WHEN decisions.status IS DISTINCT FROM EXCLUDED.status
          OR decisions.decision IS DISTINCT FROM EXCLUDED.decision
          OR decisions.rule_version IS DISTINCT FROM EXCLUDED.rule_version
          OR decisions.support_refs IS DISTINCT FROM EXCLUDED.support_refs
          OR decisions.payload IS DISTINCT FROM EXCLUDED.payload
        THEN now()
        ELSE decisions.updated_at
      END
  `;
  return { changed, previous };
}

function eventFor(item, previous) {
  return {
    id: randomUUID(),
    type: previous ? "decision.changed" : "decision.created",
    occurred_at: new Date().toISOString(),
    network: item.network,
    contract_address: item.contract_address,
    kind: item.kind,
    case_id: item.case_id,
    previous: previous
      ? { status: previous.status, decision: previous.decision }
      : null,
    current: {
      status: item.status,
      decision: item.decision,
      rule_version: item.rule_version,
      support_refs: item.support_refs,
      decided_at: item.decided_at,
    },
  };
}

function isPrivateHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return true;
  const ipType = isIP(host);
  if (!ipType) return false;
  if (ipType === 4) {
    const parts = host.split(".").map(Number);
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      parts[0] === 0 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168)
    );
  }
  return host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:");
}

export function validateWebhookUrl(value) {
  const parsed = new URL(String(value || ""));
  if (parsed.protocol !== "https:" || isPrivateHostname(parsed.hostname)) {
    throw new Error("Webhook URL must be a public HTTPS address");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Webhook URL must not contain embedded credentials");
  }
  return parsed.toString();
}

async function assertPublicWebhookDestination(value) {
  const cleanUrl = validateWebhookUrl(value);
  const parsed = new URL(cleanUrl);
  const hostname = parsed.hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (!isIP(hostname)) {
    let addresses;
    try {
      addresses = await lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw new Error("Webhook hostname could not be resolved");
    }
    if (!addresses.length || addresses.some((entry) => isPrivateHostname(entry.address))) {
      throw new Error("Webhook hostname must resolve only to public addresses");
    }
  }
  return cleanUrl;
}

async function dispatchWebhookEvents(events) {
  const signingSecret = env("REGISTRY_WEBHOOK_SECRET");
  if (!events.length || !signingSecret || !env("DATABASE_URL")) return 0;
  const sql = database();
  const subscriptions = await sql`
    SELECT id, url, events
    FROM webhook_subscriptions
    WHERE active = true
    ORDER BY created_at ASC
  `;
  let delivered = 0;
  for (const event of events) {
    const body = JSON.stringify(event);
    const signature = createHmac("sha256", signingSecret).update(body).digest("hex");
    for (const subscription of subscriptions) {
      const acceptedEvents = Array.isArray(subscription.events) ? subscription.events : [];
      if (!acceptedEvents.includes(event.type) && !acceptedEvents.includes("decision.*")) continue;
      let responseStatus = null;
      let responseExcerpt = "";
      let ok = false;
      try {
        const target = await assertPublicWebhookDestination(subscription.url);
        const response = await fetch(target, {
          method: "POST",
          redirect: "error",
          headers: {
            "content-type": "application/json",
            "user-agent": "GenLayer-Decision-Registry/1.0",
            "x-genlayer-event": event.type,
            "x-genlayer-signature": `sha256=${signature}`,
          },
          body,
          signal: AbortSignal.timeout(8_000),
        });
        responseStatus = response.status;
        responseExcerpt = (await response.text()).slice(0, 500);
        ok = response.ok;
      } catch (error) {
        responseExcerpt = String(error?.message || error).slice(0, 500);
      }
      await sql`
        INSERT INTO webhook_deliveries (
          subscription_id, event_type, case_key, response_status,
          delivered, response_excerpt, attempted_at
        ) VALUES (
          ${subscription.id}, ${event.type}, ${`${event.kind}:${event.case_id}`},
          ${responseStatus}, ${ok}, ${responseExcerpt}, now()
        )
      `;
      if (ok) delivered += 1;
    }
  }
  return delivered;
}

export async function syncRegistry(source = "api") {
  const startedAt = new Date();
  const chain = await readChainDecisions();
  if (!env("DATABASE_URL")) {
    return {
      source: "chain",
      items: chain.items,
      seen: chain.items.length,
      changed: 0,
      webhook_deliveries: 0,
      warnings: chain.errors,
    };
  }
  const events = [];
  for (const item of chain.items) {
    const result = await upsertDecision(item);
    if (result.changed) events.push(eventFor(item, result.previous));
  }
  const webhookDeliveries = await dispatchWebhookEvents(events);
  const sql = database();
  await sql`
    INSERT INTO registry_sync_runs (
      source, decisions_seen, decisions_changed, transactions_refreshed,
      error_text, started_at, finished_at
    ) VALUES (
      ${source}, ${chain.items.length}, ${events.length}, 0,
      ${chain.errors.join("\n")}, ${startedAt.toISOString()}::timestamptz, now()
    )
  `;
  return {
    source: "database",
    seen: chain.items.length,
    changed: events.length,
    webhook_deliveries: webhookDeliveries,
    warnings: chain.errors,
  };
}

export async function syncRegistryIfStale(source = "api") {
  if (!env("DATABASE_URL")) return syncRegistry(source);
  const sql = database();
  const rows = await sql`
    SELECT finished_at
    FROM registry_sync_runs
    WHERE error_text = ''
    ORDER BY finished_at DESC
    LIMIT 1
  `;
  const lastFinished = rows[0]?.finished_at ? new Date(rows[0].finished_at).getTime() : 0;
  if (lastFinished && Date.now() - lastFinished < PUBLIC_SYNC_MIN_AGE_SECONDS * 1_000) {
    return {
      source: "database-cache",
      seen: 0,
      changed: 0,
      webhook_deliveries: 0,
      warnings: [],
      skipped: true,
    };
  }
  return syncRegistry(source);
}

function latestTransactionMap(rows) {
  const result = new Map();
  for (const row of rows) {
    const key = `${String(row.contract_address).toLowerCase()}:${row.kind}:${row.case_id}`;
    if (!result.has(key)) result.set(key, row);
  }
  return result;
}

function finalityFor(transaction) {
  if (!transaction) {
    return {
      status: "not_tracked",
      label: "No transaction linked",
      final: false,
      appeal_supported: false,
    };
  }
  const status = statusText(transaction.tx_status);
  if (status === "FINALIZED") {
    const consensusResult = consensusResultText(transaction);
    const executionResult = executionResultText(transaction);
    if (consensusResult && consensusResult !== "MAJORITY_AGREE") {
      return {
        status,
        label: `Rejected by validators (${consensusResult})`,
        final: false,
        appeal_supported: false,
      };
    }
    if (executionResult && executionResult !== "FINISHED_WITH_RETURN") {
      return {
        status,
        label: `Contract execution failed (${executionResult})`,
        final: false,
        appeal_supported: false,
      };
    }
    if (!consensusResult || !executionResult) {
      return {
        status,
        label: "Finality not yet verified",
        final: false,
        appeal_supported: false,
      };
    }
    return { status, label: "Final", final: true, appeal_supported: false };
  }
  if (["ACCEPTED", "PROPOSING", "COMMITTING", "REVEALING"].includes(status)) {
    return {
      status,
      label: "Accepted / settling",
      final: false,
      appeal_supported: false,
    };
  }
  if (["CANCELED", "UNDETERMINED", "FAILED"].includes(status)) {
    return { status, label: "Failed or cancelled", final: false, appeal_supported: false };
  }
  return { status, label: "Processing", final: false, appeal_supported: false };
}

// Exported only so the server test can keep SDK enum drift from corrupting UI finality.
export const finalityForTest = finalityFor;

function publicDecision(row, transaction) {
  return {
    network: row.network,
    contract_address: row.contract_address,
    source_name: row.source_name,
    kind: row.kind,
    case_id: row.case_id,
    status: row.status,
    decision: row.decision,
    rule_version: row.rule_version,
    support_refs: row.support_refs,
    decided_at: row.decided_at,
    title: row.title,
    content: row.content,
    payload: row.payload,
    observed_at: row.observed_at,
    updated_at: row.updated_at,
    transaction: transaction
      ? {
          hash: transaction.tx_hash,
          operation: transaction.operation,
          status: transaction.tx_status,
          observed_at: transaction.observed_at,
        }
      : null,
    finality: finalityFor(transaction),
  };
}

export async function listDecisions({ q = "", kind = "", status = "", limit = 100 } = {}) {
  const boundedLimit = Math.min(Math.max(Number(limit) || 100, 1), MAX_QUERY_ITEMS);
  if (!env("DATABASE_URL")) {
    const chain = await readChainDecisions();
    return filterDecisions(chain.items.map((item) => publicDecision(item, null)), {
      q,
      kind,
      status,
      limit: boundedLimit,
    });
  }
  const sql = database();
  const [rows, transactionRows] = await Promise.all([
    sql`SELECT * FROM decisions ORDER BY updated_at DESC, case_id ASC LIMIT 500`,
    sql`
      SELECT * FROM case_transactions
      ORDER BY submitted_at DESC
      LIMIT 500
    `,
  ]);
  const transactions = latestTransactionMap(transactionRows);
  const currentAddresses = new Set(allowedContractAddresses());
  const decisions = rows
    .filter((row) => currentAddresses.has(String(row.contract_address).toLowerCase()))
    .map((row) =>
      publicDecision(
        row,
        transactions.get(
          `${String(row.contract_address).toLowerCase()}:${row.kind}:${row.case_id}`
        )
      )
    );
  return filterDecisions(decisions, { q, kind, status, limit: boundedLimit });
}

function filterDecisions(items, { q, kind, status, limit }) {
  const needle = String(q || "").trim().toLowerCase();
  const wantedKind = String(kind || "").trim().toLowerCase();
  const wantedStatus = String(status || "").trim().toLowerCase();
  return items
    .filter((item) => !wantedKind || item.kind.toLowerCase() === wantedKind)
    .filter((item) => !wantedStatus || item.status.toLowerCase() === wantedStatus)
    .filter((item) => {
      if (!needle) return true;
      const haystack = [
        item.case_id,
        item.title,
        item.content,
        item.decision,
        ...(item.support_refs || []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    })
    .slice(0, limit);
}

function allowedContractAddresses() {
  return [
    configuredAddress("GENLAYER_CONTRACT_ADDRESS"),
    configuredAddress("TRUTHFEED_CONTRACT_ADDRESS"),
  ]
    .filter(Boolean)
    .map((value) => value.toLowerCase());
}

function txSummary(transaction) {
  return {
    hash: String(transaction?.hash || ""),
    status: statusText(transaction),
    to_address: String(
      transaction?.to_address || transaction?.toAddress || transaction?.to || ""
    ),
    from_address: String(
      transaction?.from_address || transaction?.fromAddress || transaction?.from || ""
    ),
    created_at: transaction?.created_at || transaction?.createdAt || null,
    result_name: consensusResultText(transaction),
    execution_result_name: executionResultText(transaction),
  };
}

function decodedTransactionCall(transaction) {
  const raw = transaction?.data?.calldata?.raw;
  if (!Array.isArray(raw) || raw.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new Error("Transaction calldata is unavailable");
  }
  const decoded = abi.calldata.decode(Uint8Array.from(raw));
  const method = decoded instanceof Map ? decoded.get("method") : decoded?.method;
  const args = decoded instanceof Map ? decoded.get("args") : decoded?.args;
  return {
    method: String(method || ""),
    args: Array.isArray(args) ? args : [],
  };
}

export function validateTrackedTransactionCall(transaction, { kind, caseId, operation }) {
  const expectedMethod = TRACKED_OPERATIONS[kind]?.[operation];
  if (!expectedMethod) throw new Error("Unsupported tracked operation");
  const call = decodedTransactionCall(transaction);
  if (call.method !== expectedMethod) {
    throw new Error("Tracked operation does not match transaction calldata");
  }
  if (String(call.args[0] ?? "") !== caseId) {
    throw new Error("Tracked case_id does not match transaction calldata");
  }
  return call;
}

export async function trackTransaction(input) {
  if (!env("DATABASE_URL")) throw new Error("Transaction tracking requires DATABASE_URL");
  const hash = String(input?.hash || "").trim();
  const kind = String(input?.kind || "").trim();
  const caseId = String(input?.case_id || "").trim();
  const operation = String(input?.operation || "").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("Invalid transaction hash");
  if (![LIVING_KIND, TRUTH_KIND].includes(kind)) throw new Error("Unknown decision kind");
  if (!caseId || caseId.length > 80) throw new Error("Invalid case_id");
  if (!operation || operation.length > 80) throw new Error("Invalid operation");

  const transaction = await genlayer().getTransaction({ hash });
  const summary = txSummary(transaction);
  const recipient = summary.to_address.toLowerCase();
  if (!allowedContractAddresses().includes(recipient)) {
    throw new Error("Transaction recipient is not a configured decision contract");
  }
  const expectedAddress = kind === LIVING_KIND
    ? configuredAddress("GENLAYER_CONTRACT_ADDRESS")
    : configuredAddress("TRUTHFEED_CONTRACT_ADDRESS");
  if (!expectedAddress || recipient !== expectedAddress.toLowerCase()) {
    throw new Error("Transaction kind does not match its contract recipient");
  }
  validateTrackedTransactionCall(transaction, { kind, caseId, operation });

  const sql = database();
  await sql`
    INSERT INTO case_transactions (
      tx_hash, network, contract_address, kind, case_id, operation, actor,
      tx_status, tx_payload, submitted_at, observed_at
    ) VALUES (
      ${hash.toLowerCase()}, ${NETWORK}, ${recipient}, ${kind}, ${caseId},
      ${operation}, ${summary.from_address.toLowerCase()}, ${summary.status},
      ${jsonValue(summary)}::jsonb, now(), now()
    )
    ON CONFLICT (tx_hash) DO UPDATE SET
      tx_status = EXCLUDED.tx_status,
      tx_payload = EXCLUDED.tx_payload,
      observed_at = now()
  `;
  return { ...summary, finality: finalityFor({ tx_status: summary.status, ...summary }) };
}

export async function getTransactions({ hash = "", kind = "", case_id = "" } = {}) {
  const sql = database();
  let rows;
  if (hash) {
    rows = await sql`
      SELECT * FROM case_transactions WHERE tx_hash = ${hash.toLowerCase()} LIMIT 1
    `;
  } else if (kind && case_id) {
    rows = await sql`
      SELECT * FROM case_transactions
      WHERE kind = ${kind} AND case_id = ${case_id}
      ORDER BY submitted_at DESC LIMIT 50
    `;
  } else {
    rows = await sql`
      SELECT * FROM case_transactions ORDER BY submitted_at DESC LIMIT 100
    `;
  }
  return rows.map((row) => ({ ...row, finality: finalityFor(row) }));
}

export async function refreshTransactions() {
  if (!env("DATABASE_URL")) return 0;
  const sql = database();
  const rows = await sql`
    SELECT tx_hash, tx_status FROM case_transactions
    WHERE tx_status <> 'FINALIZED'
       OR COALESCE(tx_payload->>'result_name', '') = ''
       OR COALESCE(tx_payload->>'execution_result_name', '') = ''
    ORDER BY observed_at ASC
    LIMIT 100
  `;
  let refreshed = 0;
  for (const row of rows) {
    try {
      const transaction = await genlayer().getTransaction({ hash: row.tx_hash });
      const summary = txSummary(transaction);
      await sql`
        UPDATE case_transactions
        SET tx_status = ${summary.status},
            tx_payload = ${jsonValue(summary)}::jsonb,
            observed_at = now()
        WHERE tx_hash = ${row.tx_hash}
      `;
      refreshed += 1;
    } catch {
      // A later sync retries transient RPC/indexing failures.
    }
  }
  return refreshed;
}

export function isAdminAuthorization(headerValue) {
  const expected = env("REGISTRY_ADMIN_TOKEN");
  const actual = String(headerValue || "").replace(/^Bearer\s+/i, "");
  if (!expected || !actual) return false;
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

export async function listWebhookSubscriptions() {
  const sql = database();
  return sql`
    SELECT id, url, events, active, created_at, updated_at
    FROM webhook_subscriptions ORDER BY created_at DESC
  `;
}

export async function createWebhookSubscription({ url, events }) {
  const cleanUrl = await assertPublicWebhookDestination(url);
  const cleanEvents = Array.from(
    new Set(
      (Array.isArray(events) ? events : ["decision.changed"])
        .map(String)
        .filter((value) => ["decision.created", "decision.changed", "decision.*"].includes(value))
    )
  );
  if (!cleanEvents.length) throw new Error("At least one supported webhook event is required");
  const sql = database();
  const id = randomUUID();
  const rows = await sql`
    INSERT INTO webhook_subscriptions (id, url, events, active, created_at, updated_at)
    VALUES (${id}::uuid, ${cleanUrl}, ${jsonValue(cleanEvents)}::jsonb, true, now(), now())
    ON CONFLICT (url) DO UPDATE SET
      events = EXCLUDED.events, active = true, updated_at = now()
    RETURNING id, url, events, active, created_at, updated_at
  `;
  return rows[0];
}

export async function deleteWebhookSubscription(id) {
  if (!/^[0-9a-fA-F-]{36}$/.test(String(id || ""))) throw new Error("Invalid subscription id");
  const sql = database();
  const rows = await sql`
    DELETE FROM webhook_subscriptions WHERE id = ${id}::uuid RETURNING id
  `;
  return Boolean(rows[0]);
}

export function registryConfiguration() {
  return {
    network: NETWORK,
    database: Boolean(env("DATABASE_URL")),
    livingconstitution: configuredAddress("GENLAYER_CONTRACT_ADDRESS"),
    truthfeed: configuredAddress("TRUTHFEED_CONTRACT_ADDRESS"),
    studio_native_appeals: false,
  };
}
