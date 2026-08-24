# Oracle by Plain3rd

Oracle by Plain3rd is one product interface for two GenLayer StudioNet decision engines:

Live product: [https://oracle-by-plain3rd.vercel.app](https://oracle-by-plain3rd.vercel.app)

- **Evidence Oracle** uses the deployed TruthFeed contract to resolve sourced
  YES/NO/UNCLEAR questions through validator consensus.
- **Governance Oracle** uses the deployed LivingConstitution contract to review
  proposals against a versioned charter and gate one-wallet-one-vote ballots.
- **Decision Registry** searches both products and tracks transaction finality
  without replacing the contracts as the authoritative source.

## Live StudioNet configuration

- RPC: `https://studio.genlayer.com/api`
- Chain ID: `61999`
- TruthFeed: `0x4207498939EC4649B8aF2dDE13Df69D9383Ac49a`
- LivingConstitution: `0xC4d913fCdA9Bfe3BA2207f7970d9834b2159EfF1`
- Registry API: `https://livingconstitution-nine.vercel.app`

Oracle by Plain3rd intentionally does not merge the two intelligent contracts. Keeping
their storage and permissions separate preserves their audited histories and
lets each decision engine evolve without a risky state migration.

## Private review package

The repositories intentionally remain private. A reviewer who needs source access
must be invited to this repository and the two exact deployed source snapshots:

- [TruthFeed source at `9e05a1a`](https://github.com/Leokings/truthfeed/tree/9e05a1aa50c67a06e5fa5b946b5d62177e384176)
- [LivingConstitution source at `7f4dc1d`](https://github.com/Leokings/livingconstitution/tree/7f4dc1d01b86748d4fdea3703cf11e7e8bf9dc67)

The public interface deliberately excludes owner-only charter amendments and
ownership transfers. Reviewers stay inside Oracle for ordinary decision actions;
the owner operations remain explicit contract methods in the linked source.

## Release verification

The August 24, 2026 reviewer release passed 14 automated tests, a production
bundle build, desktop and 390 px mobile browser checks, and `npm audit` with zero
high-severity vulnerabilities. Its fresh-wallet StudioNet records are:

- evidence decision `q-genlayer-intelligent-contracts-3d309142` → `YES`;
- governance review `p-oracle-review-transparency-02ba1a08` → `COMPLIANT`
  against constitution version 2.

Vercel Web Analytics and Speed Insights collect aggregate page/performance data.
Oracle sends no custom analytics events containing wallet addresses, questions,
proposals or evidence sources.

## Local development

```powershell
npm install
npm run check
python -m http.server 8080 -d dist
```

Open `http://localhost:8080`. The build defaults to the public StudioNet
configuration above. Use a new wallet account containing no real assets.

For an explicitly opt-in, fresh ephemeral-wallet consensus check, follow
[`TESTING.md`](./TESTING.md) and run `npm run smoke:studionet` with its safety
environment flag. The private key is never printed or persisted.

## Vercel configuration

Set these public build-time variables in Production and Preview:

```text
GENLAYER_RPC_URL
LIVING_CONSTITUTION_CONTRACT_ADDRESS
TRUTHFEED_CONTRACT_ADDRESS
DECISION_REGISTRY_URL
```

No private key, mnemonic, database password or registry administration token is
used by the browser application.

## Safety boundaries

- Wallet writes only occur after an explicit browser-wallet signature.
- Submitted transaction hashes are saved in local browser storage and can be
  refreshed after a reload until consensus and finality complete.
- Decision panels load the newest StudioNet page first and allow progressively
  loading older records, so a new submission never disappears behind old history.
- Evidence sources must be public HTTPS hosts; the TruthFeed contract enforces
  the authoritative URL checks again on-chain.
- AI rationale is explanatory. Outcomes, citations, charter rule references,
  ballots and contract state are the authoritative fields.
- StudioNet rechecks are application-level reviews that preserve prior rulings;
  they are not presented as native bonded appeals.
- Records explicitly labeled with `pilot-`, `demo-` or `sample-` identifiers
  remain on-chain but are excluded from the production interface and metrics.
