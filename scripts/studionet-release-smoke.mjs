import { createAccount, createClient, chains } from "../vendor/genlayer-js/index.js";

import { receiptFailure } from "../tx-utils.js";


const RPC_URL = "https://studio.genlayer.com/api";
const REGISTRY_URL = "https://livingconstitution-nine.vercel.app";
const TRUTH_ADDRESS = "0x704687cD890E636696F9362708c8832fbcC40773";
const LIVING_ADDRESS = "0x7e397Abe9df988b05266d613b1c099a1458f0Fda";
const TRUTH_KIND = "truthfeed.question.v2";
const LIVING_KIND = "livingconstitution.proposal.v2";

if (process.env.RUN_STUDIONET_SMOKE !== "1") {
  throw new Error("Set RUN_STUDIONET_SMOKE=1 to create real transactions on gasless StudioNet.");
}

const account = createAccount();
const client = createClient({ chain: chains.studionet, endpoint: RPC_URL, account });
const suffix = account.address.slice(-8).toLowerCase();
const existingQuestionId = process.env.STUDIONET_EXISTING_QUESTION_ID?.trim();
const existingQuestionCreateHash = process.env.STUDIONET_EXISTING_QUESTION_CREATE_HASH?.trim();
const questionId = existingQuestionId || `release-check-evidence-${suffix}`;
const proposalId = `release-check-governance-${suffix}`;

console.log(`Fresh ephemeral StudioNet wallet: ${account.address}`);
console.log("The private key is not printed or persisted.");

async function register(hash, kind, caseId, operation) {
  const response = await fetch(`${REGISTRY_URL}/api/transactions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hash, kind, case_id: caseId, operation }),
  });
  if (!response.ok) throw new Error(`Registry rejected ${operation}: HTTP ${response.status} ${await response.text()}`);
}

async function write({ address, kind, caseId, operation, args, long = false }) {
  const hash = await client.writeContract({ address, functionName: operation, args });
  console.log(`${operation}: ${hash}`);
  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: "ACCEPTED",
    interval: long ? 4000 : 2500,
    retries: long ? 300 : 100,
  });
  const failure = receiptFailure(receipt);
  if (failure) throw new Error(`${operation} failed: ${failure}`);
  await register(hash, kind, caseId, operation);
  return hash;
}

if (existingQuestionId) {
  console.log(`Resuming existing StudioNet question: ${questionId}`);
  if (existingQuestionCreateHash) {
    await register(existingQuestionCreateHash, TRUTH_KIND, questionId, "create_question");
  }
} else {
  await write({
    address: TRUTH_ADDRESS,
    kind: TRUTH_KIND,
    caseId: questionId,
    operation: "create_question",
    args: [
      questionId,
      "Does GenLayer documentation describe Intelligent Contracts as Python programs that can use nondeterministic operations?",
      "Answer YES only if the official GenLayer page states both that Intelligent Contracts are written in Python and that they can use nondeterministic operations. Answer NO if it contradicts either claim, otherwise UNCLEAR.",
      `json:${JSON.stringify(["https://docs.genlayer.com/developers/intelligent-contracts/introduction"])}`,
    ],
  });
}

await write({
  address: TRUTH_ADDRESS,
  kind: TRUTH_KIND,
  caseId: questionId,
  operation: "resolve_question",
  args: [questionId],
  long: true,
});

await write({
  address: LIVING_ADDRESS,
  kind: LIVING_KIND,
  caseId: proposalId,
  operation: "submit_proposal",
  args: [
    proposalId,
    "Publish an Oracle reviewer transparency package",
    "Approve Oracle interface version 2 and publish its linked contract addresses, exact source revisions, automated test and security results, transaction-recovery guidance, and monthly reliability updates. Preserve all prior decisions. No treasury allocation or private user data is requested.",
    `json:${JSON.stringify([questionId])}`,
    "Does the public Oracle guide describe the Evidence to Governance to outcome-verification loop?",
    "Answer YES only if the public guide describes sourced evidence supporting governance and a later evidence check verifying the result of an approved proposal. Answer NO if it contradicts that loop, otherwise UNCLEAR.",
    `json:${JSON.stringify(["https://oracle-by-plain3rd.vercel.app/how-it-works"])}`,
    0,
  ],
});

await write({
  address: LIVING_ADDRESS,
  kind: LIVING_KIND,
  caseId: proposalId,
  operation: "check_proposal",
  args: [proposalId],
  long: true,
});

const [decision, proposal] = await Promise.all([
  client.readContract({ address: TRUTH_ADDRESS, functionName: "get_decision", args: [questionId] }),
  client.readContract({ address: LIVING_ADDRESS, functionName: "get_proposal", args: [proposalId] }),
]);

console.log(JSON.stringify({
  question: { id: questionId, status: decision.status, decision: decision.decision },
  proposal: {
    id: proposalId,
    status: proposal.status,
    constitution_version: proposal.constitution_version,
    evidence_ids: proposal.evidence_ids,
    verification_question_id: proposal.verification_question_id,
  },
}, null, 2));
