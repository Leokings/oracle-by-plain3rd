# Oracle architecture

```text
Browser wallet
      |
      v
Oracle unified frontend (Vercel)
      |-------------------------------|
      v                               v
TruthFeed contract             LivingConstitution contract
0x4207...c49a                  0xC4d9...EfF1
      |                               |
      |---------------|---------------|
                      v
          Shared Decision Registry API
                      |
                      v
                  Neon Postgres
```

## Why the contracts remain separate

The merge is intentionally at the product and index layers. TruthFeed and
LivingConstitution have different schemas, permissions and decision semantics.
A new monolithic contract would require migrating append-only histories and
would replace already-audited deployments. Oracle instead provides one wallet
session, common finality language and a single searchable record.

## Browser-to-chain flow

1. Static configuration supplies the StudioNet RPC and both contract addresses.
2. Read-only calls use the vendored `genlayer-js` SDK without a wallet.
3. Writes require an EIP-1193 wallet, an explicit chain `61999` switch and an
   authorized account.
4. Oracle checks both consensus status and contract execution status.
5. Successful transaction hashes are posted to the registry, where calldata,
   target contract, operation and case ID are validated before storage.
6. Registry finality is refreshed independently from application decisions.

## Trust boundaries

- Contract state is authoritative; registry records are a discovery cache.
- User questions, proposals, URLs and AI explanations render via DOM text APIs,
  not untrusted HTML.
- No database or administration credential is shipped to the browser.
- Content Security Policy permits only the StudioNet RPC and registry origin for
  network connections.

