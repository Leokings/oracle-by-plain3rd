# Oracle by Plain3rd

Oracle by Plain3rd is one product made from two linked GenLayer StudioNet
contracts:

1. **Evidence** resolves a sourced YES, NO, or UNCLEAR question.
2. **Governance** uses one or more resolved evidence decisions when reviewing a
   proposal against the Oracle charter.
3. If a ballot passes, Governance asks Evidence to check whether the promised
   result was actually delivered.
4. The verified result is copied back into the proposal record.

The contracts remain separate because they have different jobs and permissions,
but they now call each other and form one evidence-to-outcome loop.

Live product: [https://oracle-by-plain3rd.vercel.app](https://oracle-by-plain3rd.vercel.app)

## Live StudioNet configuration

- RPC: `https://studio.genlayer.com/api`
- Chain ID: `61999`
- Evidence contract: `0x704687cD890E636696F9362708c8832fbcC40773`
- Governance contract: `0x7e397Abe9df988b05266d613b1c099a1458f0Fda`
- Registry API: `https://livingconstitution-nine.vercel.app`

The source repositories remain private. A reviewer who needs source access must
be invited to `Leokings/oracle-by-plain3rd`, `Leokings/truthfeed`, and
`Leokings/livingconstitution`.

## Local checks

```powershell
npm install
npm run check
npm audit --audit-level=high
python -m http.server 8080 -d dist
```

Open `http://localhost:8080`. The build defaults to the public StudioNet
configuration above. Local checks do not create a wallet or write on-chain.

For a real fresh-wallet StudioNet check, follow [TESTING.md](./TESTING.md). The
release script creates an ephemeral account in memory and never prints or saves
its private key.

## Vercel variables

```text
GENLAYER_RPC_URL
LIVING_CONSTITUTION_CONTRACT_ADDRESS
TRUTHFEED_CONTRACT_ADDRESS
DECISION_REGISTRY_URL
```

These are public configuration values. No private key, mnemonic, registry token,
or database password is shipped to the browser.

## Safety boundaries

- Browser writes require an explicit wallet signature.
- Transaction hashes remain available after a reload so users can refresh their
  status.
- Evidence and outcome sources must be public HTTPS pages.
- Contract outcomes, citations, rule references, ballots, and verification
  records are authoritative; free-form AI rationale is explanatory.
- The built-in ballot is one-wallet-one-vote, not identity- or token-weighted
  governance. A treasury integration needs a separate membership and finality
  policy.
