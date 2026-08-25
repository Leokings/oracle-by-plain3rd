// For local development, copy this file to `config.js` and fill in the values.
// Vercel generates config.js from GENLAYER_RPC_URL and
// GENLAYER_CONTRACT_ADDRESS and TRUTHFEED_CONTRACT_ADDRESS during its build.
window.ConstitutionConfig = {
  // GenLayer RPC endpoint (e.g. your local GenLayer Studio node or testnet RPC).
  RPC_URL: "YOUR_GENLAYER_RPC_URL_HERE",

  // Address of the deployed LivingConstitution intelligent contract.
  CONTRACT_ADDRESS: "YOUR_DEPLOYED_CONTRACT_ADDRESS_HERE",

  // Optional second decision engine shown in the shared registry.
  TRUTHFEED_CONTRACT_ADDRESS: "YOUR_TRUTHFEED_CONTRACT_ADDRESS_HERE",

  // Leave blank for same-origin /api routes. Set a full HTTPS origin only when
  // the registry Functions are hosted in a different Vercel project.
  REGISTRY_API_BASE: "",
};
