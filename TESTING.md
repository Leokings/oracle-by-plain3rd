# Testing Oracle by Plain3rd

## Fast automated test

From this repository:

```powershell
npm install
npm run check
npm audit --audit-level=high
```

This runs receipt/configuration tests, evidence URL tests, product utility tests
and the production bundle. No wallet or StudioNet transaction is used.

On a deployed Vercel URL, the browser should also request the first-party
`/_vercel/insights/` and Speed Insights routes. Localhost deliberately does not
load analytics, and Oracle does not emit custom wallet or decision-content events.

## One-command fresh-wallet StudioNet smoke test

Only run this when four new public StudioNet transactions are wanted:

```powershell
$env:RUN_STUDIONET_SMOKE = "1"
npm run smoke:studionet
Remove-Item Env:RUN_STUDIONET_SMOKE
```

The script creates an ephemeral wallet in memory, posts and resolves one real
evidence question, submits and reviews one real governance proposal, and links
all four transactions to the registry. It never prints or saves the private key.
StudioNet is gasless, so the fresh wallet does not need funding.

## Easiest live test with a new wallet

1. In MetaMask, create a new account used only for StudioNet testing. Do not put
   real assets in it.
2. Open `https://oracle-by-plain3rd.vercel.app`, select **Connect wallet**, and
   approve GenLayer StudioNet, chain ID `61999`.
3. Under **Ask**, post a unique question with an exact rule and a reputable
   public HTTPS page as the first evidence source.
4. Select **Resolve with validators**. The decision should show an outcome,
   numbered citations, separately labeled leader rationale and transaction
   finality.
   Immediately after signing, confirm **Wallet transaction activity** shows the
   saved hash. Reload the page once and use **Refresh status** to confirm the
   operation is still recoverable.
5. Confirm the new decision appears under **Registry** with its transaction
   finality shown separately from its review history.
6. Under **Govern**, submit a real proposal. Select **Run constitutional review** and
   wait for validator consensus.
7. If the contract owner opens a ballot, connect a second fresh wallet and
   verify that each wallet may vote only once.
8. Search your records under **Registry** and confirm their finality is shown
   separately from application-level review history.
9. If more than twelve records exist, confirm the newest record appears first
   and **Show more** / **Load older from StudioNet** reveals prior history.

## What different wallets may do

- Any connected wallet can create and resolve evidence questions, submit and
  check proposals, vote on an open ballot, and close an expired ballot.
- Only a question creator or the TruthFeed owner may request its recheck.
- Only a proposal submitter or LivingConstitution owner may request its recheck.
- Only the LivingConstitution owner may open a ballot.
- Charter amendments and two-step ownership controls stay in the original
  audited operator consoles linked from Oracle by Plain3rd.

## Expected transaction states

`ACCEPTED` means validator execution succeeded but the transaction can still be
inside the protocol finalization window. `FINALIZED` means the registry has
observed the irreversible state. Oracle by Plain3rd never treats those labels as the same.
