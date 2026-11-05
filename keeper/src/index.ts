import { createPublicClient, createWalletClient, http, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { setTimeout as delay } from "node:timers/promises";
import { DEPLOYMENTS, RETAINED_DEPLOYMENTS } from "./deployment.generated.js";
import { selectDeployment } from "./config.js";
import { chainForDeployment } from "./chain.js";
import { notify, telegramFromEnv } from "./alerts.js";
import { KeeperEngine } from "./engine.js";
import { createKeeperIO } from "./rpc.js";
import { createStatusServer } from "./status.js";
import { loadWatches, pollCommands } from "./watches.js";

async function main() {
  const config = selectDeployment(process.env, DEPLOYMENTS, process.argv.includes("--execute"), RETAINED_DEPLOYMENTS);
  const watch = process.argv.includes("--watch") || process.env.KEEPER_WATCH === "true";
  const chain = chainForDeployment(config);
  const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl, { timeout: 15_000, retryCount: 1 }) });
  let wallet: WalletClient | undefined;
  if (config.execute) {
    const key = process.env.KEEPER_PRIVATE_KEY;
    if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("Configure a keeper private key.");
    const account = privateKeyToAccount(key as `0x${string}`);
    if (!config.expectedKeeper || config.expectedKeeper.toLowerCase() !== account.address.toLowerCase()) {
      throw new Error("Signer must match configured expected keeper.");
    }
    wallet = createWalletClient({ account, chain, transport: http(config.rpcUrl, { timeout: 15_000, retryCount: 0 }) });
  }
  const tg = telegramFromEnv();
  const io = createKeeperIO({ publicClient, wallet, chain, config, watches: loadWatches, alert: (message) => notify(tg, message) });
  const engine = new KeeperEngine({ chainId: config.chainId, factory: config.factory, keeper: wallet?.account?.address ?? null,
    expectedKeeper: config.expectedKeeper, mode: config.execute ? "execute" : "read-only", pollMs: config.pollMs }, io);
  const server = createStatusServer(() => engine.status());
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(config.port, "0.0.0.0", resolve); });
  console.log(`Coil keeper: chain ${config.chainId}, factory ${config.factory}, mode ${config.execute ? "execute" : "read-only"}.`);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    do {
      // Commands are optional; Telegram availability does not determine rescue availability.
      try { await pollCommands(tg); } catch { console.error("Telegram commands unavailable."); }
      if (controller.signal.aborted) break;
      await engine.scan();
      console.log(`Keeper scan: ${engine.status().status}.`);
      if (!watch) break;
      try { await delay(config.pollMs, undefined, { signal: controller.signal }); } catch { break; }
    } while (!controller.signal.aborted);
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

main().catch(() => {
  // Provider/key parsing exceptions may contain credentials. Never print raw error objects.
  console.error("Keeper stopped: check deployment, RPC, port, and expected signer configuration.");
  process.exitCode = 1;
});
