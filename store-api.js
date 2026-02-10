// Store API client for Loiter Lawyer Tamagotchi
// Fetches store catalog and handles purchases via remote API.
// Falls back to built-in items when no API is configured or the API is unreachable.
//
// Configuration: Create ~/.biglaw-sim/store-config.json with:
//   { "apiBase": "https://your-api.com/api", "apiKey": "your-key-here" }
// If the file doesn't exist, the built-in catalog is used (no error shown).

const fs = require("fs");
const path = require("path");
const os = require("os");

const CONFIG_FILE = path.join(os.homedir(), ".biglaw-sim", "store-config.json");

const BUILTIN_ITEMS = [
  {
    id: "hat",
    name: "Fun Hat",
    description: "Cosmetic. Slight stress reduction on breaks.",
    cost: 250,
    category: "cosmetic",
    effect: { target: "lawyer.outfit.hat", value: true }
  },
  {
    id: "tie",
    name: "New Tie Patterns",
    description: "Cosmetic. Small rep gain buff.",
    cost: 200,
    category: "cosmetic",
    effect: { target: "lawyer.outfit.tie", value: true }
  },
  {
    id: "casual",
    name: "Casual Fridays",
    description: "On Fridays, passive stress decay improves.",
    cost: 500,
    category: "upgrade",
    effect: { target: "lawyer.outfit.casualFridays", value: true }
  },
  {
    id: "fridge",
    name: "Mini-Fridge",
    description: "Hunger decays slower.",
    cost: 800,
    category: "upgrade",
    effect: { target: "store.fridge", value: true }
  },
  {
    id: "coffeeMaker",
    name: "Better Coffee Maker",
    description: "Caffeine decays slower.",
    cost: 800,
    category: "upgrade",
    effect: { target: "store.coffeeMaker", value: true }
  },
  {
    id: "desk",
    name: "Standing Desk",
    description: "Stress rises slower during work.",
    cost: 900,
    category: "upgrade",
    effect: { target: "store.desk", value: true }
  }
];

let _cachedCatalog = null;
let _catalogFetchedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Read store API config from ~/.biglaw-sim/store-config.json.
 * Returns { apiBase, apiKey } or null if not configured.
 */
function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return null;
    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    const cfg = JSON.parse(raw);
    if (!cfg.apiBase) return null;
    return { apiBase: cfg.apiBase.replace(/\/+$/, ""), apiKey: cfg.apiKey || "" };
  } catch {
    return null;
  }
}

async function apiFetch(endpoint, options = {}) {
  const config = loadConfig();
  if (!config) throw new Error("No API configured");

  const url = `${config.apiBase}${endpoint}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (config.apiKey) {
      headers["Authorization"] = `Bearer ${config.apiKey}`;
    }

    const res = await fetch(url, { ...options, signal: controller.signal, headers });

    if (!res.ok) {
      throw new Error(`Store API error: ${res.status} ${res.statusText}`);
    }

    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch the store catalog.
 * - source "builtin": no API configured, using built-in items (normal default)
 * - source "api": fetched from remote API
 * - source "cache": returned cached API result
 * - source "fallback": API configured but unreachable, using built-in items
 */
async function fetchCatalog() {
  const config = loadConfig();

  // No API configured — use built-in items silently (this is the normal case)
  if (!config) {
    return { items: BUILTIN_ITEMS, source: "builtin" };
  }

  const now = Date.now();
  if (_cachedCatalog && (now - _catalogFetchedAt) < CACHE_TTL_MS) {
    return { items: _cachedCatalog, source: "cache" };
  }

  try {
    const data = await apiFetch("/store/items");
    const items = Array.isArray(data.items) ? data.items : data;

    const valid = items.every(
      (it) => it.id && it.name && typeof it.cost === "number"
    );
    if (!valid) throw new Error("Invalid catalog format from API");

    _cachedCatalog = items;
    _catalogFetchedAt = now;
    return { items, source: "api" };
  } catch (err) {
    console.warn("Store API unreachable, using fallback catalog:", err.message);
    return { items: BUILTIN_ITEMS, source: "fallback" };
  }
}

/**
 * Notify the API that a purchase was made (fire-and-forget).
 * Does nothing if no API is configured.
 */
async function reportPurchase(itemId, pointsSpent) {
  const config = loadConfig();
  if (!config) return;

  try {
    await apiFetch("/store/purchase", {
      method: "POST",
      body: JSON.stringify({ itemId, pointsSpent, timestamp: Date.now() })
    });
  } catch (err) {
    console.warn("Could not report purchase to API:", err.message);
  }
}

/** Clear the catalog cache so the next fetchCatalog() hits the API. */
function invalidateCache() {
  _cachedCatalog = null;
  _catalogFetchedAt = 0;
}

/** Check whether an API is currently configured. */
function isConfigured() {
  return loadConfig() !== null;
}

module.exports = { fetchCatalog, reportPurchase, invalidateCache, isConfigured, BUILTIN_ITEMS };
