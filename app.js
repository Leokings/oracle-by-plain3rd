import { createClient, chains } from "genlayer-js";
import { inject } from "@vercel/analytics";
import { injectSpeedInsights } from "@vercel/speed-insights";

import {
  LIVING_KIND,
  TRUTH_KIND,
  createCaseId,
  evidenceSnapshotCurrent,
  finalityLabel,
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
  walletConnectionErrorMessage,
} from "./product-utils.js";
import {
  isConfiguredAddress,
  isConfiguredRpcUrl,
  receiptFailure,
  receiptStatusName,
} from "./tx-utils.js";


const CONFIG = Object.assign(
  {
    RPC_URL: "",
    LIVING_CONTRACT_ADDRESS: "",
    TRUTH_CONTRACT_ADDRESS: "",
    REGISTRY_API_BASE: "",
  },
  window.OracleConfig || {},
);

const STUDIO_CHAIN_ID_HEX = "0xf22f";
const STUDIO_CHAIN_PARAMS = {
  chainId: STUDIO_CHAIN_ID_HEX,
  chainName: "GenLayer Studio Network",
  rpcUrls: [CONFIG.RPC_URL || "https://studio.genlayer.com/api"],
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
};
const WALLET_KEY = "oracle_wallet_v2";
const TRANSACTION_KEY = "oracle_transactions_v2";
const PAGE_SIZE = 50;
const INITIAL_VISIBLE = 12;
const VISIBLE_STEP = 12;
const TRANSACTION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SOURCES = 5;
const PAGE = document.body.dataset.page || "home";
const IS_LOCAL = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
const CONFIGURED =
  isConfiguredRpcUrl(CONFIG.RPC_URL) &&
  isConfiguredAddress(CONFIG.LIVING_CONTRACT_ADDRESS) &&
  isConfiguredAddress(CONFIG.TRUTH_CONTRACT_ADDRESS) &&
  /^https:\/\//.test(String(CONFIG.REGISTRY_API_BASE || ""));

if (!IS_LOCAL) {
  inject({ mode: "production" });
  injectSpeedInsights({ debug: false });
}

const state = {
  wallet: null,
  owner: "",
  truthOwner: "",
  constitution: "",
  constitutionVersion: 0,
  questions: [],
  questionTotal: 0,
  questionOffset: 0,
  questionVisible: INITIAL_VISIBLE,
  proposals: [],
  proposalTotal: 0,
  proposalOffset: 0,
  proposalVisible: INITIAL_VISIBLE,
  ballots: [],
  ballotOffset: 0,
  registry: [],
  registryWarning: "",
};

const readClient = CONFIGURED
  ? createClient({ chain: chains.studionet, endpoint: CONFIG.RPC_URL })
  : null;
let writeClient = null;
let writeClientAddress = "";
let walletEventsBound = false;
let walletConnectInFlight = false;
let volatileTrackedTransactions = [];
let trackedStorageAvailable = true;

const $ = (id) => document.getElementById(id);

function errMsg(error) {
  return String(error?.shortMessage || error?.message || error || "Unknown error");
}

function toast(type, message, timeout = 6500) {
  const item = document.createElement("div");
  item.className = `toast toast-${type}`;
  item.setAttribute("role", type === "error" ? "alert" : "status");
  const text = document.createElement("span");
  text.textContent = message;
  const close = document.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "Dismiss notification");
  close.textContent = "×";
  close.addEventListener("click", () => item.remove());
  item.append(text, close);
  $("toast-root").appendChild(item);
  window.setTimeout(() => item.remove(), timeout);
}

function readTrackedTransactions() {
  if (!trackedStorageAvailable) return volatileTrackedTransactions;
  try {
    const value = JSON.parse(localStorage.getItem(TRANSACTION_KEY) || "[]");
    if (!Array.isArray(value)) return [];
    const cutoff = Date.now() - TRANSACTION_RETENTION_MS;
    volatileTrackedTransactions = value
      .filter((item) => /^0x[0-9a-f]{64}$/i.test(String(item?.hash || "")))
      .filter((item) => !["FINALIZED", "FAILED", "CANCELED"].includes(String(item.status || "").toUpperCase()) || Number(item.updatedAt || item.submittedAt || 0) >= cutoff)
      .sort((left, right) => Number(right.submittedAt || 0) - Number(left.submittedAt || 0));
    return volatileTrackedTransactions;
  } catch {
    trackedStorageAvailable = false;
    return volatileTrackedTransactions;
  }
}

function writeTrackedTransactions(items) {
  volatileTrackedTransactions = items.slice(0, 30);
  try {
    localStorage.setItem(TRANSACTION_KEY, JSON.stringify(volatileTrackedTransactions));
  } catch {
    trackedStorageAvailable = false;
    // Keep tracking in memory when browser privacy settings disable storage.
  }
  renderTransactionActivity();
}

function trackTransaction(item) {
  const items = readTrackedTransactions().filter((existing) => existing.hash.toLowerCase() !== item.hash.toLowerCase());
  items.unshift({
    ...item,
    status: String(item.status || "SUBMITTED").toUpperCase(),
    submittedAt: Number(item.submittedAt || Date.now()),
    updatedAt: Date.now(),
  });
  writeTrackedTransactions(items);
}

function updateTrackedTransaction(hash, changes) {
  const items = readTrackedTransactions();
  const index = items.findIndex((item) => item.hash.toLowerCase() === String(hash).toLowerCase());
  if (index < 0) return;
  items[index] = { ...items[index], ...changes, updatedAt: Date.now() };
  writeTrackedTransactions(items);
}

function renderTransactionActivity() {
  const panel = $("transaction-activity");
  const container = $("transaction-list");
  if (!panel || !container) return;
  const items = readTrackedTransactions();
  panel.hidden = items.length === 0;
  container.replaceChildren();
  for (const item of items) {
    const row = document.createElement("article");
    row.className = "transaction-item";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "text-button";
    copy.textContent = shortAddress(item.hash);
    copy.setAttribute("aria-label", `Copy transaction ${item.hash}`);
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(item.hash);
        toast("success", "Transaction hash copied.");
      } catch {
        toast("error", "Clipboard access was unavailable.");
      }
    });
    const heading = document.createElement("div");
    heading.className = "transaction-item-head";
    heading.append(
      textElement("strong", "", String(item.operation || "transaction").replaceAll("_", " ")),
      textElement("span", `badge badge-${String(item.status || "submitted").toLowerCase()}`, String(item.status || "SUBMITTED").replaceAll("_", " ")),
    );
    row.append(
      heading,
      textElement("span", "transaction-case", item.caseId || "Unlinked decision"),
      copy,
    );
    if (item.lastError) row.appendChild(textElement("p", "transaction-error", item.lastError));
    container.appendChild(row);
  }
}

function textElement(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = value == null ? "" : String(value);
  return element;
}

function actionButton(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className || "";
  button.textContent = label;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await handler();
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

function randomUnit() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] / 0xffffffff;
}

function registryUrl(path) {
  return `${String(CONFIG.REGISTRY_API_BASE || "").replace(/\/$/, "")}${path}`;
}

function registryRecord(kind, caseId) {
  return state.registry.find((item) => item.kind === kind && item.case_id === caseId) || null;
}

async function readContract(address, functionName, args = []) {
  if (!readClient) throw new Error("Oracle by Plain3rd is missing its StudioNet configuration.");
  return readClient.readContract({ address, functionName, args });
}

function storedWallet() {
  try {
    const value = JSON.parse(sessionStorage.getItem(WALLET_KEY) || "null");
    if (value && isConfiguredAddress(value.address)) return { address: value.address };
  } catch {
    sessionStorage.removeItem(WALLET_KEY);
  }
  return null;
}

async function ensureStudioNetwork(provider) {
  let current = "";
  try {
    current = await provider.request({ method: "eth_chainId" });
  } catch {}
  if (String(current).toLowerCase() === STUDIO_CHAIN_ID_HEX) return true;

  const switchParams = [{ chainId: STUDIO_CHAIN_ID_HEX }];
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: switchParams });
    return true;
  } catch (switchError) {
    const code = Number(switchError?.code ?? switchError?.data?.originalError?.code);
    if (code !== 4902 && code !== -32603 && !/unrecognized|not added/i.test(errMsg(switchError))) {
      return false;
    }
  }

  try {
    await provider.request({ method: "wallet_addEthereumChain", params: [STUDIO_CHAIN_PARAMS] });
    await provider.request({ method: "wallet_switchEthereumChain", params: switchParams });
    return true;
  } catch {
    return false;
  }
}

function renderWallet() {
  state.wallet = storedWallet();
  const connected = Boolean(state.wallet);
  $("connect-wallet").hidden = connected;
  $("wallet-chip").hidden = !connected;
  if (connected) {
    $("wallet-address").textContent = shortAddress(state.wallet.address);
    $("wallet-chip").title = state.wallet.address;
  }
  renderQuestions();
  renderProposals();
}

function resetWriteClient() {
  writeClient = null;
  writeClientAddress = "";
}

function bindWalletEvents(provider) {
  if (!provider || walletEventsBound || typeof provider.on !== "function") return;
  walletEventsBound = true;
  provider.on("accountsChanged", (accounts) => {
    resetWriteClient();
    if (!Array.isArray(accounts) || !accounts[0]) {
      sessionStorage.removeItem(WALLET_KEY);
      renderWallet();
      toast("info", "Wallet disconnected.");
      return;
    }
    sessionStorage.setItem(WALLET_KEY, JSON.stringify({ address: accounts[0] }));
    renderWallet();
    toast("info", `Wallet changed to ${shortAddress(accounts[0])}.`);
  });
  provider.on("chainChanged", (chainId) => {
    resetWriteClient();
    if (String(chainId).toLowerCase() !== STUDIO_CHAIN_ID_HEX) {
      toast("error", "Switch back to GenLayer StudioNet (chain 61999) before signing.");
    }
  });
}

async function waitForWalletProvider(timeoutMs = 2500) {
  if (window.ethereum?.request) return window.ethereum;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (provider) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("ethereum#initialized", onInitialized);
      window.clearInterval(pollId);
      window.clearTimeout(timeoutId);
      resolve(provider?.request ? provider : null);
    };
    const onInitialized = () => finish(window.ethereum);
    window.addEventListener("ethereum#initialized", onInitialized, { once: true });
    const pollId = window.setInterval(() => {
      if (window.ethereum?.request) finish(window.ethereum);
    }, 100);
    const timeoutId = window.setTimeout(() => finish(window.ethereum), timeoutMs);
  });
}

function setWalletConnectBusy(busy, label = "Connect wallet") {
  const button = $("connect-wallet");
  button.disabled = busy;
  button.setAttribute("aria-busy", String(busy));
  button.textContent = label;
}

async function connectWallet() {
  if (walletConnectInFlight) {
    toast("info", "A wallet request is already open. Check your wallet extension.");
    return;
  }
  walletConnectInFlight = true;
  setWalletConnectBusy(true, "Open wallet…");
  toast("info", "Check your wallet extension and approve the connection.", 10000);
  try {
    const provider = await waitForWalletProvider();
    if (!provider) {
      toast("error", "No browser wallet found. Install MetaMask and create a StudioNet-only test account.");
      return;
    }
    let accounts;
    try {
      accounts = await provider.request({ method: "eth_requestAccounts" });
    } catch (error) {
      toast("error", walletConnectionErrorMessage(error));
      return;
    }
    if (!Array.isArray(accounts) || !accounts[0]) {
      toast("error", "The wallet did not provide an account.");
      return;
    }
    setWalletConnectBusy(true, "Switch network…");
    if (!(await ensureStudioNetwork(provider))) {
      toast("error", "StudioNet was not confirmed. Add chain 61999 and try again.");
      return;
    }
    sessionStorage.setItem(WALLET_KEY, JSON.stringify({ address: accounts[0] }));
    bindWalletEvents(provider);
    renderWallet();
    toast("success", `Connected ${shortAddress(accounts[0])} on StudioNet.`);
  } finally {
    walletConnectInFlight = false;
    setWalletConnectBusy(false);
  }
}

function disconnectWallet() {
  sessionStorage.removeItem(WALLET_KEY);
  resetWriteClient();
  renderWallet();
  toast("info", "Oracle by Plain3rd wallet session cleared.");
}

function getWriteClient(address, provider) {
  if (!writeClient || writeClientAddress.toLowerCase() !== address.toLowerCase()) {
    writeClient = createClient({
      chain: chains.studionet,
      endpoint: CONFIG.RPC_URL,
      account: address,
      provider,
    });
    writeClientAddress = address;
  }
  return writeClient;
}

async function registerTransaction(hash, kind, caseId, operation) {
  try {
    const response = await fetch(registryUrl("/api/transactions"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hash, kind, case_id: caseId, operation }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return true;
  } catch (error) {
    console.warn("Registry tracking failed; the contract write is unaffected:", error);
    return false;
  }
}

async function refreshTrackedTransactions({ announce = false } = {}) {
  if (!readClient) return;
  const items = readTrackedTransactions().filter(
    (item) => !["FINALIZED", "FAILED", "CANCELED"].includes(String(item.status || "").toUpperCase()),
  );
  let contractStateChanged = false;
  for (const item of items) {
    try {
      const receipt = await readClient.getTransaction({ hash: item.hash });
      const status = receiptStatusName(receipt) || item.status || "SUBMITTED";
      const accepted = ["ACCEPTED", "READY_TO_FINALIZE", "FINALIZED"].includes(status);
      if (accepted) {
        const failure = receiptFailure(receipt);
        if (failure) {
          updateTrackedTransaction(item.hash, { status: "FAILED", lastError: failure });
          continue;
        }
        const registered = item.registered || await registerTransaction(item.hash, item.kind, item.caseId, item.operation);
        updateTrackedTransaction(item.hash, { status, registered, lastError: "" });
        contractStateChanged ||= status !== item.status || !item.registered;
        continue;
      }
      if (["CANCELED", "UNDETERMINED", "VALIDATORS_TIMEOUT", "LEADER_TIMEOUT"].includes(status)) {
        updateTrackedTransaction(item.hash, {
          status: status === "CANCELED" ? "CANCELED" : "FAILED",
          lastError: `Consensus ended with ${status.replaceAll("_", " ").toLowerCase()}.`,
        });
        continue;
      }
      updateTrackedTransaction(item.hash, { status, lastError: "" });
    } catch (error) {
      updateTrackedTransaction(item.hash, { lastError: `Status check paused: ${errMsg(error)}` });
    }
  }
  if (contractStateChanged) {
    await Promise.allSettled([refreshTruth(), refreshGovernance(), refreshRegistry({ fresh: true })]);
  }
  renderTransactionActivity();
  if (announce) toast("info", items.length ? "Transaction activity refreshed." : "No pending transactions to refresh.");
}

async function executeWrite({ address, kind, caseId, operation, method, args, longPoll = false }) {
  const wallet = storedWallet();
  if (!wallet) throw new Error("Connect a wallet before signing a transaction.");
  const provider = window.ethereum;
  if (!provider) throw new Error("No browser wallet is available.");
  if (!(await ensureStudioNetwork(provider))) throw new Error("StudioNet chain 61999 was not confirmed.");

  const accounts = await provider.request({ method: "eth_accounts" });
  if (!Array.isArray(accounts) || !accounts.some((item) => item.toLowerCase() === wallet.address.toLowerCase())) {
    throw new Error("The connected account is no longer authorized. Reconnect it and try again.");
  }

  const client = getWriteClient(wallet.address, provider);
  const hash = await client.writeContract({ address, functionName: method, args });
  trackTransaction({ hash, kind, caseId, operation, address, method });
  toast("info", `Transaction ${shortAddress(hash)} submitted. Its live status is saved below.`, 10000);
  let receipt;
  try {
    receipt = await client.waitForTransactionReceipt({
      hash,
      status: "ACCEPTED",
      interval: longPoll ? 4000 : 2500,
      retries: longPoll ? 300 : 100,
    });
  } catch (error) {
    updateTrackedTransaction(hash, {
      lastError: `Automatic waiting paused: ${errMsg(error)} Use Refresh status to continue tracking.`,
    });
    throw new Error(`The transaction remains saved below while consensus continues. ${errMsg(error)}`);
  }
  const failure = receiptFailure(receipt);
  if (failure) {
    updateTrackedTransaction(hash, { status: "FAILED", lastError: failure });
    throw new Error(`${failure} Transaction ${shortAddress(hash)}.`);
  }
  const status = receiptStatusName(receipt) || "ACCEPTED";
  const registered = await registerTransaction(hash, kind, caseId, operation);
  updateTrackedTransaction(hash, { status, registered, lastError: "" });
  toast("success", `${operation} accepted on-chain. Registry finality will update separately.`);
  return { hash, receipt };
}

function normalizeQuestion(raw) {
  let sources = raw?.sources;
  if (typeof sources === "string") {
    try { sources = JSON.parse(sources); } catch { sources = []; }
  }
  return {
    ...raw,
    id: String(raw?.id || ""),
    text: String(raw?.text || ""),
    criteria: String(raw?.criteria || ""),
    status: String(raw?.status || "open").toLowerCase(),
    outcome: String(raw?.outcome || "").toLowerCase(),
    sources: Array.isArray(sources) ? sources.map(String) : [],
    citations: Array.isArray(raw?.citations) ? raw.citations.map(Number) : [],
    history: Array.isArray(raw?.history) ? raw.history : [],
    creator: String(raw?.creator || ""),
    resolve_not_before: Number(raw?.resolve_not_before || 0),
    resolution_round: Number(raw?.resolution_round || 0),
    link_type: String(raw?.link_type || "standalone"),
    linked_proposal_id: String(raw?.linked_proposal_id || ""),
  };
}

function normalizeProposal(raw) {
  return {
    ...raw,
    id: String(raw?.id || ""),
    title: String(raw?.title || ""),
    body: String(raw?.body || ""),
    status: String(raw?.status || "submitted").toLowerCase(),
    submitter: String(raw?.submitter || ""),
    rule_refs: Array.isArray(raw?.rule_refs) ? raw.rule_refs.map(String) : [],
    review_history: Array.isArray(raw?.review_history) ? raw.review_history : [],
    review_count: Number(raw?.review_count || 0),
    evidence_ids: Array.isArray(raw?.evidence_ids) ? raw.evidence_ids.map(String) : [],
    evidence_snapshot: Array.isArray(raw?.evidence_snapshot) ? raw.evidence_snapshot : [],
    verification_question_id: String(raw?.verification_question_id || ""),
    verification_status: String(raw?.verification_status || "not_started").toLowerCase(),
    verification_outcome: String(raw?.verification_outcome || "").toLowerCase(),
    verification_round: Number(raw?.verification_round || 0),
    governance_outcome: String(raw?.governance_outcome || "pending").toLowerCase(),
  };
}

function normalizeBallot(raw) {
  return {
    ...raw,
    id: String(raw?.id || ""),
    proposal_id: String(raw?.proposal_id || ""),
    status: String(raw?.status || "none").toLowerCase(),
    closes_at: Number(raw?.closes_at || 0),
    quorum: Number(raw?.quorum || 0),
    votes_for: Number(raw?.votes_for || 0),
    votes_against: Number(raw?.votes_against || 0),
    total_votes: Number(raw?.total_votes || 0),
    passed: Boolean(raw?.passed),
  };
}

async function readLatestPage(address, method, total, normalizer, dateField = "created_at") {
  const window = latestPageWindow(total, PAGE_SIZE);
  if (!window.limit) return { items: [], offset: 0, total: 0 };
  const raw = await readContract(address, method, [window.offset, window.limit]);
  const page = normalizePage(raw);
  return {
    items: newestFirst(page.items.map(normalizer), dateField),
    offset: window.offset,
    total: Math.max(Number(total) || 0, page.total || 0),
  };
}

async function refreshTruth() {
  const [stats, ownership] = await Promise.all([
    readContract(CONFIG.TRUTH_CONTRACT_ADDRESS, "get_stats"),
    readContract(CONFIG.TRUTH_CONTRACT_ADDRESS, "get_ownership_state").catch(() => ({ owner: "" })),
  ]);
  const page = await readLatestPage(
    CONFIG.TRUTH_CONTRACT_ADDRESS,
    "list_questions",
    Number(stats?.created || 0),
    normalizeQuestion,
  );
  state.questions = page.items.filter((item) => isProductionRecordId(item.id));
  state.questionTotal = page.total;
  state.questionOffset = page.offset;
  state.questionVisible = INITIAL_VISIBLE;
  state.truthOwner = String(ownership?.owner || "");
  renderEvidenceOptions();
  renderQuestions();
  renderProposals();
  renderMetrics();
}

async function refreshGovernance() {
  const [constitution, version, stats, ownership] = await Promise.all([
    readContract(CONFIG.LIVING_CONTRACT_ADDRESS, "get_constitution"),
    readContract(CONFIG.LIVING_CONTRACT_ADDRESS, "constitution_version_count"),
    readContract(CONFIG.LIVING_CONTRACT_ADDRESS, "get_stats"),
    readContract(CONFIG.LIVING_CONTRACT_ADDRESS, "get_ownership_state").catch(() => ({ owner: "" })),
  ]);
  const [proposalPage, ballotPage] = await Promise.all([
    readLatestPage(
      CONFIG.LIVING_CONTRACT_ADDRESS,
      "list_proposals",
      Number(stats?.proposals_submitted || 0),
      normalizeProposal,
    ),
    readLatestPage(
      CONFIG.LIVING_CONTRACT_ADDRESS,
      "list_ballots",
      Number(stats?.ballots_opened || 0),
      normalizeBallot,
      "opened_at",
    ).catch(() => ({ items: [], offset: 0, total: 0 })),
  ]);
  state.constitution = String(constitution || "");
  state.constitutionVersion = Number(version || 0);
  state.proposals = proposalPage.items.filter((item) => isProductionRecordId(item.id));
  state.proposalTotal = proposalPage.total;
  state.proposalOffset = proposalPage.offset;
  state.proposalVisible = INITIAL_VISIBLE;
  state.owner = String(ownership?.owner || "");
  state.ballots = ballotPage.items.filter((item) => isProductionRecordId(item.proposal_id));
  state.ballotOffset = ballotPage.offset;
  renderCharter();
  renderProposals();
  renderMetrics();
}

async function loadOlderQuestions() {
  const window = olderPageWindow(state.questionOffset, PAGE_SIZE);
  if (!window.limit) return;
  const raw = await readContract(CONFIG.TRUTH_CONTRACT_ADDRESS, "list_questions", [window.offset, window.limit]);
  const incoming = normalizePage(raw).items
    .map(normalizeQuestion)
    .filter((item) => isProductionRecordId(item.id));
  state.questions = mergeUniqueNewest(state.questions, incoming);
  state.questionOffset = window.offset;
  state.questionVisible += incoming.length;
  renderEvidenceOptions();
  renderQuestions();
}

async function loadOlderProposals() {
  const proposalWindow = olderPageWindow(state.proposalOffset, PAGE_SIZE);
  if (!proposalWindow.limit) return;
  const ballotWindow = olderPageWindow(state.ballotOffset, PAGE_SIZE);
  const [rawProposals, rawBallots] = await Promise.all([
    readContract(CONFIG.LIVING_CONTRACT_ADDRESS, "list_proposals", [proposalWindow.offset, proposalWindow.limit]),
    ballotWindow.limit
      ? readContract(CONFIG.LIVING_CONTRACT_ADDRESS, "list_ballots", [ballotWindow.offset, ballotWindow.limit]).catch(() => ({ items: [] }))
      : Promise.resolve({ items: [] }),
  ]);
  const incomingProposals = normalizePage(rawProposals).items
    .map(normalizeProposal)
    .filter((item) => isProductionRecordId(item.id));
  const incomingBallots = normalizePage(rawBallots).items
    .map(normalizeBallot)
    .filter((item) => isProductionRecordId(item.proposal_id));
  state.proposals = mergeUniqueNewest(state.proposals, incomingProposals);
  state.ballots = mergeUniqueNewest(state.ballots, incomingBallots, "id", "opened_at");
  state.proposalOffset = proposalWindow.offset;
  state.ballotOffset = ballotWindow.offset;
  state.proposalVisible += incomingProposals.length;
  renderProposals();
}

async function refreshRegistry({ fresh = false } = {}) {
  const response = await fetch(registryUrl(`/api/registry?fresh=${fresh ? "1" : "0"}&limit=200`), {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Registry returned HTTP ${response.status}`);
  const result = await response.json();
  state.registry = Array.isArray(result.items)
    ? result.items.filter(
        (item) =>
          [TRUTH_KIND, LIVING_KIND].includes(item?.kind) &&
          isProductionRecordId(item?.case_id),
      )
    : [];
  state.registryWarning = String(result.warning || "");
  renderRegistry();
  renderQuestions();
  renderProposals();
  renderMetrics();
}

async function refreshAll({ freshRegistry = false } = {}) {
  if (!CONFIGURED) {
    const status = $("network-status");
    status?.classList.add("is-error");
    if (status?.lastChild) status.lastChild.textContent = "Config error";
    toast("error", "Oracle by Plain3rd deployment configuration is incomplete.", 10000);
    return;
  }
  const refreshers = {
    home: [refreshTruth, refreshGovernance, () => refreshRegistry({ fresh: freshRegistry })],
    evidence: [refreshTruth, () => refreshRegistry({ fresh: freshRegistry })],
    proposals: [refreshTruth, () => refreshRegistry({ fresh: freshRegistry })],
    governance: [refreshTruth, refreshGovernance, () => refreshRegistry({ fresh: freshRegistry })],
    decisions: [() => refreshRegistry({ fresh: freshRegistry })],
  }[PAGE] || [];
  const results = await Promise.allSettled(refreshers.map((refresh) => refresh()));
  const failures = results.filter((result) => result.status === "rejected");
  const status = $("network-status");
  if (!status) return;
  status.classList.toggle("is-live", failures.length < results.length);
  status.classList.toggle("is-error", failures.length === results.length);
  status.lastChild.textContent = failures.length === results.length ? "Unavailable" : "Live · StudioNet";
  if (failures.length) {
    console.warn("Oracle by Plain3rd refresh warnings:", failures.map((item) => item.reason));
  }
}

function renderMetrics() {
  const truthCount = $("truth-count");
  const proposalCount = $("proposal-count");
  const finalCount = $("final-count");
  if (truthCount) truthCount.textContent = `${state.questions.length}${state.questionOffset > 0 ? "+" : ""}`;
  if (proposalCount) proposalCount.textContent = `${state.proposals.length}${state.proposalOffset > 0 ? "+" : ""}`;
  if (finalCount) finalCount.textContent = String(state.registry.filter((item) => item.finality?.final).length);
}

function appendFinality(card, kind, caseId) {
  const record = registryRecord(kind, caseId);
  const row = document.createElement("div");
  row.className = "finality-row";
  const badge = textElement("span", `badge ${record?.finality?.final ? "badge-final" : ""}`, finalityLabel(record));
  const copy = textElement(
    "span",
    "",
    record?.transaction
      ? `latest tracked ${record.transaction.operation} transaction`
      : "No transaction has been linked in the shared registry",
  );
  row.append(badge, copy);
  card.appendChild(row);
}

function appendRecordControls(container, { shown, loaded, hasOlder, showMore, loadOlder }) {
  if (shown >= loaded && !hasOlder) return;
  const controls = document.createElement("div");
  controls.className = "record-controls";
  controls.appendChild(textElement("span", "", `Showing ${Math.min(shown, loaded)} newest record${Math.min(shown, loaded) === 1 ? "" : "s"}`));
  if (shown < loaded) {
    controls.appendChild(actionButton("Show more", "", showMore));
  } else if (hasOlder) {
    controls.appendChild(actionButton("Load older from StudioNet", "", loadOlder));
  }
  container.appendChild(controls);
}

function renderEvidenceOptions() {
  const container = $("proposal-evidence-options");
  if (!container) return;
  const previous = new Set(
    Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map((input) => input.value),
  );
  container.replaceChildren();
  const decisions = state.questions.filter(
    (question) => question.status === "resolved" && ["yes", "no"].includes(question.outcome),
  );
  if (!decisions.length) {
    const empty = textElement("p", "evidence-empty", "Resolve an evidence question first.");
    container.appendChild(empty);
    return;
  }
  for (const question of decisions) {
    const label = document.createElement("label");
    label.className = "evidence-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "proposal-evidence";
    input.value = question.id;
    input.checked = previous.has(question.id);
    const copy = document.createElement("span");
    copy.append(
      textElement("strong", "", question.text || question.id),
      textElement("small", "", `${question.outcome.toUpperCase()} · ${question.id}`),
    );
    label.append(input, copy);
    container.appendChild(label);
  }
}

function renderQuestions() {
  const container = $("truth-feed");
  if (!container) return;
  container.replaceChildren();
  if (!state.questions.length) {
    container.appendChild(textElement("div", "empty-card", "No production questions have been recorded yet."));
    return;
  }

  for (const question of state.questions.slice(0, state.questionVisible)) {
    const card = document.createElement("article");
    card.className = "decision-card";
    const head = document.createElement("div");
    head.className = "card-head";
    const titleBlock = document.createElement("div");
    titleBlock.append(
      textElement("span", "card-id", question.id),
      textElement("h3", "", question.text || question.id),
    );
    const status = question.outcome || question.status;
    head.append(titleBlock, textElement("span", `badge badge-${status}`, status));
    card.append(head);

    if (question.link_type === "proposal_outcome" && question.linked_proposal_id) {
      card.append(
        textElement("p", "linked-record", `Outcome check for ${question.linked_proposal_id}`),
      );
    }

    const decisionDetails = document.createElement("details");
    decisionDetails.className = "history";
    decisionDetails.appendChild(textElement("summary", "", question.outcome ? "View evidence and reasoning" : "View rule and evidence"));
    let hasDecisionDetails = false;

    if (question.criteria) {
      decisionDetails.append(textElement("p", "card-label", "Resolution rule"));
      decisionDetails.append(textElement("p", "card-copy", question.criteria));
      hasDecisionDetails = true;
    }

    if (question.sources.length) {
      decisionDetails.append(textElement("p", "card-label", "Evidence"));
      const list = document.createElement("ol");
      list.className = "source-list";
      question.sources.forEach((source) => {
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = source;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = source;
        item.appendChild(link);
        list.appendChild(item);
      });
      decisionDetails.appendChild(list);
      hasDecisionDetails = true;
    }

    if (question.outcome) {
      card.append(textElement("p", "card-label", "Consensus result"));
      const citationText = question.citations.length ? ` · sources ${question.citations.join(", ")}` : "";
      card.append(textElement("p", "card-copy", `${question.outcome.toUpperCase()}${citationText}`));
      if (question.reasoning) {
        decisionDetails.append(textElement("p", "card-label", "AI rationale · context only"));
        decisionDetails.append(textElement("p", "rationale", question.reasoning));
        hasDecisionDetails = true;
      }
    }

    if (question.history.length) {
      decisionDetails.append(textElement("p", "card-label", "Decision history"));
      const historyList = document.createElement("ol");
      question.history.forEach((round) => {
        historyList.appendChild(
          textElement(
            "li",
            "",
            `Round ${round.round || "?"}: ${String(round.outcome || "unknown").toUpperCase()}${Array.isArray(round.citations) && round.citations.length ? ` · sources ${round.citations.join(", ")}` : ""}`,
          ),
        );
      });
      decisionDetails.appendChild(historyList);
      hasDecisionDetails = true;
    }
    if (hasDecisionDetails) card.appendChild(decisionDetails);

    appendFinality(card, TRUTH_KIND, question.id);
    const actions = document.createElement("div");
    actions.className = "card-actions";
    const now = Math.floor(Date.now() / 1000);
    if (question.status === "open") {
      const scheduled = question.resolve_not_before > now;
      const resolveButton = actionButton(
        scheduled ? `Scheduled ${new Date(question.resolve_not_before * 1000).toLocaleString()}` : "Resolve with validators",
        "action-primary",
        () => resolveQuestion(question.id),
      );
      resolveButton.disabled = scheduled;
      actions.appendChild(resolveButton);
    }
    const wallet = storedWallet();
    const canRecheck = wallet && question.status === "resolved" && [question.creator, state.truthOwner]
      .filter(Boolean)
      .some((address) => address.toLowerCase() === wallet.address.toLowerCase());
    if (canRecheck) {
      actions.appendChild(actionButton("Request recheck", "", () => recheckQuestion(question.id)));
    }
    if (actions.childElementCount) card.appendChild(actions);
    container.appendChild(card);
  }
  appendRecordControls(container, {
    shown: state.questionVisible,
    loaded: state.questions.length,
    hasOlder: state.questionOffset > 0,
    showMore: () => {
      state.questionVisible += VISIBLE_STEP;
      renderQuestions();
    },
    loadOlder: loadOlderQuestions,
  });
}

function renderCharter() {
  const version = $("charter-version");
  const list = $("charter-list");
  if (!version || !list) return;
  version.textContent = `version ${state.constitutionVersion || "—"}`;
  list.replaceChildren();
  const articles = splitCharter(state.constitution);
  if (!articles.length) {
    list.appendChild(textElement("li", "", "The charter could not be read."));
    return;
  }
  articles.forEach((article) => list.appendChild(textElement("li", "", article)));
}

function currentBallot(proposalId) {
  return state.ballots.find((ballot) => ballot.proposal_id === proposalId) || null;
}

function renderProposals() {
  const container = $("proposal-list");
  if (!container) return;
  container.replaceChildren();
  if (!state.proposals.length) {
    container.appendChild(textElement("div", "empty-card", "No production proposals have been recorded yet."));
    return;
  }

  for (const proposal of state.proposals.slice(0, state.proposalVisible)) {
    const card = document.createElement("article");
    card.className = "decision-card";
    const head = document.createElement("div");
    head.className = "card-head";
    const titleBlock = document.createElement("div");
    titleBlock.append(
      textElement("span", "card-id", proposal.id),
      textElement("h3", "", proposal.title || proposal.id),
    );
    head.append(titleBlock, textElement("span", `badge badge-${proposal.status}`, proposal.status.replaceAll("_", " ")));
    card.append(head, textElement("p", "card-copy", proposal.body));

    const evidenceCurrent = evidenceSnapshotCurrent(proposal.evidence_snapshot, state.questions);
    if (proposal.evidence_ids.length) {
      const evidenceBlock = document.createElement("div");
      evidenceBlock.className = "linked-evidence";
      evidenceBlock.appendChild(textElement("p", "card-label", "Evidence used"));
      const evidenceList = document.createElement("ul");
      for (const evidenceId of proposal.evidence_ids) {
        const snapshot = proposal.evidence_snapshot.find((item) => String(item?.id || "") === evidenceId);
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = "evidence.html";
        link.textContent = evidenceId;
        item.append(link, textElement("span", "", snapshot?.outcome ? ` · ${String(snapshot.outcome).toUpperCase()}` : " · awaiting review"));
        evidenceList.appendChild(item);
      }
      evidenceBlock.appendChild(evidenceList);
      if (proposal.evidence_snapshot.length) {
        evidenceBlock.appendChild(
          textElement(
            "span",
            `badge ${evidenceCurrent ? "badge-final" : "badge-stale"}`,
            evidenceCurrent ? "evidence current" : "evidence changed",
          ),
        );
      }
      card.appendChild(evidenceBlock);
    }

    if (proposal.rule_refs.length) {
      card.append(textElement("p", "card-label", "Cited charter rules"));
      const refs = document.createElement("ul");
      refs.className = "ref-list";
      proposal.rule_refs.forEach((ref) => refs.appendChild(textElement("li", "", ref)));
      card.appendChild(refs);
    }
    const reviewDetails = document.createElement("details");
    reviewDetails.className = "history";
    reviewDetails.appendChild(textElement("summary", "", "View review details"));
    let hasReviewDetails = false;
    if (proposal.analysis) {
      reviewDetails.append(textElement("p", "card-label", "AI rationale · context only"));
      reviewDetails.append(textElement("p", "rationale", proposal.analysis));
      hasReviewDetails = true;
    }

    if (proposal.review_history.length) {
      reviewDetails.append(textElement("p", "card-label", "Review history"));
      const historyList = document.createElement("ol");
      proposal.review_history.forEach((review) => {
        historyList.appendChild(
          textElement("li", "", `Review ${review.review || "?"}: ${String(review.verdict || "unknown").replaceAll("_", " ")} · charter v${review.constitution_version || "?"}`),
        );
      });
      reviewDetails.appendChild(historyList);
      hasReviewDetails = true;
    }
    if (hasReviewDetails) card.appendChild(reviewDetails);

    const ballot = currentBallot(proposal.id);
    if (ballot) {
      const ballotRow = document.createElement("div");
      ballotRow.className = "ballot-row";
      const ballotStatus = ballot.status === "closed" ? (ballot.passed ? "passed" : "failed") : ballot.status;
      ballotRow.append(
        textElement("span", `badge badge-${ballotStatus}`, `ballot ${ballotStatus}`),
        textElement("span", "", `FOR ${ballot.votes_for} · AGAINST ${ballot.votes_against} · quorum ${ballot.quorum} · closes ${new Date(ballot.closes_at * 1000).toLocaleString()}`),
      );
      card.appendChild(ballotRow);
    }

    if (proposal.verification_question_id) {
      const outcomeRow = document.createElement("div");
      outcomeRow.className = "outcome-row";
      const outcomeLabel = proposal.verification_outcome || proposal.verification_status;
      outcomeRow.append(
        textElement("span", `badge badge-${proposal.verification_status}`, `outcome ${outcomeLabel.replaceAll("_", " ")}`),
        textElement("span", "", proposal.verification_question_id),
      );
      card.appendChild(outcomeRow);
    }

    appendFinality(card, LIVING_KIND, proposal.id);
    const actions = document.createElement("div");
    actions.className = "card-actions";
    if (proposal.status === "submitted") {
      actions.appendChild(actionButton("Run constitutional review", "action-gold", () => checkProposal(proposal.id)));
    }
    const wallet = storedWallet();
    const isOwner = wallet && state.owner && wallet.address.toLowerCase() === state.owner.toLowerCase();
    const isSubmitter = wallet && proposal.submitter && wallet.address.toLowerCase() === proposal.submitter.toLowerCase();
    if (proposal.status !== "submitted" && (isOwner || isSubmitter)) {
      actions.appendChild(actionButton("Request recheck", "", () => recheckProposal(proposal.id)));
    }
    if (proposal.status === "compliant" && evidenceCurrent && isOwner && (!ballot || ballot.status !== "open")) {
      actions.appendChild(actionButton("Open ballot", "action-gold", () => openBallot(proposal.id)));
    }
    if (ballot?.status === "open" && ballot.closes_at > Math.floor(Date.now() / 1000)) {
      actions.append(
        actionButton("Vote for", "action-primary", () => vote(proposal.id, true)),
        actionButton("Vote against", "", () => vote(proposal.id, false)),
      );
    }
    if (ballot?.status === "open" && ballot.closes_at <= Math.floor(Date.now() / 1000)) {
      actions.appendChild(actionButton("Close ballot", "action-gold", () => closeBallot(proposal.id)));
    }
    const verificationQuestion = state.questions.find(
      (question) => question.id === proposal.verification_question_id,
    );
    if (
      storedWallet() &&
      ballot?.status === "closed" &&
      ballot.passed &&
      verificationQuestion?.status === "resolved" &&
      proposal.verification_round !== verificationQuestion.resolution_round
    ) {
      actions.appendChild(
        actionButton("Update outcome", "action-primary", () => syncOutcomeVerification(proposal.id)),
      );
    }
    if (
      storedWallet() &&
      ballot?.status === "closed" &&
      ballot.passed &&
      !verificationQuestion &&
      ["queued", "pending"].includes(proposal.verification_status)
    ) {
      actions.appendChild(
        actionButton("Retry outcome check", "", () => retryOutcomeVerification(proposal.id)),
      );
    }
    if (actions.childElementCount) card.appendChild(actions);
    container.appendChild(card);
  }
  appendRecordControls(container, {
    shown: state.proposalVisible,
    loaded: state.proposals.length,
    hasOlder: state.proposalOffset > 0,
    showMore: () => {
      state.proposalVisible += VISIBLE_STEP;
      renderProposals();
    },
    loadOlder: loadOlderProposals,
  });
}

function renderRegistry() {
  const search = $("registry-search");
  const sourceControl = $("registry-source");
  const count = $("registry-count");
  const container = $("registry-list");
  if (!search || !sourceControl || !count || !container) return;
  const query = search.value.trim().toLowerCase();
  const source = sourceControl.value;
  const items = state.registry.filter((item) => {
    if (source !== "all" && item.source_name !== source) return false;
    if (!query) return true;
    return [item.title, item.content, item.case_id, item.status, item.decision, item.source_name]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });
  count.textContent = `${items.length} of ${state.registry.length} indexed decisions`;
  container.replaceChildren();
  if (!items.length) {
    const message = state.registryWarning || (
      state.registry.length ? "No matching decisions." : "No production decisions have been recorded yet."
    );
    container.appendChild(textElement("div", "empty-card", message));
    return;
  }
  for (const item of items) {
    const card = document.createElement("article");
    card.className = "registry-item";
    const head = document.createElement("div");
    head.className = "registry-item-head";
    head.append(
      textElement("span", "source-chip", item.source_name || "Oracle by Plain3rd"),
      textElement("span", `badge ${item.finality?.final ? "badge-final" : ""}`, finalityLabel(item)),
    );
    card.append(
      head,
      textElement("h3", "", item.title || item.case_id),
      textElement("p", "registry-meta", `${item.case_id} · ${item.status}${item.decision ? ` · ${item.decision}` : ""}`),
    );
    container.appendChild(card);
  }
}

function addUrlRow({ containerId, inputClass, label, value = "" }) {
  const container = $(containerId);
  if (!container) return;
  if (container.children.length >= MAX_SOURCES) return;
  const row = document.createElement("div");
  row.className = "source-row";
  const input = document.createElement("input");
  input.className = inputClass;
  input.type = "url";
  input.inputMode = "url";
  input.maxLength = 2048;
  input.placeholder = "https://public-source.org/article";
  input.value = value;
  input.setAttribute("aria-label", `${label} ${container.children.length + 1}`);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "×";
  remove.setAttribute("aria-label", "Remove evidence source");
  remove.addEventListener("click", () => {
    if (container.children.length > 1) row.remove();
  });
  row.append(input, remove);
  container.appendChild(row);
}

function addSourceRow(value = "") {
  addUrlRow({
    containerId: "source-inputs",
    inputClass: "source-url",
    label: "Evidence source",
    value,
  });
}

function addVerificationSourceRow(value = "") {
  addUrlRow({
    containerId: "verification-source-inputs",
    inputClass: "verification-source-url",
    label: "Outcome source",
    value,
  });
}

function sourceValues(selector = ".source-url") {
  return Array.from(document.querySelectorAll(selector))
    .map((input) => input.value.trim())
    .filter(Boolean);
}

async function submitTruth(event) {
  event.preventDefault();
  const error = $("truth-error");
  error.textContent = "";
  const text = $("q-text").value.trim();
  const criteria = $("q-criteria").value.trim();
  const sources = sourceValues();
  const scheduledValue = $("q-resolve-after").value;
  if (!text || !criteria) {
    error.textContent = "Question and resolution rule are required.";
    return;
  }
  if (sources.length < 1 || sources.length > MAX_SOURCES || sources.some((source) => !isPublicHttpsSource(source))) {
    error.textContent = "Use one to five unique public HTTPS sources. Local/private targets are not allowed.";
    return;
  }
  if (new Set(sources).size !== sources.length) {
    error.textContent = "Each evidence source must be unique.";
    return;
  }
  let resolveNotBefore = 0;
  if (scheduledValue) {
    const milliseconds = Date.parse(scheduledValue);
    if (!Number.isFinite(milliseconds) || milliseconds <= Date.now()) {
      error.textContent = "Scheduled resolution must be in the future.";
      return;
    }
    if (milliseconds > Date.now() + 365 * 24 * 60 * 60 * 1000) {
      error.textContent = "Scheduled resolution cannot be more than one year away.";
      return;
    }
    resolveNotBefore = Math.floor(milliseconds / 1000);
  }
  const id = createCaseId("q", text, Date.now(), randomUnit());
  const method = resolveNotBefore ? "create_question_scheduled" : "create_question";
  const args = resolveNotBefore
    ? [id, text, criteria, `json:${JSON.stringify(sources)}`, resolveNotBefore]
    : [id, text, criteria, `json:${JSON.stringify(sources)}`];
  const submit = $("truth-submit");
  submit.disabled = true;
  try {
    await executeWrite({
      address: CONFIG.TRUTH_CONTRACT_ADDRESS,
      kind: TRUTH_KIND,
      caseId: id,
      operation: method,
      method,
      args,
    });
    event.target.reset();
    $("source-inputs").replaceChildren();
    addSourceRow();
    await Promise.all([refreshTruth(), refreshRegistry({ fresh: true })]);
  } catch (writeError) {
    error.textContent = errMsg(writeError);
  } finally {
    submit.disabled = false;
  }
}

async function resolveQuestion(id) {
  try {
    await executeWrite({
      address: CONFIG.TRUTH_CONTRACT_ADDRESS,
      kind: TRUTH_KIND,
      caseId: id,
      operation: "resolve_question",
      method: "resolve_question",
      args: [id],
      longPoll: true,
    });
    await Promise.all([refreshTruth(), refreshRegistry({ fresh: true })]);
  } catch (error) {
    toast("error", `Resolution failed: ${errMsg(error)}`, 10000);
  }
}

async function recheckQuestion(id) {
  const reason = window.prompt("Why should this evidence decision be reviewed again?", "New or corrected evidence should be considered.");
  if (reason === null) return;
  if (!reason.trim()) {
    toast("error", "A written recheck reason is required.");
    return;
  }
  let replacementSources = [];
  if (window.confirm("Replace the evidence sources for the new round? Choose Cancel to reuse the existing pack.")) {
    const raw = window.prompt("Enter one to five public HTTPS URLs separated by commas:", "");
    if (raw === null) return;
    replacementSources = raw.split(",").map((item) => item.trim()).filter(Boolean);
    if (
      replacementSources.length < 1 ||
      replacementSources.length > MAX_SOURCES ||
      new Set(replacementSources).size !== replacementSources.length ||
      replacementSources.some((source) => !isPublicHttpsSource(source))
    ) {
      toast("error", "Replacement evidence must be one to five unique public HTTPS URLs.");
      return;
    }
  }
  const method = replacementSources.length ? "request_recheck_with_sources" : "request_recheck";
  const args = replacementSources.length
    ? [id, reason.trim(), `json:${JSON.stringify(replacementSources)}`]
    : [id, reason.trim()];
  try {
    await executeWrite({
      address: CONFIG.TRUTH_CONTRACT_ADDRESS,
      kind: TRUTH_KIND,
      caseId: id,
      operation: method,
      method,
      args,
    });
    await Promise.all([refreshTruth(), refreshRegistry({ fresh: true })]);
  } catch (error) {
    toast("error", `Recheck failed: ${errMsg(error)}`, 10000);
  }
}

async function submitProposal(event) {
  event.preventDefault();
  const error = $("governance-error");
  error.textContent = "";
  const title = $("proposal-title").value.trim();
  const body = $("proposal-body").value.trim();
  const evidenceIds = Array.from(
    document.querySelectorAll('input[name="proposal-evidence"]:checked'),
  ).map((input) => input.value);
  const verificationQuestion = $("verification-question").value.trim();
  const verificationCriteria = $("verification-criteria").value.trim();
  const verificationSources = sourceValues(".verification-source-url");
  const verificationDelayDays = Number($("verification-delay-days").value || 0);
  if (!title || !body) {
    error.textContent = "Proposal title and body are required.";
    return;
  }
  if (evidenceIds.length < 1 || evidenceIds.length > MAX_SOURCES) {
    error.textContent = "Choose one to five resolved evidence decisions.";
    return;
  }
  if (!verificationQuestion || !verificationCriteria) {
    error.textContent = "Add the question and rule that will verify the result.";
    return;
  }
  if (
    verificationSources.length < 1 ||
    verificationSources.length > MAX_SOURCES ||
    new Set(verificationSources).size !== verificationSources.length ||
    verificationSources.some((source) => !isPublicHttpsSource(source))
  ) {
    error.textContent = "Use one to five unique public HTTPS outcome sources.";
    return;
  }
  if (!Number.isInteger(verificationDelayDays) || verificationDelayDays < 0 || verificationDelayDays > 365) {
    error.textContent = "Outcome delay must be a whole number from 0 to 365 days.";
    return;
  }
  const id = createCaseId("p", title, Date.now(), randomUnit());
  const submit = $("governance-submit");
  submit.disabled = true;
  try {
    await executeWrite({
      address: CONFIG.LIVING_CONTRACT_ADDRESS,
      kind: LIVING_KIND,
      caseId: id,
      operation: "submit_proposal",
      method: "submit_proposal",
      args: [
        id,
        title,
        body,
        `json:${JSON.stringify(evidenceIds)}`,
        verificationQuestion,
        verificationCriteria,
        `json:${JSON.stringify(verificationSources)}`,
        verificationDelayDays * 24 * 60 * 60,
      ],
    });
    event.target.reset();
    $("verification-source-inputs").replaceChildren();
    addVerificationSourceRow();
    await Promise.all([refreshGovernance(), refreshRegistry({ fresh: true })]);
  } catch (writeError) {
    error.textContent = errMsg(writeError);
  } finally {
    submit.disabled = false;
  }
}

async function checkProposal(id) {
  try {
    await executeWrite({
      address: CONFIG.LIVING_CONTRACT_ADDRESS,
      kind: LIVING_KIND,
      caseId: id,
      operation: "check_proposal",
      method: "check_proposal",
      args: [id],
      longPoll: true,
    });
    await Promise.all([refreshGovernance(), refreshRegistry({ fresh: true })]);
  } catch (error) {
    toast("error", `Constitutional review failed: ${errMsg(error)}`, 10000);
  }
}

async function recheckProposal(id) {
  const reason = window.prompt("Why should this proposal be checked again?", "New or corrected information should be considered.");
  if (reason === null) return;
  if (!reason.trim()) {
    toast("error", "A written recheck reason is required.");
    return;
  }
  try {
    await executeWrite({
      address: CONFIG.LIVING_CONTRACT_ADDRESS,
      kind: LIVING_KIND,
      caseId: id,
      operation: "request_recheck_with_reason",
      method: "request_recheck_with_reason",
      args: [id, reason.trim()],
    });
    await Promise.all([refreshGovernance(), refreshRegistry({ fresh: true })]);
  } catch (error) {
    toast("error", `Proposal recheck failed: ${errMsg(error)}`, 10000);
  }
}

async function openBallot(id) {
  const quorumValue = window.prompt("Minimum number of wallets required for this ballot:", "3");
  if (quorumValue === null) return;
  const quorum = Number(quorumValue);
  if (!Number.isInteger(quorum) || quorum < 1 || quorum > 1_000_000) {
    toast("error", "Quorum must be a whole number from 1 to 1,000,000.");
    return;
  }
  const durationValue = window.prompt(
    "Ballot duration in minutes (5 minimum; 1440 is 24 hours):",
    "1440",
  );
  if (durationValue === null) return;
  const durationMinutes = parseBallotDurationMinutes(durationValue);
  if (durationMinutes === null) {
    toast("error", "Ballot duration must be a whole number from 5 to 129,600 minutes.");
    return;
  }
  try {
    await executeWrite({
      address: CONFIG.LIVING_CONTRACT_ADDRESS,
      kind: LIVING_KIND,
      caseId: id,
      operation: "open_ballot",
      method: "open_ballot",
      args: [id, Math.floor(Date.now() / 1000) + durationMinutes * 60, quorum],
    });
    await Promise.all([refreshGovernance(), refreshRegistry({ fresh: true })]);
  } catch (error) {
    toast("error", `Could not open the ballot: ${errMsg(error)}`, 10000);
  }
}

async function vote(id, support) {
  try {
    await executeWrite({
      address: CONFIG.LIVING_CONTRACT_ADDRESS,
      kind: LIVING_KIND,
      caseId: id,
      operation: support ? "cast_vote_for" : "cast_vote_against",
      method: "cast_vote",
      args: [id, support],
    });
    await Promise.all([refreshGovernance(), refreshRegistry({ fresh: true })]);
  } catch (error) {
    toast("error", `Vote failed: ${errMsg(error)}`, 10000);
  }
}

async function closeBallot(id) {
  try {
    await executeWrite({
      address: CONFIG.LIVING_CONTRACT_ADDRESS,
      kind: LIVING_KIND,
      caseId: id,
      operation: "close_ballot",
      method: "close_ballot",
      args: [id],
    });
    await Promise.all([refreshTruth(), refreshGovernance(), refreshRegistry({ fresh: true })]);
  } catch (error) {
    toast("error", `Could not close the ballot: ${errMsg(error)}`, 10000);
  }
}

async function syncOutcomeVerification(id) {
  try {
    await executeWrite({
      address: CONFIG.LIVING_CONTRACT_ADDRESS,
      kind: LIVING_KIND,
      caseId: id,
      operation: "sync_outcome_verification",
      method: "sync_outcome_verification",
      args: [id],
    });
    await Promise.all([refreshGovernance(), refreshRegistry({ fresh: true })]);
  } catch (error) {
    toast("error", `Could not update the outcome: ${errMsg(error)}`, 10000);
  }
}

async function retryOutcomeVerification(id) {
  try {
    await executeWrite({
      address: CONFIG.LIVING_CONTRACT_ADDRESS,
      kind: LIVING_KIND,
      caseId: id,
      operation: "retry_outcome_verification",
      method: "retry_outcome_verification",
      args: [id],
    });
    await Promise.all([refreshTruth(), refreshGovernance(), refreshRegistry({ fresh: true })]);
  } catch (error) {
    toast("error", `Could not retry the outcome check: ${errMsg(error)}`, 10000);
  }
}

function setRefreshBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = busy ? "Refreshing…" : label;
}

function bind(id, eventName, handler) {
  const element = $(id);
  if (element) element.addEventListener(eventName, handler);
}

bind("connect-wallet", "click", connectWallet);
bind("disconnect-wallet", "click", disconnectWallet);
bind("truth-form", "submit", submitTruth);
bind("proposal-form", "submit", submitProposal);
bind("add-source", "click", () => addSourceRow());
bind("add-verification-source", "click", () => addVerificationSourceRow());
bind("registry-search", "input", renderRegistry);
bind("registry-source", "change", renderRegistry);
bind("copy-contracts", "click", async () => {
  const text = `TruthFeed: ${CONFIG.TRUTH_CONTRACT_ADDRESS}\nLivingConstitution: ${CONFIG.LIVING_CONTRACT_ADDRESS}`;
  try {
    await navigator.clipboard.writeText(text);
    toast("success", "Both contract addresses copied.");
  } catch {
    toast("error", "Clipboard access was unavailable.");
  }
});

bind("refresh-truth", "click", async (event) => {
  setRefreshBusy(event.currentTarget, true, "Refresh questions");
  try { await refreshTruth(); } catch (error) { toast("error", errMsg(error)); }
  finally { setRefreshBusy(event.currentTarget, false, "Refresh questions"); }
});
bind("refresh-governance", "click", async (event) => {
  setRefreshBusy(event.currentTarget, true, "Refresh governance");
  try { await refreshGovernance(); } catch (error) { toast("error", errMsg(error)); }
  finally { setRefreshBusy(event.currentTarget, false, "Refresh governance"); }
});
bind("refresh-registry", "click", async (event) => {
  setRefreshBusy(event.currentTarget, true, "Sync registry");
  try { await refreshRegistry({ fresh: true }); } catch (error) { toast("error", errMsg(error)); }
  finally { setRefreshBusy(event.currentTarget, false, "Sync registry"); }
});
bind("refresh-transactions", "click", async (event) => {
  setRefreshBusy(event.currentTarget, true, "Refresh status");
  try { await refreshTrackedTransactions({ announce: true }); }
  finally { setRefreshBusy(event.currentTarget, false, "Refresh status"); }
});
bind("dismiss-transactions", "click", () => {
  const active = readTrackedTransactions().filter(
    (item) => !["FINALIZED", "FAILED", "CANCELED"].includes(String(item.status || "").toUpperCase()),
  );
  writeTrackedTransactions(active);
});

if ($("source-inputs")) addSourceRow();
if ($("verification-source-inputs")) addVerificationSourceRow();
renderWallet();
renderTransactionActivity();
if (window.ethereum) bindWalletEvents(window.ethereum);
refreshAll();
if ($("transaction-activity")) refreshTrackedTransactions().catch(() => {});

window.setInterval(() => {
  if (
    document.visibilityState === "visible" &&
    ["home", "evidence", "governance", "decisions"].includes(PAGE)
  ) refreshRegistry({ fresh: false }).catch(() => {});
}, 60_000);

window.setInterval(() => {
  if (
    $("transaction-activity") &&
    document.visibilityState === "visible" &&
    readTrackedTransactions().length
  ) {
    refreshTrackedTransactions().catch(() => {});
  }
}, 15_000);
