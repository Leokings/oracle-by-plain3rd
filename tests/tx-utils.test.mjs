import test from "node:test";
import assert from "node:assert/strict";

import {
  isConfiguredAddress,
  isConfiguredRpcUrl,
  receiptConsensusResultName,
  receiptExecutionName,
  receiptFailure,
  receiptStatusName,
} from "../tx-utils.js";


test("normalizes numeric GenLayer receipt enums", () => {
  const receipt = { status: 5, txExecutionResult: 1 };
  assert.equal(receiptStatusName(receipt), "ACCEPTED");
  assert.equal(receiptExecutionName(receipt), "FINISHED_WITH_RETURN");
  assert.equal(receiptFailure(receipt), null);
});

test("supports snake_case SDK receipt fields", () => {
  assert.equal(
    receiptFailure({ status_name: "FINALIZED", tx_execution_result_name: "FINISHED_WITH_RETURN" }),
    null,
  );
});

test("accepts a raw Studio majority-agree receipt", () => {
  assert.equal(
    receiptFailure({
      status: 7,
      result: 6,
      consensus_data: { leader_receipt: [{ execution_result: "SUCCESS" }] },
    }),
    null,
  );
});

test("accepts raw Studio SUCCESS and ERROR execution aliases", () => {
  assert.equal(
    receiptFailure({
      status_name: "ACCEPTED",
      consensus_data: { leader_receipt: [{ execution_result: "SUCCESS" }] },
    }),
    null,
  );
  assert.match(
    receiptFailure({
      status_name: "ACCEPTED",
      consensus_data: { leader_receipt: [{ execution_result: "ERROR", error: "revert" }] },
    }),
    /failed/i,
  );
});

test("does not confuse consensus acceptance with execution success", () => {
  const receipt = {
    status: 5,
    txExecutionResult: 2,
    consensus_data: { leader_receipt: { error: "[EXPECTED] duplicate id" } },
  };
  assert.match(receiptFailure(receipt), /duplicate id/);
  assert.match(receiptFailure({ status: 5 }), /did not prove successful/);
});

test("rejects failed consensus states and invalid deployment config", () => {
  assert.match(receiptFailure({ status: 8, txExecutionResult: 1 }), /CANCELED/);
  const undeterminedExecution = {
    status_name: "FINALIZED",
    result: 7,
    consensus_data: { leader_receipt: [{ execution_result: "SUCCESS" }] },
  };
  assert.equal(receiptConsensusResultName(undeterminedExecution), "MAJORITY_DISAGREE");
  assert.match(receiptFailure(undeterminedExecution), /Validators did not approve/);
  assert.equal(isConfiguredAddress("0x1111111111111111111111111111111111111111"), true);
  assert.equal(isConfiguredAddress("YOUR_CONTRACT"), false);
  assert.equal(isConfiguredRpcUrl("https://studio.genlayer.com/api"), true);
  assert.equal(isConfiguredRpcUrl("YOUR_RPC_URL"), false);
});
