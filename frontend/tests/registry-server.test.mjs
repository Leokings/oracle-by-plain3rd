import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { abi } from "../vendor/genlayer-js/index.js";
import { json, requestJson } from "../server/http.js";
import {
  finalityForTest,
  isAdminAuthorization,
  registryConfiguration,
  validateTrackedTransactionCall,
  validateWebhookUrl,
} from "../server/registry.js";


test("webhook URLs must be public HTTPS addresses", () => {
  assert.equal(validateWebhookUrl("https://hooks.example.com/genlayer"), "https://hooks.example.com/genlayer");
  assert.throws(() => validateWebhookUrl("http://hooks.example.com/x"), /public HTTPS/);
  assert.throws(() => validateWebhookUrl("https://localhost/x"), /public HTTPS/);
  assert.throws(() => validateWebhookUrl("https://127.0.0.1/x"), /public HTTPS/);
  assert.throws(() => validateWebhookUrl("https://192.168.1.4/x"), /public HTTPS/);
  assert.throws(() => validateWebhookUrl("https://[::1]/x"), /public HTTPS/);
  assert.throws(() => validateWebhookUrl("https://user:secret@hooks.example.com/x"), /credentials/);
});

test("webhook administration requires the exact bearer token", () => {
  const previous = process.env.REGISTRY_ADMIN_TOKEN;
  process.env.REGISTRY_ADMIN_TOKEN = "test-admin-token";
  try {
    assert.equal(isAdminAuthorization("Bearer test-admin-token"), true);
    assert.equal(isAdminAuthorization("Bearer wrong"), false);
    assert.equal(isAdminAuthorization(""), false);
  } finally {
    if (previous === undefined) delete process.env.REGISTRY_ADMIN_TOKEN;
    else process.env.REGISTRY_ADMIN_TOKEN = previous;
  }
});

test("HTTP helper returns no-store JSON with CORS", async () => {
  const response = json({ ok: true });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.deepEqual(await response.json(), { ok: true });
});

test("HTTP helper emits a bodyless CORS preflight response", async () => {
  const response = json({}, { status: 204 });
  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("access-control-allow-methods"), "GET,POST,DELETE,OPTIONS");
});

test("request body helper enforces its byte bound", async () => {
  const request = new Request("https://example.com/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: "ok" }),
  });
  assert.deepEqual(await requestJson(request, 100), { value: "ok" });
  const oversized = new Request("https://example.com/api", {
    method: "POST",
    body: "x".repeat(101),
  });
  await assert.rejects(() => requestJson(oversized, 100), /too large/);
});

test("registry configuration never returns database credentials", () => {
  const configuration = registryConfiguration();
  assert.equal(configuration.network, "studionet");
  assert.equal(configuration.studio_native_appeals, false);
  assert.equal("database_url" in configuration, false);
});

test("transaction tracking binds the operation and case id to decoded calldata", () => {
  const raw = abi.calldata.encode(
    abi.calldata.makeCalldataObject("cast_vote", ["proposal-7", true])
  );
  const transaction = { data: { calldata: { raw: Array.from(raw) } } };
  const input = {
    kind: "livingconstitution.proposal.v3",
    caseId: "proposal-7",
    operation: "cast_vote_for",
  };
  assert.equal(validateTrackedTransactionCall(transaction, input).method, "cast_vote");
  assert.throws(
    () => validateTrackedTransactionCall(transaction, { ...input, caseId: "proposal-8" }),
    /case_id/
  );
  assert.throws(
    () => validateTrackedTransactionCall(transaction, { ...input, operation: "close_ballot" }),
    /operation/
  );
});

test("registry finality normalizes numeric Studio transaction statuses", () => {
  assert.deepEqual(finalityForTest({
    tx_status: 7,
    tx_payload: {
      result_name: "MAJORITY_AGREE",
      execution_result_name: "FINISHED_WITH_RETURN",
    },
  }), {
    status: "FINALIZED",
    label: "Final",
    final: true,
    appeal_supported: false,
  });
  assert.equal(finalityForTest({ tx_status: "5" }).status, "ACCEPTED");
});

test("registry does not call a validator-rejected transaction final", () => {
  const finality = finalityForTest({
    tx_status: 7,
    tx_payload: {
      result: 7,
      execution_result_name: "FINISHED_WITH_RETURN",
    },
  });
  assert.equal(finality.final, false);
  assert.match(finality.label, /Rejected by validators/);
});

test("database schema contains all durable registry tables", async () => {
  const schema = await readFile(new URL("../server/schema.sql", import.meta.url), "utf8");
  for (const table of [
    "decisions",
    "case_transactions",
    "webhook_subscriptions",
    "webhook_deliveries",
    "registry_sync_runs",
  ]) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
});
