# Testing the Evidence contract

## Safe local check

```powershell
.\scripts\test.ps1
```

This lints the GenLayer contract, runs mocked direct tests, tests and bundles the
browser code, and audits npm dependencies. It does not write to StudioNet.

## Live product check

Use the Evidence section in
[Oracle by Plain3rd](https://oracle-by-plain3rd.vercel.app):

1. Connect a brand-new StudioNet-only wallet with no real assets.
2. Ask a uniquely named question with a precise YES/NO rule and public HTTPS
   sources.
3. Resolve it and check the outcome and cited source numbers.
4. Submit a Governance proposal that selects this resolved question as evidence.
5. Confirm the proposal review displays the same evidence ID, outcome, round,
   and citations.

The standalone TruthFeed URL redirects to Oracle and does not provide simulated
local records.

## Fresh-wallet integration check

```powershell
.\scripts\test.ps1 -Integration -Network studionet
```

This opt-in command deploys and writes public StudioNet test records from a fresh
in-memory wallet. The private key is not printed or persisted. StudioNet is
public and rate-limited.
