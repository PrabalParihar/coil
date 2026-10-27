import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import { musdBelowPegBps, needsGuard, notify, telegramFromEnv, type Telegram } from "./alerts.js";
import { accountErrors, revertReason } from "./revert.js";
import { privateKeyToAccount } from "viem/accounts";
import { mezoTestnet } from "./chain.js";

const factoryAbi = [
  {
    type: "function",
    name: "accountsLength",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "accounts",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "heartbeat",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
] as const;

const accountAbi = [
  {
    type: "function",
    name: "position",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "active", type: "bool" },
          { name: "collateral", type: "uint256" },
          { name: "debt", type: "uint256" },
          { name: "cr", type: "uint256" },
          { name: "liquidationPrice", type: "uint256" },
          { name: "redemptionRank", type: "uint256" },
          { name: "floorCR", type: "uint256" },
          { name: "guardTargetCR", type: "uint256" },
          { name: "redemptionZone", type: "uint32" },
          { name: "slippageBps", type: "uint16" },
          { name: "owner", type: "address" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "guard",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "acted", type: "bool" }],
  },
  ...accountErrors,
] as const;

type Position = {
  active: boolean;
  collateral: bigint;
  debt: bigint;
  cr: bigint;
  liquidationPrice: bigint;
  redemptionRank: bigint;
  floorCR: bigint;
  guardTargetCR: bigint;
  redemptionZone: number;
  slippageBps: number;
  owner: Address;
};

const OUTSIDE = (1n << 256n) - 1n;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const MUSD = "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503";
const PRICE_FEED = "0x86bCF0841622a5dAC14A313a15f96A95421b9366";
const POOL = "0xd16A5Df82120ED8D626a1a15232bFcE2366d6AA9";

const priceAbi = [
  { type: "function", name: "fetchPrice", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;
const poolAbi = [
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "function",
    name: "getReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
  },
] as const;
const pegAbi = [
  { type: "function", name: "pegGuardBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
] as const;

function pct(cr: bigint) {
  if (cr === 0n) return "—";
  const hundredths = (cr * 10000n) / 10n ** 18n;
  return `${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, "0")}%`;
}

type WatchFile = { addresses: Address[] };

function watchesPath() {
  return process.env.WATCHES_PATH || "/tmp/coil-watches.json";
}

function loadWatches(): Address[] {
  const path = watchesPath();
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as WatchFile;
    return (parsed.addresses ?? []).filter((item) => isAddress(item));
  } catch {
    return [];
  }
}

function saveWatches(addresses: Address[]) {
  const unique = [...new Set(addresses.map((item) => item.toLowerCase() as Address))];
  writeFileSync(watchesPath(), JSON.stringify({ addresses: unique }, null, 2));
  return unique;
}

async function pollCommands(tg: Telegram | null) {
  if (!tg) return;
  const url = `https://api.telegram.org/bot${tg.token}/getUpdates?timeout=0&offset=${tg.offset}`;
  const response = await fetch(url);
  if (!response.ok) return;
  const body = (await response.json()) as {
    ok: boolean;
    result?: { update_id: number; message?: { text?: string; chat?: { id: number } } }[];
  };
  if (!body.ok || !body.result) return;
  let watches = loadWatches();
  for (const update of body.result) {
    tg.offset = update.update_id + 1;
    const text = update.message?.text?.trim() ?? "";
    const chat = update.message?.chat?.id;
    if (!text.startsWith("/") || chat?.toString() !== tg.chatId) continue;
    const [command, arg] = text.split(/\s+/, 2);
    if (command === "/watch" && arg && isAddress(arg)) {
      watches = saveWatches([...watches, arg]);
      await notify(tg, `Watching ${arg}. The keeper still only calls guard().`);
    } else if (command === "/unwatch" && arg && isAddress(arg)) {
      watches = saveWatches(watches.filter((item) => item.toLowerCase() !== arg.toLowerCase()));
      await notify(tg, `Stopped watching ${arg}.`);
    } else if (command === "/help" || command === "/start") {
      await notify(
        tg,
        "Coil Labs keeper. /watch 0xClone and /unwatch 0xClone. Alerts fire when a trove is under its floor, inside its redemption zone, or near the queue while MUSD is under $1. guard() pays MEZO only on the Wave 2 factory, and only if the ratio rose. The bot token is never printed.",
      );
    }
  }
}

async function listAccounts(publicClient: PublicClient, factory: Address) {
  const length = await publicClient.readContract({
    address: factory,
    abi: factoryAbi,
    functionName: "accountsLength",
  });
  const accounts: Address[] = [];
  for (let i = 0n; i < length; i++) {
    const account = await publicClient.readContract({
      address: factory,
      abi: factoryAbi,
      functionName: "accounts",
      args: [i],
    });
    accounts.push(account);
  }
  for (const extra of loadWatches()) {
    if (!accounts.some((item) => item.toLowerCase() === extra.toLowerCase())) accounts.push(extra);
  }
  return accounts;
}

async function scan(opts: {
  publicClient: PublicClient;
  wallet?: WalletClient;
  factory: Address;
  execute: boolean;
  tg: Telegram | null;
}) {
  const { publicClient, wallet, factory, execute, tg } = opts;
  const accounts = await listAccounts(publicClient, factory);
  console.log(`Coil Labs keeper · ${accounts.length} account(s) · ${execute ? "EXECUTE" : "dry run"}`);
  let belowPeg = 0n;
  try {
    const price = await publicClient.readContract({ address: PRICE_FEED, abi: priceAbi, functionName: "fetchPrice" });
    const token0 = await publicClient.readContract({ address: POOL, abi: poolAbi, functionName: "token0" });
    const reserves = await publicClient.readContract({ address: POOL, abi: poolAbi, functionName: "getReserves" });
    const musdFirst = token0.toLowerCase() === MUSD.toLowerCase();
    belowPeg = musdBelowPegBps(musdFirst ? reserves[0] : reserves[1], musdFirst ? reserves[1] : reserves[0], price);
    console.log(`MUSD under $1 by ${belowPeg.toString()} bps`);
  } catch (error) {
    console.log(`peg read skipped (${error instanceof Error ? error.message.slice(0, 140) : "error"})`);
  }
  const signer = wallet?.account?.address ?? ZERO;

  for (const account of accounts) {
    let position: Position;
    try {
      position = (await publicClient.readContract({
        address: account,
        abi: accountAbi,
        functionName: "position",
      })) as Position;
    } catch (error) {
      console.log(`${account} unreadable (${error instanceof Error ? error.message : "error"})`);
      continue;
    }
    if (!position.active) {
      console.log(`${account} idle`);
      continue;
    }
    let pegGuardBps = 0;
    try {
      pegGuardBps = Number(
        await publicClient.readContract({ address: account, abi: pegAbi, functionName: "pegGuardBps" }),
      );
    } catch {
      pegGuardBps = 0;
    }
    const reason = needsGuard(position, { belowPegBps: belowPeg, pegGuardBps });
    const rank =
      position.redemptionRank === OUTSIDE ? "outside top 32" : position.redemptionRank.toString();
    console.log(
      `${account} owner=${position.owner} CR=${pct(position.cr)} floor=${pct(position.floorCR)} guard=${pct(position.guardTargetCR)} rank=${rank}`,
    );
    if (!reason) continue;

    console.log(`  guard() because ${reason}`);
    await notify(
      tg,
      `Coil Labs: ${account} ${reason}. CR ${pct(position.cr)}, floor ${pct(position.floorCR)}, target ${pct(position.guardTargetCR)}.`,
    );

    const caller = wallet?.account?.address ?? "0x0000000000000000000000000000000000000001";
    try {
      const simulated = await publicClient.simulateContract({
        address: account,
        abi: accountAbi,
        functionName: "guard",
        account: caller,
      });
      if (!simulated.result) {
        console.log("  simulation returned false (already safe, or the ratio would not rise)");
        continue;
      }
    } catch (error) {
      const reason = revertReason(error);
      console.log(`  simulation reverted: ${reason}`);
      if (reason === "NotKeeper()") {
        console.log("  Wave 1 guard() is owner/keeper only and pays no MEZO. Wave 2 pays a MEZO tip when the ratio rises.");
      }
      await notify(tg, `Coil Labs: guard() simulation failed for ${account}. ${reason.slice(0, 180)}`);
      continue;
    }

    if (!execute || !wallet) {
      console.log("  dry run: would send guard()");
      continue;
    }

    try {
      const hash = await wallet.writeContract({
        address: account,
        abi: accountAbi,
        functionName: "guard",
        account: wallet.account!,
        chain: mezoTestnet,
        gas: 6_000_000n,
      });
      console.log(`  tx ${hash}`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      console.log(`  ${receipt.status} block ${receipt.blockNumber}`);
      const link = `https://explorer.test.mezo.org/tx/${hash}`;
      if (receipt.status === "success") {
        await notify(tg, `Coil Labs rescue ${link}`);
      } else {
        await notify(tg, `Coil Labs rescue reverted ${link}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  send failed: ${message.slice(0, 240)}`);
      await notify(tg, `Coil Labs: rescue failed for ${account}. ${message.slice(0, 180)}`);
    }
  }

  if (execute && wallet) {
    try {
      const hash = await wallet.writeContract({
        address: factory,
        abi: factoryAbi,
        functionName: "heartbeat",
        account: wallet.account!,
        chain: mezoTestnet,
        gas: 200_000n,
      });
      console.log(`heartbeat ${hash} signer ${signer}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "error";
      const missing = /not found|does not exist|unknown function/i.test(message);
      console.log(
        `heartbeat skipped (${message.slice(0, 160)})${missing ? ". Wave 1 factories have no heartbeat()." : ""}`,
      );
    }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const execute = process.argv.includes("--execute") || process.env.COIL_EXECUTE === "true";
  const watch = process.argv.includes("--watch") || process.env.KEEPER_WATCH === "true";
  const rpc = process.env.MEZO_TESTNET_RPC ?? "https://rpc.test.mezo.org";
  const factory = process.env.COIL_FACTORY;
  if (!factory || !isAddress(factory)) {
    throw new Error("Set COIL_FACTORY to the deployed CoilFactory address.");
  }
  const pollMs = Number(process.env.KEEPER_POLL_MS ?? "20000");
  const publicClient = createPublicClient({ chain: mezoTestnet, transport: http(rpc) });
  const tg = telegramFromEnv();
  if (!tg) console.log("Telegram alerts off (set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to enable).");

  let wallet: WalletClient | undefined;
  if (execute) {
    const key = process.env.KEEPER_PRIVATE_KEY;
    if (!key) throw new Error("Set KEEPER_PRIVATE_KEY to send guard() transactions.");
    const account = privateKeyToAccount(key as `0x${string}`);
    wallet = createWalletClient({ account, chain: mezoTestnet, transport: http(rpc) });
    console.log(`signer ${account.address}`);
  }

  do {
    if (tg) await pollCommands(tg);
    await scan({ publicClient, wallet, factory, execute, tg });
    if (!watch) break;
    await sleep(Number.isFinite(pollMs) && pollMs >= 3000 ? pollMs : 20000);
  } while (watch);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
