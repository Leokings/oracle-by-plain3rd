# Oracle by Plain3rd

Oracle by Plain3rd is one product interface for two GenLayer StudioNet decision engines:

Live product: `https://oracle-by-plain3rd.vercel.app`

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

## Local development

```powershell
npm install
npm run check
python -m http.server 8080 -d dist
```

Open `http://localhost:8080`. The build defaults to the public StudioNet
configuration above. Use a new wallet account containing no real assets.

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
- Evidence sources must be public HTTPS hosts; the TruthFeed contract enforces
  the authoritative URL checks again on-chain.
- AI rationale is explanatory. Outcomes, citations, charter rule references,
  ballots and contract state are the authoritative fields.
- StudioNet rechecks are application-level reviews that preserve prior rulings;
  they are not presented as native bonded appeals.
- Records explicitly labeled with `pilot-`, `demo-` or `sample-` identifiers
  remain on-chain but are excluded from the production interface and metrics.
