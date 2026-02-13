// Store API client for Loiter Lawyer Tamagotchi
// Fetches store catalog and handles purchases via remote API.
// Falls back to built-in items when no API is configured or the API is unreachable.
//
// Configuration (two options, in-app takes priority):
//   1. In-app: Use setConfig({ apiBase, apiKey }) from the renderer
//   2. File:   Create ~/.biglaw-sim/store-config.json with:
//              { "apiBase": "https://your-api.com/api", "apiKey": "your-key-here" }
//
// If neither is set, the built-in catalog is used (no error shown).

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
  },
  {
    id: "designerWatch",
    name: "Designer Watch",
    description: "A Rolex Submariner. +5% productivity. Impresses absolutely nobody at the firm.",
    cost: 1200,
    category: "cosmetic",
    effect: { target: "store.designerWatch", value: true }
  },
  {
    id: "golfClubs",
    name: "Golf Clubs",
    description: "Titleist AP2 irons. Passive stress decay +15%. For 'networking,' obviously.",
    cost: 1500,
    category: "upgrade",
    effect: { target: "store.golfClubs", value: true }
  },
  {
    id: "leatherBriefcase",
    name: "Leather Briefcase",
    description: "Italian calfskin. Reputation gains +15%. You look like you bill $800/hr.",
    cost: 1000,
    category: "upgrade",
    effect: { target: "store.leatherBriefcase", value: true }
  },
  {
    id: "espressoMachine",
    name: "Espresso Machine",
    description: "La Marzocca Linea Mini. Coffee action gives +30% more caffeine.",
    cost: 1100,
    category: "upgrade",
    effect: { target: "store.espressoMachine", value: true }
  },
  {
    id: "cornerOfficeArt",
    name: "Corner Office Art",
    description: "A framed Rothko print. Passive stress rise -10%. It 'speaks to you.'",
    cost: 750,
    category: "cosmetic",
    effect: { target: "store.cornerOfficeArt", value: true }
  },
  {
    id: "monogrammedPen",
    name: "Monogrammed Pen",
    description: "Montblanc Meisterstück. Billable hour gains +8%. The ink flows like settlements.",
    cost: 600,
    category: "upgrade",
    effect: { target: "store.monogrammedPen", value: true }
  }
];

let _cachedCatalog = null;
let _catalogFetchedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// In-app config set by the renderer via setConfig()
let _inAppConfig = null;

/**
 * Set the API configuration from the in-app settings UI.
 * Pass { apiBase, apiKey } to connect, or null to disconnect.
 */
function setConfig(cfg) {
  if (!cfg || !cfg.apiBase) {
    _inAppConfig = null;
  } else {
    _inAppConfig = {
      apiBase: cfg.apiBase.replace(/\/+$/, ""),
      apiKey: cfg.apiKey || ""
    };
  }
  invalidateCache();
}

/** Get the current in-app config (for saving to game state). */
function getConfig() {
  return _inAppConfig ? { ..._inAppConfig } : null;
}

/**
 * Resolve the active config. In-app config takes priority over file config.
 * Returns { apiBase, apiKey } or null if not configured.
 */
function loadConfig() {
  // In-app config takes priority
  if (_inAppConfig) return _inAppConfig;

  // Fall back to file-based config
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
    return { items: BUILTIN_ITEMS, source: "fallback", error: err.message };
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

module.exports = { fetchCatalog, reportPurchase, invalidateCache, isConfigured, setConfig, getConfig, BUILTIN_ITEMS };
