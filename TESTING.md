# Testing Oracle by Plain3rd

## Safe automated check

Run this from the Oracle repository:

```powershell
npm install
npm run check
npm audit --audit-level=high
```

This tests and builds the interface without using a wallet or creating a
StudioNet transaction.

## Easiest live test

Use a brand-new MetaMask account containing no real assets.

1. Open [Oracle by Plain3rd](https://oracle-by-plain3rd.vercel.app) and select
   **Connect wallet**. Approve GenLayer StudioNet, chain ID `61999`.
2. In **Evidence**, ask a question with a unique ID, a precise YES/NO rule, and
   one or more reputable public HTTPS sources.
3. Select **Resolve with validators**. Wait for YES, NO, or UNCLEAR and check the
   cited source numbers.
4. In **Governance**, submit a proposal and select the resolved evidence from
   step 3. Also say what later result should be checked and where it can be
   verified.
5. Select **Run constitutional review**. The proposal should show its charter
   decision and a snapshot of the evidence it used.
6. If the contract owner opens a ballot, vote with the new wallet. A wallet can
   vote only once.
7. After a passed ballot, resolve the linked outcome question in **Evidence**,
   then select **Update outcome** on the proposal. It should show achieved, not
   achieved, or unclear.

That is the full loop: evidence supports a decision, and the decision creates a
later evidence check.

## One-command fresh-wallet release check

Only run this when four public StudioNet transactions are intended:

```powershell
$env:RUN_STUDIONET_SMOKE = "1"
npm run smoke:studionet
Remove-Item Env:RUN_STUDIONET_SMOKE
```

The script creates a fresh wallet in memory, posts and resolves evidence, then
submits and reviews a proposal that uses that evidence. The private key is never
printed or saved. StudioNet is gasless, so the test wallet needs no funding.

## Permissions

- Any wallet can create and resolve evidence, submit and review proposals, vote
  on an open ballot, close an expired ballot, and sync an outcome result.
- Only an evidence creator or the Evidence owner can request its recheck.
- Only a proposal submitter or the Governance owner can request its recheck.
- Only the Governance owner can open or cancel a ballot.

`ACCEPTED` means validators executed the transaction successfully.
`FINALIZED` is the stronger state to require before a money-moving integration
acts on it.
