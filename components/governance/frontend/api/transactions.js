import { json, problem, requestJson } from "../server/http.js";
import { getTransactions, trackTransaction } from "../server/registry.js";


export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return json({}, { status: 204 });
    try {
      if (request.method === "GET") {
        const url = new URL(request.url);
        const items = await getTransactions({
          hash: url.searchParams.get("hash") || "",
          kind: url.searchParams.get("kind") || "",
          case_id: url.searchParams.get("case_id") || "",
        });
        return json({ items, total: items.length });
      }
      if (request.method === "POST") {
        const tracked = await trackTransaction(await requestJson(request));
        return json({ transaction: tracked }, { status: 201 });
      }
      return problem("Method not allowed", 405);
    } catch (error) {
      return problem(error, request.method === "POST" ? 400 : 503);
    }
  },
};
