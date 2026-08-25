# Oracle by Plain3rd submission guide

## What to open

- Product: [oracle-by-plain3rd.vercel.app](https://oracle-by-plain3rd.vercel.app)
- Repository: `Leokings/oracle-by-plain3rd` (private; invite the reviewer)
- Network: GenLayer StudioNet, chain ID `61999`

## What the product demonstrates

Oracle joins two intelligent contracts into one auditable decision loop:

```text
sourced question → Evidence decision → proposal review → public ballot
       ↑                                                   ↓
       └──────── delivered-result verification ← passed proposal
```

Evidence handles facts that require web sources and validator judgment.
Governance uses those resolved facts to review a proposal against a versioned
charter. The proposal creator—not the contract admin—opens voting. Anyone can
vote once per wallet, close an expired ballot, and sync a resolved outcome.

## Source map

| Part | Source | Live address or service |
| --- | --- | --- |
| Unified interface | repository root | `oracle-by-plain3rd.vercel.app` |
| Evidence contract | `components/evidence/contracts/truth_feed.py` | `0xcf2C42546E652A84aE5A5586707F053B6e299e7a` |
| Governance contract | `components/governance/contracts/living_constitution.py` | `0x793021e64B3289B291De6182A04DBF055b346408` |
| Decision Registry | `components/governance/frontend/server/` and `frontend/api/` | `livingconstitution-nine.vercel.app/api` |

The component folders also contain their direct tests, integration tests,
architecture notes, deployment records, and security/governance audit notes.

## Verify without touching StudioNet

On Windows PowerShell:

```powershell
.\scripts\test-all.ps1
```

A successful run ends with:

```text
All Oracle checks passed. No network transactions were created.
```

For a shorter interface-only check:

```powershell
npm install
npm run check
npm audit --audit-level=high
```

## Test the full live flow

Use three new, empty browser-wallet accounts and follow [TESTING.md](./TESTING.md).
That guide supplies one copy-and-paste scenario covering wallet connection,
Evidence creation and recheck, proposal submission, constitutional review,
creator-opened voting, three-wallet voting, ballot closing, outcome verification,
and the combined Decisions registry.

## Reviewer notes

- StudioNet is a test environment. Do not send real assets to test wallets.
- The live V3 contracts are linked to each other and keep their own append-only
  records because they have different permissions and decision types.
- The original private component repositories are historical mirrors. They are
  not required to build, test, or review this final repository.
- Secrets and generated local files are excluded from Git. Vercel public runtime
  configuration contains only the RPC URL, contract addresses, and registry URL.
