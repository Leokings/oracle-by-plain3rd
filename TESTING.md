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
3. Under **Ask**, post a unique question with an exact rule and
   `https://example.com/` as the first evidence source.
4. Select **Resolve with validators**. The decision should show an outcome,
   numbered citations, separately labeled leader rationale and transaction
   finality.
5. Inspect the existing case `pilot-example-domain-10e9a999` to see two
   preserved evidence rounds.
6. Under **Govern**, submit a proposal. Select **Run constitutional review** and
   wait for validator consensus.
7. Inspect `pilot-open-source-grant-2c718c7c` to see a compliant proposal and
   its pilot ballot. A wallet may vote only once per ballot.
8. Search both records under **Registry** and confirm their finality is shown
   separately from their application-level review history.

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
