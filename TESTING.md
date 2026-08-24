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
5. Confirm the new decision appears under **Registry** with its transaction
   finality shown separately from its review history.
6. Under **Govern**, submit a real proposal. Select **Run constitutional review** and
   wait for validator consensus.
7. If the contract owner opens a ballot, connect a second fresh wallet and
   verify that each wallet may vote only once.
8. Search your records under **Registry** and confirm their finality is shown
   separately from application-level review history.

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
