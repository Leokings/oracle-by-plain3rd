import { json } from "../server/http.js";
import { registryConfiguration } from "../server/registry.js";


export default {
  async fetch() {
    return json({ ok: true, configuration: registryConfiguration() });
  },
};
