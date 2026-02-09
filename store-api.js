// Store API client for Loiter Lawyer Tamagotchi
// Fetches store catalog and handles purchases via remote API.
// Falls back to hardcoded items when the API is unreachable.

const STORE_API_BASE = "https://loiter-lawyer-store.lylecheatem.com/api";

const FALLBACK_ITEMS = [
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

async function apiFetch(endpoint, options = {}) {
  const url = `${STORE_API_BASE}${endpoint}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });

    if (!res.ok) {
      throw new Error(`Store API error: ${res.status} ${res.statusText}`);
    }

    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch the store catalog from the API.
 * Returns an array of item objects. Falls back to hardcoded items on failure.
 */
async function fetchCatalog() {
  const now = Date.now();
  if (_cachedCatalog && (now - _catalogFetchedAt) < CACHE_TTL_MS) {
    return { items: _cachedCatalog, source: "cache" };
  }

  try {
    const data = await apiFetch("/store/items");
    const items = Array.isArray(data.items) ? data.items : data;

    // Validate that items have the expected shape
    const valid = items.every(
      (it) => it.id && it.name && typeof it.cost === "number"
    );
    if (!valid) throw new Error("Invalid catalog format from API");

    _cachedCatalog = items;
    _catalogFetchedAt = now;
    return { items, source: "api" };
  } catch (err) {
    console.warn("Store API unreachable, using fallback catalog:", err.message);
    return { items: FALLBACK_ITEMS, source: "fallback" };
  }
}

/**
 * Notify the API that a purchase was made (fire-and-forget).
 * Purchase logic stays client-side since the game state is local.
 */
async function reportPurchase(itemId, pointsSpent) {
  try {
    await apiFetch("/store/purchase", {
      method: "POST",
      body: JSON.stringify({ itemId, pointsSpent, timestamp: Date.now() })
    });
  } catch (err) {
    // Non-critical — purchase already applied locally
    console.warn("Could not report purchase to API:", err.message);
  }
}

/** Clear the catalog cache so the next fetchCatalog() hits the API. */
function invalidateCache() {
  _cachedCatalog = null;
  _catalogFetchedAt = 0;
}

module.exports = { fetchCatalog, reportPurchase, invalidateCache, FALLBACK_ITEMS };
