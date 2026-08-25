# LivingConstitution release operations

## Current production component

- Network: GenLayer StudioNet (`61999`)
- RPC: `https://studio.genlayer.com/api`
- Contract: `0x793021e64B3289B291De6182A04DBF055b346408`
- Deploy transaction: `0x26212ea8a8e96b8f0191cef38611046f13146195583f1c5b4ebcb3fec031dd0c`
- Linked Evidence: `0xcf2C42546E652A84aE5A5586707F053B6e299e7a`
- Legacy contract: `0x7e397Abe9df988b05266d613b1c099a1458f0Fda`
- Migration: 3 proposals imported; permanently closed by `0x02fae69f5651273c484cdb4dbeb204990851e522c7073cf168cc5620781bfd75`
- Owner: `0x91B1b2D1f2De66400fcbeAEbadB8a5330eB28DC0`
- Owner CLI account: `credence-deployer` (unlocked in the local OS keychain)
- Vercel project: `livingconstitution` (`prj_Wjtaoo0ig9SsMU8ltANhbsLAt1xj`)
- Production URL: `https://livingconstitution-nine.vercel.app`
- Git source: `Leokings/livingconstitution`, production branch `master`, root `frontend`
- Neon resource: `genlayer-decision-registry` (`rough-dream-30350619`, AWS `iad1`)

This is the Governance and registry component of Oracle by Plain3rd on public
StudioNet. The registry API remains here; the root redirects to the merged UI.

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
- `TRUTHFEED_CONTRACT_ADDRESS`
- `DATABASE_URL` and related Neon variables (managed by the Neon integration)
- `REGISTRY_ADMIN_TOKEN` (sensitive)
- `REGISTRY_WEBHOOK_SECRET` (sensitive)
- `CRON_SECRET` (sensitive, Production)

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
genlayer write 0x793021e64B3289B291De6182A04DBF055b346408 transfer_ownership --args 0xNEW_OWNER
```

This only stages the destination. Verify `get_ownership_state`, then the exact
destination must call `accept_ownership`. The current owner can use
`cancel_ownership_transfer` before acceptance. Do not transfer to an unverified
multisig, guessed treasury address, or an address whose signer flow has not been
tested.

## Registry endpoints

- `GET /api/health` — public configuration health, never secrets
- `GET /api/registry?fresh=1` — sync and search both decision contracts
- `POST /api/transactions` — links only hashes whose decoded calldata matches
  the declared contract, operation, and case ID
- `GET|POST|DELETE /api/webhooks` — bearer-administered signed subscriptions
- `GET /api/cron-sync` — authenticated Vercel cron refresh

The registry is a searchable cache. Money-moving consumers must read the
contract again and enforce their required transaction finality.

## Rollback

Vercel can roll back the site with `vercel rollback`. Contracts are separate
deployments; to revert an address, update `GENLAYER_CONTRACT_ADDRESS` in all
Vercel environments and deploy a new frontend artifact. Never point the UI at a
contract whose schema does not match the checked-in frontend.
