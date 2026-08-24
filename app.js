import { createClient, chains } from "genlayer-js";

import {
  LIVING_KIND,
  TRUTH_KIND,
  createCaseId,
  finalityLabel,
  isPublicHttpsSource,
  isProductionRecordId,
  normalizePage,
  shortAddress,
  splitCharter,
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
const WALLET_KEY = "oracle_wallet_v1";
const PAGE_SIZE = 50;
const MAX_SOURCES = 5;
const CONFIGURED =
  isConfiguredRpcUrl(CONFIG.RPC_URL) &&
  isConfiguredAddress(CONFIG.LIVING_CONTRACT_ADDRESS) &&
  isConfiguredAddress(CONFIG.TRUTH_CONTRACT_ADDRESS) &&
  /^https:\/\//.test(String(CONFIG.REGISTRY_API_BASE || ""));

const state = {
  wallet: null,
  owner: "",
  truthOwner: "",
  constitution: "",
  constitutionVersion: 0,
  questions: [],
  proposals: [],
  ballots: [],
  registry: [],
  registryWarning: "",
};

const readClient = CONFIGURED
  ? createClient({ chain: chains.studionet, endpoint: CONFIG.RPC_URL })
  : null;
let writeClient = null;
let writeClientAddress = "";
let walletEventsBound = false;

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

async function connectWallet() {
  const provider = window.ethereum;
  if (!provider) {
    toast("error", "No browser wallet found. Install MetaMask and create a StudioNet-only test account.");
    return;
  }
  let accounts;
  try {
    accounts = await provider.request({ method: "eth_requestAccounts" });
  } catch (error) {
    toast("error", `Wallet connection was not approved: ${errMsg(error)}`);
    return;
  }
  if (!Array.isArray(accounts) || !accounts[0]) {
    toast("error", "The wallet did not provide an account.");
    return;
  }
  if (!(await ensureStudioNetwork(provider))) {
    toast("error", "StudioNet was not confirmed. Add chain 61999 and try again.");
    return;
  }
  sessionStorage.setItem(WALLET_KEY, JSON.stringify({ address: accounts[0] }));
  bindWalletEvents(provider);
  renderWallet();
  toast("success", `Connected ${shortAddress(accounts[0])} on StudioNet.`);
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
  } catch (error) {
    console.warn("Registry tracking failed; the contract write is unaffected:", error);
  }
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
  toast("info", `Transaction ${shortAddress(hash)} submitted; waiting for validator consensus…`, 9000);
  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: "ACCEPTED",
    interval: longPoll ? 4000 : 2500,
    retries: longPoll ? 300 : 100,
  });
  const failure = receiptFailure(receipt);
  if (failure) throw new Error(`${failure} Transaction ${shortAddress(hash)}.`);
  await registerTransaction(hash, kind, caseId, operation);
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

async function refreshTruth() {
  const [rawPage, ownership] = await Promise.all([
    readContract(CONFIG.TRUTH_CONTRACT_ADDRESS, "list_questions", [0, PAGE_SIZE]),
    readContract(CONFIG.TRUTH_CONTRACT_ADDRESS, "get_ownership_state").catch(() => ({ owner: "" })),
  ]);
  const page = normalizePage(rawPage);
  state.questions = page.items
    .map(normalizeQuestion)
    .filter((item) => isProductionRecordId(item.id));
  state.truthOwner = String(ownership?.owner || "");
  renderQuestions();
  renderMetrics();
}

async function refreshGovernance() {
  const [constitution, version, rawProposals, ownership, rawBallots] = await Promise.all([
    readContract(CONFIG.LIVING_CONTRACT_ADDRESS, "get_constitution"),
    readContract(CONFIG.LIVING_CONTRACT_ADDRESS, "constitution_version_count"),
    readContract(CONFIG.LIVING_CONTRACT_ADDRESS, "list_proposals", [0, PAGE_SIZE]),
    readContract(CONFIG.LIVING_CONTRACT_ADDRESS, "get_ownership_state").catch(() => ({ owner: "" })),
    readContract(CONFIG.LIVING_CONTRACT_ADDRESS, "list_ballots", [0, PAGE_SIZE]).catch(() => ({ items: [] })),
  ]);
  const proposalPage = normalizePage(rawProposals);
  const ballotPage = normalizePage(rawBallots);
  state.constitution = String(constitution || "");
  state.constitutionVersion = Number(version || 0);
  state.proposals = proposalPage.items
    .map(normalizeProposal)
    .filter((item) => isProductionRecordId(item.id));
  state.owner = String(ownership?.owner || "");
  state.ballots = ballotPage.items
    .map(normalizeBallot)
    .filter((item) => isProductionRecordId(item.proposal_id));
  renderCharter();
  renderProposals();
  renderMetrics();
}

async function refreshRegistry({ fresh = false } = {}) {
  const response = await fetch(registryUrl(`/api/registry?fresh=${fresh ? "1" : "0"}&limit=200`), {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Registry returned HTTP ${response.status}`);
  const result = await response.json();
  state.registry = Array.isArray(result.items)
    ? result.items.filter((item) => isProductionRecordId(item?.case_id))
    : [];
  state.registryWarning = String(result.warning || "");
  renderRegistry();
  renderQuestions();
  renderProposals();
  renderMetrics();
}

async function refreshAll({ freshRegistry = false } = {}) {
  if (!CONFIGURED) {
    $("network-status").classList.add("is-error");
    $("network-status").lastChild.textContent = "Config error";
    toast("error", "Oracle by Plain3rd deployment configuration is incomplete.", 10000);
    return;
  }
  const results = await Promise.allSettled([
    refreshTruth(),
    refreshGovernance(),
    refreshRegistry({ fresh: freshRegistry }),
  ]);
  const failures = results.filter((result) => result.status === "rejected");
  const status = $("network-status");
  status.classList.toggle("is-live", failures.length < results.length);
  status.classList.toggle("is-error", failures.length === results.length);
  status.lastChild.textContent = failures.length === results.length ? "Unavailable" : "Live · StudioNet";
  if (failures.length) {
    console.warn("Oracle by Plain3rd refresh warnings:", failures.map((item) => item.reason));
  }
}

function renderMetrics() {
  $("truth-count").textContent = String(state.questions.length);
  $("proposal-count").textContent = String(state.proposals.length);
  $("final-count").textContent = String(state.registry.filter((item) => item.finality?.final).length);
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

function renderQuestions() {
  const container = $("truth-feed");
  if (!container) return;
  container.replaceChildren();
  if (!state.questions.length) {
    container.appendChild(textElement("div", "empty-card", "No production questions have been recorded yet."));
    return;
  }

  for (const question of state.questions.slice(0, 12)) {
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

    if (question.criteria) {
      card.append(textElement("p", "card-label", "Resolution rule"));
      card.append(textElement("p", "card-copy", question.criteria));
    }

    if (question.sources.length) {
      card.append(textElement("p", "card-label", "Evidence"));
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
      card.appendChild(list);
    }

    if (question.outcome) {
      card.append(textElement("p", "card-label", "Consensus result"));
      const citationText = question.citations.length ? ` · sources ${question.citations.join(", ")}` : "";
      card.append(textElement("p", "card-copy", `${question.outcome.toUpperCase()}${citationText}`));
      if (question.reasoning) {
        card.append(textElement("p", "rationale", `Leader rationale · not authoritative: ${question.reasoning}`));
      }
    }

    if (question.history.length) {
      const details = document.createElement("details");
      details.className = "history";
      details.appendChild(textElement("summary", "", `${question.history.length} preserved resolution round${question.history.length === 1 ? "" : "s"}`));
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
      details.appendChild(historyList);
      card.appendChild(details);
    }

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
}

function renderCharter() {
  $("charter-version").textContent = `version ${state.constitutionVersion || "—"}`;
  const list = $("charter-list");
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

  for (const proposal of state.proposals.slice(0, 12)) {
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

    if (proposal.rule_refs.length) {
      card.append(textElement("p", "card-label", "Cited charter rules"));
      const refs = document.createElement("ul");
      refs.className = "ref-list";
      proposal.rule_refs.forEach((ref) => refs.appendChild(textElement("li", "", ref)));
      card.appendChild(refs);
    }
    if (proposal.analysis) {
      card.append(textElement("p", "rationale", `Leader rationale · not authoritative: ${proposal.analysis}`));
    }

    if (proposal.review_history.length) {
      const details = document.createElement("details");
      details.className = "history";
      details.appendChild(textElement("summary", "", `${proposal.review_history.length} preserved constitutional review${proposal.review_history.length === 1 ? "" : "s"}`));
      const historyList = document.createElement("ol");
      proposal.review_history.forEach((review) => {
        historyList.appendChild(
          textElement("li", "", `Review ${review.review || "?"}: ${String(review.verdict || "unknown").replaceAll("_", " ")} · charter v${review.constitution_version || "?"}`),
        );
      });
      details.appendChild(historyList);
      card.appendChild(details);
    }

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
    if (proposal.status === "compliant" && isOwner && (!ballot || ballot.status !== "open")) {
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
    if (actions.childElementCount) card.appendChild(actions);
    container.appendChild(card);
  }
}

function renderRegistry() {
  const query = $("registry-search").value.trim().toLowerCase();
  const source = $("registry-source").value;
  const items = state.registry.filter((item) => {
    if (source !== "all" && item.source_name !== source) return false;
    if (!query) return true;
    return [item.title, item.content, item.case_id, item.status, item.decision, item.source_name]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });
  $("registry-count").textContent = `${items.length} of ${state.registry.length} indexed decisions`;
  const container = $("registry-list");
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

function addSourceRow(value = "") {
  const container = $("source-inputs");
  if (container.children.length >= MAX_SOURCES) return;
  const row = document.createElement("div");
  row.className = "source-row";
  const input = document.createElement("input");
  input.className = "source-url";
  input.type = "url";
  input.inputMode = "url";
  input.maxLength = 2048;
  input.placeholder = "https://public-source.org/article";
  input.value = value;
  input.setAttribute("aria-label", `Evidence source ${container.children.length + 1}`);
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

function sourceValues() {
  return Array.from(document.querySelectorAll(".source-url"))
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
  if (!title || !body) {
    error.textContent = "Proposal title and body are required.";
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
      args: [id, title, body],
    });
    event.target.reset();
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
  const quorumValue = window.prompt("Minimum number of wallets required for this 24-hour ballot:", "3");
  if (quorumValue === null) return;
  const quorum = Number(quorumValue);
  if (!Number.isInteger(quorum) || quorum < 1 || quorum > 1_000_000) {
    toast("error", "Quorum must be a whole number from 1 to 1,000,000.");
    return;
  }
  try {
    await executeWrite({
      address: CONFIG.LIVING_CONTRACT_ADDRESS,
      kind: LIVING_KIND,
      caseId: id,
      operation: "open_ballot",
      method: "open_ballot",
      args: [id, Math.floor(Date.now() / 1000) + 86400, quorum],
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
    await Promise.all([refreshGovernance(), refreshRegistry({ fresh: true })]);
  } catch (error) {
    toast("error", `Could not close the ballot: ${errMsg(error)}`, 10000);
  }
}

function setRefreshBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = busy ? "Refreshing…" : label;
}

$("connect-wallet").addEventListener("click", connectWallet);
$("disconnect-wallet").addEventListener("click", disconnectWallet);
$("truth-form").addEventListener("submit", submitTruth);
$("proposal-form").addEventListener("submit", submitProposal);
$("add-source").addEventListener("click", () => addSourceRow());
$("registry-search").addEventListener("input", renderRegistry);
$("registry-source").addEventListener("change", renderRegistry);
$("copy-contracts").addEventListener("click", async () => {
  const text = `TruthFeed: ${CONFIG.TRUTH_CONTRACT_ADDRESS}\nLivingConstitution: ${CONFIG.LIVING_CONTRACT_ADDRESS}`;
  try {
    await navigator.clipboard.writeText(text);
    toast("success", "Both contract addresses copied.");
  } catch {
    toast("error", "Clipboard access was unavailable.");
  }
});

$("refresh-truth").addEventListener("click", async (event) => {
  setRefreshBusy(event.currentTarget, true, "Refresh questions");
  try { await refreshTruth(); } catch (error) { toast("error", errMsg(error)); }
  finally { setRefreshBusy(event.currentTarget, false, "Refresh questions"); }
});
$("refresh-governance").addEventListener("click", async (event) => {
  setRefreshBusy(event.currentTarget, true, "Refresh governance");
  try { await refreshGovernance(); } catch (error) { toast("error", errMsg(error)); }
  finally { setRefreshBusy(event.currentTarget, false, "Refresh governance"); }
});
$("refresh-registry").addEventListener("click", async (event) => {
  setRefreshBusy(event.currentTarget, true, "Sync registry");
  try { await refreshRegistry({ fresh: true }); } catch (error) { toast("error", errMsg(error)); }
  finally { setRefreshBusy(event.currentTarget, false, "Sync registry"); }
});

addSourceRow();
renderWallet();
if (window.ethereum) bindWalletEvents(window.ethereum);
refreshAll();

window.setInterval(() => {
  if (document.visibilityState === "visible") refreshRegistry({ fresh: false }).catch(() => {});
}, 60_000);
