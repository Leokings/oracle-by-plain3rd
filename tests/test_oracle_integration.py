"""Opt-in StudioNet test for Oracle's full cross-contract feedback loop."""

import json
import os
from pathlib import Path
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
        reason="Set RUN_GENLAYER_INTEGRATION=1 to write to StudioNet",
    ),
]

ROOT = Path(__file__).resolve().parents[2]
TRUTH_CONTRACT = ROOT / "truthfeed" / "contracts" / "truth_feed.py"
LIVING_CONTRACT = ROOT / "livingconstitution" / "contracts" / "living_constitution.py"


def deploy(factory, account, args=None):
    receipt = factory.deploy_contract_tx(
        args=args or [],
        account=account,
        consensus_max_rotations=5,
        wait_interval=3000,
        wait_retries=180,
    )
    assert_transaction_succeeded(receipt)
    address = extract_contract_address(receipt)
    for attempt in range(30):
        try:
            schema = get_gl_client().get_contract_schema(address)
            return Contract.new(address, schema, account=account)
        except Exception:
            if attempt == 29:
                raise
            time.sleep(3)


def consensus_result_name(receipt):
    explicit = receipt.get("result_name")
    if explicit:
        return str(getattr(explicit, "value", explicit)).upper()
    raw = str(receipt.get("result", ""))
    return {
        "0": "IDLE",
        "1": "AGREE",
        "2": "DISAGREE",
        "3": "TIMEOUT",
        "4": "DETERMINISTIC_VIOLATION",
        "5": "NO_MAJORITY",
        "6": "MAJORITY_AGREE",
        "7": "MAJORITY_DISAGREE",
    }.get(raw, "")


def assert_transaction_succeeded(receipt):
    result_name = consensus_result_name(receipt)
    assert result_name == "MAJORITY_AGREE", (
        f"validators did not approve the transaction: {result_name or 'missing result'}"
    )
    assert tx_execution_succeeded(receipt), "leader contract execution did not succeed"


def transact(method, *, triggered=False, consensus_attempts=1):
    last_receipt = None
    for attempt in range(consensus_attempts):
        last_receipt = method.transact(
            consensus_max_rotations=5,
            wait_interval=3000,
            wait_retries=180,
            wait_triggered_transactions=triggered,
        )
        if (
            consensus_result_name(last_receipt) == "MAJORITY_AGREE"
            and tx_execution_succeeded(last_receipt)
        ):
            return last_receipt
        if attempt + 1 < consensus_attempts and tx_execution_succeeded(last_receipt):
            print(
                "Validator consensus was "
                f"{consensus_result_name(last_receipt) or 'missing'}; retrying safely."
            )
            continue
        break
    assert_transaction_succeeded(last_receipt)
    return last_receipt


def test_oracle_cross_contract_feedback_loop():
    wallet = create_accounts(1)[0]
    print(f"Fresh throwaway StudioNet wallet: {wallet.address}")
    print("The private key is neither printed nor persisted.")

    truth_factory = get_contract_factory(contract_file_path=TRUTH_CONTRACT)
    living_factory = get_contract_factory(contract_file_path=LIVING_CONTRACT)
    truth = deploy(truth_factory, wallet, [""])
    print(f"Temporary TruthFeed: {truth.address}")

    constitution = (
        "Article 1: Proposals must improve Oracle accuracy, security, accessibility, "
        "reliability, or sustainable operation.\n"
        "Article 2: Proposals must cite resolved TruthFeed evidence.\n"
        "Article 3: Contract and public-rule changes must publish tests, security "
        "evidence, and preserve prior histories.\n"
        "Article 4: Proposals must not request secrets or private user data.\n"
        "Article 5: Approved work must publish a completion record."
    )
    living = deploy(living_factory, wallet, [constitution, truth.address, 60, 1, ""])
    print(f"Temporary LivingConstitution: {living.address}")
    transact(truth.set_governance_contract(args=[living.address]))

    suffix = wallet.address[-8:].lower()
    evidence_id = f"q-oracle-cross-contract-evidence-{suffix}"
    proposal_id = f"p-oracle-linked-workflow-{suffix}"
    evidence_source = (
        "https://docs.genlayer.com/developers/intelligent-contracts/features/"
        "interacting-with-intelligent-contracts"
    )
    verification_source = os.getenv(
        "ORACLE_VERIFICATION_SOURCE",
        "https://oracle-by-plain3rd.vercel.app/how-it-works",
    )

    transact(
        truth.create_question(
            args=[
                evidence_id,
                "Does GenLayer support synchronous contract views and asynchronous internal messages?",
                "YES only if the official documentation describes both view() reads and emit() messages between intelligent contracts.",
                json.dumps([evidence_source]),
            ]
        )
    )
    transact(truth.resolve_question(args=[evidence_id]), consensus_attempts=2)
    evidence = truth.get_decision(args=[evidence_id]).call()
    assert evidence["decision"] == "yes"

    transact(
        living.submit_proposal(
            args=[
                proposal_id,
                "Adopt Oracle's linked evidence and outcome workflow",
                (
                    "Adopt Oracle's accuracy, security, and reliability workflow. This "
                    f"proposal explicitly cites resolved TruthFeed decision {evidence_id}; "
                    "its YES outcome confirms that GenLayer supports the linked contract "
                    "reads and messages used by this workflow. Ballots require unchanged "
                    "evidence, and passed decisions create a public outcome check. Published "
                    f"test, security, and completion evidence is available at {verification_source}. "
                    "This changes no treasury allocation, requests no secrets or private "
                    "user data, and preserves every prior evidence, proposal, ballot, and "
                    "outcome history."
                ),
                json.dumps([evidence_id]),
                "Does Oracle's public guide explain the linked evidence and outcome workflow?",
                (
                    "YES only if the public guide states that governance uses resolved "
                    "TruthFeed evidence and passed proposals receive an outcome check."
                ),
                json.dumps([verification_source]),
                0,
            ]
        )
    )
    transact(living.check_proposal(args=[proposal_id]), consensus_attempts=2)
    proposal = living.get_proposal(args=[proposal_id]).call()
    assert proposal["evidence_snapshot"][0]["id"] == evidence_id
    assert proposal["evidence_snapshot"][0]["outcome"] == "yes"
    gate = living.get_voting_gate(args=[proposal_id]).call()
    assert gate["evidence_current"] is True

    full_loop = os.getenv("ORACLE_FULL_LOOP") == "1"
    if not full_loop:
        print(
            json.dumps(
                {
                    "truthfeed": truth.address,
                    "livingconstitution": living.address,
                    "evidence_id": evidence_id,
                    "proposal_id": proposal_id,
                    "proposal_status": proposal["status"],
                }
            )
        )
        return

    assert proposal["status"] == "compliant"
    transact(living.open_ballot(args=[proposal_id]))
    closes_at = int(living.get_ballot(args=[proposal_id]).call()["closes_at"])
    transact(living.cast_vote(args=[proposal_id, True]))
    while time.time() <= closes_at + 2:
        remaining = max(int(closes_at + 2 - time.time()), 0)
        print(f"Waiting for ballot deadline: {remaining}s")
        time.sleep(min(10, max(remaining, 1)))
    transact(living.close_ballot(args=[proposal_id]), triggered=True)

    verification_id = proposal["verification_question_id"]
    for attempt in range(30):
        try:
            linked = truth.get_question(args=[verification_id]).call()
            break
        except Exception:
            if attempt == 29:
                raise
            time.sleep(3)
    assert linked["linked_proposal_id"] == proposal_id
    transact(truth.resolve_question(args=[verification_id]), consensus_attempts=2)
    transact(living.sync_outcome_verification(args=[proposal_id]))
    final_decision = living.get_decision(args=[proposal_id]).call()
    assert final_decision["governance_outcome"] == "passed"
    assert final_decision["outcome_verification"]["status"] == "achieved"
    print(
        json.dumps(
            {
                "truthfeed": truth.address,
                "livingconstitution": living.address,
                "evidence_id": evidence_id,
                "proposal_id": proposal_id,
                "verification_id": verification_id,
                "verification_status": "achieved",
            }
        )
    )
