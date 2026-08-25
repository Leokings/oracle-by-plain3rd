import { json, problem } from "../server/http.js";
import { refreshTransactions, syncRegistry } from "../server/registry.js";


export default {
  async fetch(request) {
    const expected = String(process.env.CRON_SECRET || "").trim();
    const provided = String(request.headers.get("authorization") || "");
    if (!expected || provided !== `Bearer ${expected}`) return problem("Unauthorized", 401);
    if (request.method !== "GET") return problem("Method not allowed", 405);
    try {
      const [sync, transactions_refreshed] = await Promise.all([
        syncRegistry("cron"),
        refreshTransactions(),
      ]);
      return json({ ok: true, sync, transactions_refreshed });
    } catch (error) {
      return problem(error, 503);
    }
  },
};
