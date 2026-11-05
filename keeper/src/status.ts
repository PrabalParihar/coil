import { createServer } from "node:http";
import type { KeeperStatus } from "./engine.js";

export function createStatusServer(status: () => KeeperStatus) {
  return createServer((req, res) => {
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.setHeader("access-control-allow-origin", "*");
    if (req.url !== "/health" && req.url !== "/status") {
      res.writeHead(404).end('{"error":"not found"}'); return;
    }
    if (req.method !== "GET") {
      res.setHeader("allow", "GET");
      res.writeHead(405).end('{"error":"method not allowed"}'); return;
    }
    const body = status();
    res.statusCode = req.url === "/health" && body.status !== "healthy" && body.status !== "monitoring" ? 503 : 200;
    res.end(JSON.stringify(body));
  });
}
