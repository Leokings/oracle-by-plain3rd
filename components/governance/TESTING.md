# Testing the Governance contract

## Safe local check

```powershell
.\scripts\test.ps1
```

This lints the GenLayer contract, runs mocked direct tests, tests and bundles the
frontend and registry, and audits npm dependencies. It does not write to
StudioNet.

## Live product check

Use the Governance section in
[Oracle by Plain3rd](https://oracle-by-plain3rd.vercel.app):

1. Connect a brand-new StudioNet-only wallet with no real assets.
2. Resolve an Evidence question first.
3. Submit a proposal, select that evidence, and provide a later outcome question,
   rule, and public verification source.
4. Run the charter review and confirm its evidence snapshot is visible.
5. With the same proposal-creator wallet, select **Open voting**. Quorum and
   duration come from the displayed contract policy.
6. Vote with distinct fresh wallets. The same wallet cannot vote twice.
7. After a passed ballot, resolve its linked Evidence outcome question and use
   **Update outcome** on the proposal.

The root of the standalone LivingConstitution URL redirects to Oracle. Its
Decision Registry API remains active and never substitutes local records when
StudioNet is unavailable.

## Fresh-wallet integration check

```powershell
.\scripts\test.ps1 -Integration -Network studionet
```

This opt-in command deploys linked temporary contracts and exercises public
StudioNet transactions with a fresh in-memory wallet. The private key is not
printed or persisted. Set `ORACLE_FULL_LOOP=1` only when the longer ballot and
outcome-verification flow is intended.
