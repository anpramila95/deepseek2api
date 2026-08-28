import { ProxyAgent } from "undici";
import { getSystemSettings } from "./system-settings-service.js";

const proxyAgents = new Map();

function getRandomGlobalProxy() {
  try {
    const settings = getSystemSettings();
    const list = settings.globalProxies;
    if (Array.isArray(list) && list.length > 0) {
      const idx = Math.floor(Math.random() * list.length);
      return list[idx];
    }
  } catch {
    // fallback if store not yet initialized
  }
  return "";
}

export function resolveProxyDispatcher(proxy) {
  let value = typeof proxy === "string" ? proxy.trim() : "";
  if (!value) {
    value = getRandomGlobalProxy();
  }
  if (!value) return undefined;
  if (!proxyAgents.has(value)) proxyAgents.set(value, new ProxyAgent(value));
  return proxyAgents.get(value);
}
