import { json, problem, requestJson } from "../server/http.js";
import {
  createWebhookSubscription,
  deleteWebhookSubscription,
  isAdminAuthorization,
  listWebhookSubscriptions,
} from "../server/registry.js";


export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return json({}, { status: 204 });
    if (!isAdminAuthorization(request.headers.get("authorization"))) {
      return problem("Unauthorized", 401);
    }
    try {
      if (request.method === "GET") {
        const items = await listWebhookSubscriptions();
        return json({ items, total: items.length });
      }
      if (request.method === "POST") {
        const subscription = await createWebhookSubscription(await requestJson(request));
        return json({ subscription }, { status: 201 });
      }
      if (request.method === "DELETE") {
        const url = new URL(request.url);
        const deleted = await deleteWebhookSubscription(url.searchParams.get("id"));
        return json({ deleted });
      }
      return problem("Method not allowed", 405);
    } catch (error) {
      return problem(error, 400);
    }
  },
};
