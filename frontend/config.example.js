// TruthFeed frontend configuration.
// For local development, copy this file to `config.js` and fill in the values.
// Vercel generates config.js from GENLAYER_RPC_URL and
// GENLAYER_CONTRACT_ADDRESS and DECISION_REGISTRY_URL during its build.
window.TruthFeedConfig = {
  // GenLayer JSON-RPC endpoint (local Studio node, testnet, or mainnet gateway).
  RPC_URL: "REPLACE_GENLAYER_RPC_URL_HERE",

  // Address of the deployed TruthFeed intelligent contract.
  CONTRACT_ADDRESS: "REPLACE_DEPLOYED_CONTRACT_ADDRESS_HERE",

  // Shared registry hosted by LivingConstitution (no trailing slash).
  REGISTRY_API_BASE: "https://livingconstitution-nine.vercel.app",
};
