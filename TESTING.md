# Testing Oracle by Plain3rd

## Safe whole-product check

Run this one command from the Oracle repository in PowerShell:

```powershell
.\scripts\test-all.ps1
```

It verifies the unified app, both intelligent contracts, both component source
interfaces, and the Decision Registry. It does not create a wallet or make a
StudioNet transaction.

For an interface-only check, use:

```powershell
npm install
npm run check
npm audit --audit-level=high
```

This shorter command only tests and builds the unified interface.

## Full manual StudioNet test

Use three brand-new MetaMask accounts containing no real assets:

- **Wallet A** creates the proposal, opens voting, and votes FOR.
- **Wallet B** votes AGAINST.
- **Wallet C** votes FOR.

StudioNet chain ID is `61999`. Replace `[RUN]` below with a unique label such
as `0825A`.

Wait for each transaction to reach **ACCEPTED** before starting the next one.

### 1. Wallet and navigation

1. Open [Oracle by Plain3rd](https://oracle-by-plain3rd.vercel.app).
2. Check that Home links separately to Evidence, Proposals, Governance, and
   Decisions.
3. Connect Wallet A and approve StudioNet.
4. Disconnect, then reconnect Wallet A.
5. Expected: the connection button immediately says **Open wallet…**, the
   connected address appears, and StudioNet shows as live.

### 2. Evidence

Open **Evidence** and paste:

**Question**

```text
[RUN] — Does the official GenLayer documentation describe StudioNet as a shared hosted environment for prototyping with limitations that differ from a live network?
```

**Resolution rule**

```text
Return YES only if the official sources jointly state that StudioNet is a hosted or shared environment intended for development or prototyping and that Studio has limitations or simulated behavior that differ from a live network. Return NO if the sources describe StudioNet as fully production-equivalent. Return UNCLEAR if either part cannot be verified or the sources conflict.
```

**Sources**

```text
https://docs.genlayer.com/developers/intelligent-contracts/deploying/network-configuration
https://docs.genlayer.com/developers/intelligent-contracts/tools/genlayer-studio/limitations
```

Leave the date empty.

1. Use **+ Add source**, add both URLs, then add and remove one extra source row
   to test the source controls.
2. Select **Post question on-chain**.
3. Select **Resolve with validators**.
4. Expected result: **YES**, with source citations.
5. With Wallet A, select **Request recheck** and use:

```text
Confirm that the official sources still support both parts of the decision rule.
```

6. When asked whether to replace the sources, choose **Cancel** to reuse the
   existing source pack.
7. Expected: the question reopens. Select **Resolve with validators** again.
8. Expected: the result returns to **YES** and decision history gains another
   round.

Do this recheck before creating the proposal so the proposal snapshots the
latest evidence round.

### 3. Proposal

Open **Proposals**, select the resolved `[RUN]` evidence, and paste:

**Title**

```text
[RUN] — Adopt Oracle StudioNet Integration Safety Policy v1
```

**Proposal**

```text
Approve Oracle by Plain3rd StudioNet Integration Safety Policy v1 for future Governance-to-adapter research. No spending, production asset transfer, or deployment is authorized. The affected component is the future Governance-to-adapter integration, version v1. Research must use fresh empty test wallets, act only after FINALIZED decisions, use only StudioNet-supported Intelligent Contract messaging or native GEN behavior, avoid unsupported Studio EVM contract calls, publish test transaction hashes and failure results, expose no secrets, and preserve every existing evidence, proposal, ballot, and outcome record. The official GenLayer documentation listed in the outcome check is the completion record. Any implementation requires a separate proposal.
```

**Outcome question**

```text
[RUN] — Do the official GenLayer documents support every technical boundary required by Oracle StudioNet Integration Safety Policy v1?
```

**Outcome decision rule**

```text
Return YES only if the official sources jointly establish all four points: (1) Intelligent Contracts can emit internal messages after finalization, (2) native GEN can be received and sent, (3) Studio does not implement general external EVM contract interaction beyond supported address or EOA value transfers, and (4) Studio is gasless or simulated and is not full live-network parity. Return NO if any point is explicitly contradicted. Return UNCLEAR if any point is missing, inaccessible, or ambiguous.
```

**Outcome sources**

```text
https://docs.genlayer.com/developers/intelligent-contracts/features/messages
https://docs.genlayer.com/developers/intelligent-contracts/features/value-transfers
https://docs.genlayer.com/developers/intelligent-contracts/tools/genlayer-studio/limitations
```

Set **Check after** to `0`, then select **Submit proposal on-chain**.

### 4. Governance review

Open **Governance**.

1. Find the `[RUN]` proposal.
2. Select **Run constitutional review**.
3. Expected: **compliant**, evidence is labeled current, charter rules are
   cited, and review details are available.
4. With Wallet A, select **Request recheck** and use:

```text
Confirm this proposal still follows the current charter and current evidence snapshot.
```

5. Expected: the proposal returns to submitted. Select
   **Run constitutional review** again.
6. Expected: another review appears in the review history and the proposal
   returns to compliant.

Validator judgment is not hard-coded. If the review is non-compliant, read the
cited rule and correct the next test proposal rather than forcing a ballot.

### 5. Open and vote

1. Stay connected with Wallet A, which created the proposal.
2. Confirm the page shows the fixed policy **Quorum 3 · 5 min**.
3. Select **Open voting**. There are no quorum or duration prompts.
4. With Wallet A, select **Vote for**.
5. Try voting again with Wallet A. Expected: the second vote fails because one
   wallet can vote only once.
6. Switch to Wallet B and select **Vote against**.
7. Switch to Wallet C and select **Vote for**.
8. Expected tally: FOR `2`, AGAINST `1`, quorum `3`.

After five minutes, any wallet can select **Close ballot**. Expected: the ballot
passes. Wait for that transaction to reach **FINALIZED** because the outcome
evidence question is created by a separate finalized contract message. The
five-minute duration is the contract-wide StudioNet test policy.

### 6. Verify the outcome

1. Open **Evidence** and refresh questions.
2. Find the question labeled as the outcome check for the `[RUN]` proposal.
3. Select **Resolve with validators**.
4. Expected result: **YES**.
5. Return to **Governance**, refresh, and select **Update outcome**.
6. Expected proposal outcome: **achieved**.

If the internal outcome message failed and **Retry outcome check** appears, use
it and refresh Evidence. Do not deliberately break the main test just to make
this recovery button appear.

### 7. Combined decision record

Open **Decisions**.

1. Select **Sync registry**.
2. Search for the unique `[RUN]` label.
3. Filter to **Evidence decisions**, then **Governance decisions**.
4. Expected: the related question and proposal are separately searchable with
   their transaction finality.
5. Use **Copy contract addresses** in the footer.
6. In any work page, use **Refresh status** and **Dismiss completed** in the
   saved transaction panel.

## Optional safeguard checks

- **Scheduled evidence:** create a second question with a future
  **Do not resolve before** time. Its resolve button should remain disabled
  until that time.
- **Stale evidence protection:** create a second proposal, review it, then
  open voting and recheck one of its linked evidence questions. Governance
  should hide voting, label the snapshot as changed, and let any connected
  wallet select **Invalidate stale ballot**. The proposal creator can then
  request a fresh review.
- **Creator permissions:** only the wallet that submitted a compliant proposal
  should see **Open voting** for it. The Governance admin should not see that
  action unless it also created that proposal.

## One-command fresh-wallet smoke check

Only run this when four public StudioNet transactions are intended:

```powershell
$env:RUN_STUDIONET_SMOKE = "1"
npm run smoke:studionet
Remove-Item Env:RUN_STUDIONET_SMOKE
```

The script creates a fresh wallet in memory and never prints or saves its
private key.

## Permissions

- Any wallet can create and resolve evidence, submit and review proposals, vote
  on a current open ballot, close an expired ballot, invalidate a ballot whose
  evidence changed, and sync an outcome result.
- Only an evidence creator can request its recheck.
- Only a proposal creator can request its recheck or open its voting.
- The Governance admin is limited to charter administration and a recorded
  emergency ballot cancellation; it is not part of the normal proposal flow.

Oracle shows `ACCEPTED` only after it also checks the contract execution result;
the lifecycle label by itself is not proof of successful execution. `FINALIZED`
is the stronger state required before a future money-moving integration should
act.
