# TruthFeed release operations

## Current production component

- Network: GenLayer StudioNet (`61999`)
- RPC: `https://studio.genlayer.com/api`
- Contract: `0xcf2C42546E652A84aE5A5586707F053B6e299e7a`
- Deploy transaction: `0x65f2ff7b181a2e6a36589f7151c8adc1efadddd402531230942984e553e933cb`
- Linked Governance: `0x793021e64B3289B291De6182A04DBF055b346408`
- Link transaction: `0xb01e43ccbe32ffeb91a1a351e6ddd483b10aec7e468a6c92c0b06da8f303e73e`
- Legacy contract: `0x704687cD890E636696F9362708c8832fbcC40773`
- Migration: 4 questions imported; permanently closed by `0xfeafc6648242e889b9ddcad6ef920fc003f180c82b33716dbde4152fbf8861e7`
- Owner: `0x91B1b2D1f2De66400fcbeAEbadB8a5330eB28DC0`
- Owner CLI account: `credence-deployer` (unlocked in the local OS keychain)
- Vercel project: `truthfeed` (`prj_AiYCIIzPQkj07BWDjo4AM19BPaiS`)
- Production URL: `https://truthfeed-neon.vercel.app`
- Git source: `Leokings/truthfeed`, production branch `master`, root `frontend`

This is the Evidence component of Oracle by Plain3rd on public StudioNet. The
standalone URL redirects to the merged Oracle interface.

## Normal release

From the repository root:

```powershell
.\scripts\test.ps1
git push origin master
```

Vercel builds `frontend/dist` and generates `config.js` from these project
variables in Production, Preview, and Development:

- `GENLAYER_RPC_URL`
- `GENLAYER_CONTRACT_ADDRESS`
- `DECISION_REGISTRY_URL` (`https://livingconstitution-nine.vercel.app`)

## Manual Vercel recovery

From the repository root (the Vercel project already has `frontend` as its root):

```powershell
vercel pull --yes --environment=production
vercel deploy --prod
```

Verify with `vercel inspect <deployment-url>` and `vercel curl / --deployment
<deployment-url>` before promotion.

## Ownership transfer

Only transfer to a verified wallet or multisig address:

```powershell
genlayer network set studionet
genlayer account use credence-deployer
genlayer write 0xcf2C42546E652A84aE5A5586707F053B6e299e7a transfer_ownership --args 0xNEW_OWNER
```

This stages the destination without removing the current owner. Verify
`get_ownership_state`; then the exact pending address must call
`accept_ownership`. The current owner can call `cancel_ownership_transfer`
before acceptance. Never stage a guessed multisig or treasury address.

TruthFeed posts verified transaction hashes to the shared registry hosted by
LivingConstitution. The registry validates the configured recipient plus decoded
method and case ID; it remains a cache, while the contract is authoritative.

## Rollback

Vercel can roll back the site with `vercel rollback`. Contracts are separate
deployments; to revert an address, update `GENLAYER_CONTRACT_ADDRESS` in all
Vercel environments and deploy a new frontend artifact. Never point the UI at a
contract whose schema does not match the checked-in frontend.
