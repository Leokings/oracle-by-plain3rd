# Governance contract audit

This audit compares the original StudioNet governance contract with the
creator-led v3 workflow.

## Fixed in v3

- **Admin-gated voting:** only the proposal creator can open voting for that
  proposal after a compliant review with current evidence.
- **Movable ballot rules:** quorum and duration are fixed when the contract is
  deployed. They cannot be chosen after a proposal passes review.
- **Losing-ballot cancellation:** a creator recheck can no longer cancel an
  active ballot. Emergency cancellation is a separate, reasoned admin action.
- **Stale evidence during voting:** changed evidence blocks new votes and any
  wallet can invalidate the stale ballot before the creator requests a recheck.
- **Read-error cancellation:** a linked-contract read failure now propagates as
  an error instead of pretending that valid evidence changed and making a
  ballot cancellable.
- **Unreviewed success criteria:** the full outcome-verification plan is now
  included in the validator review and preserved in its review snapshot.
- **Unrestricted outcome retries:** only the proposal creator can retry the
  proposal's automatic outcome check.
- **Cross-deployment question collisions:** new outcome-question IDs include a
  governance-contract suffix.
- **Permanent old integration link:** Evidence and Governance are replaced as a
  coordinated pair. The new Evidence contract is linked once to the new
  Governance address, so passed proposals can still create outcome checks.
- **Indirect Evidence-admin interference:** the Evidence admin can no longer
  reopen or void another creator's question and thereby disrupt that creator's
  governance ballot.
- **Misleading permissions in the interface:** creator-only actions are shown
  only to that creator, and a cancelled ballot from an earlier review no longer
  hides the next review's Open voting action.
- **Record replacement risk:** a one-time importer copies records from the
  pinned legacy contract. Closed decisions remain closed; cancelled ballots are
  archived and may be reopened only by their original proposal creator.

## Explicit remaining limits

- Voting is one-wallet/one-vote. It does not prove that wallets represent
  different people and is not Sybil-resistant.
- The admin can update the charter and perform a reasoned emergency ballot
  cancellation. A later production version should place these powers behind a
  multisig or a passed governance decision.
- StudioNet is a hosted development network. No production treasury or asset
  execution should depend on this deployment.
- Contract code is immutable. Future code changes require another visible,
  audited migration rather than a silent admin code replacement.

These limits must remain visible in product documentation and submission
materials until a membership/snapshot adapter and self-governed administration
are implemented.
