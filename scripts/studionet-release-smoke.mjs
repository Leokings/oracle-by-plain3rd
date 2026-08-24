import { createAccount, createClient, chains } from "../vendor/genlayer-js/index.js";

import { receiptFailure } from "../tx-utils.js";


const RPC_URL = "https://studio.genlayer.com/api";
const REGISTRY_URL = "https://livingconstitution-nine.vercel.app";
const TRUTH_ADDRESS = "0x4207498939EC4649B8aF2dDE13Df69D9383Ac49a";
const LIVING_ADDRESS = "0xC4d913fCdA9Bfe3BA2207f7970d9834b2159EfF1";
const TRUTH_KIND = "truthfeed.question.v1";
const LIVING_KIND = "livingconstitution.proposal.v1";

if (process.env.RUN_STUDIONET_SMOKE !== "1") {
  throw new Error("Set RUN_STUDIONET_SMOKE=1 to create real transactions on gasless StudioNet.");
}

const account = createAccount();
const client = createClient({ chain: chains.studionet, endpoint: RPC_URL, account });
const suffix = account.address.slice(-8).toLowerCase();
const existingQuestionId = process.env.STUDIONET_EXISTING_QUESTION_ID?.trim();
const existingQuestionCreateHash = process.env.STUDIONET_EXISTING_QUESTION_CREATE_HASH?.trim();
const questionId = existingQuestionId || `q-genlayer-intelligent-contracts-${suffix}`;
const proposalId = `p-oracle-review-transparency-${suffix}`;

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
    "Approve a documentation-only release that publishes the deployed contract addresses, exact source revisions, security and test results, transaction-recovery guidance, and a monthly public reliability update. No treasury allocation or private user data is requested.",
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
  proposal: { id: proposalId, status: proposal.status, constitution_version: proposal.constitution_version },
}, null, 2));
