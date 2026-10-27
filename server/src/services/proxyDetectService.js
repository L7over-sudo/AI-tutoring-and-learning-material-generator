import net from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const COMMON_PROXY_PORTS = [7897, 7890, 7899, 10809, 10808, 1080, 1087, 20171, 2080, 4780, 8080, 8888, 7777, 6152];

function parseProxyUrl(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`);
    if (!url.hostname || !url.port) return null;
    return {
      proxyHost: url.hostname,
      proxyPort: url.port,
      proxyProtocol: url.protocol.startsWith("socks") ? "socks5" : "http"
    };
  } catch {
    return null;
  }
}

function parseWindowsProxyServer(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  const protocolEntry = text
    .split(";")
    .map((item) => item.trim())
    .find((item) => /^(https?|socks)=/i.test(item));
  const selected = protocolEntry ? protocolEntry.split("=").slice(1).join("=") : text.split(";")[0];
  return parseProxyUrl(selected);
}

async function detectEnvProxy() {
  return parseProxyUrl(process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY || process.env.https_proxy || process.env.http_proxy || process.env.all_proxy);
}

async function detectWindowsSystemProxy() {
  if (process.platform !== "win32") return null;

  try {
    const { stdout } = await execFileAsync("reg", [
      "query",
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
      "/v",
      "ProxyServer"
    ], { windowsHide: true, timeout: 1500 });
    const match = stdout.match(/ProxyServer\s+REG_\w+\s+(.+)/i);
    return parseWindowsProxyServer(match?.[1]);
  } catch {
    return null;
  }
}

export function canConnect(port, host = "127.0.0.1", timeoutMs = 300) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

async function usable(proxy) {
  if (!proxy?.proxyHost || !proxy?.proxyPort) return null;
  return await canConnect(Number(proxy.proxyPort), proxy.proxyHost, 500) ? proxy : null;
}

export async function detectConfiguredProxy() {
  return (await usable(await detectEnvProxy())) || (await usable(await detectWindowsSystemProxy())) || (await detectLocalProxy());
}

export async function detectLocalProxy() {
  for (const port of COMMON_PROXY_PORTS) {
    if (await canConnect(port)) {
      return { proxyHost: "127.0.0.1", proxyPort: String(port), proxyProtocol: "http" };
    }
  }
  return null;
}

export async function isLocalProxyAvailable(proxyHost, proxyPort) {
  if (!proxyHost || !proxyPort || !/^\d+$/.test(String(proxyPort))) return false;
  return canConnect(Number(proxyPort), proxyHost);
}
