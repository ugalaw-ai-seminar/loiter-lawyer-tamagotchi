// BigLaw Associate Sim — stable rollback
// Real-time slow decay (hours/days), assignment queue, billables, rank, events, office interactions.
// Persistence: JSON file in user home directory.

const fs = require("fs");
const path = require("path");
const os = require("os");
const storeApi = require("./store-api");

const SAVE_DIR = path.join(os.homedir(), ".biglaw-sim");
const SAVE_FILE = path.join(SAVE_DIR, "save.json");

const $ = (id) => document.getElementById(id);

const RANKS = [
  { name: "Junior Associate", billables: 0, rep: 0 },
  { name: "Midlevel Associate", billables: 600, rep: 80 },
  { name: "Senior Associate", billables: 1400, rep: 200 },
  { name: "Counsel (Partner Track)", billables: 2400, rep: 380 },
  { name: "Partner", billables: 3600, rep: 600 }
];

const PERK_DEFS = [
  { id: "nightOwl",     name: "Night Owl",     cost: 600,  rankReq: 1, desc: "Sleep penalty on productivity reduced by 45%." },
  { id: "masterBiller", name: "Master Biller", cost: 1200, rankReq: 2, desc: "+12% billable hours earned on completed tasks." },
  { id: "goldenVoice",  name: "Golden Voice",  cost: 1800, rankReq: 3, desc: "+25% reputation gain on litigation assignments." }
];

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function now() { return Date.now(); }

function isFriday(ts) { return new Date(ts).getDay() === 5; } // 0 Sun ... 5 Fri

function nextChristmasPartyTimestamp(fromTs) {
  // Thursday before Dec 25 (real-world). If already passed this year's party, compute next year's.
  const d = new Date(fromTs);
  let year = d.getFullYear();

  function partyForYear(y) {
    const dec25 = new Date(y, 11, 25, 18, 0, 0, 0); // 6pm local
    let t = new Date(dec25);
    while (t.getDay() !== 4) t.setDate(t.getDate() - 1); // 4=Thu
    return t.getTime();
  }

  let party = partyForYear(year);
  if (party <= fromTs) party = partyForYear(year + 1);
  return party;
}

const defaultState = () => ({
  createdAt: now(),
  lastTick: now(),
  dismissed: false,

  lawyer: {
    gender: "male",
    hair: "brown",
    eyes: "blue",
    outfit: { suit: true, hat: false, tie: false, casualFridays: false }
  },

  office: {
    plantAlive: true,
    windowClean: false,
    bankersLightOn: true,
    walkingPadOn: false,
    bookshelfBuffUntil: 0
  },

  store: {
    fridge: false,
    coffeeMaker: false,
    desk: false
  },

  perks: {
    nightOwl: false,
    masterBiller: false,
    goldenVoice: false
  },

  stats: {
    hunger: 85,
    caffeine: 70,
    sleep: 75,
    stress: 35
  },

  money: 0,
  billables: 0,

  reputation: { lit: 0, corp: 0, reg: 0 },

  pipStrikes: 0,
  missedDeadlines: 0,

  offers: [],
  queue: [],

  nextEventAt: now() + 1000 * 60 * 60 * 10,
  nextOfferRefreshAt: now() + 1000 * 60 * 60 * 8,
  nextChristmasPartyAt: nextChristmasPartyTimestamp(now()),

  log: [],

  // --- Arc mechanics ---

  // Midlevel: Junior management
  juniors: [],             // Array of { id, name, task, progress, billableHours, points, deadlineAt, assignedAt, completed, missed }
  nextJuniorSpawnAt: 0,    // When the next junior associate appears

  // Senior: Rival tug-of-war
  rival: {
    name: "",
    score: 0,              // Rival's accumulated score
    playerScore: 0,        // Player's tug-of-war score
    momentum: 0,           // -100 to 100 (negative = rival winning, positive = player winning)
    lastTrashTalkAt: 0,
    active: false
  },

  // Partner: Breakaway / prestige
  breakaway: {
    count: 0,              // Number of times player has broken away
    multiplier: 1.0,       // Permanent multiplier from breakaways
    lifetimeEarnings: 0    // Total money across all runs (used for multiplier calc)
  },

  // Work/family choice spiral
  workChoices: 0,          // Consecutive times player chose work over family
  familyChoices: 0,        // Consecutive times player chose family over work
  divorced: false,         // Triggered by sustained work choices
  burnout: false,          // Triggered by extreme work choices — permanent productivity penalty until recovery
  burnoutUntil: 0,         // Timestamp when burnout wears off

  // NPCs
  npcs: [],                // Active NPCs in the office { id, name, type, persona, quote, effect, expiresAt, interacted }
  nextNpcSpawnAt: 0,       // When next NPC wanders in

  // API settings (persisted so user doesn't re-enter each session)
  apiConfig: null,          // { apiBase, apiKey } or null

  // Bitcoin
  bitcoin: {
    holdings: 0,            // BTC amount (fractional)
    totalInvested: 0,       // Total $ spent buying
    lastPrice: 0,           // Last known BTC price (persisted for offline fallback)
    stressCheckPrice: 0,    // Price at last stress effect check
    lastStressCheckAt: 0    // Timestamp of last stress check
  }
});

let state = load() || defaultState();

// ---------- Canvas ----------
const canvas = $("scene");
const ctx = canvas.getContext("2d");

// ---------- UI helpers ----------
function log(msg) {
  const ts = new Date().toLocaleString();
  state.log.unshift({ ts, msg });
  state.log = state.log.slice(0, 120);
  renderLog();
}

function renderLog() {
  const el = $("log");
  el.innerHTML = "";
  for (const e of state.log) {
    const div = document.createElement("div");
    div.className = "entry";
    div.textContent = `[${e.ts}] ${e.msg}`;
    el.appendChild(div);
  }
}

function save() {
  try {
    if (!fs.existsSync(SAVE_DIR)) fs.mkdirSync(SAVE_DIR, { recursive: true });
    fs.writeFileSync(SAVE_FILE, JSON.stringify(state), "utf-8");
    log("Saved.");
  } catch (e) {
    log("Save failed: " + e.message);
  }
}
function load() {
  try {
    if (!fs.existsSync(SAVE_FILE)) return null;
    const raw = fs.readFileSync(SAVE_FILE, "utf-8");
    const s = JSON.parse(raw);
    if (!s.stats || !s.lawyer) return null;
    return s;
  } catch {
    return null;
  }
}

$("btn-save").addEventListener("click", save);
$("btn-load").addEventListener("click", () => {
  const s = load();
  if (s) {
    state = s;
    log("Loaded save.");
    renderAll();
  } else {
    log("No save found.");
  }
});
$("btn-new").addEventListener("click", () => {
  state = defaultState();
  seedOffers(true);
  log("New game started.");
  renderAll();
});

function buyPerk(perkId) {
  const def = PERK_DEFS.find(p => p.id === perkId);
  if (!def) return;
  if (state.perks[perkId]) { log("Already owned."); return; }
  if (rankIndex() < def.rankReq) { log(`Requires rank: ${RANKS[def.rankReq].name}.`); return; }
  if (state.money < def.cost) { log("Not enough money."); return; }
  state.money -= def.cost;
  state.perks[perkId] = true;
  log(`Perk unlocked: ${def.name}!`);
  renderAll();
}

function renderPerks() {
  const wrap = $("perk-list");
  wrap.innerHTML = "";
  const ri = rankIndex();

  for (const def of PERK_DEFS) {
    const owned = !!state.perks[def.id];
    const meetsRank = ri >= def.rankReq;
    const canAfford = state.money >= def.cost;

    const card = document.createElement("div");
    card.className = "perk-card" + (owned ? " owned" : "") + (!meetsRank ? " locked" : "");

    let statusHtml = "";
    if (owned) {
      statusHtml = '<span class="perk-status perk-active">Active</span>';
    } else if (!meetsRank) {
      statusHtml = '<span class="perk-status perk-locked-tag">Locked</span>';
    }

    let reqText = `Requires: ${RANKS[def.rankReq].name}`;
    if (!meetsRank) reqText += " (not yet reached)";

    let buttonHtml = "";
    if (!owned) {
      if (!meetsRank) {
        buttonHtml = `<button disabled>Locked — ${RANKS[def.rankReq].name}</button>`;
      } else {
        buttonHtml = `<button class="btn-buy-perk" data-perk="${def.id}" ${!canAfford ? "disabled" : ""}>Buy ($${def.cost})</button>`;
      }
    }

    card.innerHTML = `
      <div class="perk-name">${def.name} ${statusHtml}</div>
      <div class="perk-desc">${def.desc}</div>
      <div class="perk-req">${reqText} · $${def.cost}</div>
      ${buttonHtml}
    `;
    wrap.appendChild(card);
  }

  wrap.querySelectorAll("[data-perk]").forEach(btn => {
    btn.addEventListener("click", () => buyPerk(btn.getAttribute("data-perk")));
  });
}

// ---------- Assistant actions ----------
$("btn-coffee").addEventListener("click", () => {
  state.stats.caffeine = clamp(state.stats.caffeine + 35, 0, 100);
  state.stats.stress = clamp(state.stats.stress - 2, 0, 100);
  log("Refilled coffee pot. Caffeine up.");
});

$("btn-food").addEventListener("click", () => {
  if (state.money < 15) { log("Not enough money for takeout. ($15)"); return; }
  state.money -= 15;
  state.stats.hunger = clamp(state.stats.hunger + 40, 0, 100);
  state.stats.stress = clamp(state.stats.stress - 3, 0, 100);

  const lines = [
    "Ordered takeout ($15). Chinese again…",
    "Ordered takeout ($15). The delivery guy knows your floor by heart.",
    "Ordered takeout ($15). Ate over the keyboard like a professional.",
    "Ordered takeout ($15). It's technically dinner if it arrives after midnight.",
    "Ordered takeout ($15). The receipt looks like a billing statement."
  ];
  log(randChoice(lines));
});

$("btn-nap").addEventListener("click", () => {
  state.stats.sleep = clamp(state.stats.sleep + 28, 0, 100);
  state.stats.stress = clamp(state.stats.stress - 8, 0, 100);
  log("Power nap. Sleep up, stress down.");
});

$("btn-sin").addEventListener("click", () => {
  if (state.money < 8) { log("Not enough money for a 'Sin' pouch. ($8)"); return; }
  state.money -= 8;
  state._sinUntil = now() + 1000 * 60 * 60 * 6; // 6 hours
  state.stats.stress = clamp(state.stats.stress + 6, 0, 100);
  state.stats.sleep = clamp(state.stats.sleep - 6, 0, 100);
  log("Used a 'Sin' pouch ($8). Productivity up (6h), but sleep/stress take a hit.");
});

$("btn-clear-finished").addEventListener("click", () => clearFinishedTasks());

$("btn-probono").addEventListener("click", () => {
  const a = makeAssignment({ kind: "probono" });
  state.queue.push(a);
  log("Accepted a pro bono matter. No pay, but stress relief on completion.");
});

$("btn-window").addEventListener("click", () => {
  if (Math.random() < 0.05) {
    const badLines = [
      "Looked out the window… remembered that you live in Detroit (stress up).",
      "Looked out the window and wished to be outside (stress up).",
      "Looked out the window and saw hail (stress up)."
    ];
    const up = 6;
    state.stats.stress = clamp(state.stats.stress + up, 0, 100);
    log(randChoice(badLines));
    return;
  }

  const base = state.office.windowClean ? 10 : 6;
  state.stats.stress = clamp(state.stats.stress - base, 0, 100);
  log(state.office.windowClean
    ? "Looked out the clean window. Stress down (buffed)."
    : "Looked out the window. Stress down."
  );
});

$("btn-clean-window").addEventListener("click", () => {
  state.office.windowClean = true;
  state.stats.stress = clamp(state.stats.stress - 2, 0, 100);
  log("Cleaned the window. Future window breaks are stronger.");
});

$("btn-cradle").addEventListener("click", () => {
  let amt = 5;
  if (state.lawyer.outfit.hat) amt += 1;
  state.stats.stress = clamp(state.stats.stress - amt, 0, 100);
  log("Clicked Newton’s cradle. Stress down.");
});

$("btn-plant").addEventListener("click", () => {
  state.office.plantAlive = true;
  state.stats.stress = clamp(state.stats.stress - 4, 0, 100);
  log("Watered the plant. The office feels… slightly less grim.");
});

$("btn-books").addEventListener("click", () => {
  state.office.bookshelfBuffUntil = now() + 1000 * 60 * 60 * 18;
  state.stats.stress = clamp(state.stats.stress - 3, 0, 100);
  log("Organized the bookshelf. Short productivity buff.");
});

$("btn-walkpad").addEventListener("click", () => {
  state.office.walkingPadOn = !state.office.walkingPadOn;
  log(`Walking pad ${state.office.walkingPadOn ? "ON" : "OFF"}.`);
});

$("btn-light").addEventListener("click", () => {
  state.office.bankersLightOn = !state.office.bankersLightOn;
  log(`Banker’s light ${state.office.bankersLightOn ? "ON" : "OFF"}. (No real effect. It’s the vibe.)`);
});

// ---------- Store (API-backed) ----------
let storeCatalog = [];
let storeSource = "loading";

function applyItemEffect(item) {
  const key = item.id;
  // Apply known effects to game state
  if (key === "hat") state.lawyer.outfit.hat = true;
  else if (key === "tie") state.lawyer.outfit.tie = true;
  else if (key === "casual") state.lawyer.outfit.casualFridays = true;
  else if (key === "fridge") state.store.fridge = true;
  else if (key === "coffeeMaker") state.store.coffeeMaker = true;
  else if (key === "desk") state.store.desk = true;
  else if (item.effect && item.effect.target) {
    // Generic effect path for new API-sourced items (e.g. "store.newItem")
    const parts = item.effect.target.split(".");
    let obj = state;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!obj[parts[i]]) obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = item.effect.value;
  }
}

function isItemOwned(item) {
  const key = item.id;
  if (key === "hat") return !!state.lawyer.outfit.hat;
  if (key === "tie") return !!state.lawyer.outfit.tie;
  if (key === "casual") return !!state.lawyer.outfit.casualFridays;
  if (key === "fridge") return !!state.store.fridge;
  if (key === "coffeeMaker") return !!state.store.coffeeMaker;
  if (key === "desk") return !!state.store.desk;
  // Generic check for API items
  if (item.effect && item.effect.target) {
    const parts = item.effect.target.split(".");
    let obj = state;
    for (const p of parts) {
      if (!obj || obj[p] === undefined) return false;
      obj = obj[p];
    }
    return !!obj;
  }
  return false;
}

function buy(itemId) {
  const item = storeCatalog.find(i => i.id === itemId);
  if (!item) return;
  if (isItemOwned(item)) {
    log("Already owned.");
    return;
  }
  if (state.money < item.cost) {
    log("Not enough money.");
    return;
  }
  state.money -= item.cost;
  applyItemEffect(item);
  log(`Purchased: ${item.name}.`);
  storeApi.reportPurchase(item.id, item.cost);
  renderAll();
}

function renderStore() {
  const wrap = $("store-items");
  wrap.innerHTML = "";

  if (storeSource === "loading") {
    wrap.innerHTML = '<div class="store-status">Loading store catalog…</div>';
    return;
  }

  if (storeCatalog.length === 0) {
    wrap.innerHTML = '<div class="store-status">No items available.</div>';
    return;
  }

  for (const item of storeCatalog) {
    const owned = isItemOwned(item);
    const div = document.createElement("div");
    div.className = "store-item" + (owned ? " owned" : "");
    div.innerHTML = `
      <div class="name">${item.name}${owned ? ' <span class="tag tag-done">Owned</span>' : ""}</div>
      <div class="desc">${item.description || ""}</div>
      <button data-buy="${item.id}" ${owned ? "disabled" : ""}>${owned ? "Owned" : `Buy ($${item.cost})`}</button>
    `;
    wrap.appendChild(div);
  }

  if (storeSource === "fallback") {
    const note = document.createElement("div");
    note.className = "store-status store-offline";
    note.textContent = "Store API unreachable — showing built-in catalog.";
    wrap.appendChild(note);
  } else if (storeSource === "api") {
    const note = document.createElement("div");
    note.className = "store-status";
    note.style.color = "#6fff9a";
    note.textContent = "Connected to store API.";
    wrap.appendChild(note);
  }

  wrap.querySelectorAll("[data-buy]").forEach(btn => {
    btn.addEventListener("click", () => buy(btn.getAttribute("data-buy")));
  });
}

async function loadStoreCatalog() {
  storeSource = "loading";
  renderStore();
  const result = await storeApi.fetchCatalog();
  storeCatalog = result.items;
  storeSource = result.source;
  renderStore();
}

function refreshStore() {
  storeApi.invalidateCache();
  loadStoreCatalog();
}

// ---------- API Settings UI ----------
function initSettingsUI() {
  const toggleBtn = $("btn-toggle-settings");
  const panel = $("settings-panel");
  const inputBase = $("input-api-base");
  const inputKey = $("input-api-key");
  const saveBtn = $("btn-save-api");
  const clearBtn = $("btn-clear-api");
  const toggleKeyBtn = $("btn-toggle-key-vis");
  const statusEl = $("api-status");

  // Toggle settings panel visibility
  toggleBtn.addEventListener("click", () => {
    const hidden = panel.style.display === "none";
    panel.style.display = hidden ? "" : "none";
    toggleBtn.textContent = hidden ? "Hide" : "Show";
  });

  // Toggle API key visibility
  toggleKeyBtn.addEventListener("click", () => {
    const isPassword = inputKey.type === "password";
    inputKey.type = isPassword ? "text" : "password";
    toggleKeyBtn.textContent = isPassword ? "Hide" : "Show";
  });

  // Connect: save config to state and store-api, then reload catalog
  saveBtn.addEventListener("click", async () => {
    const apiBase = inputBase.value.trim();
    const apiKey = inputKey.value.trim();

    if (!apiBase) {
      statusEl.textContent = "Please enter an API Base URL.";
      statusEl.className = "api-status error";
      return;
    }

    statusEl.textContent = "Connecting...";
    statusEl.className = "api-status";

    // Save to state (persisted across sessions)
    state.apiConfig = { apiBase, apiKey };
    storeApi.setConfig(state.apiConfig);

    // Try fetching the catalog to verify connection
    const result = await storeApi.fetchCatalog();
    storeCatalog = result.items;
    storeSource = result.source;

    if (result.source === "api") {
      statusEl.textContent = "Connected to store API.";
      statusEl.className = "api-status connected";
      log("Store API connected: " + apiBase);
    } else if (result.source === "fallback") {
      statusEl.textContent = "API unreachable: " + (result.error || "connection failed") + ". Using built-in catalog.";
      statusEl.className = "api-status error";
      log("Store API connection failed: " + (result.error || "unreachable"));
    }

    renderStore();
  });

  // Disconnect: clear config
  clearBtn.addEventListener("click", () => {
    state.apiConfig = null;
    storeApi.setConfig(null);
    inputBase.value = "";
    inputKey.value = "";
    statusEl.textContent = "Disconnected. Using built-in catalog.";
    statusEl.className = "api-status disconnected";
    log("Store API disconnected.");
    loadStoreCatalog();
  });

  // Restore saved config into UI fields and store-api
  if (state.apiConfig && state.apiConfig.apiBase) {
    inputBase.value = state.apiConfig.apiBase;
    inputKey.value = state.apiConfig.apiKey || "";
    storeApi.setConfig(state.apiConfig);
    statusEl.textContent = "API configured. Hit Refresh to reconnect.";
    statusEl.className = "api-status";
  }
}

// ---------- Bitcoin ----------
let btcPrice = 0;
let btcPriceUpdatedAt = 0;
let btcFetchError = null;

async function fetchBtcPrice() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
      { signal: controller.signal }
    );
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    btcPrice = data.bitcoin.usd;
    btcPriceUpdatedAt = now();
    btcFetchError = null;
    state.bitcoin.lastPrice = btcPrice;
  } catch (e) {
    btcFetchError = e.message;
    if (state.bitcoin.lastPrice > 0 && btcPrice === 0) {
      btcPrice = state.bitcoin.lastPrice;
    }
  } finally {
    clearTimeout(timeout);
  }
}

function buyBtc(dollars) {
  if (btcPrice <= 0) { log("Bitcoin price unavailable. Try again later."); return; }
  if (state.money < dollars) { log("Not enough money."); return; }
  state.money -= dollars;
  const amount = dollars / btcPrice;
  state.bitcoin.holdings += amount;
  state.bitcoin.totalInvested += dollars;
  log(`Bought $${dollars} of BTC at $${btcPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}/BTC.`);
  renderAll();
}

function sellBtc(fraction) {
  if (btcPrice <= 0) { log("Bitcoin price unavailable. Try again later."); return; }
  if (state.bitcoin.holdings <= 0) { log("No Bitcoin to sell."); return; }
  const sellAmount = state.bitcoin.holdings * fraction;
  const dollars = Math.floor(sellAmount * btcPrice);
  const investedPortion = state.bitcoin.totalInvested * fraction;
  state.bitcoin.holdings -= sellAmount;
  state.bitcoin.totalInvested -= investedPortion;
  if (fraction >= 1) { state.bitcoin.holdings = 0; state.bitcoin.totalInvested = 0; }
  state.money += dollars;
  const pnl = dollars - Math.round(investedPortion);
  const pnlStr = pnl >= 0 ? `+$${pnl}` : `-$${Math.abs(pnl)}`;
  log(`Sold Bitcoin for $${dollars} (${pnlStr} P&L).`);
  renderAll();
}

function tickBitcoin(dtHours) {
  if (state.bitcoin.holdings <= 0 || btcPrice <= 0) return;

  // Initialize stress check price on first tick with holdings
  if (state.bitcoin.stressCheckPrice <= 0) {
    state.bitcoin.stressCheckPrice = btcPrice;
    state.bitcoin.lastStressCheckAt = now();
    return;
  }

  // Only check stress effects once per hour
  if (now() - state.bitcoin.lastStressCheckAt < 1000 * 60 * 60) return;

  const change = (btcPrice - state.bitcoin.stressCheckPrice) / state.bitcoin.stressCheckPrice;
  state.bitcoin.stressCheckPrice = btcPrice;
  state.bitcoin.lastStressCheckAt = now();

  // Scale stress effect with portfolio size (bigger position = bigger swings)
  const portfolioValue = state.bitcoin.holdings * btcPrice;
  const stressScale = clamp(portfolioValue / 1000, 0.5, 4);

  if (change < -0.02) {
    const stressUp = Math.abs(change) * 15 * stressScale;
    state.stats.stress = clamp(state.stats.stress + stressUp, 0, 100);
    log(`Bitcoin dropped ${Math.abs(Math.round(change * 100))}%. Portfolio stress rising.`);
  } else if (change > 0.03) {
    const stressDown = change * 8 * stressScale;
    state.stats.stress = clamp(state.stats.stress - stressDown, 0, 100);
    log(`Bitcoin up ${Math.round(change * 100)}%. Feeling bullish.`);
  }
}

// ---------- Assignments ----------
function randChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); }

function makeAssignment(opts = {}) {
  const kinds = ["lit", "corp", "reg"];
  const kind = opts.kind || randChoice(kinds);

  let billableHours = randInt(2, 12);
  let points = billableHours * randInt(18, 28);
  let stress = billableHours * 0.8;

  if (kind === "probono") {
    billableHours = randInt(2, 6);
    points = 0;
    stress = -6;
  }

  if (Math.random() < 0.18 && kind !== "probono") {
    billableHours += randInt(6, 12);
    points += randInt(200, 400);
    stress += randInt(6, 14);
  }

  const deadlineHours = kind === "probono" ? randInt(36, 120) : randInt(24, 168);
  const deadlineAt = now() + deadlineHours * 60 * 60 * 1000;

  const names = {
    lit: ["Draft motion to dismiss", "Depo outline prep", "Emergency TRO packet", "Cite-check brief"],
    corp: ["Revise SPA redlines", "Due diligence sweep", "Board memo draft", "Closing checklist"],
    reg: ["Agency comment letter", "Compliance audit memo", "FOIA response review", "Investigatory CID response"],
    probono: ["Tenant hotline advice", "Expungement clinic prep", "Asylum intake interview", "Name change petition"]
  };

  return {
    id: Math.random().toString(36).slice(2),
    kind,
    title: randChoice(names[kind]),
    billableHours,
    billablesEarned: 0,
    points,
    stressImpact: stress,
    deadlineAt,
    acceptedAt: now(),
    progress: 0
  };
}

function seedOffers(force = false) {
  if (!force && state.offers.length > 0) return;
  state.offers = [makeAssignment(), makeAssignment(), makeAssignment()];
}

function refreshOffers() {
  state.offers = [makeAssignment(), makeAssignment(), makeAssignment()];
  state.nextOfferRefreshAt = now() + 1000 * 60 * 60 * randInt(6, 10);
  log("New assignment offers posted.");
}

function acceptOffer(id) {
  const idx = state.offers.findIndex(o => o.id === id);
  if (idx === -1) return;
  const a = state.offers[idx];
  state.offers.splice(idx, 1);
  state.queue.push(a);
  state.stats.stress = clamp(state.stats.stress + 2, 0, 100);
  log(`Accepted: ${a.title} (${a.billableHours}h).`);
}

function clearTask(id) {
  const idx = state.queue.findIndex(a => a.id === id);
  if (idx === -1) return;
  const a = state.queue[idx];
  if (!a._completed && !a._missed) return;
  state.queue.splice(idx, 1);
  log(`Cleared from queue: ${a.title}.`);
  renderQueue();
}

function clearFinishedTasks() {
  const before = state.queue.length;
  state.queue = state.queue.filter(a => !a._completed && !a._missed);
  const cleared = before - state.queue.length;
  if (cleared > 0) {
    log(`Cleared ${cleared} finished task${cleared > 1 ? "s" : ""} from queue.`);
  } else {
    log("No finished tasks to clear.");
  }
  renderQueue();
}

// ---------- Events ----------

// Helper: track a work-over-family choice
function choseWork() {
  state.workChoices += 1;
  state.familyChoices = 0;
  checkWorkSpiral();
}

// Helper: track a family-over-work choice
function choseFamily() {
  state.familyChoices += 1;
  state.workChoices = 0;
  // Choosing family during burnout speeds recovery (shave 12 hours off)
  if (state.burnout && state.burnoutUntil > now()) {
    state.burnoutUntil -= 1000 * 60 * 60 * 12;
    log("Choosing family helped. The burnout feels a little lighter.");
  }
  checkFamilySpiral();
}

function checkWorkSpiral() {
  // Divorce at 5 consecutive work choices
  if (state.workChoices >= 5 && !state.divorced) {
    state.divorced = true;
    state.stats.stress = clamp(state.stats.stress + 25, 0, 100);
    log("Your spouse filed for divorce. The papers arrived between two billing statements.");
    log("Stress permanently elevated. Was it worth it?");
  }

  // Burnout at 8 consecutive work choices (or 4 after divorce)
  const burnoutThreshold = state.divorced ? 4 : 8;
  if (state.workChoices >= burnoutThreshold && !state.burnout) {
    state.burnout = true;
    state.burnoutUntil = now() + 1000 * 60 * 60 * randInt(48, 96); // 2-4 days
    state.stats.stress = clamp(state.stats.stress + 20, 0, 100);
    state.stats.sleep = clamp(state.stats.sleep - 20, 0, 100);
    log("BURNOUT. You can't focus. You can't sleep. Productivity is tanked until you recover.");
    log("(Burnout lasts 2-4 days. Choosing family in events will speed recovery.)");
  }
}

function checkFamilySpiral() {
  // PIP strike at 4 consecutive family choices
  if (state.familyChoices >= 4) {
    state.pipStrikes += 1;
    state.familyChoices = 0; // Reset so they can accumulate again
    log("HR called. Your 'work-life balance' has been noticed. PIP strike issued.");
    log("The firm doesn't care about your daughter's recital.");
  }
}

function triggerRandomEvent() {
  // Events tagged: "work_family" events track the spiral. "neutral" events don't.
  const events = [
    // --- Work vs Family events ---
    {
      type: "work_family",
      name: "Partner email: 'Need this tonight.'",
      a: { label: "Pull all-nighter ($120)", effect: () => {
        state.stats.stress = clamp(state.stats.stress + 10, 0, 100);
        state.stats.sleep = clamp(state.stats.sleep - 10, 0, 100);
        state.money += 120;
        log("You chose the all-nighter. +$120, stress/sleep down.");
        choseWork();
      }},
      b: { label: "Negotiate deadline (safer)", effect: () => {
        state.stats.stress = clamp(state.stats.stress - 6, 0, 100);
        if (Math.random() < 0.25) {
          state.reputation.lit = clamp(state.reputation.lit - 5, 0, 9999);
          log("Deadline negotiation worked… but someone noticed. Small rep hit.");
        } else {
          log("Deadline negotiation worked. Stress down.");
        }
        choseFamily();
      }}
    },
    {
      type: "work_family",
      name: "Family conflict: date night vs urgent filing",
      a: { label: "Skip date, file tonight ($90)", effect: () => {
        state.stats.stress = clamp(state.stats.stress + 8, 0, 100);
        state.money += 90;
        log("Career choice: +$90, more stress.");
        choseWork();
      }},
      b: { label: "Go on the date (stress down)", effect: () => {
        state.stats.stress = clamp(state.stats.stress - 10, 0, 100);
        log("Family choice: stress down, no pay.");
        choseFamily();
      }}
    },
    {
      type: "work_family",
      name: "Child sick at childcare: pick up vs push through",
      a: { label: "Push through ($110)", effect: () => {
        state.stats.stress = clamp(state.stats.stress + 10, 0, 100);
        state.money += 110;
        log("Pushed through. +$110, stress up.");
        choseWork();
      }},
      b: { label: "Pick up child (stress down)", effect: () => {
        state.stats.stress = clamp(state.stats.stress - 8, 0, 100);
        state.stats.sleep = clamp(state.stats.sleep + 4, 0, 100);
        log("Picked up child. Stress down; a rare human moment.");
        choseFamily();
      }}
    },
    {
      type: "work_family",
      name: "Your daughter's dance recital is tonight. There's also a client dinner.",
      a: { label: "Skip the recital, attend the dinner ($100 + rep)", effect: () => {
        state.stats.stress = clamp(state.stats.stress + 6, 0, 100);
        state.money += 100;
        state.reputation.corp += 5;
        log("You went to the dinner. +$100, +rep. Your daughter wasn't impressed.");
        choseWork();
      }},
      b: { label: "Go to the recital (stress down)", effect: () => {
        state.stats.stress = clamp(state.stats.stress - 12, 0, 100);
        log("You watched her dance. She saw you in the audience and smiled. Stress way down.");
        choseFamily();
      }}
    },
    {
      type: "work_family",
      name: "Your son's baseball game is Saturday. A partner wants you in the office.",
      a: { label: "Work Saturday ($95)", effect: () => {
        state.stats.stress = clamp(state.stats.stress + 8, 0, 100);
        state.stats.sleep = clamp(state.stats.sleep - 4, 0, 100);
        state.money += 95;
        log("Another Saturday at the office. +$95. Your son hit a home run. You heard about it later.");
        choseWork();
      }},
      b: { label: "Go to the game (stress down)", effect: () => {
        state.stats.stress = clamp(state.stats.stress - 10, 0, 100);
        state.stats.sleep = clamp(state.stats.sleep + 2, 0, 100);
        log("You saw the home run. He ran to you after. Sometimes the small things aren't small.");
        choseFamily();
      }}
    },
    {
      type: "work_family",
      name: "Anniversary dinner tonight. But a deal is closing and the partner 'needs bodies.'",
      a: { label: "Stay for the close ($140 + rep)", effect: () => {
        state.stats.stress = clamp(state.stats.stress + 12, 0, 100);
        state.money += 140;
        state.reputation.corp += 4;
        log("The deal closed at 2 AM. +$140, +rep. Your spouse ate alone. Again.");
        choseWork();
      }},
      b: { label: "Go to dinner (stress down, risk rep)", effect: () => {
        state.stats.stress = clamp(state.stats.stress - 14, 0, 100);
        if (Math.random() < 0.3) {
          state.reputation.corp = clamp(state.reputation.corp - 4, 0, 9999);
          log("You went to dinner. The partner noticed your absence. Small rep hit — but your spouse was happy.");
        } else {
          log("Dinner was wonderful. Nobody at the firm noticed. A rare win.");
        }
        choseFamily();
      }}
    },
    {
      type: "work_family",
      name: "Parent-teacher conference conflicts with a deposition prep session.",
      a: { label: "Skip the conference ($80)", effect: () => {
        state.stats.stress = clamp(state.stats.stress + 6, 0, 100);
        state.money += 80;
        log("Depo prep went well. +$80. The teacher sent a note home. You didn't read it.");
        choseWork();
      }},
      b: { label: "Attend the conference (stress down)", effect: () => {
        state.stats.stress = clamp(state.stats.stress - 8, 0, 100);
        log("The teacher said your kid is doing great. You felt something unfamiliar: pride that isn't billable.");
        choseFamily();
      }}
    },
    {
      type: "work_family",
      name: "Your best friend is in town for one night. There's a brief due tomorrow.",
      a: { label: "Finish the brief ($85)", effect: () => {
        state.stats.stress = clamp(state.stats.stress + 7, 0, 100);
        state.money += 85;
        log("Brief filed on time. +$85. Your friend texted 'maybe next time.' That was six months ago.");
        choseWork();
      }},
      b: { label: "Go see your friend (stress down)", effect: () => {
        state.stats.stress = clamp(state.stats.stress - 10, 0, 100);
        state.stats.sleep = clamp(state.stats.sleep - 3, 0, 100);
        log("You stayed out too late laughing. Sleep is down, but you feel human.");
        choseFamily();
      }}
    },
    {
      type: "work_family",
      name: "Thanksgiving. The family expects you home. The partner expects a draft by Friday.",
      a: { label: "Work through the holiday ($150)", effect: () => {
        state.stats.stress = clamp(state.stats.stress + 14, 0, 100);
        state.stats.sleep = clamp(state.stats.sleep - 6, 0, 100);
        state.money += 150;
        log("You billed on Thanksgiving. +$150. The office was empty except for you and the cleaning crew.");
        choseWork();
      }},
      b: { label: "Go home for Thanksgiving (stress way down)", effect: () => {
        state.stats.stress = clamp(state.stats.stress - 18, 0, 100);
        state.stats.hunger = clamp(state.stats.hunger + 20, 0, 100);
        state.stats.sleep = clamp(state.stats.sleep + 6, 0, 100);
        log("Mom's cooking. The couch. Football on TV. For one day, you forgot about billables.");
        choseFamily();
      }}
    },
    // --- Neutral events (no spiral tracking) ---
    {
      type: "neutral",
      name: "Water-cooler chat with senior partner",
      a: { label: "Be charming (rep boost)", effect: () => {
        const boost = 10 + (state.lawyer.outfit.tie ? 2 : 0);
        state.reputation.corp = clamp(state.reputation.corp + boost, 0, 9999);
        log("Nailed the chat. Reputation up.");
      }},
      b: { label: "Avoid eye contact (no risk)", effect: () => {
        state.stats.stress = clamp(state.stats.stress - 2, 0, 100);
        log("Avoided engagement. A small peace was preserved.");
      }}
    }
  ];

  // Weight toward work_family events (80%) to make the spiral meaningful
  const workFamilyEvents = events.filter(e => e.type === "work_family");
  const neutralEvents = events.filter(e => e.type === "neutral");
  const pool = Math.random() < 0.8 ? workFamilyEvents : neutralEvents;
  const ev = randChoice(pool.length > 0 ? pool : events);

  const pickA = confirm(`${ev.name}\n\nOK = ${ev.a.label}\nCancel = ${ev.b.label}`);
  if (pickA) ev.a.effect();
  else ev.b.effect();

  state.nextEventAt = now() + 1000 * 60 * 60 * randInt(10, 20);
}

// ---------- Arc helpers ----------

function rankIndex() {
  const repTotal = state.reputation.lit + state.reputation.corp + state.reputation.reg;
  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) {
    if (state.billables >= RANKS[i].billables && repTotal >= RANKS[i].rep) idx = i;
  }
  return idx;
}

// --- Midlevel: Junior Management ---

const JUNIOR_NAMES = [
  "Alex Chen", "Jordan Miles", "Priya Patel", "Sam Okafor",
  "Taylor Webb", "Morgan Reyes", "Casey Kim", "Drew Novak",
  "Riley Foster", "Quinn Barrett", "Jamie Liu", "Avery Stone"
];

function spawnJunior() {
  const kinds = ["lit", "corp", "reg"];
  const kind = randChoice(kinds);
  const billableHours = randInt(2, 8);
  const points = billableHours * randInt(12, 20);
  const deadlineHours = randInt(24, 120);
  const names = {
    lit: ["Draft discovery requests", "Research case law", "Prepare witness outline", "Index exhibits"],
    corp: ["Organize data room", "Draft ancillary docs", "Review disclosure schedules", "Compile signature pages"],
    reg: ["Pull agency filings", "Summarize comment letters", "Update compliance tracker", "Draft FOIA request"]
  };

  return {
    id: Math.random().toString(36).slice(2),
    name: randChoice(JUNIOR_NAMES.filter(n => !state.juniors.some(j => j.name === n))) || randChoice(JUNIOR_NAMES),
    task: randChoice(names[kind]),
    kind,
    billableHours,
    billablesEarned: 0,
    points,
    deadlineAt: now() + deadlineHours * 60 * 60 * 1000,
    assignedAt: now(),
    progress: 0,
    completed: false,
    missed: false,
    assigned: false  // Player hasn't delegated work yet
  };
}

function assignJunior(juniorId) {
  const j = state.juniors.find(x => x.id === juniorId);
  if (!j || j.assigned) return;
  j.assigned = true;
  j.assignedAt = now();
  log(`Delegated "${j.task}" to ${j.name}. They're on it.`);
}

function dismissJunior(juniorId) {
  const idx = state.juniors.findIndex(x => x.id === juniorId);
  if (idx === -1) return;
  const j = state.juniors[idx];
  if (!j.completed && !j.missed) return;
  state.juniors.splice(idx, 1);
}

function tickJuniors(dtHours) {
  if (rankIndex() < 1) return; // Only midlevel+

  // Spawn juniors periodically (max 3 at a time)
  const unfinished = state.juniors.filter(j => !j.completed && !j.missed).length;
  if (now() >= state.nextJuniorSpawnAt && unfinished < 3) {
    state.juniors.push(spawnJunior());
    state.nextJuniorSpawnAt = now() + 1000 * 60 * 60 * randInt(8, 18);
    log("A junior associate is waiting for your direction.");
  }
  if (state.nextJuniorSpawnAt === 0) {
    state.nextJuniorSpawnAt = now() + 1000 * 60 * 60 * randInt(2, 6);
  }

  for (const j of state.juniors) {
    if (j.completed || j.missed || !j.assigned) continue;

    // Juniors work at ~60-80% speed with some randomness
    const juniorSpeed = 0.6 + Math.random() * 0.2;
    const workDone = juniorSpeed * dtHours;
    const remaining = j.billableHours - j.billablesEarned;
    const toAdd = Math.min(remaining, workDone);
    j.billablesEarned += toAdd;
    j.progress = clamp(j.billablesEarned / j.billableHours, 0, 1);

    if (now() > j.deadlineAt && j.progress < 1 && !j.missed) {
      j.missed = true;
      // No PIP for the player - just a lost opportunity
      log(`${j.name} missed the deadline on "${j.task}." No bonus this time.`);
    }

    if (j.progress >= 1 && !j.completed) {
      j.completed = true;
      const bonus = Math.round(j.points * state.breakaway.multiplier);
      state.money += bonus;
      state.billables += j.billableHours * 0.3; // Partial billable credit for delegation
      log(`${j.name} completed "${j.task}." Delegation bonus: +$${bonus}.`);
    }
  }

  // Auto-clear old finished juniors after 2 hours
  state.juniors = state.juniors.filter(j =>
    !(j.completed && now() - j.deadlineAt > 1000 * 60 * 60 * 2) &&
    !(j.missed && now() - j.deadlineAt > 1000 * 60 * 60 * 2)
  );
}

// --- Senior: Rival Tug-of-War ---

const RIVAL_NAMES = [
  "Sloane Hargrove", "Blaine Whitfield", "Preston Kincaid",
  "Harper Ellington", "Sterling Cross", "Whitney Aldridge"
];

const RIVAL_TRASH_TALK = [
  "just landed a Fortune 500 client. You?",
  "billed 14 hours yesterday. While golfing.",
  "was just seen leaving the managing partner's office… smiling.",
  "got another 'attaboy' email from the exec committee.",
  "is telling everyone they'll make partner first.",
  "booked the big conference room for a 'victory lunch.'",
  "left a copy of their billables report on your chair. Accidentally, of course.",
  "just asked if you need help 'keeping up.'"
];

function initRival() {
  if (state.rival.active) return;
  state.rival.active = true;
  state.rival.name = randChoice(RIVAL_NAMES);
  state.rival.score = 0;
  state.rival.playerScore = 0;
  state.rival.momentum = 0;
  state.rival.lastTrashTalkAt = now();
  log(`You've been paired against ${state.rival.name} in the race to Counsel. May the best biller win.`);
}

function tickRival(dtHours) {
  if (rankIndex() < 2) { // Not senior yet
    state.rival.active = false;
    return;
  }
  if (rankIndex() > 2) { // Past senior
    state.rival.active = false;
    return;
  }
  if (!state.rival.active) initRival();

  // Rival accumulates score at a variable rate (semi-random, competitive)
  const rivalProd = 0.5 + Math.random() * 0.6; // 50-110% effective
  const rivalBillables = rivalProd * dtHours;
  const rivalPoints = rivalBillables * randInt(18, 26);
  state.rival.score += rivalPoints;

  // Player score tracks points earned this tick cycle (accumulated from main tick)
  // We use a simpler measure: billables * productivity as proxy
  const prod = productivityMultiplier();
  const playerWork = prod * dtHours;
  const playerPoints = playerWork * randInt(20, 28);
  state.rival.playerScore += playerPoints;

  // Momentum: difference normalized to -100..100
  const total = state.rival.playerScore + state.rival.score;
  if (total > 0) {
    const raw = ((state.rival.playerScore - state.rival.score) / total) * 100;
    state.rival.momentum = clamp(raw, -100, 100);
  }

  // Rival trash talk every 12-24 hours
  if (now() - state.rival.lastTrashTalkAt > 1000 * 60 * 60 * randInt(12, 24)) {
    state.rival.lastTrashTalkAt = now();
    log(`${state.rival.name} ${randChoice(RIVAL_TRASH_TALK)}`);
  }

  // Momentum affects stress slightly
  if (state.rival.momentum < -30) {
    state.stats.stress = clamp(state.stats.stress + 0.1 * dtHours, 0, 100);
  } else if (state.rival.momentum > 30) {
    state.stats.stress = clamp(state.stats.stress - 0.05 * dtHours, 0, 100);
  }
}

// --- Partner: Breakaway / Prestige ---

function calculateBreakawayMultiplier() {
  // Each breakaway gives a compounding bonus based on lifetime earnings
  // Formula: 1 + 0.15 * count + log2(1 + lifetimeEarnings / 5000) * 0.1
  const count = state.breakaway.count;
  const earnings = state.breakaway.lifetimeEarnings;
  return 1 + (0.15 * count) + (Math.log2(1 + earnings / 5000) * 0.1);
}

function canBreakaway() {
  return rankIndex() >= 4; // Must be Partner
}

function executeBreakaway() {
  if (!canBreakaway()) return;

  const oldMultiplier = state.breakaway.multiplier;
  const oldCount = state.breakaway.count;
  const btcValue = Math.floor((state.bitcoin ? state.bitcoin.holdings : 0) * btcPrice);
  const totalEarnings = state.breakaway.lifetimeEarnings + state.money + btcValue;

  // Preserve breakaway data
  const breakawayData = {
    count: oldCount + 1,
    lifetimeEarnings: totalEarnings,
    multiplier: 1 // recalculated below
  };

  // Reset to fresh state
  const fresh = defaultState();
  fresh.breakaway = breakawayData;
  fresh.breakaway.multiplier = calculateBreakawayMultiplier.call(null);
  // Recalculate with the updated breakaway state
  fresh.breakaway.multiplier = 1 + (0.15 * fresh.breakaway.count) + (Math.log2(1 + fresh.breakaway.lifetimeEarnings / 5000) * 0.1);

  state = fresh;
  seedOffers(true);

  log(`BREAKAWAY #${state.breakaway.count}! You've left the firm to start your own practice.`);
  log(`Everything resets, but your experience gives you a ${Math.round((state.breakaway.multiplier - 1) * 100)}% permanent bonus.`);
  log("Back to Junior Associate — but this time, you know the game.");

  renderAll();
}

// --- NPCs ---

function isSummerSeason() {
  const m = new Date().getMonth(); // 0-indexed: 5=Jun, 6=Jul
  return m === 5 || m === 6;
}

// Summer associate archetypes (June-July only)
const SUMMER_ASSOCIATES = [
  // Frat-boy types
  {
    name: "Chad Buckley",
    persona: "fratbro",
    desc: "Summer associate. Polo collar popped. Talks about 'his boys' constantly.",
    interactions: [
      { label: "Grab beers after work", effect: { stress: -6, caffeine: -4 }, msg: "Chad insisted on a rooftop bar. You had fun, somehow." },
      { label: "Ignore him", effect: { stress: -1 }, msg: "Chad finger-gunned at you on his way out. You pretended not to see." }
    ]
  },
  {
    name: "Tanner Whitmore",
    persona: "fratbro",
    desc: "Summer associate. Already networking for a corner office. Wears boat shoes indoors.",
    interactions: [
      { label: "Let him buy lunch", effect: { hunger: 20, stress: -3 }, msg: "Tanner put it on his dad's card. The sushi was excellent." },
      { label: "Decline politely", effect: { stress: -1 }, msg: "Tanner shrugged. 'Your loss, bro.'" }
    ]
  },
  // Nerd types
  {
    name: "Priya Subramaniam",
    persona: "nerd",
    desc: "Summer associate. Law review. Cites cases from memory. Terrifyingly competent.",
    interactions: [
      { label: "Ask for research help", effect: { points: 40, stress: -4 }, msg: "Priya found a case on point in eleven minutes. You pretended you knew about it." },
      { label: "Nod and move on", effect: { stress: -1 }, msg: "Priya went back to her color-coded outlines." }
    ]
  },
  {
    name: "Eugene Park",
    persona: "nerd",
    desc: "Summer associate. Built a billable-hours tracker in Excel with macros. Has strong opinions about fonts.",
    interactions: [
      { label: "Ask about his spreadsheet", effect: { points: 25, stress: -2 }, msg: "Eugene showed you a pivot table that genuinely improved your workflow." },
      { label: "Avoid the conversation", effect: { stress: -1 }, msg: "Eugene adjusted his glasses and went back to optimizing cell references." }
    ]
  },
  // Normal types
  {
    name: "Maria Santos",
    persona: "normal",
    desc: "Summer associate. Friendly, sharp, keeps her head down. Everyone likes her.",
    interactions: [
      { label: "Grab coffee together", effect: { caffeine: 15, stress: -5 }, msg: "Maria asked good questions about the firm. It was nice to talk to a normal person." },
      { label: "Wave hello", effect: { stress: -1 }, msg: "Maria smiled and went back to her memo." }
    ]
  },
  {
    name: "James Okonkwo",
    persona: "normal",
    desc: "Summer associate. Former public defender intern. Genuinely wants to help people.",
    interactions: [
      { label: "Talk about pro bono work", effect: { stress: -8, repReg: 3 }, msg: "James lit up when you mentioned the clinic. You remembered why you went to law school." },
      { label: "Just say hi", effect: { stress: -1 }, msg: "James nodded warmly and headed to the library." }
    ]
  },
  // Weirdos
  {
    name: "Kessler Vane",
    persona: "weirdo",
    desc: "Summer associate. Eats lunch at exactly 11:11 AM every day. Has never been seen blinking.",
    interactions: [
      { label: "Ask about the 11:11 thing", effect: { stress: 5 }, msg: "Kessler stared at you for eight seconds, then said: 'Alignment.' You didn't ask again." },
      { label: "Keep your distance", effect: { stress: -2 }, msg: "Probably wise." }
    ]
  },
  {
    name: "Daphne Creel",
    persona: "weirdo",
    desc: "Summer associate. Left teeth marks on a shared stapler. Claims it 'wasn't her.'",
    interactions: [
      { label: "Offer her your stapler", effect: { stress: 4 }, msg: "She accepted without breaking eye contact. Your stapler came back… damp." },
      { label: "Lock your supplies", effect: { stress: -2 }, msg: "You started locking your desk drawer. The bite marks stopped." }
    ]
  },
  {
    name: "Morton Filch",
    persona: "weirdo",
    desc: "Summer associate. Wears the same brown cardigan daily. Hums in the elevator. Smells faintly of cedar.",
    interactions: [
      { label: "Compliment the cardigan", effect: { stress: -3 }, msg: "Morton beamed. 'It was my grandfather's. And his grandfather's.' The math didn't add up, but he seemed happy." },
      { label: "Take the stairs", effect: { stress: -1, sleep: -2 }, msg: "14 flights. Your knees hurt but at least there was no humming." }
    ]
  },
  {
    name: "Yuki Tannenbaum",
    persona: "weirdo",
    desc: "Summer associate. Keeps a terrarium on her desk with something alive in it. Nobody's sure what.",
    interactions: [
      { label: "Peek at the terrarium", effect: { stress: 6 }, msg: "It moved. You made eye contact with it. You wish you hadn't." },
      { label: "Don't look", effect: { stress: -1 }, msg: "Some things are better left unknown." }
    ]
  }
];

// Year-round office NPCs (Sept–May)
const OFFICE_NPCS = [
  // Associates
  {
    name: "Rachel Whitfield",
    persona: "associate",
    desc: "Third-year associate. Looks exhausted. Has three monitors and a neck pillow at her desk.",
    interactions: [
      { label: "Commiserate about hours", effect: { stress: -5 }, msg: "You both stared at the ceiling and sighed in unison. It was oddly therapeutic." },
      { label: "Nod in passing", effect: { stress: -1 }, msg: "The universal associate greeting: dead eyes, slight head tilt." }
    ]
  },
  {
    name: "Derek Liu",
    persona: "associate",
    desc: "Fifth-year. Hasn't taken a vacation in two years. Somehow still chipper.",
    interactions: [
      { label: "Ask his secret", effect: { caffeine: 10, stress: -3 }, msg: "'Cold brew and denial,' he said with a grin that didn't quite reach his eyes." },
      { label: "Keep walking", effect: { stress: -1 }, msg: "Derek waved. His smile lingered a beat too long." }
    ]
  },
  {
    name: "Amara Osei",
    persona: "associate",
    desc: "Seventh-year. On the cusp of senior. Runs on spite and green tea.",
    interactions: [
      { label: "Ask for career advice", effect: { stress: -4, repLit: 3 }, msg: "'Bill hard, don't complain, and never eat fish in the microwave.' Solid advice." },
      { label: "Let her work", effect: { stress: -1 }, msg: "Amara didn't look up. Respect." }
    ]
  },
  // Partners
  {
    name: "Richard Halloway III",
    persona: "partner",
    desc: "Equity partner. Corner office. Has a putting green nobody's ever seen him use.",
    interactions: [
      { label: "Make small talk", effect: { repCorp: 5, stress: 3 }, msg: "He talked about golf for twelve minutes. You smiled the entire time. Your face hurts." },
      { label: "Avoid eye contact", effect: { stress: -2 }, msg: "You ducked into the copy room. Safe." }
    ]
  },
  {
    name: "Barbara Kline",
    persona: "partner",
    desc: "Managing partner. Sends emails at 4 AM. Nobody knows when she sleeps.",
    interactions: [
      { label: "Reply to her 4 AM email immediately", effect: { points: 50, sleep: -6, stress: 4 }, msg: "She replied in 90 seconds. You're in too deep now." },
      { label: "Pretend you didn't see it", effect: { stress: -1 }, msg: "She didn't mention it. For now." }
    ]
  },
  // Secretaries / Staff
  {
    name: "Linda from Reception",
    persona: "staff",
    desc: "Has been here longer than the managing partner. Knows everyone's secrets.",
    interactions: [
      { label: "Chat with Linda", effect: { stress: -7 }, msg: "Linda told you which partner is on thin ice. You didn't ask, but you now know." },
      { label: "Just wave", effect: { stress: -1 }, msg: "Linda waved back. She remembers your birthday. You don't remember hers." }
    ]
  },
  {
    name: "Denise Kowalski",
    persona: "staff",
    desc: "Legal secretary. Formats documents faster than you can read them. Do NOT touch her label maker.",
    interactions: [
      { label: "Ask her to fix your formatting", effect: { points: 30, stress: -3 }, msg: "Done in four minutes. She didn't even look at the screen. Witchcraft." },
      { label: "Try to fix it yourself", effect: { stress: 3 }, msg: "You spent 40 minutes fighting Word. Denise sighed audibly from across the hall." }
    ]
  },
  {
    name: "Gerald the Mailroom Guy",
    persona: "staff",
    desc: "Delivers interoffice mail. Has worked here 30 years. Calls everyone 'chief.'",
    interactions: [
      { label: "Shoot the breeze with Gerald", effect: { stress: -6 }, msg: "'Hang in there, chief.' Gerald patted your shoulder. You almost cried." },
      { label: "Take your mail and go", effect: { stress: -1 }, msg: "'See you tomorrow, chief.' Gerald's the most consistent person in your life." }
    ]
  },
  // Delivery person (tied to ordering food)
  {
    name: "Marcus (DoorDash)",
    persona: "delivery",
    desc: "Your regular delivery driver. Knows the building code, your floor, and your usual order.",
    interactions: [
      { label: "Chat for a minute", effect: { hunger: 15, stress: -5 }, msg: "Marcus asked how you were. He meant it. That hit different at 10 PM." },
      { label: "Grab the bag and go", effect: { hunger: 15, stress: -1 }, msg: "Marcus shouted 'have a good night!' as the elevator closed. You didn't." }
    ]
  },
  {
    name: "Soo-Yun (Uber Eats)",
    persona: "delivery",
    desc: "Delivers your late-night sushi. Always texts 'enjoy!' with a smiley face.",
    interactions: [
      { label: "Tip extra and say thanks", effect: { hunger: 15, stress: -4, points: -5 }, msg: "Soo-Yun grinned. 'You're my favorite customer on this floor.' Small kindnesses." },
      { label: "Quick handoff", effect: { hunger: 15, stress: -1 }, msg: "Efficient. Professional. Two ships passing at 11 PM." }
    ]
  }
];

function spawnNpc() {
  const pool = isSummerSeason() ? SUMMER_ASSOCIATES : OFFICE_NPCS;

  // Filter out NPCs already present
  const activeNames = state.npcs.map(n => n.name);
  const available = pool.filter(n => !activeNames.includes(n.name));
  if (available.length === 0) return null;

  const template = randChoice(available);
  // Pick one interaction pair for this visit
  const interaction = randChoice(template.interactions);

  return {
    id: Math.random().toString(36).slice(2),
    name: template.name,
    persona: template.persona,
    desc: template.desc,
    optA: { label: interaction.label, effect: interaction.effect, msg: interaction.msg },
    optB: { label: template.interactions.find(i => i !== interaction)?.label || "Ignore", effect: template.interactions.find(i => i !== interaction)?.effect || { stress: -1 }, msg: template.interactions.find(i => i !== interaction)?.msg || "You went about your day." },
    arrivedAt: now(),
    expiresAt: now() + 1000 * 60 * 60 * randInt(6, 24), // Leaves after 6-24 hours
    interacted: false
  };
}

function interactNpc(npcId, choice) {
  const npc = state.npcs.find(n => n.id === npcId);
  if (!npc || npc.interacted) return;
  npc.interacted = true;

  const opt = choice === "a" ? npc.optA : npc.optB;
  const eff = opt.effect;

  if (eff.stress) state.stats.stress = clamp(state.stats.stress + eff.stress, 0, 100);
  if (eff.caffeine) state.stats.caffeine = clamp(state.stats.caffeine + eff.caffeine, 0, 100);
  if (eff.hunger) state.stats.hunger = clamp(state.stats.hunger + eff.hunger, 0, 100);
  if (eff.sleep) state.stats.sleep = clamp(state.stats.sleep + eff.sleep, 0, 100);
  if (eff.points) state.money += eff.points;
  if (eff.repLit) state.reputation.lit += eff.repLit;
  if (eff.repCorp) state.reputation.corp += eff.repCorp;
  if (eff.repReg) state.reputation.reg += eff.repReg;

  log(opt.msg);
}

function tickNpcs(dtHours) {
  // Expire old NPCs
  state.npcs = state.npcs.filter(n => now() < n.expiresAt);

  // Spawn new NPCs periodically (max 2 at a time)
  if (now() >= state.nextNpcSpawnAt && state.npcs.length < 2) {
    const npc = spawnNpc();
    if (npc) {
      state.npcs.push(npc);
      const seasonLabel = isSummerSeason() ? "A summer associate" : (npc.persona === "delivery" ? "A delivery driver" : "Someone");
      log(`${seasonLabel} stopped by: ${npc.name}.`);
    }
    state.nextNpcSpawnAt = now() + 1000 * 60 * 60 * randInt(4, 14);
  }
  if (state.nextNpcSpawnAt === 0) {
    state.nextNpcSpawnAt = now() + 1000 * 60 * 60 * randInt(1, 4);
  }
}

// ---------- Simulation ----------
function productivityMultiplier() {
  const { hunger, caffeine, sleep, stress } = state.stats;

  const hungerPenalty = hunger < 35 ? (35 - hunger) / 60 : 0;
  const caffeinePenalty = caffeine < 30 ? (30 - caffeine) / 70 : 0;

  let sleepPenalty = sleep < 35 ? (35 - sleep) / 60 : 0;
  if (state.perks.nightOwl) sleepPenalty *= 0.55;

  const stressPenalty = stress > 70 ? (stress - 70) / 60 : 0;

  let mult = 1.0 - (hungerPenalty + caffeinePenalty + sleepPenalty + stressPenalty);
  mult = clamp(mult, 0.15, 1.25);

  if (state._sinUntil && state._sinUntil > now()) mult *= 1.12;
  if (state.office.bookshelfBuffUntil > now()) mult *= 1.08;
  if (state.lawyer.outfit.casualFridays && isFriday(now())) mult *= 1.04;

  // Burnout: massive productivity penalty
  if (state.burnout && state.burnoutUntil > now()) mult *= 0.35;

  return mult;
}

function tick(dtMs) {
  if (state.dismissed) return;

  const dtHours = dtMs / (1000 * 60 * 60);

  let hungerDecay = 0.9;
  let caffeineDecay = 1.1;
  let sleepDecay = 0.7;

  if (state.store.fridge) hungerDecay *= 0.78;
  if (state.store.coffeeMaker) caffeineDecay *= 0.78;
  if (state._sinUntil && state._sinUntil > now()) sleepDecay *= 1.15;

  state.stats.hunger = clamp(state.stats.hunger - hungerDecay * dtHours, 0, 100);
  state.stats.caffeine = clamp(state.stats.caffeine - caffeineDecay * dtHours, 0, 100);
  state.stats.sleep = clamp(state.stats.sleep - sleepDecay * dtHours, 0, 100);

  if (state.office.walkingPadOn) state.stats.stress = clamp(state.stats.stress - 0.35 * dtHours, 0, 100);

  // Divorce: stress floor at 25 (can never fully relax)
  if (state.divorced && state.stats.stress < 25) {
    state.stats.stress = 25;
  }

  // Burnout recovery check
  if (state.burnout && state.burnoutUntil > 0 && now() >= state.burnoutUntil) {
    state.burnout = false;
    state.burnoutUntil = 0;
    log("The fog is lifting. Burnout is fading. Productivity restored.");
  }

  const workload = state.queue.length;
  let stressRise = (0.22 + workload * 0.08) * dtHours;
  if (state.store.desk) stressRise *= 0.78;
  if (state.lawyer.outfit.casualFridays && isFriday(now())) stressRise *= 0.9;

  // Divorced: +40% passive stress rise
  if (state.divorced) stressRise *= 1.4;

  state.stats.stress = clamp(state.stats.stress + stressRise, 0, 100);

  const prod = productivityMultiplier();

  for (const a of state.queue) {
    if (a.progress >= 1) continue;

    const workHoursThisTick = prod * dtHours;
    const billableGainMult = (state.perks.masterBiller ? 1.12 : 1.0) * state.breakaway.multiplier;

    const remainingBillables = a.billableHours - a.billablesEarned;
    const billablesToAdd = Math.min(remainingBillables, workHoursThisTick * billableGainMult);

    a.billablesEarned += billablesToAdd;
    state.billables += billablesToAdd;

    a.progress = clamp(a.billablesEarned / a.billableHours, 0, 1);

    if (now() > a.deadlineAt && a.progress < 1 && !a._missed) {
      a._missed = true;
      state.missedDeadlines += 1;
      state.pipStrikes += 1;
      state.stats.stress = clamp(state.stats.stress + 12, 0, 100);
      log(`Deadline MISSED: ${a.title}. PIP strike issued.`);
    }

    if (a.progress >= 1 && !a._completed) {
      a._completed = true;

      const earnedPoints = Math.round(a.points * state.breakaway.multiplier);
      state.money += earnedPoints;

      state.stats.stress = clamp(state.stats.stress + (a.stressImpact * 0.2), 0, 100);
      if (a.kind === "probono") state.stats.stress = clamp(state.stats.stress - 10, 0, 100);

      let repGain = Math.max(4, Math.round(a.billableHours * 1.2));
      if (state.perks.goldenVoice && a.kind === "lit") repGain = Math.round(repGain * 1.25);
      if (state.lawyer.outfit.tie) repGain += 1;
      repGain = Math.round(repGain * state.breakaway.multiplier);

      if (a.kind === "lit") state.reputation.lit += repGain;
      if (a.kind === "corp") state.reputation.corp += repGain;
      if (a.kind === "reg") state.reputation.reg += repGain;
      if (a.kind === "probono") state.reputation.reg += 2;

      log(`Completed: ${a.title}. +$${earnedPoints}, +rep.`);
    }
  }

  state.queue = state.queue.filter(a => !(a._completed && (now() - a.deadlineAt > 1000 * 60 * 60)));

  if (now() >= state.nextOfferRefreshAt) refreshOffers();
  if (now() >= state.nextEventAt) triggerRandomEvent();

  if (now() >= state.nextChristmasPartyAt) {
    state.stats.stress = clamp(state.stats.stress - 30, 0, 100);
    state.stats.sleep = clamp(state.stats.sleep + 10, 0, 100);
    log("Office Christmas party (Thursday before Christmas). Stress melts away—for one night.");
    state.nextChristmasPartyAt = nextChristmasPartyTimestamp(now());
  }

  // Arc ticks
  tickJuniors(dtHours);
  tickRival(dtHours);
  tickNpcs(dtHours);
  tickBitcoin(dtHours);

  if (state.pipStrikes >= 3) {
    state.dismissed = true;
    log("Dismissed. The firm has decided you are not 'a good fit.' (Run ended.)");
  }

  const critical =
    (state.stats.hunger < 8) ||
    (state.stats.caffeine < 8) ||
    (state.stats.sleep < 8) ||
    (state.stats.stress > 95);

  if (critical && Math.random() < 0.002 * dtMs) {
    state.pipStrikes += 1;
    log("Critical condition persisted. HR is 'circling back' (PIP strike).");
  }
}

function rankName() {
  return RANKS[rankIndex()].name;
}

// ---------- Rendering ----------
function setBar(id, v) {
  const el = $(id);
  el.style.width = `${clamp(v, 0, 100)}%`;
}

function renderStats() {
  const s = state.stats;

  setBar("bar-hunger", s.hunger);
  setBar("bar-caffeine", s.caffeine);
  setBar("bar-sleep", s.sleep);
  setBar("bar-stress", 100 - s.stress); // invert for “bad”

  $("val-hunger").textContent = Math.round(s.hunger);
  $("val-caffeine").textContent = Math.round(s.caffeine);
  $("val-sleep").textContent = Math.round(s.sleep);
  $("val-stress").textContent = Math.round(s.stress);

  $("points").textContent = "$" + Math.floor(state.money).toString();
  $("billables").textContent = Math.floor(state.billables).toString();
  $("pip").textContent = state.pipStrikes.toString();

  const prod = productivityMultiplier();
  const prodLabel = state.breakaway.multiplier > 1
    ? `${Math.round(prod * 100)}% (${state.breakaway.multiplier.toFixed(2)}x prestige)`
    : `${Math.round(prod * 100)}%`;
  $("prod").textContent = prodLabel;

  $("rep-lit").textContent = Math.floor(state.reputation.lit);
  $("rep-corp").textContent = Math.floor(state.reputation.corp);
  $("rep-reg").textContent = Math.floor(state.reputation.reg);

  const rankSuffix = state.dismissed ? " — DISMISSED" : (state.breakaway.count > 0 ? ` (Run #${state.breakaway.count + 1})` : "");
  $("rank").textContent = `Rank: ${rankName()}${rankSuffix}`;
}

function renderClock() {
  $("clock").textContent = new Date().toLocaleString();
}

function renderOffers() {
  const wrap = $("offers");
  wrap.innerHTML = "";
  for (const o of state.offers) {
    const card = document.createElement("div");
    card.className = "card";
    const dl = new Date(o.deadlineAt).toLocaleString();
    card.innerHTML = `
      <div class="top">
        <div>
          <div class="name">${o.title}</div>
          <div class="meta">${o.kind.toUpperCase()} • Deadline: ${dl}</div>
        </div>
        <div>
          <button data-accept="${o.id}">Accept</button>
        </div>
      </div>
      <div class="mini">
        <div>${o.billableHours}h billables</div>
        <div>+$${o.points}</div>
      </div>
    `;
    wrap.appendChild(card);
  }

  wrap.querySelectorAll("[data-accept]").forEach(btn => {
    btn.addEventListener("click", () => acceptOffer(btn.getAttribute("data-accept")));
  });
}

function renderQueue() {
  const wrap = $("queue");
  wrap.innerHTML = "";

  if (state.queue.length === 0) {
    const empty = document.createElement("div");
    empty.className = "card";
    empty.textContent = "No active assignments. (A rare moment of peace.)";
    wrap.appendChild(empty);
    return;
  }

  for (const a of state.queue) {
    const card = document.createElement("div");
    card.className = "card";
    const dl = new Date(a.deadlineAt).toLocaleString();
    const pct = Math.round(a.progress * 100);
    const canClear = a._completed || a._missed;
    const statusLabel = a._completed ? "Done" : (a._missed ? "Missed" : "");

    card.innerHTML = `
      <div class="top">
        <div>
          <div class="name">${a.title}${statusLabel ? ` <span class="tag ${a._completed ? "tag-done" : "tag-missed"}">${statusLabel}</span>` : ""}</div>
          <div class="meta">${a.kind.toUpperCase()} • Deadline: ${dl}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="meta">${pct}%</div>
          ${canClear ? `<button class="btn-clear" data-clear="${a.id}">Clear</button>` : ""}
        </div>
      </div>
      <div class="mini">
        <div>${Math.floor(a.billablesEarned)}/${a.billableHours}h</div>
        <div>$${a.points}</div>
      </div>
      <div class="progress"><div class="pfill" style="width:${pct}%"></div></div>
    `;
    wrap.appendChild(card);
  }

  wrap.querySelectorAll("[data-clear]").forEach(btn => {
    btn.addEventListener("click", () => clearTask(btn.getAttribute("data-clear")));
  });
}

// NES-ish procedural office scene
function drawScene() {
  const W = canvas.width;
  const H = canvas.height;

  ctx.clearRect(0, 0, W, H);

  const px = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  const stroke = (x, y, w, h, c, lw=2) => { ctx.strokeStyle = c; ctx.lineWidth = lw; ctx.strokeRect(x, y, w, h); };

  const pal = {
    nightSky: "#070a14",
    sky: "#0f1732",
    sky2: "#131f46",
    building: "#0a1022",
    building2: "#10183a",
    window: "#2f3d6b",
    windowClean: "#8fb9ff",
    cityLight: "#f2d98a",
    desk: "#1b2236",
    deskEdge: "#2c3554",
    wall: "#10131a",
    floor: "#0d0f14",
    outline: "#0a0c12",
    text: "#e8e8e8",
    plant: "#2b7a44",
    plantDead: "#4c4a2f",
    pot: "#2a3040",
    lamp: "#2a3040",
    lampOn: "#cfe1ff",
    coffee: "#3a2b1a",
    paper: "#d9dbe6"
  };

  px(0, 0, W, H, pal.wall);
  px(0, 230, W, 70, pal.floor);

  px(0, 0, W, 150, pal.sky);
  px(0, 0, W, 80, pal.nightSky);
  px(0, 80, W, 70, pal.sky2);

  for (let i = 0; i < 12; i++) {
    const bw = 22 + (i % 3) * 8;
    const bh = 40 + (i % 5) * 18;
    const bx = 10 + i * 34;
    const by = 150 - bh;

    px(bx, by, bw, bh, i % 2 ? pal.building : pal.building2);

    for (let wx = bx + 4; wx < bx + bw - 4; wx += 6) {
      for (let wy = by + 6; wy < by + bh - 6; wy += 8) {
        if (Math.random() < 0.25) px(wx, wy, 2, 2, pal.cityLight);
      }
    }
  }

  const frameC = state.office.windowClean ? pal.windowClean : pal.window;
  stroke(16, 12, W - 32, 150, frameC, 3);
  px(16 + (W - 32) / 2 - 1, 12, 2, 150, frameC);
  px(16, 12 + 75, W - 32, 2, frameC);

  if (state.office.windowClean) {
    px(26, 22, 4, 140, "#cfe1ff33");
    px(40, 22, 2, 140, "#cfe1ff22");
  }

  // bookshelf
  const shelfX = 22, shelfY = 170, shelfW = 88, shelfH = 120;
  px(shelfX, shelfY, shelfW, shelfH, "#0f1422");
  stroke(shelfX, shelfY, shelfW, shelfH, "#2a3040", 2);
  px(shelfX + 6, shelfY + 38, shelfW - 12, 3, "#2a3040");
  px(shelfX + 6, shelfY + 78, shelfW - 12, 3, "#2a3040");
  px(shelfX + 6, shelfY + 114, shelfW - 12, 3, "#2a3040");

  const books = [
    { x: shelfX + 10, y: shelfY + 18, w: 10, h: 18, c: "#a95cff" },
    { x: shelfX + 22, y: shelfY + 14, w: 8,  h: 22, c: "#6fb3ff" },
    { x: shelfX + 32, y: shelfY + 20, w: 12, h: 16, c: "#6fff9a" },
    { x: shelfX + 46, y: shelfY + 16, w: 9,  h: 20, c: "#ff6f6f" }
  ];
  for (const b of books) px(b.x, b.y, b.w, b.h, b.c);

  // desk
  px(130, 205, 270, 75, pal.desk);
  px(130, 205, 270, 8, pal.deskEdge);
  stroke(130, 205, 270, 75, "#12182a", 2);

  // banker's lamp
  px(255, 190, 26, 6, "#202946");
  px(267, 170, 3, 20, "#202946");
  px(245, 160, 60, 12, state.office.bankersLightOn ? pal.lampOn : pal.lamp);
  stroke(245, 160, 60, 12, "#202946", 2);

  // coffee pot
  const cpX = 350, cpY = 178;
  px(cpX, cpY, 46, 24, "#151b2c");
  stroke(cpX, cpY, 46, 24, "#2a3040", 2);
  px(cpX + 8, cpY - 18, 18, 18, "#2a3040");
  px(cpX + 10, cpY - 16, 14, 14, pal.coffee);
  px(cpX + 26, cpY - 14, 8, 6, "#2a3040");
  px(cpX + 12, cpY - 22, 10, 4, "#2a3040");

  // Newton’s cradle
  const ncX = 165, ncY = 178;
  px(ncX, ncY, 48, 22, "#151b2c");
  stroke(ncX, ncY, 48, 22, "#2a3040", 2);
  px(ncX + 6, ncY + 4, 2, 14, "#2a3040");
  px(ncX + 40, ncY + 4, 2, 14, "#2a3040");
  px(ncX + 6, ncY + 4, 36, 2, "#2a3040");
  for (let i = 0; i < 5; i++) px(ncX + 12 + i * 6, ncY + 14, 4, 4, "#cfe1ff");

  // plant
  const plantC = state.office.plantAlive ? pal.plant : pal.plantDead;
  px(W - 40, 215, 26, 28, plantC);
  px(W - 44, 240, 34, 14, pal.pot);
  stroke(W - 44, 240, 34, 14, "#12182a", 2);

  // papers
  px(300, 210, 42, 30, pal.paper);
  stroke(300, 210, 42, 30, "#a9b0bb", 1);

  // walking pad
  if (state.office.walkingPadOn) {
    px(140, 286, 240, 6, "#6fb3ff");
    px(140, 292, 240, 2, "#2a3040");
  }

  // lawyer sprite (face attached)
  const s = state.stats;
  const slump = (s.sleep < 25 || s.stress > 85) ? 6 : 0;
  const ax = 240, ay = 150 + slump;

  px(ax, ay, 60, 60, "#1f2740");
  px(ax + 6, ay + 10, 10, 35, "#2a3554");
  px(ax + 44, ay + 10, 10, 35, "#2a3554");
  px(ax + 26, ay + 12, 8, 40, "#d9dbe6");

  px(ax + 29, ay + 18, 2, 34, state.lawyer.outfit.tie ? "#ff6fb3" : "#2a3040");
  px(ax + 27, ay + 18, 6, 4, state.lawyer.outfit.tie ? "#ff6fb3" : "#2a3040");

  px(ax - 10, ay + 14, 10, 36, "#1f2740");
  px(ax + 60, ay + 14, 10, 36, "#1f2740");

  const hx = ax + 18, hy = ay - 28;
  px(hx, hy, 24, 24, "#b9926a");
  px(hx, hy, 24, 6, "#5b3a29"); // hair
  px(hx + 6, hy + 10, 3, 3, "#1a1a1a");
  px(hx + 15, hy + 10, 3, 3, "#1a1a1a");
  px(hx + 9, hy + 18, 6, 1, "#1a1a1a");

  if (state.lawyer.outfit.hat) {
    px(hx - 2, hy - 6, 28, 6, "#6fff9a");
    px(hx + 2, hy - 10, 20, 4, "#6fff9a");
  }

  ctx.fillStyle = pal.text;
  ctx.font = "12px monospace";
  const mood = (s.stress > 80) ? "!!!" : (s.stress > 55 ? "..." : ":)");
  ctx.fillText(mood, ax + 74, ay - 8);

  ctx.fillStyle = "#a9b0bb";
  ctx.font = "10px monospace";
  ctx.fillText("BOOKS", shelfX + 16, shelfY + 12);
  ctx.fillText("DESK", 240, 202);
}

// ---------- Arc Rendering ----------

function renderJuniors() {
  const panel = $("arc-juniors");
  const ri = rankIndex();
  if (ri < 1) { panel.style.display = "none"; return; }
  panel.style.display = "";

  const wrap = $("junior-list");
  wrap.innerHTML = "";

  if (state.juniors.length === 0) {
    const empty = document.createElement("div");
    empty.className = "junior-card";
    empty.innerHTML = '<div class="junior-task">No juniors available right now. Check back soon.</div>';
    wrap.appendChild(empty);
    return;
  }

  for (const j of state.juniors) {
    const card = document.createElement("div");
    card.className = "junior-card";
    const pct = Math.round(j.progress * 100);
    const dl = new Date(j.deadlineAt).toLocaleString();
    const statusTag = j.completed
      ? ' <span class="tag tag-done">Done</span>'
      : j.missed
        ? ' <span class="tag tag-missed">Missed</span>'
        : !j.assigned
          ? ' <span class="tag" style="background:#1a2a3a;color:#6fb3ff;border:1px solid #2b4a6a">Awaiting</span>'
          : "";

    card.innerHTML = `
      <div class="junior-top">
        <div class="junior-name">${j.name}${statusTag}</div>
        ${!j.assigned && !j.completed && !j.missed
          ? `<button class="btn-delegate" data-delegate="${j.id}">Delegate</button>`
          : !j.completed && !j.missed && j.assigned
            ? `<div style="color:var(--muted);font-size:11px">${pct}%</div>`
            : j.completed || j.missed
              ? `<button class="btn-clear" data-dismiss-junior="${j.id}">Clear</button>`
              : ""
        }
      </div>
      <div class="junior-task">${j.task} (${j.kind.toUpperCase()})</div>
      <div class="junior-meta">
        <span>${j.billableHours}h • +$${j.points} bonus</span>
        <span>Due: ${dl}</span>
      </div>
      ${j.assigned && !j.completed && !j.missed
        ? `<div class="progress"><div class="pfill" style="width:${pct}%"></div></div>`
        : ""
      }
    `;
    wrap.appendChild(card);
  }

  wrap.querySelectorAll("[data-delegate]").forEach(btn => {
    btn.addEventListener("click", () => {
      assignJunior(btn.getAttribute("data-delegate"));
      renderJuniors();
    });
  });
  wrap.querySelectorAll("[data-dismiss-junior]").forEach(btn => {
    btn.addEventListener("click", () => {
      dismissJunior(btn.getAttribute("data-dismiss-junior"));
      renderJuniors();
    });
  });
}

function renderRival() {
  const panel = $("arc-rival");
  if (rankIndex() !== 2 || !state.rival.active) {
    panel.style.display = "none";
    return;
  }
  panel.style.display = "";

  $("rival-name-label").textContent = state.rival.name;
  $("rival-pscore").textContent = Math.floor(state.rival.playerScore);
  $("rival-rscore").textContent = Math.floor(state.rival.score);

  // Tug fill: 0% = rival winning fully, 50% = tied, 100% = player winning fully
  const fillPct = clamp(50 + state.rival.momentum / 2, 0, 100);
  $("tug-fill").style.width = `${fillPct}%`;

  const status = $("rival-status");
  if (state.rival.momentum > 40) {
    status.textContent = "You're pulling ahead. Keep billing.";
    status.style.color = "#6fff9a";
  } else if (state.rival.momentum > 10) {
    status.textContent = "Slight edge — don't let up.";
    status.style.color = "#6fb3ff";
  } else if (state.rival.momentum > -10) {
    status.textContent = "Dead heat. Every hour counts.";
    status.style.color = "var(--muted)";
  } else if (state.rival.momentum > -40) {
    status.textContent = `${state.rival.name} is edging ahead…`;
    status.style.color = "#f2d98a";
  } else {
    status.textContent = `${state.rival.name} is dominating. Bill harder.`;
    status.style.color = "#ff6f6f";
  }
}

function renderBreakaway() {
  const panel = $("arc-breakaway");
  if (rankIndex() < 4) { panel.style.display = "none"; return; }
  panel.style.display = "";

  $("breakaway-count").textContent = state.breakaway.count;
  $("breakaway-mult").textContent = state.breakaway.multiplier.toFixed(2) + "x";
  const btcVal = Math.floor((state.bitcoin ? state.bitcoin.holdings : 0) * btcPrice);
  $("breakaway-earnings").textContent = "$" + Math.floor(state.breakaway.lifetimeEarnings + state.money + btcVal);
}

function renderNpcs() {
  const panel = $("npc-panel");
  const wrap = $("npc-list");
  if (state.npcs.length === 0) {
    panel.style.display = "none";
    return;
  }
  panel.style.display = "";
  wrap.innerHTML = "";

  const seasonTag = isSummerSeason() ? "Summer" : "Office";

  for (const npc of state.npcs) {
    const card = document.createElement("div");
    card.className = "npc-card";

    const personaColors = {
      fratbro: "#f2d98a", nerd: "#6fb3ff", normal: "#6fff9a", weirdo: "#ff6fb3",
      associate: "#a9b0bb", partner: "#cfa5ff", staff: "#6fff9a", delivery: "#f2d98a"
    };
    const tagColor = personaColors[npc.persona] || "var(--muted)";
    const personaLabel = {
      fratbro: "Frat Bro", nerd: "Nerd", normal: "Normal", weirdo: "???",
      associate: "Associate", partner: "Partner", staff: "Staff", delivery: "Delivery"
    }[npc.persona] || npc.persona;

    if (npc.interacted) {
      card.innerHTML = `
        <div class="npc-top">
          <div class="npc-name">${npc.name} <span class="tag" style="background:transparent;color:${tagColor};border:1px solid ${tagColor}">${personaLabel}</span></div>
        </div>
        <div class="npc-desc" style="opacity:0.5">${npc.desc}</div>
        <div class="npc-done">Already interacted.</div>
      `;
    } else {
      card.innerHTML = `
        <div class="npc-top">
          <div class="npc-name">${npc.name} <span class="tag" style="background:transparent;color:${tagColor};border:1px solid ${tagColor}">${personaLabel}</span></div>
        </div>
        <div class="npc-desc">${npc.desc}</div>
        <div class="npc-actions">
          <button class="npc-btn" data-npc="${npc.id}" data-choice="a">${npc.optA.label}</button>
          <button class="npc-btn" data-npc="${npc.id}" data-choice="b">${npc.optB.label}</button>
        </div>
      `;
    }
    wrap.appendChild(card);
  }

  wrap.querySelectorAll("[data-npc]").forEach(btn => {
    btn.addEventListener("click", () => {
      interactNpc(btn.getAttribute("data-npc"), btn.getAttribute("data-choice"));
      renderNpcs();
    });
  });
}

function renderBitcoin() {
  // Price
  const priceStr = btcPrice > 0
    ? "$" + btcPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : "--";
  $("btc-price").textContent = priceStr;

  // Updated timestamp
  const updEl = $("btc-updated");
  if (btcPriceUpdatedAt > 0) {
    const ago = Math.floor((now() - btcPriceUpdatedAt) / 1000);
    updEl.textContent = ago < 10 ? "Price: just now" : `Price: ${ago}s ago`;
    updEl.style.color = "#555";
  } else if (btcFetchError) {
    updEl.textContent = "Price: offline";
    updEl.style.color = "#ff6f6f";
  }

  // Holdings
  const holdings = state.bitcoin.holdings;
  $("btc-holdings").textContent = holdings > 0 ? holdings.toFixed(6) : "0";

  // Value
  const value = Math.floor(holdings * btcPrice);
  $("btc-value").textContent = "$" + value.toLocaleString();

  // P&L
  const pnl = value - Math.round(state.bitcoin.totalInvested);
  const pnlEl = $("btc-pnl");
  if (holdings <= 0) {
    pnlEl.textContent = "$0";
    pnlEl.className = "";
  } else if (pnl >= 0) {
    pnlEl.textContent = "+$" + pnl.toLocaleString();
    pnlEl.className = "btc-profit";
  } else {
    pnlEl.textContent = "-$" + Math.abs(pnl).toLocaleString();
    pnlEl.className = "btc-loss";
  }

  // Disable buttons when appropriate
  $("btn-btc-buy-50").disabled = state.money < 50 || btcPrice <= 0;
  $("btn-btc-buy-100").disabled = state.money < 100 || btcPrice <= 0;
  $("btn-btc-sell-half").disabled = holdings <= 0 || btcPrice <= 0;
  $("btn-btc-sell-all").disabled = holdings <= 0 || btcPrice <= 0;
}

function renderAll() {
  renderClock();
  renderStats();
  renderOffers();
  renderQueue();
  renderStore();
  renderPerks();
  renderBitcoin();
  renderJuniors();
  renderRival();
  renderBreakaway();
  renderNpcs();
  renderLog();
  drawScene();
}

// ---------- Boot ----------
function saveSilent() {
  try {
    if (!fs.existsSync(SAVE_DIR)) fs.mkdirSync(SAVE_DIR, { recursive: true });
    fs.writeFileSync(SAVE_FILE, JSON.stringify(state), "utf-8");
  } catch (_) { /* best effort */ }
}

function init() {
  seedOffers();
  loadStoreCatalog();

  // Breakaway button
  $("btn-breakaway").addEventListener("click", () => {
    if (!canBreakaway()) return;
    const confirmed = confirm(
      "BREAK AWAY?\n\n" +
      "You'll leave the firm and start your own practice.\n" +
      "All progress resets to zero — rank, billables, reputation, everything.\n\n" +
      `But you'll carry a permanent ${Math.round(((1 + 0.15 * (state.breakaway.count + 1) + Math.log2(1 + (state.breakaway.lifetimeEarnings + state.money + Math.floor((state.bitcoin ? state.bitcoin.holdings : 0) * btcPrice)) / 5000) * 0.1) - 1) * 100)}% bonus into your next run.\n\n` +
      "Are you sure?"
    );
    if (confirmed) executeBreakaway();
  });

  // Migrate old saves that lack arc fields
  if (!state.juniors) state.juniors = [];
  if (!state.nextJuniorSpawnAt) state.nextJuniorSpawnAt = 0;
  if (!state.rival) state.rival = { name: "", score: 0, playerScore: 0, momentum: 0, lastTrashTalkAt: 0, active: false };
  if (!state.breakaway) state.breakaway = { count: 0, multiplier: 1.0, lifetimeEarnings: 0 };
  if (state.workChoices === undefined) state.workChoices = 0;
  if (state.familyChoices === undefined) state.familyChoices = 0;
  if (state.divorced === undefined) state.divorced = false;
  if (state.burnout === undefined) state.burnout = false;
  if (state.burnoutUntil === undefined) state.burnoutUntil = 0;
  if (!state.npcs) state.npcs = [];
  if (!state.nextNpcSpawnAt) state.nextNpcSpawnAt = 0;
  if (state.apiConfig === undefined) state.apiConfig = null;
  if (state.money === undefined) { state.money = state.points || 0; delete state.points; }
  if (!state.bitcoin) state.bitcoin = { holdings: 0, totalInvested: 0, lastPrice: 0, stressCheckPrice: 0, lastStressCheckAt: 0 };
  if (!state.perks) state.perks = { nightOwl: false, masterBiller: false, goldenVoice: false };

  initSettingsUI();

  // Bitcoin buttons
  $("btn-btc-buy-50").addEventListener("click", () => buyBtc(50));
  $("btn-btc-buy-100").addEventListener("click", () => buyBtc(100));
  $("btn-btc-sell-half").addEventListener("click", () => sellBtc(0.5));
  $("btn-btc-sell-all").addEventListener("click", () => sellBtc(1));

  // Start fetching Bitcoin price
  fetchBtcPrice();
  setInterval(fetchBtcPrice, 60 * 1000); // Refresh every 60 seconds

  renderAll();

  setInterval(() => {
    const t = now();
    const dt = t - state.lastTick;
    state.lastTick = t;

    const capped = Math.min(dt, 1000 * 60 * 60 * 6);
    tick(capped);

    renderAll();
  }, 1000);

  setInterval(() => {
    save();
  }, 1000 * 60 * 3);

  window.addEventListener("beforeunload", () => {
    saveSilent();
  });
}

init();
