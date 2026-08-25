// Verify the vendored genlayer-js SDK can read from the deployed TruthFeed
// contract on studionet. Run with:
//   node.exe scripts/check_read.mjs   (from the repo root, truthfeed/)
import { createClient } from "../frontend/vendor/genlayer-js/index.js";
import { studionet } from "../frontend/vendor/genlayer-js/chains/index.js";

const CONTRACT_ADDRESS = "0xF2E7Ef1B02ccc2F225Fed4d1D94Ff7b09af7d59c";

const client = createClient({ chain: studionet });
console.log("chain:", client.chain.id, client.chain.name, "->", client.chain.rpcUrls.default.http[0]);

const stats = await client.readContract({
  address: CONTRACT_ADDRESS,
  functionName: "get_stats",
  args: [],
});
console.log("get_stats:", JSON.stringify(stats));

const list = await client.readContract({
  address: CONTRACT_ADDRESS,
  functionName: "list_questions",
  args: [0, 10],
});
console.log("list_questions:", JSON.stringify(list));
