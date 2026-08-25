import { createClient, chains } from "genlayer-js";
import {
  isConfiguredAddress,
  isConfiguredRpcUrl,
  receiptFailure,
  receiptStatusName,
} from "./tx-utils.js";

const CONFIG = Object.assign(
  {
    RPC_URL: "",
    CONTRACT_ADDRESS: "",
    TRUTHFEED_CONTRACT_ADDRESS: "",
    REGISTRY_API_BASE: "",
  },
  window.ConstitutionConfig || {}
);

const CONN_KEY = "lc_conn";
const REGISTRY_SNAPSHOT_KEY = "lc_registry_snapshot_v1";
const LIVING_DECISION_KIND = "livingconstitution.proposal.v3";
const RPC_CONFIGURED =
  isConfiguredAddress(CONFIG.CONTRACT_ADDRESS) && isConfiguredRpcUrl(CONFIG.RPC_URL);
const STUDIO_CHAIN_ID_HEX = "0xf22f";
const STUDIO_CHAIN_PARAMS = {
  chainId: STUDIO_CHAIN_ID_HEX,
  chainName: "Genlayer Studio Network",
  rpcUrls: [isConfiguredRpcUrl(CONFIG.RPC_URL) ? CONFIG.RPC_URL : "https://studio.genlayer.com/api"],
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
};
const PAGE_SIZE = 50;

const readClient = RPC_CONFIGURED
  ? createClient({ chain: chains.studionet, endpoint: CONFIG.RPC_URL })
  : null;
let writeClient = null;
let writeClientAddress = "";

const state = {
  constitution: "",
  constitutionVersions: [],
  versionCount: 0,
  proposals: [],
  stats: null,
  live: false,
  filter: "all",
  conn: null,
  owner: "",
  pendingOwner: "",
  ballots: [],
  registry: [],
  registryWarning: "",
  registryLoading: true,
};

/* ------------------------------------------------------------------ */
/* Chain access                                                        */
/* ------------------------------------------------------------------ */

async function readView(functionName, args = []) {
  if (!readClient) throw new Error("RPC or contract address is not configured.");
  return readClient.readContract({
    address: CONFIG.CONTRACT_ADDRESS,
    functionName,
    args,
  });
}

async function refreshFromChain() {
  if (!RPC_CONFIGURED) throw new Error("RPC or contract address is not configured.");
  const [constitution, versionCount, proposals, stats, ownership, ballotPage] = await Promise.all([
    readView("get_constitution"),
    readView("constitution_version_count"),
    readView("list_proposals", [0, PAGE_SIZE]),
    readView("get_stats"),
    readView("get_ownership_state").catch(async () => ({ owner: await readView("get_owner"), pending_owner: "" })),
    readView("list_ballots", [0, PAGE_SIZE]).catch(() => ({ items: [] })),
  ]);
  state.constitution = String(constitution || "");
  state.versionCount = Number(versionCount) || 0;
  try {
    state.constitutionVersions = await Promise.all(
      Array.from({ length: state.versionCount }, (_, index) =>
        readView("get_constitution_version", [index + 1]).then(String)
      )
    );
  } catch {
    state.constitutionVersions = Array.from({ length: state.versionCount }, (_, index) =>
      index === state.versionCount - 1 ? state.constitution : ""
    );
  }
  state.proposals = Array.isArray(proposals) ? proposals.map(normalizeProposal) : [];
  state.stats = stats || null;
  state.owner = String(ownership?.owner || "");
  state.pendingOwner = String(ownership?.pending_owner || "");
  state.ballots = (Array.isArray(ballotPage) ? ballotPage : ballotPage?.items || []).map(normalizeBallot);
  state.live = true;
}

function normalizeProposal(raw) {
  return {
    id: String(raw.id ?? ""),
    title: String(raw.title ?? ""),
    body: String(raw.body ?? ""),
    status: String(raw.status ?? "submitted").toLowerCase(),
    violations: Array.isArray(raw.violations) ? raw.violations.map(String) : [],
    rule_refs: Array.isArray(raw.rule_refs)
      ? raw.rule_refs.map(String)
      : Array.isArray(raw.violations)
        ? raw.violations.map(String)
        : [],
    analysis: String(raw.analysis ?? ""),
    analysis_provenance: String(raw.analysis_provenance ?? "leader_output_non_authoritative"),
    constitution_version: Number(raw.constitution_version ?? 0),
    review_count: Number(raw.review_count ?? 0),
    review_history: Array.isArray(raw.review_history) ? raw.review_history : [],
    submitter: String(raw.submitter ?? ""),
    checked_at: String(raw.checked_at ?? ""),
    created_at: String(raw.created_at ?? ""),
    recheck_requests: Array.isArray(raw.recheck_requests) ? raw.recheck_requests : [],
    current_ballot_id: String(raw.current_ballot_id ?? ""),
    ballot_history: Array.isArray(raw.ballot_history) ? raw.ballot_history.map(String) : [],
  };
}

function normalizeBallot(raw) {
  return {
    id: String(raw?.id ?? ""),
    proposal_id: String(raw?.proposal_id ?? ""),
    status: String(raw?.status ?? "none").toLowerCase(),
    review: Number(raw?.review ?? 0),
    constitution_version: Number(raw?.constitution_version ?? 0),
    closes_at: Number(raw?.closes_at ?? 0),
    quorum: Number(raw?.quorum ?? 0),
    votes_for: Number(raw?.votes_for ?? 0),
    votes_against: Number(raw?.votes_against ?? 0),
    total_votes: Number(raw?.total_votes ?? 0),
    passed: Boolean(raw?.passed),
    cancel_reason: String(raw?.cancel_reason ?? ""),
    opened_at: String(raw?.opened_at ?? ""),
    closed_at: String(raw?.closed_at ?? ""),
  };
}

function registryUrl(path) {
  const base = String(CONFIG.REGISTRY_API_BASE || "").replace(/\/$/, "");
  return `${base}${path}`;
}

function registryItemFor(kind, caseId) {
  return state.registry.find((item) => item.kind === kind && item.case_id === caseId) || null;
}

async function refreshRegistry({ fresh = true, notify = true } = {}) {
  state.registryLoading = true;
  try {
    const response = await fetch(registryUrl(`/api/registry?fresh=${fresh ? "1" : "0"}&limit=200`), {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Registry returned HTTP ${response.status}`);
    const result = await response.json();
    const nextItems = Array.isArray(result.items) ? result.items : [];
    if (notify) notifyRegistryChanges(nextItems);
    state.registry = nextItems;
    state.registryWarning = String(result.warning || "");
  } catch (error) {
    state.registryWarning = String(error?.message || error);
  } finally {
    state.registryLoading = false;
  }
}

function notificationSnapshot(items) {
  return Object.fromEntries(
    items.map((item) => [
      `${item.kind}:${item.case_id}`,
      `${item.status}|${item.decision}|${item.finality?.status || ""}`,
    ])
  );
}

function notifyRegistryChanges(items) {
  let previous = {};
  try {
    previous = JSON.parse(localStorage.getItem(REGISTRY_SNAPSHOT_KEY) || "{}");
  } catch (_) {
    previous = {};
  }
  const next = notificationSnapshot(items);
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    for (const item of items) {
      const key = `${item.kind}:${item.case_id}`;
      if (previous[key] && previous[key] !== next[key]) {
        new Notification(`${item.source_name}: ${item.case_id}`, {
          body: `${item.status}${item.decision ? ` · ${item.decision}` : ""} · ${item.finality?.label || "status updated"}`,
        });
      }
    }
  }
  localStorage.setItem(REGISTRY_SNAPSHOT_KEY, JSON.stringify(next));
}

async function enableNotifications() {
  if (typeof Notification === "undefined") {
    toast("err", "This browser does not support notifications.");
    return;
  }
  const permission = await Notification.requestPermission();
  toast(
    permission === "granted" ? "ok" : "info",
    permission === "granted"
      ? "Decision updates are enabled while this browser is running."
      : "Notifications were not enabled."
  );
  renderRegistry();
}

async function registerTransaction(hash, caseId, operation) {
  if (!hash || !caseId) return;
  try {
    const response = await fetch(registryUrl("/api/transactions"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        hash,
        kind: LIVING_DECISION_KIND,
        case_id: caseId,
        operation,
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    console.warn("Transaction registry update failed; chain write is unaffected:", error);
  }
}

async function sendWrite(functionName, args, { longPoll = false } = {}) {
  if (!RPC_CONFIGURED) throw new Error("RPC or contract address is not configured.");
  const conn = state.conn || readStoredConnection();
  if (!conn) throw new Error("Connect your wallet first — Connect Wallet is the only way to sign transactions.");
  const provider = window.ethereum;
  if (!provider) throw new Error("No browser wallet is available.");
  const networkReady = await ensureStudioNetwork(provider);
  if (!networkReady) {
    throw new Error("Wallet network was not confirmed. Switch to GenLayer Studio (chain 61999) and try again.");
  }
  const accounts = await provider.request({ method: "eth_accounts" });
  if (!Array.isArray(accounts) || !accounts.some((value) => String(value).toLowerCase() === conn.address.toLowerCase())) {
    throw new Error("The connected account is no longer authorized in your wallet. Reconnect it and try again.");
  }
  if (!writeClient || writeClientAddress.toLowerCase() !== conn.address.toLowerCase()) {
    writeClient = createClient({
      chain: chains.studionet,
      endpoint: CONFIG.RPC_URL,
      account: conn.address,
      provider,
    });
    writeClientAddress = conn.address;
  }
  try {
    const hash = await writeClient.writeContract({ address: CONFIG.CONTRACT_ADDRESS, functionName, args });
    const receipt = await writeClient.waitForTransactionReceipt({
      hash,
      status: "ACCEPTED",
      interval: longPoll ? 4000 : 2500,
      retries: longPoll ? 300 : 80,
    });
    return { hash, receipt };
  } catch (err) {
    throw new Error(`${errMsg(err)} — Wallet signing failed? Check that MetaMask is unlocked and on the GenLayer Studio network.`);
  }
}

function errMsg(err) {
  return String(err?.message || err?.shortMessage || err);
}


/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch (_) {
    return iso;
  }
}

function cssEscape(v) {
  return window.CSS && CSS.escape ? CSS.escape(v) : v.replace(/["\\]/g, "\\$&");
}

function truncateHash(hash) {
  return hash ? `${hash.slice(0, 10)}…${hash.slice(-8)}` : "";
}

async function copyText(text, okMessage) {
  try {
    await navigator.clipboard.writeText(text);
    toast("ok", okMessage);
  } catch (_) {
    toast("err", "Clipboard unavailable in this context.");
  }
}

function toast(kind, message, timeoutMs = 5200) {
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  const ico = document.createElement("span");
  ico.className = "toast-ico";
  ico.textContent = kind === "ok" ? "✓" : kind === "err" ? "✕" : "ℹ";
  const body = document.createElement("span");
  body.textContent = message;
  el.append(ico, body);
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), timeoutMs);
}

function splitArticles(text) {
  const parts = String(text)
    .split(/(?=Article\s+\d+\s*[:.])/i)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : text.trim() ? [text.trim()] : [];
}

function renderNetPill() {
  const pill = $("net-pill");
  const label = $("net-label");
  pill.classList.remove("pill-loading", "pill-live", "pill-unavailable");
  if (state.live) {
    pill.classList.add("pill-live");
    label.textContent = "live · studionet";
  } else {
    pill.classList.add("pill-unavailable");
    label.textContent = RPC_CONFIGURED ? "studionet unavailable" : "not configured";
  }
}

function renderConstitution() {
  $("charter-skeleton").hidden = true;
  const articlesEl = $("constitution-articles");
  const emptyEl = $("charter-empty");
  const articles = splitArticles(state.constitution);
  articlesEl.innerHTML = "";
  if (!articles.length) {
    emptyEl.hidden = false;
    articlesEl.hidden = true;
  } else {
    emptyEl.hidden = true;
    articlesEl.hidden = false;
    for (const text of articles) {
      const li = document.createElement("li");
      li.textContent = text;
      articlesEl.appendChild(li);
    }
  }

  const vc = Math.max(state.versionCount, 0);
  $("version-count").textContent = `v${vc || "–"} · ${vc} version${vc === 1 ? "" : "s"}`;

  const historyBtn = $("btn-toggle-history");
  historyBtn.hidden = !state.versionCount;
  const list = $("history-list");
  list.innerHTML = "";
  for (let i = 1; i <= state.versionCount; i++) {
    const li = document.createElement("li");
    li.className = i === state.versionCount ? "history-item history-current" : "history-item";
    const ver = document.createElement("span");
    ver.className = "history-version";
    ver.textContent = `v${i}`;
    const preview = document.createElement("span");
    preview.className = "history-preview";
    const versionText = String(state.constitutionVersions[i - 1] || "");
    if (versionText) {
      preview.textContent =
        versionText.split("\n")[0] +
        (versionText.includes("\n") ? " …" : "") +
        (i === state.versionCount ? " (current)" : "");
      preview.title = versionText;
    } else {
      preview.textContent = "This older deployment does not expose the archived text.";
      preview.classList.add("muted");
    }
    li.append(ver, preview);
    list.appendChild(li);
  }
}

function renderStats() {
  const s = state.stats || {};
  $("stat-submitted").textContent = Number(s.proposals_submitted ?? 0);
  $("stat-checked").textContent = Number(s.proposals_checked ?? 0);
  $("stat-compliant").textContent = Number(s.verdicts_compliant ?? 0);
  $("stat-noncompliant").textContent = Number(s.verdicts_non_compliant ?? 0);
  const needsReview = $("stat-needs-review");
  if (needsReview) needsReview.textContent = Number(s.verdicts_needs_review ?? 0);
}

function badgeClass(status) {
  return {
    compliant: "badge-compliant",
    non_compliant: "badge-non_compliant",
    needs_review: "badge-pending",
    submitted: "badge-submitted",
    pending: "badge-pending",
  }[status] || "badge-submitted";
}

function badgeLabel(status) {
  return status === "pending" ? "settling…" : status.replace("_", "-");
}

function buildCard(p) {
  const card = document.createElement("article");
  card.className = `card st-${cssEscape(p.status)}`;
  card.dataset.proposalId = p.id;

  const head = document.createElement("div");
  head.className = "card-head";
  const title = document.createElement("h3");
  title.className = "card-title";
  title.textContent = p.title;
  const badge = document.createElement("span");
  badge.className = `badge ${badgeClass(p.status)}`;
  badge.textContent = badgeLabel(p.status);
  head.append(title, badge);

  const meta = document.createElement("p");
  meta.className = "card-meta";
  meta.textContent = `${p.id} · constitution v${p.constitution_version || "?"} · submitted ${fmtDate(p.created_at)}${p.checked_at ? ` · checked ${fmtDate(p.checked_at)}` : ""}`;

  const body = document.createElement("p");
  body.className = "card-body-text";
  body.textContent = p.body;

  card.append(head, meta, body);

  if (p.rule_refs.length) {
    const label = document.createElement("p");
    label.className = "card-meta";
    label.textContent = "Consensus rule references:";
    card.appendChild(label);
    const ul = document.createElement("ul");
    ul.className = "violations";
    for (const v of p.rule_refs) {
      const li = document.createElement("li");
      li.textContent = v;
      ul.appendChild(li);
    }
    card.appendChild(ul);
  }

  if (p.analysis) {
    const label = document.createElement("p");
    label.className = "card-meta";
    label.textContent = "Leader rationale (not a consensus field):";
    card.appendChild(label);
    const q = document.createElement("blockquote");
    q.className = "card-analysis";
    q.textContent = p.analysis;
    card.appendChild(q);
  }

  if (p.review_history.length > 1) {
    const details = document.createElement("details");
    details.className = "review-history";
    const summary = document.createElement("summary");
    summary.textContent = `${p.review_history.length} completed reviews`;
    const list = document.createElement("ol");
    for (const review of p.review_history) {
      const item = document.createElement("li");
      const refs = Array.isArray(review.rule_refs) && review.rule_refs.length
        ? ` · ${review.rule_refs.join(", ")}`
        : "";
      item.textContent = `Review ${review.review} · constitution v${review.constitution_version} · ${String(review.verdict || "").replace("_", "-")}${refs}`;
      list.appendChild(item);
    }
    details.append(summary, list);
    card.appendChild(details);
  }

  const registryRecord = registryItemFor(LIVING_DECISION_KIND, p.id);
  if (registryRecord) {
    const finality = document.createElement("div");
    finality.className = "finality-row";
    const finalityBadge = document.createElement("span");
    finalityBadge.className = `chip-static ${registryRecord.finality?.final ? "finality-final" : "finality-settling"}`;
    finalityBadge.textContent = registryRecord.finality?.label || "Finality unknown";
    const finalityText = document.createElement("span");
    finalityText.className = "muted";
    finalityText.textContent = registryRecord.transaction
      ? `latest tracked ${registryRecord.transaction.operation} transaction`
      : "No transaction hash has been linked to this indexed record yet.";
    finality.append(finalityBadge, finalityText);
    card.appendChild(finality);
  }

  const proposalBallots = state.ballots.filter((item) => item.proposal_id === p.id);
  const ballot =
    proposalBallots.find((item) => item.id === p.current_ballot_id) ||
    proposalBallots.at(-1) ||
    null;
  const latestReviewHasBallot = Boolean(ballot && ballot.review === p.review_count);
  if (ballot) {
    const voting = document.createElement("div");
    voting.className = `voting-box voting-${ballot.status}`;
    const votingTitle = document.createElement("strong");
    votingTitle.textContent = ballot.status === "open"
      ? "Pilot ballot open"
      : ballot.status === "closed"
        ? `Pilot ballot ${ballot.passed ? "passed" : "did not pass"}`
        : "Pilot ballot cancelled";
    const votingMeta = document.createElement("span");
    votingMeta.className = "muted";
    votingMeta.textContent = ballot.status === "open"
      ? `FOR ${ballot.votes_for} · AGAINST ${ballot.votes_against} · quorum ${ballot.quorum} · closes ${fmtDate(new Date(ballot.closes_at * 1000).toISOString())}`
      : ballot.status === "cancelled"
        ? ballot.cancel_reason
        : `FOR ${ballot.votes_for} · AGAINST ${ballot.votes_against} · quorum ${ballot.quorum}`;
    voting.append(votingTitle, votingMeta);
    card.appendChild(voting);
  } else if (p.status === "compliant") {
    const ready = document.createElement("div");
    ready.className = "voting-box voting-ready";
    ready.innerHTML = "<strong>Voting gate ready</strong><span class=\"muted\">The latest constitutional review is compliant.</span>";
    card.appendChild(ready);
  }

  if (p._reviewing) {
    const review = document.createElement("div");
    review.className = "reviewing-state";
    const sp = document.createElement("span");
    sp.className = "spinner";
    const txt = document.createElement("span");
    txt.textContent = "validators reviewing against constitution… the validator jury is deliberating.";
    review.append(sp, txt);
    card.appendChild(review);
  }

  const actions = document.createElement("div");
  actions.className = "card-actions";

  if (p._txHash) {
    const txRow = document.createElement("span");
    txRow.className = "tx-row";
    const lbl = document.createElement("span");
    lbl.textContent = p._txPending ? "tx " : "tx ";
    const code = document.createElement("code");
    code.textContent = truncateHash(p._txHash);
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "icon-btn";
    copyBtn.title = "Copy transaction hash";
    copyBtn.setAttribute("aria-label", "Copy transaction hash");
    copyBtn.textContent = "⧉";
    copyBtn.addEventListener("click", () => copyText(p._txHash, "Transaction hash copied."));
    txRow.append(lbl, code, copyBtn);
    actions.appendChild(txRow);

    if (!p._txPending && p._txStatus) {
      const st = document.createElement("span");
      st.className = "chip-static";
      st.style.color = p._txOk ? "var(--green)" : "var(--red)";
      st.style.borderColor = p._txOk ? "rgba(76,195,138,.45)" : "rgba(239,106,106,.45)";
      st.textContent = p._txStatus;
      actions.appendChild(st);
    }
  }

  if (p.status === "submitted" && !p._pending && state.live) {
    const checkBtn = document.createElement("button");
    checkBtn.type = "button";
    checkBtn.className = "btn btn-outline btn-sm btn-check";
    checkBtn.textContent = "Run constitutional check";
    checkBtn.addEventListener("click", () => handleCheck(p.id));
    actions.appendChild(checkBtn);
  }

  const connectedIsSubmitter = Boolean(
    state.conn && p.submitter && state.conn.address.toLowerCase() === p.submitter.toLowerCase()
  );
  if (
    ["compliant", "non_compliant", "needs_review"].includes(p.status) &&
    connectedIsSubmitter &&
    (!ballot || ballot.status === "cancelled") &&
    state.live
  ) {
    const recheckBtn = document.createElement("button");
    recheckBtn.type = "button";
    recheckBtn.className = "btn btn-ghost btn-sm";
    recheckBtn.textContent = "Request recheck";
    recheckBtn.title = "Available to the proposal creator";
    recheckBtn.addEventListener("click", () => handleRequestRecheck(p.id));
    actions.appendChild(recheckBtn);
  }

  if (
    p.status === "compliant" &&
    !latestReviewHasBallot &&
    connectedIsSubmitter &&
    state.live
  ) {
    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "btn btn-outline btn-sm";
    openBtn.textContent = "Open voting";
    openBtn.addEventListener("click", () => handleOpenBallot(p.id));
    actions.appendChild(openBtn);
  }
  if (ballot?.status === "open" && state.conn && state.live && Date.now() < ballot.closes_at * 1000) {
    const voteFor = document.createElement("button");
    voteFor.type = "button";
    voteFor.className = "btn btn-vote-for btn-sm";
    voteFor.textContent = "Vote FOR";
    voteFor.addEventListener("click", () => handleVote(p.id, true));
    const voteAgainst = document.createElement("button");
    voteAgainst.type = "button";
    voteAgainst.className = "btn btn-vote-against btn-sm";
    voteAgainst.textContent = "Vote AGAINST";
    voteAgainst.addEventListener("click", () => handleVote(p.id, false));
    actions.append(voteFor, voteAgainst);
  }
  if (ballot?.status === "open" && state.live && Date.now() >= ballot.closes_at * 1000) {
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "btn btn-outline btn-sm";
    closeBtn.textContent = "Close ballot";
    closeBtn.addEventListener("click", () => handleCloseBallot(p.id));
    actions.appendChild(closeBtn);
  }

  if (actions.children.length) card.appendChild(actions);
  return card;
}

function renderProposals() {
  const container = $("cards");
  container.innerHTML = "";
  const visible = state.proposals.filter((p) => state.filter === "all" || p.status === state.filter);
  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = state.live ? "No proposals match this filter." : "StudioNet records are unavailable.";
    container.appendChild(empty);
    return;
  }
  for (const p of visible) container.appendChild(buildCard(p));
}

function renderRegistry() {
  const container = $("registry-results");
  if (!container) return;
  container.innerHTML = "";
  const search = String($("registry-search")?.value || "").trim().toLowerCase();
  const kind = String($("registry-kind")?.value || "");
  const items = state.registry.filter((item) => {
    if (kind && item.kind !== kind) return false;
    if (!search) return true;
    return [
      item.case_id,
      item.title,
      item.content,
      item.status,
      item.decision,
      ...(item.support_refs || []),
    ].join(" ").toLowerCase().includes(search);
  });

  $("registry-count").textContent = state.registryLoading
    ? "syncing…"
    : `${items.length} of ${state.registry.length} indexed decisions`;
  const warning = $("registry-warning");
  warning.hidden = !state.registryWarning;
  warning.textContent = state.registryWarning
    ? `Indexer warning: ${state.registryWarning}. On-chain proposal reads above remain authoritative.`
    : "";
  const notificationButton = $("btn-notifications");
  if (notificationButton && typeof Notification !== "undefined") {
    notificationButton.textContent = Notification.permission === "granted"
      ? "Updates enabled"
      : "Enable browser updates";
    notificationButton.disabled = Notification.permission === "granted";
  }

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = state.registryLoading
      ? "Reading both GenLayer contracts…"
      : "No indexed decisions match this search.";
    container.appendChild(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement("article");
    row.className = "registry-row";
    const head = document.createElement("div");
    head.className = "registry-row-head";
    const title = document.createElement("strong");
    title.textContent = item.title || item.case_id;
    const source = document.createElement("span");
    source.className = "chip-static";
    source.textContent = item.source_name;
    head.append(title, source);
    const meta = document.createElement("p");
    meta.className = "card-meta";
    meta.textContent = `${item.case_id} · ${item.status}${item.decision ? ` · decision ${item.decision}` : ""} · ${item.rule_version}`;
    const finality = document.createElement("div");
    finality.className = "registry-finality";
    const finalityChip = document.createElement("span");
    finalityChip.className = `chip-static ${item.finality?.final ? "finality-final" : "finality-settling"}`;
    finalityChip.textContent = item.finality?.label || "Finality unknown";
    const refs = document.createElement("span");
    refs.className = "muted";
    refs.textContent = Array.isArray(item.support_refs) && item.support_refs.length
      ? `support: ${item.support_refs.join(", ")}`
      : "no support references recorded";
    finality.append(finalityChip, refs);
    row.append(head, meta, finality);
    container.appendChild(row);
  }
}

function renderAll() {
  renderKeyPanel();
  renderNetPill();
  renderConstitution();
  renderStats();
  renderProposals();
  renderRegistry();
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

function randomProposalId() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let suffix = "";
  crypto.getRandomValues(new Uint8Array(6)).forEach((b) => (suffix += alphabet[b % alphabet.length]));
  return `p-${suffix}`;
}

async function handleSubmit(event) {
  event.preventDefault();
  const errEl = $("form-error");
  errEl.hidden = true;

  const title = $("input-title").value.trim();
  const body = $("input-body").value.trim();

  if (!title || !body) {
    errEl.textContent = "Title and body are both required.";
    errEl.hidden = false;
    return;
  }
  if (!state.conn) {
    errEl.textContent = "Connect a wallet first — proposals are signed transactions.";
    errEl.hidden = false;
    return;
  }

  const pid = randomProposalId();
  const optimistic = normalizeProposal({ id: pid, title, body, status: "pending" });
  optimistic._pending = true;
  state.proposals.unshift(optimistic);
  setFilter("all");
  renderProposals();
  setBusy(true);

  try {
    const { hash, receipt } = await sendWrite("submit_proposal", [pid, title, body]);
    optimistic._txHash = hash;
    const failure = receiptFailure(receipt);
    if (failure) {
      optimistic._txPending = false;
      optimistic._txStatus = "ERROR";
      optimistic._txOk = false;
      renderProposals();
      toast("err", failure, 9000);
      return;
    }
    optimistic._txPending = false;
    optimistic._txStatus = receiptStatusName(receipt) || "ACCEPTED";
    optimistic._txOk = true;
    await registerTransaction(hash, pid, "submit_proposal");
    await refreshFromChain();
    await refreshRegistry({ fresh: true });
    const settled = state.proposals.find((x) => x.id === pid);
    if (settled) {
      settled._txHash = hash;
      settled._txPending = false;
      settled._txStatus = optimistic._txStatus;
      settled._txOk = true;
    }
    renderAll();
    $("input-title").value = "";
    $("input-body").value = "";
    syncCounters();
    toast("ok", `Proposal ${pid} accepted on-chain. It remains appealable until finalization.`);
  } catch (err) {
    state.proposals = state.proposals.filter((x) => x !== optimistic);
    renderProposals();
    errEl.textContent = String(err?.message || err?.shortMessage || err);
    errEl.hidden = false;
  } finally {
    setBusy(false);
  }
}

async function handleCheck(proposalId) {
  const p = state.proposals.find((x) => x.id === proposalId);
  if (!p) return;
  p._reviewing = true;
  renderProposals();

  try {
    const { hash, receipt } = await sendWrite("check_proposal", [proposalId], { longPoll: true });
    const failure = receiptFailure(receipt);
    if (failure) {
      p._reviewing = false;
      p._txHash = hash;
      p._txPending = false;
      p._txStatus = "ERROR";
      p._txOk = false;
      renderProposals();
      toast("err", failure, 10000);
      return;
    }
    await registerTransaction(hash, proposalId, "check_proposal");
    await refreshFromChain();
    await refreshRegistry({ fresh: true });
    const updated = state.proposals.find((x) => x.id === proposalId);
    if (updated) {
      updated._txHash = hash;
      updated._txPending = false;
      updated._txStatus = receiptStatusName(receipt) || "ACCEPTED";
      updated._txOk = true;
    }
    renderAll();
    const verdict = updated?.status;
    if (verdict === "compliant") toast("ok", `${proposalId}: COMPLIANT. Accepted now; final after the appeal window.`);
    else if (verdict === "non_compliant") toast("err", `${proposalId}: NON-COMPLIANT. Accepted now; final after the appeal window.`, 9000);
    else if (verdict === "needs_review") toast("info", `${proposalId}: NEEDS REVIEW because the rules or proposal are ambiguous.`, 9000);
    else toast("info", `${proposalId}: review accepted — see the record.`);
  } catch (err) {
    if (p) {
      p._reviewing = false;
      renderProposals();
    }
    toast("err", `Check failed for ${proposalId}: ${String(err?.message || err)}`, 9000);
  }
}

async function handleUpdateConstitution() {
  const next = $("input-new-constitution").value.trim();
  if (!next) {
    toast("err", "Constitution text must not be empty.");
    return;
  }
  const btn = $("btn-update-constitution");
  btn.disabled = true;
  btn.textContent = "sending…";
  try {
    const { hash, receipt } = await sendWrite("update_constitution", [next]);
    const failure = receiptFailure(receipt);
    if (failure) {
      toast("err", `${failure}`, 10000);
    } else {
      await refreshFromChain();
      renderAll();
      $("input-new-constitution").value = "";
      toast("ok", `Charter amended. Tx ${truncateHash(hash)}`);
    }
  } catch (err) {
    toast("err", `Amendment failed: ${String(err?.message || err)}`, 9000);
  } finally {
    btn.disabled = false;
    btn.textContent = "update_constitution";
  }
}

async function handleRequestRecheck(proposalId) {
  const reason = window.prompt(
    "Why should validators review this proposal again? This reason will be stored on-chain.",
    "New or corrected information should be considered."
  );
  if (reason === null) return;
  if (!reason.trim()) {
    toast("err", "A written recheck reason is required.");
    return;
  }
  try {
    const { hash, receipt } = await sendWrite("request_recheck_with_reason", [proposalId, reason.trim()]);
    const failure = receiptFailure(receipt);
    if (failure) {
      toast("err", failure, 10000);
      return;
    }
    await registerTransaction(hash, proposalId, "request_recheck_with_reason");
    await refreshFromChain();
    await refreshRegistry({ fresh: true });
    renderAll();
    toast(
      "ok",
      `${proposalId} reopened under the latest constitution; prior reviews were preserved. Tx ${truncateHash(hash)}`,
      8500
    );
  } catch (err) {
    toast("err", `Recheck request failed: ${String(err?.message || err)}`, 9000);
  }
}

async function handleResetCheck() {
  const pid = $("input-reset-id").value.trim();
  if (!pid) {
    toast("err", "Enter the proposal id to reset.");
    return;
  }
  const btn = $("btn-reset-check");
  btn.disabled = true;
  btn.textContent = "sending…";
  try {
    const { hash, receipt } = await sendWrite("reset_check", [pid]);
    const failure = receiptFailure(receipt);
    if (failure) {
      toast("err", `${failure}`, 10000);
    } else {
      await registerTransaction(hash, pid, "reset_check");
      await refreshFromChain();
      await refreshRegistry({ fresh: true });
      renderAll();
      $("input-reset-id").value = "";
      toast("ok", `${pid} re-opened for review. Tx ${truncateHash(hash)}`);
    }
  } catch (err) {
    toast("err", `Reset failed: ${String(err?.message || err)}`, 9000);
  } finally {
    btn.disabled = false;
    btn.textContent = "Owner force-reopen";
  }
}

async function handleOpenBallot(proposalId) {
  try {
    const { hash, receipt } = await sendWrite("open_ballot", [proposalId]);
    const failure = receiptFailure(receipt);
    if (failure) {
      toast("err", failure, 10_000);
      return;
    }
    await registerTransaction(hash, proposalId, "open_ballot");
    await refreshFromChain();
    await refreshRegistry({ fresh: true });
    renderAll();
    toast("ok", `Voting opened for ${proposalId}.`);
  } catch (error) {
    toast("err", `Could not open ballot: ${String(error?.message || error)}`, 9_000);
  }
}

async function handleVote(proposalId, support) {
  try {
    const { hash, receipt } = await sendWrite("cast_vote", [proposalId, support]);
    const failure = receiptFailure(receipt);
    if (failure) {
      toast("err", failure, 10_000);
      return;
    }
    await registerTransaction(hash, proposalId, support ? "cast_vote_for" : "cast_vote_against");
    await refreshFromChain();
    await refreshRegistry({ fresh: true });
    renderAll();
    toast("ok", `${support ? "FOR" : "AGAINST"} vote accepted for ${proposalId}.`);
  } catch (error) {
    toast("err", `Vote failed: ${String(error?.message || error)}`, 9_000);
  }
}

async function handleCloseBallot(proposalId) {
  try {
    const { hash, receipt } = await sendWrite("close_ballot", [proposalId]);
    const failure = receiptFailure(receipt);
    if (failure) {
      toast("err", failure, 10_000);
      return;
    }
    await registerTransaction(hash, proposalId, "close_ballot");
    await refreshFromChain();
    await refreshRegistry({ fresh: true });
    renderAll();
    toast("ok", `Ballot closed for ${proposalId}.`);
  } catch (error) {
    toast("err", `Could not close ballot: ${String(error?.message || error)}`, 9_000);
  }
}

function setBusy(busy) {
  $("btn-submit").disabled = busy;
}

/* ------------------------------------------------------------------ */
/* Connection panel                                                    */
/* ------------------------------------------------------------------ */

function shortAddress(addr) {
  return addr ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : "";
}

function readStoredConnection() {
  try {
    const raw = sessionStorage.getItem(CONN_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.mode === "wallet" && typeof parsed.address === "string" && parsed.address) {
        return { mode: "wallet", address: parsed.address };
      }
      sessionStorage.removeItem(CONN_KEY);
    }
  } catch (_) {
    sessionStorage.removeItem(CONN_KEY);
  }
  return null;
}

function renderKeyPanel() {
  state.conn = readStoredConnection();
  const conn = state.conn;
  const connected = Boolean(conn);
  $("btn-connect-wallet").hidden = connected;
  $("key-connected").hidden = !connected;
  $("key-role-chip").hidden = !connected;
  if (connected) {
    $("conn-mode-label").textContent = "wallet";
    $("key-address").textContent = shortAddress(conn.address);
    $("key-address").title = conn.address;
    const isOwner = state.owner && conn.address.toLowerCase() === state.owner.toLowerCase();
    const isPendingOwner = state.pendingOwner && conn.address.toLowerCase() === state.pendingOwner.toLowerCase();
    $("key-role-chip").textContent = isOwner ? "contract owner" : isPendingOwner ? "pending owner" : "signer ready";
    $("btn-accept-ownership").hidden = !isPendingOwner;
  } else {
    $("btn-accept-ownership").hidden = true;
  }
  if ($("current-owner")) $("current-owner").textContent = state.owner ? shortAddress(state.owner) : "unknown";
  if ($("pending-owner")) $("pending-owner").textContent = state.pendingOwner ? shortAddress(state.pendingOwner) : "none";
}

async function handleStageOwnership() {
  const nextOwner = $("input-next-owner").value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(nextOwner)) {
    toast("err", "Enter a valid 0x wallet, Safe, multisig, or DAO executor address.");
    return;
  }
  try {
    const { hash, receipt } = await sendWrite("transfer_ownership", [nextOwner]);
    const failure = receiptFailure(receipt);
    if (failure) {
      toast("err", failure, 10_000);
      return;
    }
    await refreshFromChain();
    renderAll();
    renderKeyPanel();
    $("input-next-owner").value = "";
    toast("ok", `Ownership nominated. ${shortAddress(nextOwner)} must accept before control moves. Tx ${truncateHash(hash)}`);
  } catch (error) {
    toast("err", `Ownership nomination failed: ${String(error?.message || error)}`, 9_000);
  }
}

async function handleAcceptOwnership() {
  try {
    const { hash, receipt } = await sendWrite("accept_ownership", []);
    const failure = receiptFailure(receipt);
    if (failure) {
      toast("err", failure, 10_000);
      return;
    }
    await refreshFromChain();
    renderAll();
    renderKeyPanel();
    toast("ok", `Ownership accepted. Tx ${truncateHash(hash)}`);
  } catch (error) {
    toast("err", `Ownership acceptance failed: ${String(error?.message || error)}`, 9_000);
  }
}

async function ensureStudioNetwork(provider) {
  let chainId = null;
  try {
    chainId = await provider.request({ method: "eth_chainId" });
  } catch (_) {}
  if (String(chainId).toLowerCase() === STUDIO_CHAIN_ID_HEX) return true;
  const switchParams = [{ chainId: STUDIO_CHAIN_ID_HEX }];
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: switchParams });
    return true;
  } catch (switchErr) {
    const code = Number(switchErr?.code ?? switchErr?.data?.originalError?.code);
    const msg = errMsg(switchErr);
    if (code === 4902 || code === -32603 || /unrecognized\s*chain|not\s*added/i.test(msg)) {
      try {
        await provider.request({ method: "wallet_addEthereumChain", params: [STUDIO_CHAIN_PARAMS] });
        await provider.request({ method: "wallet_switchEthereumChain", params: switchParams });
        return true;
      } catch (_) {
        toast("info", "Could not add the GenLayer Studio network to your wallet — add chain 61999 manually. Writes may fail until then.", 9000);
        return false;
      }
    }
    toast("info", "Network switch not confirmed — writes need the GenLayer Studio network (chain 61999).", 8000);
    return false;
  }
}

let walletEventsBound = false;

function bindWalletEvents(provider) {
  if (!provider || walletEventsBound || typeof provider.on !== "function") return;
  walletEventsBound = true;
  provider.on("accountsChanged", handleAccountsChanged);
  provider.on("chainChanged", handleChainChanged);
}

function handleAccountsChanged(accounts) {
  if (!state.conn) return;
  writeClient = null;
  writeClientAddress = "";
  const next = Array.isArray(accounts) ? accounts.filter(Boolean) : [];
  if (!next.length) {
    sessionStorage.removeItem(CONN_KEY);
    renderKeyPanel();
    renderProposals();
    toast("info", "Wallet disconnected — no authorized accounts remain.");
    return;
  }
  if (next[0].toLowerCase() !== String(state.conn.address).toLowerCase()) {
    state.conn = { mode: "wallet", address: next[0] };
    sessionStorage.setItem(CONN_KEY, JSON.stringify(state.conn));
    renderKeyPanel();
    renderProposals();
    toast("info", `Wallet account switched to ${shortAddress(next[0])}.`);
  }
}

function handleChainChanged(chainId) {
  if (!state.conn) return;
  writeClient = null;
  writeClientAddress = "";
  if (String(chainId).toLowerCase() !== STUDIO_CHAIN_ID_HEX) {
    toast("info", `Wallet moved to chain ${chainId} — switch back to GenLayer Studio (61999) before writing.`, 8000);
  }
}

async function connectWallet() {
  const provider = window.ethereum;
  if (!provider) {
    toast("err", "No wallet found — install MetaMask to submit or check proposals.", 8000);
    return;
  }
  let accounts;
  try {
    accounts = await provider.request({ method: "eth_requestAccounts" });
  } catch (err) {
    toast("err", `Wallet request failed: ${errMsg(err)}`, 7000);
    return;
  }
  const address = Array.isArray(accounts) ? accounts[0] : null;
  if (!address) {
    toast("err", "No account was authorized in the wallet.");
    return;
  }
  const networkReady = await ensureStudioNetwork(provider);
  if (!networkReady) {
    toast("err", "Wallet connection stopped because the GenLayer Studio network was not confirmed.", 9000);
    return;
  }
  sessionStorage.setItem(CONN_KEY, JSON.stringify({ mode: "wallet", address }));
  bindWalletEvents(provider);
  renderKeyPanel();
  renderProposals();
  toast("ok", `Wallet connected — acting as ${shortAddress(address)}.`);
}

function handleDisconnect() {
  sessionStorage.removeItem(CONN_KEY);
  writeClient = null;
  writeClientAddress = "";
  renderKeyPanel();
  renderProposals();
  toast("info", "Disconnected — wallet session cleared.");
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

function setFilter(filter) {
  state.filter = filter;
  document.querySelectorAll("#filters .chip").forEach((c) => c.classList.toggle("chip-active", c.dataset.filter === filter));
}

function syncCounters() {
  $("count-title").textContent = $("input-title").value.length;
  $("count-body").textContent = $("input-body").value.length;
}

document.addEventListener("DOMContentLoaded", async () => {
  $("footer-address").textContent = isConfiguredAddress(CONFIG.CONTRACT_ADDRESS)
    ? CONFIG.CONTRACT_ADDRESS
    : "not configured";

  $("proposal-form").addEventListener("submit", handleSubmit);
  $("btn-connect-wallet").addEventListener("click", connectWallet);
  $("btn-disconnect").addEventListener("click", handleDisconnect);
  $("btn-copy-address").addEventListener("click", () => {
    if (state.conn) copyText(state.conn.address, "Address copied.");
  });
  $("btn-footer-copy").addEventListener("click", () => copyText(CONFIG.CONTRACT_ADDRESS, "Contract address copied."));
  $("btn-refresh").addEventListener("click", refreshAll);
  $("btn-update-constitution").addEventListener("click", handleUpdateConstitution);
  $("btn-reset-check").addEventListener("click", handleResetCheck);
  $("btn-stage-ownership").addEventListener("click", handleStageOwnership);
  $("btn-accept-ownership").addEventListener("click", handleAcceptOwnership);
  $("registry-search").addEventListener("input", renderRegistry);
  $("registry-kind").addEventListener("change", renderRegistry);
  $("btn-notifications").addEventListener("click", enableNotifications);
  $("btn-registry-refresh").addEventListener("click", async () => {
    await refreshRegistry({ fresh: true });
    renderRegistry();
  });

  $("btn-toggle-history").addEventListener("click", () => {
    const drawer = $("history-drawer");
    const open = drawer.hidden;
    drawer.hidden = !open;
    $("btn-toggle-history").setAttribute("aria-expanded", String(open));
    $("btn-toggle-history").textContent = open ? "Version history ▴" : "Version history ▾";
  });

  document.querySelectorAll("#filters .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      setFilter(chip.dataset.filter);
      renderProposals();
    });
  });

  $("input-title").addEventListener("input", syncCounters);
  $("input-body").addEventListener("input", syncCounters);

  if (window.ethereum) bindWalletEvents(window.ethereum);

  renderKeyPanel();
  await refreshAll();
  window.setInterval(async () => {
    if (document.visibilityState !== "visible") return;
    await refreshRegistry({ fresh: false, notify: true });
    renderRegistry();
  }, 60_000);
});

async function refreshAll() {
  try {
    await refreshFromChain();
  } catch (err) {
    console.warn("StudioNet read failed:", err);
    Object.assign(state, {
      constitution: "",
      constitutionVersions: [],
      versionCount: 0,
      proposals: [],
      stats: null,
      live: false,
      owner: "",
      pendingOwner: "",
      ballots: [],
    });
    toast(
      "err",
      RPC_CONFIGURED
        ? "StudioNet is unreachable. No local records are being substituted."
        : "RPC or contract address is not configured.",
      7000
    );
  }
  await refreshRegistry({ fresh: true });
  renderAll();
}
