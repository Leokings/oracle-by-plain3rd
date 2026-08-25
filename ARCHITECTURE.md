# Decision-engine boundary

TruthFeed is the evidence decision engine used by the shared GenLayer Decision
Registry hosted with LivingConstitution. The contract is authoritative for each
question's criteria, evidence URLs, consensus outcome, canonical citations, and
decision history. The registry is only a searchable off-chain index.

StudioNet does not currently expose GenLayer's native appeals contracts. A
question creator can therefore request an application-level recheck with a
written reason and, when needed, a replacement evidence pack. The contract
owner cannot rewrite or reopen another creator's evidence.
The prior resolution stays in the on-chain history. On a network with native
appeals, protocol-level transaction status and bonded appeals should be shown in
addition to—not replaced by—this product workflow.

Ownership transfer is two-step so a future Safe/multisig or DAO executor must
accept administration before the current owner loses recovery control.

The shared registry accepts a transaction link only after decoding the StudioNet
calldata and matching its contract, operation, and case ID. This prevents a
public client from attaching an unrelated transaction to a decision. Signed
webhooks are administered with a server-only bearer token and reject private or
redirecting destinations.

Evidence URLs must use ordinary public hostnames on HTTPS port 443; local names,
IP literals, embedded credentials, and nonstandard ports are rejected before a
validator fetches them. A YES/NO resolution is also rejected if any authoritative
citation points to a source that the deciding validator could not render.
