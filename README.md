# Oracle by Plain3rd

Oracle by Plain3rd is one GenLayer product with two cooperating engines:

1. **Evidence** answers a sourced YES, NO, or UNCLEAR question through validator
   consensus.
2. **Governance** reviews a proposal against a charter using resolved Evidence,
   then lets the proposal creator open a public ballot.
3. When a ballot passes, Governance asks Evidence to verify whether the promised
   result was delivered and saves that outcome on the proposal.

The live interface keeps those jobs on separate pages so the workflow stays
clear: **Evidence → Proposals → Governance → Decisions**.

Live product: [https://oracle-by-plain3rd.vercel.app](https://oracle-by-plain3rd.vercel.app)

## Complete submission repository

This private repository now contains the full product. A reviewer only needs
access to `Leokings/oracle-by-plain3rd`.

```text
./                              unified Oracle interface deployed on Vercel
components/evidence/            Evidence contract, tests, docs, and source UI
components/governance/          Governance contract, tests, registry, and source UI
scripts/test-all.ps1            safe one-command verification of everything
SUBMISSION.md                   reviewer and submission guide
```

Evidence was imported from the private `truthfeed` repository at commit
`f8d0da0`. Governance was imported from the private `livingconstitution`
repository at commit `5c1ca4b`. Those repositories remain private and unchanged
as historical sources; this repository is the final maintained product.

## Live StudioNet configuration

- RPC: `https://studio.genlayer.com/api`
- Chain ID: `61999`
- Evidence contract: `0xcf2C42546E652A84aE5A5586707F053B6e299e7a`
- Governance contract: `0x793021e64B3289B291De6182A04DBF055b346408`
- Registry API: `https://livingconstitution-nine.vercel.app`

## Easiest safe test

From this repository in PowerShell, run:

```powershell
.\scripts\test-all.ps1
```

It lints both intelligent contracts, runs all fast contract and browser tests,
builds all three interfaces, tests the registry backend, and audits dependencies.
It does **not** create a wallet, deploy a contract, or write to StudioNet.

To test the real product with fresh empty wallets, follow
[TESTING.md](./TESTING.md). To review the submission quickly, start with
[SUBMISSION.md](./SUBMISSION.md).

## Vercel configuration

The repository root is the Vercel production app. Its public configuration is
generated from these Vercel variables:

```text
GENLAYER_RPC_URL
LIVING_CONSTITUTION_CONTRACT_ADDRESS
TRUTHFEED_CONTRACT_ADDRESS
DECISION_REGISTRY_URL
```

No private key, mnemonic, registry token, or database password is shipped to
the browser.

## Safety boundaries

- Every browser write requires an explicit wallet signature.
- Evidence and outcome sources must be public HTTPS pages.
- Contract decisions, citations, rule references, ballots, and verification
  records are authoritative; free-form AI rationale is explanatory.
- The built-in ballot is one-wallet-one-vote for a public pilot. It is not a
  token-weighted or Sybil-resistant DAO membership system.
- A money-moving integration should require the chosen finality policy and a
  separate membership, timelock, and execution adapter.
