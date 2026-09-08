// Geo-gate — Base tokenized stocks are Regulation S (non-US only).
// Hard-blocks US-origin users; configurable strictness for unknown/local IPs.
import { GEO } from "./config.js";

const cache = new Map(); // ip -> { country, ts }
const TTL_MS = 5 * 60_000;
const FREE_NETWORK = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$)/;

export function clientIp(req) {
  return (
    (req.headers["x-forwarded-for"] || "").split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    ""
  );
}

async function lookupCountry(ip) {
  if (FREE_NETWORK.test(ip) || !ip) return "LK"; // local — treated as loopback
  const hit = cache.get(ip);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.country;
  try {
    const res = await fetch(`https://freeipapi.com/api/json/${ip}`, {
      signal: AbortSignal.timeout(5000),
    });
    const j = await res.json();
    const code = (j.countryCode || "").toUpperCase();
    cache.set(ip, { country: code, ts: Date.now() });
    return code;
  } catch (e) {
    return "UNKNOWN";
  }
}

const BLOCKLIST = new Set(["US"]);

export async function geoCheck(req) {
  const ip = clientIp(req);
  const country = await lookupCountry(ip);
  if (BLOCKLIST.has(country)) {
    return { allowed: false, country, ip, reason: "US-origin restricted (Regulation S — non-US eligible only)" };
  }
  if ((country === "UNKNOWN" || country === "LK") && GEO === "strict") {
    return { allowed: false, country, ip, reason: "Origin could not be verified (strict mode)" };
  }
  return { allowed: true, country, ip, reason: null };
}