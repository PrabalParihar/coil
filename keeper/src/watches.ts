import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAddress, type Address } from "viem";
import { notify, type Telegram } from "./alerts.js";

type WatchFile = { addresses: Address[] };

function watchesPath() {
  return process.env.WATCHES_PATH || "/tmp/coil-watches.json";
}

export function loadWatches(): Address[] {
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

export async function pollCommands(tg: Telegram | null) {
  if (!tg) return;
  const url = `https://api.telegram.org/bot${tg.token}/getUpdates?timeout=0&offset=${tg.offset}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
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
