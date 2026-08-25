import { createClient, chains } from "../frontend/vendor/genlayer-js/index.js";

const ADDRESS = "0xE2A265A3d427Cf37C84e67820F747b27AF58E774";

const client = createClient({ chain: chains.studionet });

const [constitution, versionCount, proposals] = await Promise.all([
  client.readContract({ address: ADDRESS, functionName: "get_constitution", args: [] }),
  client.readContract({ address: ADDRESS, functionName: "constitution_version_count", args: [] }),
  client.readContract({ address: ADDRESS, functionName: "list_proposals", args: [0, 10] }),
]);

console.log("chain:", chains.studionet.name, "id:", chains.studionet.id, chains.studionet.rpcUrls.default.http[0]);
console.log("address:", ADDRESS);
console.log("get_constitution():");
console.log(String(constitution));
console.log("constitution_version_count():", Number(versionCount));
console.log("list_proposals(0, 10):", JSON.stringify(proposals, null, 2));

const stats = await client.readContract({ address: ADDRESS, functionName: "get_stats", args: [] });
console.log("get_stats():", JSON.stringify(stats));
