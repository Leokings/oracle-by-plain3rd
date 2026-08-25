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


def deploy_with_schema_retry(factory, test_wallet, args):
    """Wait for hosted StudioNet's code-to-schema index after acceptance."""
    contract_address = os.getenv("LIVINGCONSTITUTION_INTEGRATION_CONTRACT")
    if contract_address:
        print(f"Reusing temporary contract: {contract_address}")
    else:
        receipt = factory.deploy_contract_tx(
            args=args,
            account=test_wallet,
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


def test_living_constitution_full_consensus_workflow():
    test_wallet = create_accounts(1)[0]
    print(f"Using fresh throwaway wallet: {test_wallet.address}")
    release_smoke = os.getenv("GENLAYER_RELEASE_SMOKE") == "1"
    reused_contract = bool(os.getenv("LIVINGCONSTITUTION_INTEGRATION_CONTRACT"))
    constitution = (
        "Article 1: Proposals must serve the shared mission.\n"
        "Article 2: Spending proposals must contain an itemized budget."
    )
    truth_address = os.getenv("TRUTHFEED_INTEGRATION_CONTRACT")
    evidence_id = os.getenv("TRUTHFEED_INTEGRATION_EVIDENCE_ID")
    if not truth_address or not evidence_id:
        pytest.skip(
            "Set TRUTHFEED_INTEGRATION_CONTRACT and TRUTHFEED_INTEGRATION_EVIDENCE_ID"
        )
    factory = get_contract_factory("LivingConstitution")
    contract = deploy_with_schema_retry(
        factory, test_wallet, [constitution, truth_address, 300, 3, ""]
    )
    owner = contract.get_owner().call()
    if not reused_contract:
        assert owner.lower() == test_wallet.address.lower()
    proposal_prefix = "release-open-source-grant" if release_smoke else "integration-grant"
    proposal_id = f"{proposal_prefix}-{test_wallet.address[-8:].lower()}"

    submit_receipt = contract.submit_proposal(
        args=[
            proposal_id,
            "StudioNet pilot: open-source documentation grant",
            (
                "Allocate 1 percent of treasury holdings to an open-source developer "
                "documentation project. Publish monthly progress reports."
            ),
            json.dumps([evidence_id]),
            "Did the approved documentation project publish its promised reports?",
            "YES only if the public project page contains the promised reports.",
            '["https://example.com/"]',
            0,
        ]
    ).transact(consensus_max_rotations=5)
    assert tx_execution_succeeded(submit_receipt)

    check_receipt = contract.check_proposal(args=[proposal_id]).transact(
        consensus_max_rotations=5,
        wait_interval=3000,
        wait_retries=150,
    )
    assert tx_execution_succeeded(check_receipt)

    proposal = contract.get_proposal(args=[proposal_id]).call()
    assert proposal["status"] in ("compliant", "non_compliant", "needs_review")
    assert proposal["constitution_version"] == 1
    assert len(proposal["review_history"]) == 1

    gate = contract.get_voting_gate(args=[proposal_id]).call()
    assert gate["eligible_to_open"] is (proposal["status"] == "compliant")

    if proposal["status"] == "compliant" and owner.lower() == test_wallet.address.lower():
        open_receipt = contract.open_ballot(args=[proposal_id]).transact(
            consensus_max_rotations=5
        )
        assert tx_execution_succeeded(open_receipt)
        vote_receipt = contract.cast_vote(args=[proposal_id, True]).transact(
            consensus_max_rotations=5
        )
        assert tx_execution_succeeded(vote_receipt)
        ballot = contract.get_ballot(args=[proposal_id]).call()
        assert ballot["status"] == "open"
        assert ballot["votes_for"] == 1
        assert ballot["quorum"] == 3

    if release_smoke:
        print(f"Release pilot proposal reviewed: {proposal_id} -> {proposal['status']}")
        return

    if proposal["status"] == "compliant" and owner.lower() == test_wallet.address.lower():
        cancel_receipt = contract.cancel_ballot(
            args=[proposal_id, "Integration test cleanup before creator recheck."]
        ).transact(consensus_max_rotations=5)
        assert tx_execution_succeeded(cancel_receipt)

    recheck_receipt = contract.request_recheck_with_reason(
        args=[proposal_id, "Fresh-wallet StudioNet verification requested a second review."]
    ).transact(consensus_max_rotations=5)
    assert tx_execution_succeeded(recheck_receipt)
    reopened = contract.get_proposal(args=[proposal_id]).call()
    assert reopened["status"] == "submitted"
    assert len(reopened["review_history"]) == 1
    assert len(reopened["recheck_requests"]) == 1
    if proposal["status"] == "compliant" and owner.lower() == test_wallet.address.lower():
        assert contract.get_ballot(args=[proposal_id]).call()["status"] == "cancelled"
