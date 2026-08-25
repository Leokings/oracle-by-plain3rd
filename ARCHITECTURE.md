# Pilot architecture

LivingConstitution is the governance front door for two GenLayer decision
engines:

- `LivingConstitution` decides whether a proposal complies with the exact
  constitution version pinned when it was submitted.
- `TruthFeed` resolves evidence-backed yes/no questions against explicit
  criteria.
- The Decision Registry Vercel Functions read both contracts and index their
  stable `get_decision` views in Neon Postgres for search, transaction tracking,
  notifications, and signed webhooks.

The index is a cache, not an oracle. Consumers that move funds or execute
governance should read the GenLayer contract again and wait for the transaction
status their risk policy requires. StudioNet does not expose the native appeals,
rounds-storage, or fee-manager contracts. On StudioNet, the product therefore
offers an application-level recheck that preserves prior reviews. Native bonded
appeals can be enabled on a supported public network without changing the
decision schema.

## Pilot voting gate

The contract includes a non-custodial, one-address/one-vote pilot:

1. A proposal is submitted and reviewed by GenLayer validators.
2. Only the proposal creator may open voting, and only while the latest review
   is `compliant` and its evidence is current.
3. Quorum and duration come from the fixed deployment policy, not a creator or
   admin prompt after review.
4. The ballot pins the constitution version, review number, policy, and evidence
   snapshot that qualified it.
5. A wallet can vote once. Anyone may close the ballot after its deadline.
6. Changed evidence blocks votes and permits public ballot invalidation.
7. An active ballot cannot be canceled through a creator recheck. Emergency
   admin cancellation is separate and records a reason.
8. The ballot passes only when quorum is met and FOR votes exceed AGAINST votes.

This is deliberately a pilot, not token-weighted production governance. It does
not prove DAO membership or resist Sybil wallets. A production adapter should
replace voter eligibility with the DAO's membership or token snapshot while
continuing to consume the same constitutional decision.

## Administration

Ownership transfer is two-step: the current owner nominates a destination and
the destination accepts. This makes a later transfer to a Safe/multisig or DAO
executor recoverable if an address is mistyped. The deployed contracts must not
be transferred until the actual governance destination and its signers are
known and tested.

## Registry trust and security

- Registry writes are derived from paginated contract reads or verified
  transaction hashes. A tracked hash must target the configured contract and
  its decoded method and first argument must match the declared operation and
  case ID.
- Webhook administration requires a server-side bearer token. Delivery bodies
  are signed with HMAC-SHA256. Subscription URLs must be public HTTPS, resolve
  only to public IP addresses, contain no embedded credentials, and cannot
  redirect during delivery.
- Database credentials, webhook secrets, and admin tokens exist only in Vercel
  environment variables.
- The registry can fall back to direct on-chain reads if Postgres is temporarily
  unavailable; contract state remains available.
