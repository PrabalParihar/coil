import { request as httpsRequest } from "node:https";
import { createPublicClient, http, type Address } from "viem";
import { coilFactoryAbi } from "./mezo";
import { readFeeBps, type OpenFeeSnapshot } from "./open-fee";

type PolicyTuple = {
  feeBps: number;
  opensPaused: boolean;
  maxCollateral: bigint;
  maxDebt: bigint;
};

type FeeReader = {
  readContract: (args: {
    address: Address;
    abi: typeof coilFactoryAbi;
    functionName: "coilFeeBps" | "opensPaused" | "policy";
  }) => Promise<unknown>;
};

function isPolicy(value: unknown): value is PolicyTuple {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<PolicyTuple>;
  return typeof row.opensPaused === "boolean" && typeof row.maxCollateral === "bigint" && typeof row.maxDebt === "bigint";
}

async function readOptional(client: FeeReader, factory: Address, functionName: "coilFeeBps" | "opensPaused" | "policy") {
  try {
    return await client.readContract({ address: factory, abi: coilFactoryAbi, functionName });
  } catch {
    return undefined;
  }
}

/** Read `coilFeeBps()` for the open fee. Pause and limits are optional. */
export async function readOpenFeeFromClient(client: FeeReader, factory: Address): Promise<OpenFeeSnapshot | null> {
  const [feeRaw, pausedRaw, policyRaw] = await Promise.all([
    readOptional(client, factory, "coilFeeBps"),
    readOptional(client, factory, "opensPaused"),
    readOptional(client, factory, "policy"),
  ]);
  const feeBps = readFeeBps(feeRaw);
  if (feeBps === null) return null;
  const policy = isPolicy(policyRaw) ? policyRaw : null;
  return {
    factory,
    feeBps,
    opensPaused: typeof pausedRaw === "boolean" ? pausedRaw : policy ? policy.opensPaused : null,
    maxCollateral: policy ? policy.maxCollateral.toString() : null,
    maxDebt: policy ? policy.maxDebt.toString() : null,
  };
}

/**
 * `output: "export"` prerenders with Next's patched fetch. A no-store RPC call
 * is treated as dynamic and thrown away, which used to leave the HTML on the
 * "policy unavailable" branch. This fetch talks to the public RPC directly so
 * the prerender can bake `coilFeeBps()` / `opensPaused()`. The browser still
 * replaces that snapshot after hydration. A failed read must not fail the build.
 */
function rpcFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
  const body = typeof init?.body === "string" ? init.body : undefined;
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, {
      method: init?.method ?? "POST",
      headers: { "content-type": "application/json", ...(init?.headers as Record<string, string> | undefined) },
      timeout: 4_000,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve(new Response(Buffer.concat(chunks).toString("utf8"), { status: res.statusCode ?? 500 }));
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Coil factory RPC timed out."));
    });
    if (body) req.write(body);
    req.end();
  });
}

export async function readOpenFeeSnapshot(factory: Address, rpcUrl: string): Promise<OpenFeeSnapshot | null> {
  try {
    const client = createPublicClient({
      transport: http(rpcUrl, { timeout: 4_000, fetchFn: rpcFetch }),
    });
    return await readOpenFeeFromClient(client, factory);
  } catch {
    return null;
  }
}
