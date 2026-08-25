# LivingConstitution

LivingConstitution turns a DAO charter into an executable natural-language
review layer on GenLayer. A proposal is pinned to the current constitution
version when submitted. Validators independently review that exact version and
agree on:

- `verdict`: `compliant`, `non_compliant`, or `needs_review`
- `rule_refs`: canonical rule identifiers such as `article 2`

The leader's free-form analysis is stored for people to read, but is explicitly
labeled `leader_output_non_authoritative`; it is not misrepresented as something
every validator wrote or agreed word-for-word.

## Current capabilities

- Readable, append-only constitution versions
- Proposal-to-version pinning, even if the charter changes before review
- Required snapshots of resolved Evidence decisions for every proposal review
- A first-class `needs_review` result for genuinely ambiguous cases
- Validator comparison of verdict **and** canonical rule references
- Bounded constitution, proposal, model-output, pagination, and history sizes
- Prompt-injection boundaries around constitution and proposal text
- Reasoned creator rechecks under the latest constitution without erasing history
- Two-step administration transfer for a later multisig or DAO-controlled owner
- Creator-opened voting with a fixed deployment quorum and duration
- Stale-evidence invalidation and protection against recheck-canceling a live vote
- Automatic, idempotent outcome-verification questions after passed ballots
- Public syncing of verified outcomes back into the proposal record
- `get_voting_gate(id)` and normalized `get_decision(id)` integration views
- A shared Neon-backed decision registry with search, finality tracking, browser notifications,
  daily sync, and signed webhooks
- Wallet-only browser writes, configured RPC reads, strict receipt-success checks, and local JS bundles
- Accurate accepted-vs-finalized language and visible transaction hashes for appeals
- Direct tests, opt-in Studio integration test, GenVM lint, dependency audit, and CI

## Live release

The current StudioNet contract is
`0x793021e64B3289B291De6182A04DBF055b346408`, linked to Evidence at
`0xcf2C42546E652A84aE5A5586707F053B6e299e7a`. The root of
[livingconstitution-nine.vercel.app](https://livingconstitution-nine.vercel.app)
redirects to Oracle by Plain3rd while its registry API remains active.
Vercel generates `config.js` from project environment variables, and Git pushes
to `master` produce the production deployment. See
[DEPLOYMENT.md](DEPLOYMENT.md) for transaction, owner, rollback, and release
details.

The three legacy proposals and their histories were imported, verified, and the
one-time importer was permanently closed. The contract runner is intentionally
pinned to the reviewed hash on the first line.

## Contract surface

Writes:

- `submit_proposal(id, title, body, evidence_ids_json, verification_question, verification_criteria, verification_sources_json, verification_delay_seconds)`
- `check_proposal(id)`
- `request_recheck_with_reason(id, reason)` — proposal creator
- `request_recheck(id)` — compatibility alias
- `reset_check(id)` — owner-only compatibility alias
- `open_ballot(id)` — proposal creator; fixed on-chain policy
- `cast_vote(id, support)` — one vote per wallet
- `close_ballot(id)` — anyone after the deadline
- `invalidate_stale_ballot(id)` — anyone when linked evidence changed
- `sync_outcome_verification(id)` — anyone after the linked question resolves
- `retry_outcome_verification(id)` — re-emit an idempotent follow-up
- `cancel_ballot(id, reason)` — owner only
- `import_legacy_proposal(id)` — owner-only, while one-time migration is open
- `finish_migration()` — permanently closes the one-time importer
- `update_constitution(text)` — owner only
- `transfer_ownership(new_owner)` — stage a new owner
- `accept_ownership()` — pending owner only
- `cancel_ownership_transfer()` — owner only

Views:

- `get_proposal(id)`
- `get_review_history(id)`
- `list_proposals(offset, limit)`
- `get_constitution()`
- `get_constitution_version(version)`
- `constitution_version_count()`
- `is_votable(id)`
- `get_voting_gate(id)`
- `get_ballot(id)`
- `get_ballot_vote(id, voter)`
- `list_ballots(offset, limit)`
- `get_decision(id)`
- `get_stats()`
- `get_owner()`
- `get_ownership_state()`
- `get_integration_config()`
- `get_ballot_policy()`
- `get_migration_state()`

The bundled ballot is a public pilot, not Sybil-resistant DAO membership. A real
voting or treasury adapter should enforce membership/token eligibility and the
desired GenLayer finality state before acting on a compliant decision.

## Test it

On Windows, run one command from this directory:

```powershell
.\scripts\test.ps1
```

It installs local test tools, lints the contract, runs fast mocked tests, tests
and bundles the frontend, and audits npm dependencies. It does not deploy and
does not write to a network. See [TESTING.md](TESTING.md) for the browser flow
and the opt-in full-consensus Studio test.

## Project layout

```text
contracts/living_constitution.py  intelligent contract
tests/test_living_constitution.py fast direct-mode tests
tests/test_integration.py         opt-in full-consensus Studio test
frontend/app.js                   browser source
frontend/app.bundle.js            generated browser bundle (gitignored)
frontend/dist/                    generated Vercel artifact (gitignored)
frontend/tx-utils.js              receipt/config normalization
frontend/api/                     Vercel Decision Registry functions
frontend/server/                  chain index, Neon, finality, webhook logic
scripts/test.ps1                  one-command Windows verification
```

## Practical expansion path

The registry, recheck dashboard, voting pilot, and staged ownership path are now
implemented. The best next production modules are a real DAO membership/token
snapshot adapter, a timelocked treasury executor that requires finalized
compliant decisions, and small escrow/SLA/market adapters that consume the shared
`get_decision` schema instead of copying adjudication logic.
