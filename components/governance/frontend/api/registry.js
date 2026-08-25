import { json, problem } from "../server/http.js";
import {
  listDecisions,
  registryConfiguration,
  syncRegistryIfStale,
} from "../server/registry.js";


export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return json({}, { status: 204 });
    if (request.method !== "GET") return problem("Method not allowed", 405);
    const url = new URL(request.url);
    let sync = null;
    let syncWarning = "";
    if (url.searchParams.get("fresh") === "1") {
      try {
        sync = await syncRegistryIfStale("api");
      } catch (error) {
        syncWarning = String(error?.message || error);
      }
    }
    try {
      const items = await listDecisions({
        q: url.searchParams.get("q") || "",
        kind: url.searchParams.get("kind") || "",
        status: url.searchParams.get("status") || "",
        limit: url.searchParams.get("limit") || 100,
      });
      return json({
        items,
        total: items.length,
        configuration: registryConfiguration(),
        sync,
        warning: syncWarning,
      });
    } catch (error) {
      return problem(error, 503);
    }
  },
};
