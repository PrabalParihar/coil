import { isAddress } from "viem";

const COUNTERS = ["scans", "scanFailures", "simulations", "skipped", "failures", "confirmedGuards", "confirmedHeartbeats"] as const;
const STATUS_KEYS = ["chainId", "factory", "keeper", "mode", "lastScanAt", "lastHeartbeatAt", "status", "counters"] as const;
const STATUS_VALUES = ["starting", "stale", "monitoring", "healthy", "degraded"] as const;
type ServiceStatus = typeof STATUS_VALUES[number];
export type ServiceIdentity = { chainId: number; factory: string; expectedKeeper?: string | null };
export type PublicKeeperStatus = {
  chainId: number; factory: string; keeper: string | null; mode: "read-only" | "execute";
  lastScanAt: number | null; lastHeartbeatAt: number | null; status: ServiceStatus;
  counters: Record<typeof COUNTERS[number], number>;
};
export type ServiceRead = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; data: PublicKeeperStatus };
export type KeyedServiceRead = ServiceRead & { key: string };

/** Operator-selected public endpoint: no local hosts, credentials or URL secrets. */
export function publicStatusUrl(value?: string): string | null {
  if (!value) return null;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Keeper status URL must be a public HTTPS URL."); }
  const host = url.hostname.toLowerCase();
  const publicDnsName = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port || !publicDnsName || /(?:^|\.)(?:localhost|local|internal|test|invalid|onion)$/.test(host)) {
    throw new Error("Keeper status URL must use public HTTPS without credentials, parameters or a custom port.");
  }
  return url.href;
}
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function address(value: unknown): value is string {
  return typeof value === "string" && isAddress(value) && !/^0x0{40}$/i.test(value);
}
function timestamp(value: unknown, now: number): value is number | null {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 1_000_000_000_000 && value <= now + 30_000);
}

/** Validate deployment, signer, public schema and epoch-ms semantics before display. */
export function validatePublicStatus(value: unknown, expected: ServiceIdentity, now = Date.now()): PublicKeeperStatus {
  const invalid = () => { throw new Error("Public keeper status does not match the selected deployment or status schema."); };
  if (!record(value) || !exactKeys(value, STATUS_KEYS)) return invalid();
  if (value.chainId !== expected.chainId || !address(value.factory) || value.factory.toLowerCase() !== expected.factory.toLowerCase()) return invalid();
  if (value.mode !== "read-only" && value.mode !== "execute") return invalid();
  if (value.keeper !== null && (!address(value.keeper) || !expected.expectedKeeper || value.keeper.toLowerCase() !== expected.expectedKeeper.toLowerCase())) return invalid();
  if (value.mode === "execute" && (!address(value.keeper) || !address(expected.expectedKeeper))) return invalid();
  if (!timestamp(value.lastScanAt, now) || !timestamp(value.lastHeartbeatAt, now) || !STATUS_VALUES.includes(value.status as ServiceStatus)) return invalid();
  if (!record(value.counters) || !exactKeys(value.counters, COUNTERS) || COUNTERS.some(key => !Number.isSafeInteger(value.counters && (value.counters as Record<string, unknown>)[key]) || Number((value.counters as Record<string, unknown>)[key]) < 0)) return invalid();
  if (value.mode === "read-only" && value.status === "healthy") return invalid();
  if (value.mode === "execute" && value.status === "monitoring") return invalid();
  if (value.status === "healthy" && (value.lastScanAt === null || value.lastHeartbeatAt === null)) return invalid();
  if ((value.status === "monitoring" || value.status === "stale") && value.lastScanAt === null) return invalid();
  if (value.status === "starting" && value.lastScanAt !== null) return invalid();
  return { chainId: expected.chainId, factory: value.factory, keeper: value.keeper as string | null, mode: value.mode,
    lastScanAt: value.lastScanAt, lastHeartbeatAt: value.lastHeartbeatAt, status: value.status as ServiceStatus,
    counters: Object.fromEntries(COUNTERS.map(key => [key, (value.counters as Record<string, number>)[key]])) as PublicKeeperStatus["counters"] };
}

/** Fresh scan evidence expires after 60s; a response cannot perpetuate old healthy status. */
export function serviceStatusView(data: PublicKeeperStatus, now = Date.now()) {
  const scanAgeMs = data.lastScanAt === null ? null : Math.max(0, now - data.lastScanAt);
  const heartbeatAgeMs = data.lastHeartbeatAt === null ? null : Math.max(0, now - data.lastHeartbeatAt);
  const stale = scanAgeMs !== null && scanAgeMs > 60_000 || data.status === "healthy" && (heartbeatAgeMs === null || heartbeatAgeMs > 60_000);
  return { status: stale ? "stale" as const : data.status, mode: data.mode, scanAgeMs, heartbeatAgeMs };
}

export async function fetchPublicStatus(url: string, identity: ServiceIdentity, signal: AbortSignal, fetcher: typeof fetch = fetch, now = Date.now()): Promise<PublicKeeperStatus> {
  const endpoint = publicStatusUrl(url);
  if (!endpoint) throw new Error("No public status endpoint configured.");
  const response = await fetcher(endpoint, { method: "GET", credentials: "omit", cache: "no-store", redirect: "error", signal, headers: { Accept: "application/json" } });
  if (!response.ok || !response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new Error("Public keeper status unavailable.");
  const body = await response.text();
  if (body.length > 16_384) throw new Error("Invalid public status response.");
  return validatePublicStatus(JSON.parse(body), identity, now);
}

export function selectServiceRead(key: string, state: KeyedServiceRead | null): ServiceRead {
  if (!state || state.key !== key) return { kind: "loading" };
  if (state.kind === "ok") return { kind: "ok", data: state.data };
  if (state.kind === "error") return { kind: "error", message: state.message };
  return { kind: "loading" };
}

export function startPublicStatusRead(key: string, read: (signal: AbortSignal) => Promise<PublicKeeperStatus>, publish: (state: KeyedServiceRead) => void, timeoutMs = 8_000): () => void {
  const controller = new AbortController();
  let current = true;
  let finished = false;
  const fail = () => {
    if (!current || finished) return;
    finished = true;
    publish({ key, kind: "error", message: "Public keeper service unavailable or invalid. Chain heartbeat evidence is shown separately." });
  };
  const timer = setTimeout(() => { controller.abort(); fail(); }, timeoutMs);
  publish({ key, kind: "loading" });
  void (async () => {
    try {
      const data = await read(controller.signal);
      if (current && !finished && !controller.signal.aborted) { finished = true; publish({ key, kind: "ok", data }); }
    } catch { fail(); }
    finally { clearTimeout(timer); }
  })();
  return () => { current = false; clearTimeout(timer); controller.abort(); };
}
