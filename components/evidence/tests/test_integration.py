"""Opt-in full-consensus smoke test for local Studio or hosted StudioNet."""

import json
import os
import time

import pytest

from gltest import create_accounts, get_contract_factory, get_gl_client
from gltest.assertions import tx_execution_succeeded
from gltest.contracts import Contract
from gltest.utils import extract_contract_address


pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        os.getenv("RUN_GENLAYER_INTEGRATION") != "1",
        reason="Set RUN_GENLAYER_INTEGRATION=1 with GenLayer Studio running",
    ),
]


def deploy_with_schema_retry(factory, test_wallet):
    """Wait for hosted StudioNet's code-to-schema index after acceptance."""
    contract_address = os.getenv("TRUTHFEED_INTEGRATION_CONTRACT")
    if contract_address:
        print(f"Reusing temporary contract: {contract_address}")
    else:
        receipt = factory.deploy_contract_tx(
            account=test_wallet,
            args=[""],
            consensus_max_rotations=5,
        )
        assert tx_execution_succeeded(receipt)
        contract_address = extract_contract_address(receipt)
        print(f"Deployed temporary contract: {contract_address}")

    for attempt in range(20):
        try:
            schema = get_gl_client().get_contract_schema(contract_address)
            return Contract.new(contract_address, schema, account=test_wallet)
        except Exception:
            if attempt == 19:
                raise
            time.sleep(3)


def test_truthfeed_full_consensus_workflow():
    test_wallet = create_accounts(1)[0]
    print(f"Using fresh throwaway wallet: {test_wallet.address}")
    release_smoke = os.getenv("GENLAYER_RELEASE_SMOKE") == "1"
    reused_contract = bool(os.getenv("TRUTHFEED_INTEGRATION_CONTRACT"))
    factory = get_contract_factory("TruthFeed")
    contract = deploy_with_schema_retry(factory, test_wallet)
    if not reused_contract:
        assert contract.get_owner().call().lower() == test_wallet.address.lower()
    question_prefix = "release-example-domain" if release_smoke else "integration-example"
    question_id = f"{question_prefix}-{test_wallet.address[-8:].lower()}"

    create_receipt = contract.create_question(
        args=[
            question_id,
            "StudioNet pilot: Does this page identify itself as Example Domain?",
            "YES only if the visible page identifies itself as Example Domain.",
            json.dumps(["https://example.com/"]),
        ]
    ).transact(consensus_max_rotations=5)
    assert tx_execution_succeeded(create_receipt)

    resolve_receipt = contract.resolve_question(
        args=[question_id]
    ).transact(
        consensus_max_rotations=5,
        wait_interval=3000,
        wait_retries=150,
    )
    assert tx_execution_succeeded(resolve_receipt)

    decision = contract.get_decision(args=[question_id]).call()
    assert decision["status"] == "resolved"
    assert decision["decision"] in ("yes", "no", "unclear")
    assert decision["kind"] == "truthfeed.question.v3"
    assert decision["authoritative_fields"] == ["decision", "support_refs"]

    if release_smoke:
        print(f"Release pilot question resolved: {question_id}")
        return

    recheck_receipt = contract.request_recheck(
        args=[
            question_id,
            "Fresh-wallet StudioNet verification requested another evidence review.",
        ]
    ).transact(consensus_max_rotations=5)
    assert tx_execution_succeeded(recheck_receipt)
    reopened = contract.get_question(args=[question_id]).call()
    assert reopened["status"] == "open"
    assert len(reopened["history"]) == 1
    assert len(reopened["recheck_requests"]) == 1
