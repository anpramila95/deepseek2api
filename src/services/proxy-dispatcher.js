import { ProxyAgent } from "undici";

const proxyAgents = new Map();

export function resolveProxyDispatcher(proxy) {
  const value = typeof proxy === "string" ? proxy.trim() : "";
  if (!value) return undefined;
  if (!proxyAgents.has(value)) proxyAgents.set(value, new ProxyAgent(value));
  return proxyAgents.get(value);
}
