# TruthFeed

TruthFeed is a GenLayer intelligent contract for questions that ordinary smart
contracts cannot answer from chain data alone. A question includes explicit
resolution criteria and one to five HTTPS sources. Validators independently
fetch the evidence and agree on:

- `outcome`: `yes`, `no`, or `unclear`
- `citations`: canonical 1-based source numbers

The model's free-form reasoning is useful context, but it is explicitly stored
as `leader_output_non_authoritative`; it is not presented as validator consensus.

## Current capabilities

- Immediate or scheduled questions (`create_question_scheduled` prevents early resolution)
- Bounded IDs, question text, criteria, URLs, page content, output, pagination, and history
- Unique public-HTTPS evidence packs with local/private-style targets blocked
- Deterministic rejection when a YES/NO result cites an unavailable source
- Prompt-injection boundaries around all user and web content
- Independent validator comparison of outcome **and** canonical citations
- Creator-controlled reasoned rechecks, optional replacement evidence, and void controls
- Two-step administrative ownership for a future multisig or DAO-controlled owner
- Preserved decision history across re-resolution rounds
- Stable `get_decision` view for markets, escrow, insurance, SLA, or automation adapters
- One-time link to Oracle Governance and idempotent proposal-outcome questions
- Auditable one-time import from the pinned legacy Evidence contract
- Shared Decision Registry search, finality tracking, browser notifications, and signed webhooks
- Wallet-only browser writes, configured RPC reads, strict receipt-success checks, and local JS bundles
- Direct tests, opt-in Studio integration test, GenVM lint, dependency audit, and CI

## Live release

The current StudioNet contract is
`0xcf2C42546E652A84aE5A5586707F053B6e299e7a`, linked to Governance at
`0x793021e64B3289B291De6182A04DBF055b346408`. All four legacy questions and
their histories were imported, verified, and the one-time importer was
permanently closed. The former standalone frontend
[truthfeed-neon.vercel.app](https://truthfeed-neon.vercel.app) redirects to
[Oracle by Plain3rd](https://oracle-by-plain3rd.vercel.app). Vercel generates
`config.js` from project environment variables, and Git pushes to `master`
produce the production deployment. See [DEPLOYMENT.md](DEPLOYMENT.md) for
transaction, owner, rollback, and release details.

Existing storage fields remain in their original order. The contract runner is
intentionally pinned to the reviewed hash on the first line.

## Contract surface

Writes:

- `create_question(id, text, criteria, sources_json)`
- `create_question_scheduled(id, text, criteria, sources_json, resolve_not_before)`
- `create_outcome_verification(...)` — linked Governance contract only
- `resolve_question(id)`
- `reopen_question(id)`
- `request_recheck(id, reason)`
- `request_recheck_with_sources(id, reason, sources_json)`
- `void_question(id)`
- `transfer_ownership(new_owner)` — stage a new owner
- `accept_ownership()` — pending owner only
- `cancel_ownership_transfer()` — owner only
- `set_governance_contract(address)` — owner-only, one-time link
- `import_legacy_question(id)` — owner-only while the one-time migration is open
- `finish_migration()` — permanently closes legacy imports

Views:

- `get_question(id)`
- `get_decision_history(id)`
- `get_decision(id)`
- `can_resolve(id)`
- `list_questions(offset, limit)`
- `get_stats()`
- `get_owner()`
- `get_ownership_state()`
- `get_integration_config()`
- `get_migration_state()`

`get_decision` is the integration boundary. Downstream code should consume its
`decision` and `support_refs` fields, then separately decide how much finality it
requires before releasing funds or changing another protocol's state.

## Test it

On Windows, the easy path is one command from this directory:

```powershell
.\scripts\test.ps1
```

That command installs local test dependencies, lints the contract, runs the fast
mocked tests, tests and bundles the frontend, and audits npm dependencies. It does
not deploy and does not write to a network. See [TESTING.md](TESTING.md) for the
manual browser flow and the opt-in full-consensus Studio test.

## Project layout

```text
contracts/truth_feed.py       intelligent contract
tests/test_truth_feed.py      fast direct-mode tests
tests/test_integration.py     opt-in full-consensus Studio test
frontend/app.js               browser source
frontend/app.bundle.js        generated browser bundle (gitignored)
frontend/dist/                generated Vercel artifact (gitignored)
frontend/tx-utils.js          receipt/config normalization
scripts/test.ps1              one-command Windows verification
```

## Practical expansion path

The shared index, notifications, recheck workflow, and finality display are now
implemented. The next product layer should be small adapters around
`get_decision`, not copied oracle logic: a prediction-market resolver, escrow
release gate, and SLA/insurance trigger. Before real value is at risk, add the
target network's economic bond/native-appeal interface and require the chosen
GenLayer finality state.
