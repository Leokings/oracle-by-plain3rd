/* ==========================================================================
 * TruthFeed frontend — wired to studionet via vendored genlayer-js.
 *
 * Reads window.TruthFeedConfig (see config.example.js -> config.js).
 * Reads: client.readContract (get_stats / list_questions / get_question).
 * Writes: client.writeContract signed through an EIP-1193 browser wallet
 * (MetaMask) — Connect Wallet is the ONLY write path. The connected address
 * is kept in sessionStorage ("tf_conn", tab-only) and cleared on Disconnect,
 * then waitForTransactionReceipt until FINALIZED. Receipt ACCEPTED/FINALIZED
 * does not imply contract success, so FINISHED_WITH_ERROR payloads surface.
 * If the chain is unreachable, the app shows an explicit unavailable state.
 * ========================================================================== */

import { createClient, chains } from "genlayer-js";
import {
  isConfiguredAddress,
  isConfiguredRpcUrl,
  receiptFailure,
  receiptStatusName,
} from "./tx-utils.js";

const config = window.TruthFeedConfig || {};
const CONTRACT_ADDRESS = String(config.CONTRACT_ADDRESS || "");
const RPC_URL = String(config.RPC_URL || "").trim();
const REGISTRY_API_BASE = String(config.REGISTRY_API_BASE || "").replace(/\/$/, "");
const TRUTH_DECISION_KIND = "truthfeed.question.v3";
const RPC_CONFIGURED = isConfiguredAddress(CONTRACT_ADDRESS) && isConfiguredRpcUrl(RPC_URL);
const CONN_STORAGE_KEY = "tf_conn";
const STUDIO_CHAIN_ID_HEX = "0xf22f";
const STUDIO_CHAIN_PARAMS = {
  chainId: STUDIO_CHAIN_ID_HEX,
  chainName: "Genlayer Studio Network",
  rpcUrls: [isConfiguredRpcUrl(RPC_URL) ? RPC_URL : "https://studio.genlayer.com/api"],
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
};
let registryByCase = new Map();

function registryUrl(path) {
  return `${REGISTRY_API_BASE}${path}`;
}

async function registerTransaction(hash, caseId, operation) {
  if (!REGISTRY_API_BASE || !hash || !caseId) return;
  try {
    const response = await fetch(registryUrl("/api/transactions"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        hash,
        kind: TRUTH_DECISION_KIND,
        case_id: caseId,
        operation,
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    console.warn("Decision Registry transaction update failed; chain write is unaffected:", error);
  }
}

async function refreshRegistryIndex({ fresh = false } = {}) {
  if (!REGISTRY_API_BASE) return;
  try {
    const response = await fetch(
      registryUrl(`/api/registry?kind=${encodeURIComponent(TRUTH_DECISION_KIND)}&fresh=${fresh ? "1" : "0"}&limit=100`)
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    registryByCase = new Map((result.items || []).map((item) => [item.case_id, item]));
  } catch (error) {
    console.warn("Decision Registry read failed; TruthFeed remains available on-chain:", error);
  }
}

/* ------------------------------ Chain client ---------------------------- */

let _readClient = null;
let _writeClient = null;
let _writeClientAddress = "";

function getReadClient() {
  if (!_readClient) {
    _readClient = createClient({ chain: chains.studionet, endpoint: RPC_URL });
  }
  return _readClient;
}

function getWriteClient(address, provider) {
  if (!_writeClient || _writeClientAddress.toLowerCase() !== String(address).toLowerCase()) {
    _writeClient = createClient({
      chain: chains.studionet,
      endpoint: RPC_URL,
      account: address,
      provider,
    });
    _writeClientAddress = String(address);
  }
  return _writeClient;
}

/** Read-only contract call. Returns the parsed result object. */
async function rpcView(method, args) {
  if (!RPC_CONFIGURED) throw new Error("RPC not configured (config.js missing or placeholder)");
  try {
    return await getReadClient().readContract({
      address: CONTRACT_ADDRESS,
      functionName: method,
      args,
    });
  } catch (err) {
    throw new Error(`RPC read failed (${method}): ${err && err.shortMessage ? err.shortMessage : err.message || err}`);
  }
}

function errMsg(err) {
  return String(err?.message || err?.shortMessage || err);
}

/**
 * Write call. Returns { hash, receipt }. Polls to FINALIZED; throws with the
 * contract's error payload when execution finished with an error.
 */
async function rpcWrite(method, args) {
  if (!RPC_CONFIGURED) throw new Error("RPC not configured (config.js missing or placeholder)");
  const conn = readStoredConnection();
  if (!conn) {
    throw new Error("Connect your wallet first — Connect Wallet is the only way to sign transactions.");
  }
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

  const client = getWriteClient(conn.address, provider);
  let hash;
  try {
    hash = await client.writeContract({ address: CONTRACT_ADDRESS, functionName: method, args });
  } catch (err) {
    throw new Error(
      `RPC write failed (${method}): ${errMsg(err)} — Check that MetaMask is unlocked and on the GenLayer Studio network.`
    );
  }

  toast("info", `Transaction submitted — waiting for validator consensus…`, { hash });

  let receipt;
  try {
    receipt = await client.waitForTransactionReceipt({ hash, status: "FINALIZED", interval: 3000, retries: 100 });
  } catch (err) {
    showTxStatus(hash, "PENDING");
    throw new Error(`Consensus wait timed out for ${shortHash(hash)} — check back and refresh. (${err.message || err})`);
  }

  const statusName = receiptStatusName(receipt);
  showTxStatus(hash, statusName);

  const failure = receiptFailure(receipt);
  if (failure) throw new Error(`${failure} (tx ${shortHash(hash)})`);
  return { hash, receipt };
}

function shortHash(hash) {
  const h = String(hash || "");
  return h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h;
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/* ------------------------------ Data access ----------------------------- */

let liveAvailable = false;

export function currentMode() {
  return "live";
}

async function fetchStats() {
  return rpcView("get_stats", []);
}

async function fetchQuestions() {
  const res = await rpcView("list_questions", [0, 50]);
  return { total: Number(res.total ?? 0), items: res.items || [] };
}

function makeQuestionId(text) {
  return "q-" + Date.now().toString(36) + "-" + hashCode(text + Math.random()).toString(36);
}

/**
 * sources MUST be passed as a string prefixed with "json:" — the CLI/tooling
 * auto-parse quirk this deployment expects.
 */
async function submitQuestion({ text, criteria, sources, resolveNotBefore }) {
  const id = makeQuestionId(text);
  const sourcePack = "json:" + JSON.stringify(sources);
  let transaction;
  if (resolveNotBefore) {
    transaction = await rpcWrite("create_question_scheduled", [id, text, criteria, sourcePack, resolveNotBefore]);
  } else {
    transaction = await rpcWrite("create_question", [id, text, criteria, sourcePack]);
  }
  await registerTransaction(transaction.hash, id, resolveNotBefore ? "create_question_scheduled" : "create_question");
  await refreshRegistryIndex({ fresh: true });
  return id;
}

async function resolveQuestion(id) {
  const transaction = await rpcWrite("resolve_question", [id]);
  await registerTransaction(transaction.hash, id, "resolve_question");
  await refreshRegistryIndex({ fresh: true });
  return transaction;
}

async function voidQuestion(id) {
  const transaction = await rpcWrite("void_question", [id]);
  await registerTransaction(transaction.hash, id, "void_question");
  await refreshRegistryIndex({ fresh: true });
  return transaction;
}

async function reopenQuestion(id, reason, replacementSources = []) {
  const method = replacementSources.length ? "request_recheck_with_sources" : "request_recheck";
  const args = replacementSources.length
    ? [id, reason, "json:" + JSON.stringify(replacementSources)]
    : [id, reason];
  const transaction = await rpcWrite(method, args);
  await registerTransaction(transaction.hash, id, method);
  await refreshRegistryIndex({ fresh: true });
  return transaction;
}

/* ------------------------------ Rendering ------------------------------- */

const feedEl = document.getElementById("feed");
const formErrorEl = document.getElementById("form-error");
const netStatusEl = document.getElementById("net-status");
const statChipsEl = document.getElementById("stat-chips");

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value == null ? "" : String(value);
  return div.innerHTML;
}

/* ------------------------------ Toasts ---------------------------------- */

const toastRoot = document.getElementById("toast-root");

function toast(type, message, opts = {}) {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.innerHTML =
    `<span class="toast-msg">${escapeHtml(message)}</span>` +
    (opts.hash ? `<button class="linklike mono toast-hash" type="button">copy tx</button>` : "") +
    `<button class="icon-btn toast-close" type="button" aria-label="Dismiss">&times;</button>`;
  if (opts.hash) {
    el.querySelector(".toast-hash").addEventListener("click", () => copyText(opts.hash, el.querySelector(".toast-hash")));
  }
  el.querySelector(".toast-close").addEventListener("click", () => dismiss());
  toastRoot.appendChild(el);
  const timer = setTimeout(dismiss, opts.sticky ? 12000 : 6000);
  function dismiss() {
    clearTimeout(timer);
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 200);
  }
}

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    if (btn) {
      const old = btn.textContent;
      btn.textContent = "copied!";
      setTimeout(() => (btn.textContent = old), 1200);
    }
  } catch {
    /* clipboard unavailable */
  }
}

/* ------------------------------ Status pill ----------------------------- */

function renderNetPill() {
  netStatusEl.classList.remove("pill-live", "pill-checking");
  if (!RPC_CONFIGURED) {
    netStatusEl.classList.add("pill-checking");
    netStatusEl.innerHTML = '<span class="pill-dot"></span>NOT CONFIGURED';
    netStatusEl.title = "StudioNet configuration is missing";
    return;
  }
  if (liveAvailable) {
    netStatusEl.classList.add("pill-live");
    netStatusEl.innerHTML = '<span class="pill-dot"></span>LIVE';
    netStatusEl.title = `${RPC_URL_DISPLAY} · ${CONTRACT_ADDRESS}`;
  } else {
    netStatusEl.classList.add("pill-checking");
    netStatusEl.innerHTML = '<span class="pill-dot"></span>STUDIONET UNAVAILABLE';
    netStatusEl.title = "The configured StudioNet endpoint could not be reached";
  }
}

const RPC_URL_DISPLAY = String(config.RPC_URL || "").replace(/^https?:\/\//, "");

/* ------------------------------ Stats chips ----------------------------- */

async function refreshStats() {
  statChipsEl.replaceChildren(...chipSkeletons(3));
  try {
    const stats = await fetchStats();
    const chip = (label, value) =>
      htmlToNode(`<span class="chip"><strong>${escapeHtml(value)}</strong> ${escapeHtml(label)}</span>`);
    const chips = [chip("questions asked", Number(stats.created ?? 0)), chip("resolved", Number(stats.resolved ?? 0))];
    if (stats.voided !== undefined) chips.push(chip("voided", Number(stats.voided ?? 0)));
    if (stats.reopened !== undefined) chips.push(chip("rechecks", Number(stats.reopened ?? 0)));
    statChipsEl.replaceChildren(...chips);
  } catch {
    statChipsEl.replaceChildren(htmlToNode('<span class="chip">stats unavailable</span>'));
  }
}

function htmlToNode(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html.trim();
  return tpl.content.firstChild;
}

function chipSkeletons(n) {
  return Array.from({ length: n }, () => htmlToNode('<span class="chip chip-skeleton"></span>'));
}

/* ------------------------------ Feed cards ------------------------------ */

function badgeFor(q) {
  if (q.status === "void") return '<span class="badge badge-void">VOID</span>';
  if (q.status === "resolved") {
    if (q.outcome === "yes") return '<span class="badge badge-yes">YES</span>';
    if (q.outcome === "no") return '<span class="badge badge-no">NO</span>';
    return '<span class="badge badge-unclear">UNCLEAR</span>';
  }
  return '<span class="badge badge-open">OPEN</span>';
}

function skeletonCards(n) {
  return Array.from({ length: n }, (_, i) =>
    htmlToNode(
      `<article class="card q-card skeleton-card" aria-hidden="true">
        <div class="sk sk-badge"></div>
        <div class="sk sk-line w80"></div>
        <div class="sk sk-line w60"></div>
        <div class="sk sk-line w70"></div>
        ${i === 0 ? '<div class="sk sk-block"></div>' : ""}
      </article>`
    )
  );
}

const EMPTY_STATE_HTML =
  `<div class="empty-state card">
    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.6"/>
      <path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M8.5 11h5M8.5 13.5h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    </svg>
    <h3>No questions yet</h3>
    <p>Be the first to ask &mdash; post a yes/no question with sources above.</p>
  </div>`;

function questionCard(q) {
  const wallet = readStoredConnection();
  const isCreator = Boolean(
    wallet && q.creator && wallet.address.toLowerCase() === String(q.creator).toLowerCase()
  );
  const card = document.createElement("article");
  card.className = "card q-card" + (q.status === "void" ? " is-void" : "");
  card.dataset.id = q.id;

  const meta = htmlToNode(
    `<div class="q-meta">${badgeFor(q)}<span class="meta-id mono" title="Question id">${escapeHtml(q.id)}</span><span class="meta-date">${escapeHtml((q.created_at || "").slice(0, 16).replace("T", " "))}</span></div>`
  );
  card.appendChild(meta);

  const title = document.createElement("h3");
  title.className = "q-title";
  title.textContent = q.text;
  card.appendChild(title);

  if (q.criteria) {
    const crit = document.createElement("p");
    crit.className = "q-criteria";
    crit.textContent = q.criteria;
    card.appendChild(crit);
  }

  if (Array.isArray(q.sources) && q.sources.length) {
    const list = document.createElement("ul");
    list.className = "q-sources";
    q.sources.forEach((url, index) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = `Source ${index + 1}: ${url.replace(/^https?:\/\//, "")}`;
      a.title = url;
      li.appendChild(a);
      list.appendChild(li);
    });
    card.appendChild(list);
  }

  if (q.status === "resolved" && Array.isArray(q.citations) && q.citations.length) {
    const evidence = document.createElement("p");
    evidence.className = "q-resolved-at";
    evidence.textContent = `Consensus evidence: source${q.citations.length === 1 ? "" : "s"} ${q.citations.join(", ")}.`;
    card.appendChild(evidence);
  }

  if (q.status === "resolved" && q.reasoning) {
    card.appendChild(
      htmlToNode(
        `<blockquote class="q-reasoning"><footer>Leader rationale · not a consensus field</footer>${escapeHtml(q.reasoning)}</blockquote>`
      )
    );
    if (q.resolved_at) {
      card.appendChild(htmlToNode(`<p class="q-resolved-at">resolved ${escapeHtml(String(q.resolved_at).slice(0, 16).replace("T", " "))}</p>`));
    }
  }

  const history = Array.isArray(q.history) ? q.history : [];
  if (history.length > 1) {
    const details = document.createElement("details");
    details.className = "q-history";
    const summary = document.createElement("summary");
    summary.textContent = `${history.length} completed resolution rounds`;
    const list = document.createElement("ol");
    for (const decision of history) {
      const item = document.createElement("li");
      const refs = Array.isArray(decision.citations) && decision.citations.length
        ? ` · sources ${decision.citations.join(", ")}`
        : "";
      item.textContent = `Round ${decision.round}: ${String(decision.outcome || "").toUpperCase()}${refs}`;
      list.appendChild(item);
    }
    details.append(summary, list);
    card.appendChild(details);
  }

  const registryRecord = registryByCase.get(q.id);
  if (registryRecord) {
    const finality = document.createElement("div");
    finality.className = "q-finality";
    const badge = document.createElement("span");
    badge.className = `badge ${registryRecord.finality?.final ? "badge-yes" : "badge-open"}`;
    badge.textContent = registryRecord.finality?.label || "Finality unknown";
    const text = document.createElement("span");
    text.className = "text-muted";
    text.textContent = registryRecord.transaction
      ? `latest tracked ${registryRecord.transaction.operation} transaction`
      : "No transaction hash linked to this index entry yet.";
    finality.append(badge, text);
    card.appendChild(finality);
  }

  if (q.status === "open") {
    const notBefore = Number(q.resolve_not_before || 0) * 1000;
    const isScheduled = notBefore > Date.now();
    const actions = htmlToNode(`<div class="q-actions">
      <button class="btn btn-primary btn-sm btn-resolve" type="button"><span class="btn-spinner spinner hidden" aria-hidden="true"></span><span class="btn-label">${isScheduled ? "Resolution scheduled" : "Resolve"}</span></button>
      <button class="btn btn-danger-ghost btn-sm btn-void" type="button" title="Question creator only">Void</button>
      <span class="judging hidden" role="status">validators are judging&hellip;</span>
    </div>`);
    const resolveBtn = actions.querySelector(".btn-resolve");
    resolveBtn.disabled = isScheduled;
    if (isScheduled) {
      resolveBtn.title = `Available ${new Date(notBefore).toLocaleString()}`;
      const schedule = document.createElement("p");
      schedule.className = "q-resolved-at";
      schedule.textContent = `Can be resolved after ${new Date(notBefore).toLocaleString()}.`;
      card.appendChild(schedule);
    }
    resolveBtn.addEventListener("click", (e) => handleResolve(e.currentTarget, q.id));
    const voidBtn = actions.querySelector(".btn-void");
    voidBtn.hidden = !isCreator;
    voidBtn.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await voidQuestion(q.id);
        toast("success", "Question voided.");
        await refreshAll();
      } catch (err) {
        showError(err.message || String(err));
        btn.disabled = false;
      }
    });
    card.appendChild(actions);
  }

  if (q.status === "resolved" && isCreator) {
    const actions = document.createElement("div");
    actions.className = "q-actions";
    const recheck = document.createElement("button");
    recheck.className = "btn btn-ghost btn-sm";
    recheck.type = "button";
    recheck.textContent = "Request re-resolution";
    recheck.title = "Available to the question creator";
    recheck.addEventListener("click", async () => {
      const reason = window.prompt(
        "Why should validators resolve this question again? This reason will be stored on-chain.",
        "New or corrected evidence should be considered."
      );
      if (reason === null) return;
      if (!reason.trim()) {
        showError("A written recheck reason is required.");
        return;
      }
      const replacementText = window.prompt(
        "Optional: paste replacement HTTPS evidence URLs separated by commas or new lines. Leave blank to keep the current sources.",
        ""
      );
      const replacementSources = String(replacementText || "")
        .split(/[\n,]+/)
        .map((value) => value.trim())
        .filter(Boolean);
      if (
        replacementSources.length > 5 ||
        replacementSources.some((value) => !/^https:\/\/\S+$/i.test(value)) ||
        new Set(replacementSources).size !== replacementSources.length
      ) {
        showError("Replacement evidence must contain at most five unique HTTPS URLs.");
        return;
      }
      recheck.disabled = true;
      try {
        await reopenQuestion(q.id, reason.trim(), replacementSources);
        toast("success", "Question reopened with a reason; its earlier decision remains in history.");
        await refreshAll();
      } catch (err) {
        showError(err.message || String(err));
        recheck.disabled = false;
      }
    });
    actions.appendChild(recheck);
    card.appendChild(actions);
  }

  return card;
}

async function handleResolve(btn, id) {
  const spinner = btn.querySelector(".btn-spinner");
  const label = btn.querySelector(".btn-label");
  const judging = btn.parentElement.querySelector(".judging");
  btn.disabled = true;
  spinner.classList.remove("hidden");
  label.textContent = "Resolving…";
  judging.classList.remove("hidden");

  try {
    await resolveQuestion(id);
    spinner.classList.add("hidden");
    judging.classList.add("hidden");
    label.textContent = "Resolved";
    toast("success", "Outcome settled on-chain.");
    await refreshAll();
  } catch (err) {
    spinner.classList.add("hidden");
    judging.classList.add("hidden");
    btn.disabled = false;
    label.textContent = "Resolve";
    showError(err.message || String(err));
  }
}

async function renderFeed() {
  feedEl.replaceChildren(...skeletonCards(3));
  try {
    const { total, items } = await fetchQuestions();
    if (!items.length) {
      feedEl.innerHTML = EMPTY_STATE_HTML;
      return;
    }
    feedEl.replaceChildren(...items.map(questionCard));
    if (total > items.length) {
      feedEl.appendChild(
        htmlToNode(`<p class="feed-more">Showing ${items.length} of ${total} questions.</p>`)
      );
    }
  } catch (err) {
    feedEl.replaceChildren(
      htmlToNode(`<div class="empty-state card"><h3>Failed to load feed</h3><p>${escapeHtml(err.message || String(err))}</p></div>`)
    );
  }
}

async function refreshAll() {
  await refreshRegistryIndex({ fresh: false });
  await Promise.all([refreshStats(), renderFeed()]);
}

/* ------------------------------ Tx status line -------------------------- */

function showTxStatus(hash, statusName) {
  const s = String(statusName || "").toUpperCase();
  const type = s.includes("ERROR") || s === "REVERTED" ? "error" : s === "FINALIZED" ? "success" : "info";
  toast(type, `tx ${shortHash(hash)} · ${s}`, { hash, sticky: type === "error" });
}

/* ------------------------------ Wallet connection ----------------------- */

const connectWalletBtn = document.getElementById("connect-wallet-btn");
const connChipEl = document.getElementById("conn-chip");
const connAddressEl = document.getElementById("conn-address");
const disconnectBtn = document.getElementById("disconnect-btn");

let conn = null;

function shortAddress(addr) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "";
}

function readStoredConnection() {
  try {
    const raw = sessionStorage.getItem(CONN_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.mode === "wallet" && typeof parsed.address === "string" && parsed.address) {
        return { mode: "wallet", address: parsed.address };
      }
      sessionStorage.removeItem(CONN_STORAGE_KEY);
    }
  } catch (_) {
    try {
      sessionStorage.removeItem(CONN_STORAGE_KEY);
    } catch {}
  }
  return null;
}

function renderConnection() {
  conn = readStoredConnection();
  const connected = Boolean(conn);
  connectWalletBtn.hidden = connected;
  connChipEl.hidden = !connected;
  disconnectBtn.hidden = !connected;
  if (connected) {
    connAddressEl.textContent = shortAddress(conn.address);
    connChipEl.title = conn.address;
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
        toast("warning", "Could not add the GenLayer Studio network to your wallet — add chain 61999 manually. Writes may fail until then.", { sticky: true });
        return false;
      }
    }
    toast("warning", "Network switch not confirmed — writes need the GenLayer Studio network (chain 61999).", { sticky: true });
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
  if (!conn) return;
  _writeClient = null;
  _writeClientAddress = "";
  const next = Array.isArray(accounts) ? accounts.filter(Boolean) : [];
  if (!next.length) {
    conn = null;
    try {
      sessionStorage.removeItem(CONN_STORAGE_KEY);
    } catch {}
    renderConnection();
    toast("info", "Wallet disconnected — no authorized accounts remain.");
    return;
  }
  if (next[0].toLowerCase() !== String(conn.address).toLowerCase()) {
    conn = { mode: "wallet", address: next[0] };
    sessionStorage.setItem(CONN_STORAGE_KEY, JSON.stringify(conn));
    renderConnection();
    toast("info", `Wallet account switched to ${shortAddress(next[0])}.`);
  }
}

function handleChainChanged(chainId) {
  if (!conn) return;
  _writeClient = null;
  _writeClientAddress = "";
  if (String(chainId).toLowerCase() !== STUDIO_CHAIN_ID_HEX) {
    toast("warning", `Wallet moved to chain ${chainId} — switch back to GenLayer Studio (61999) before writing.`, { sticky: true });
  }
}

async function connectWallet() {
  const provider = window.ethereum;
  if (!provider) {
    toast("error", "No wallet found — install MetaMask.", { sticky: true });
    return;
  }
  let accounts;
  try {
    accounts = await provider.request({ method: "eth_requestAccounts" });
  } catch (err) {
    toast("error", `Wallet request failed: ${errMsg(err)}`);
    return;
  }
  const address = Array.isArray(accounts) ? accounts[0] : null;
  if (!address) {
    toast("error", "No account was authorized in the wallet.");
    return;
  }
  const networkReady = await ensureStudioNetwork(provider);
  if (!networkReady) {
    toast("error", "Wallet connection stopped because the GenLayer Studio network was not confirmed.", { sticky: true });
    return;
  }
  conn = { mode: "wallet", address };
  sessionStorage.setItem(CONN_STORAGE_KEY, JSON.stringify(conn));
  bindWalletEvents(provider);
  renderConnection();
  toast("success", `Wallet connected — acting as ${shortAddress(address)}.`);
}

function handleDisconnect() {
  conn = null;
  _writeClient = null;
  _writeClientAddress = "";
  try {
    sessionStorage.removeItem(CONN_STORAGE_KEY);
  } catch {}
  renderConnection();
  toast("info", "Disconnected — wallet session cleared.");
}

connectWalletBtn.addEventListener("click", () => connectWallet());
disconnectBtn.addEventListener("click", () => handleDisconnect());

/* ------------------------------ Ask form -------------------------------- */

const sourceInputsEl = document.getElementById("source-inputs");
const MAX_SOURCES = 5;

function addSourceRow(value = "") {
  if (sourceInputsEl.children.length >= MAX_SOURCES) return;
  const row = htmlToNode(
    `<div class="source-row">
      <input class="source-url" type="url" inputmode="url" maxlength="2048" placeholder="https://example.com/page" value="${escapeHtml(value)}" />
      <button class="icon-btn source-remove" type="button" aria-label="Remove source">&times;</button>
    </div>`
  );
  row.querySelector(".source-remove").addEventListener("click", () => {
    if (sourceInputsEl.children.length > 1) row.remove();
  });
  sourceInputsEl.appendChild(row);
}

addSourceRow();

document.getElementById("add-source").addEventListener("click", () => {
  addSourceRow();
  const rows = sourceInputsEl.querySelectorAll(".source-url");
  rows[rows.length - 1]?.focus();
});

document.getElementById("ask-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  formErrorEl.textContent = "";

  const text = document.getElementById("q-text").value.trim();
  const criteria = document.getElementById("q-criteria").value.trim();
  const resolveAfterValue = document.getElementById("q-resolve-after").value;
  const sources = Array.from(document.querySelectorAll(".source-url"))
    .map((input) => input.value.trim())
    .filter(Boolean);

  if (!text || !criteria) {
    formErrorEl.textContent = "[EXPECTED] Question and criteria are required.";
    return;
  }
  if (!conn) {
    formErrorEl.textContent = "Connect your wallet first — Connect Wallet is the only way to sign transactions.";
    return;
  }
  if (sources.length < 1 || sources.length > MAX_SOURCES) {
    formErrorEl.textContent = `[EXPECTED] Provide between 1 and ${MAX_SOURCES} source URLs.`;
    return;
  }
  const bad = sources.find((u) => !/^https:\/\/\S+$/i.test(u));
  if (bad) {
    formErrorEl.textContent = `[EXPECTED] Sources must be HTTPS URLs — got: ${bad.slice(0, 60)}`;
    return;
  }
  if (new Set(sources).size !== sources.length) {
    formErrorEl.textContent = "[EXPECTED] Each source URL must be unique.";
    return;
  }

  let resolveNotBefore = 0;
  if (resolveAfterValue) {
    const timestampMs = Date.parse(resolveAfterValue);
    if (!Number.isFinite(timestampMs) || timestampMs <= Date.now()) {
      formErrorEl.textContent = "[EXPECTED] Scheduled resolution must be in the future.";
      return;
    }
    if (timestampMs > Date.now() + 365 * 24 * 60 * 60 * 1000) {
      formErrorEl.textContent = "[EXPECTED] Scheduled resolution cannot be more than one year away.";
      return;
    }
    resolveNotBefore = Math.floor(timestampMs / 1000);
  }

  const submitBtn = document.getElementById("ask-submit");
  const spin = submitBtn.querySelector(".btn-spinner");
  const label = submitBtn.querySelector(".btn-label");
  submitBtn.disabled = true;
  spin.classList.remove("hidden");
  label.textContent = "Posting on-chain…";

  try {
    await submitQuestion({ text, criteria, sources, resolveNotBefore });
    event.target.reset();
    while (sourceInputsEl.children.length > 1) sourceInputsEl.lastChild.remove();
    toast("success", "Question posted — waiting for consensus.");
    await refreshAll();
  } catch (err) {
    formErrorEl.textContent = err.message || String(err);
  } finally {
    submitBtn.disabled = false;
    spin.classList.add("hidden");
    label.textContent = "Post question";
  }
});

let errorTimer = null;
function showError(message) {
  formErrorEl.textContent = message;
  toast("error", message);
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => (formErrorEl.textContent = ""), 6000);
}

document.getElementById("refresh-btn").addEventListener("click", () => refreshAll());

const contractCopyButton = document.getElementById("contract-copy");
contractCopyButton.dataset.address = CONTRACT_ADDRESS;
contractCopyButton.textContent = isConfiguredAddress(CONTRACT_ADDRESS)
  ? `${CONTRACT_ADDRESS.slice(0, 8)}…${CONTRACT_ADDRESS.slice(-4)}`
  : "not configured";
contractCopyButton.addEventListener("click", (e) => {
  copyText(e.currentTarget.dataset.address, e.currentTarget);
});

/* ------------------------------ Boot ------------------------------------ */

(async function boot() {
  if (window.ethereum) bindWalletEvents(window.ethereum);
  renderConnection();
  renderNetPill();

  // Probe the configured StudioNet contract before rendering its records.
  if (RPC_CONFIGURED) {
    try {
      await Promise.race([
        rpcView("get_stats", []),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000)),
      ]);
      liveAvailable = true;
    } catch {
      liveAvailable = false;
      toast("error", "StudioNet is unreachable. No local records are being substituted.");
    }
  }

  renderNetPill();
  await refreshAll();
})();
