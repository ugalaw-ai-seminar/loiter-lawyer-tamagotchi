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
  {
    id: "nightOwl",
    name: "Night Owl",
    desc: "Sleep penalty on productivity reduced by 45%.",
    requirement: "Complete 5 assignments while sleep is below 30.",
    threshold: 5,
    progressFn: () => state.perkProgress.nightOwlTasks,
  },
  {
    id: "masterBiller",
    name: "Master Biller",
    desc: "+12% billable hours earned on completed tasks.",
    requirement: "Accumulate 500 lifetime billable hours.",
    threshold: 500,
    progressFn: () => Math.floor(state.billables),
  },
  {
    id: "goldenVoice",
    name: "Golden Voice",
    desc: "+25% reputation gain on litigation assignments.",
    requirement: "Complete 8 litigation assignments.",
    threshold: 8,
    progressFn: () => state.perkProgress.litTasksCompleted,
  }
];

const ACHIEVEMENT_DEFS = [
  // Progression
  { id: "first_billing",    name: "Billable Hour",       desc: "Complete your first assignment.",     check: () => state.billables > 0 },
  { id: "century_club",     name: "Century Club",        desc: "Bill 100 lifetime hours.",            check: () => state.billables >= 100 },
  { id: "billing_machine",  name: "Billing Machine",     desc: "Bill 1,000 lifetime hours.",          check: () => state.billables >= 1000 },
  { id: "rank_1",           name: "Moving Up",           desc: "Reach Midlevel Associate.",           check: () => rankIndex() >= 1 },
  { id: "rank_2",           name: "Senior Material",     desc: "Reach Senior Associate.",             check: () => rankIndex() >= 2 },
  { id: "rank_3",           name: "On Track",            desc: "Reach Counsel (Partner Track).",      check: () => rankIndex() >= 3 },
  { id: "rank_4",           name: "Made Partner",        desc: "Reach Partner.",                      check: () => rankIndex() >= 4 },
  // Money
  { id: "first_grand",      name: "First Grand",        desc: "Have $1,000 at once.",                check: () => state.money >= 1000 },
  { id: "five_figures",     name: "Five Figures",        desc: "Have $10,000 at once.",               check: () => state.money >= 10000 },
  // Survival
  { id: "all_nighter",      name: "All-Nighter",        desc: "Sleep drops below 10.",               check: () => state.stats.sleep < 10 },
  { id: "meltdown",         name: "Meltdown",           desc: "Stress exceeds 95.",                  check: () => state.stats.stress > 95 },
  { id: "wired",            name: "Wired",              desc: "Max out caffeine.",                   check: () => state.stats.caffeine >= 100 },
  { id: "starving",         name: "Starving Artist",    desc: "Hunger drops below 10.",              check: () => state.stats.hunger < 10 },
  // Life events
  { id: "divorced",         name: "Irreconcilable",     desc: "Get divorced.",                       check: () => state.divorced === true },
  { id: "burnout",          name: "Burned Out",         desc: "Experience burnout.",                  check: () => state.burnout === true },
  { id: "pip_strike",       name: "On Thin Ice",        desc: "Receive a PIP strike.",               check: () => state.pipStrikes >= 1 },
  // Bitcoin
  { id: "crypto_curious",   name: "Crypto Curious",     desc: "Buy Bitcoin for the first time.",     check: () => state.bitcoin && state.bitcoin.totalInvested > 0 },
  { id: "diamond_hands",    name: "Diamond Hands",      desc: "Hold $1,000+ in Bitcoin.",            check: () => state.bitcoin && state.bitcoin.holdings * (btcPrice || state.bitcoin.lastPrice) >= 1000 },
  // Prestige
  { id: "breakaway_1",      name: "Fresh Start",        desc: "Complete a breakaway.",               check: () => state.breakaway.count >= 1 },
  { id: "breakaway_3",      name: "Serial Entrepreneur", desc: "Complete 3 breakaways.",             check: () => state.breakaway.count >= 3 },
  // Perks & store
  { id: "buy_perk",         name: "Self-Investment",    desc: "Earn any perk.",                      check: () => state.perks.nightOwl || state.perks.masterBiller || state.perks.goldenVoice },
  { id: "all_perks",        name: "Fully Loaded",       desc: "Earn all three perks.",               check: () => state.perks.nightOwl && state.perks.masterBiller && state.perks.goldenVoice },
  { id: "buy_item",         name: "Retail Therapy",     desc: "Buy something from the store.",       check: () => state.lawyer.outfit.hat || state.lawyer.outfit.tie || state.lawyer.outfit.casualFridays || state.store.fridge || state.store.coffeeMaker || state.store.desk || state.store.designerWatch || state.store.golfClubs || state.store.leatherBriefcase || state.store.espressoMachine || state.store.cornerOfficeArt || state.store.monogrammedPen },
  // Minigames
  { id: "first_minigame",   name: "Recess",              desc: "Win your first minigame.",            check: () => state.minigameBoost && state.minigameBoost.gamesWon >= 1 },
  { id: "minigame_5",       name: "Corner Office Arcade", desc: "Win 5 minigames.",                   check: () => state.minigameBoost && state.minigameBoost.gamesWon >= 5 },
];

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function now() { return Date.now(); }

function isFriday(ts) { return new Date(ts).getDay() === 5; } // 0 Sun ... 5 Fri

// --- Holiday date helpers ---

function easterSunday(year) {
  // Anonymous Gregorian algorithm
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1; // 0-indexed
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month, day);
}

function laborDay(year) {
  // First Monday of September
  const d = new Date(year, 8, 1); // Sep 1
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  return d;
}

function thanksgivingDay(year) {
  // Fourth Thursday of November
  const d = new Date(year, 10, 1); // Nov 1
  while (d.getDay() !== 4) d.setDate(d.getDate() + 1);
  d.setDate(d.getDate() + 21); // 4th occurrence
  return d;
}

function isSameDay(ts, date) {
  const d = new Date(ts);
  return d.getFullYear() === date.getFullYear() &&
    d.getMonth() === date.getMonth() &&
    d.getDate() === date.getDate();
}

function isCincoDeMayo(ts) { const d = new Date(ts); return d.getMonth() === 4 && d.getDate() === 5; }

// --- Pronoun helpers ---
function isFemale() { return state.lawyer.gender === "female"; }
function pn(male, female) { return isFemale() ? female : male; }
function lawyerName() { return state.lawyer.name || "Associate"; }

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
    name: "",
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
    desk: false,
    designerWatch: false,
    golfClubs: false,
    leatherBriefcase: false,
    espressoMachine: false,
    cornerOfficeArt: false,
    monogrammedPen: false
  },

  perks: {
    nightOwl: false,
    masterBiller: false,
    goldenVoice: false
  },

  perkProgress: {
    nightOwlTasks: 0,       // assignments completed while sleep < 30
    litTasksCompleted: 0    // litigation assignments completed (for goldenVoice)
    // masterBiller uses state.billables directly
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
    active: false,
    pitchOffTriggered: false,  // Whether the resolution event has been offered
    resolved: false,           // Whether the rivalry has ended (player won pitch-off)
    resolvedAt: 0              // Timestamp when rivalry was resolved
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
  },

  // Achievements (persisted across breakaways)
  achievements: [],         // Array of { id, unlockedAt }

  // Holidays triggered this year (array of "holiday_YYYY" strings)
  holidaysTriggered: [],

  // PIP recovery
  pipStrikeTimestamps: [],   // When each PIP strike was issued (for auto-decay)
  onTimeCompletions: 0,      // On-time completions since last PIP (for recovery)

  // Minigame boosts & stats
  minigameBoost: {
    litBoostUntil: 0,       // Timestamp: litigation productivity boost active until
    corpBoostUntil: 0,      // Timestamp: corporate/negotiation productivity boost active until
    regBoostUntil: 0,       // Timestamp: regulatory productivity boost active until
    gamesPlayed: 0,         // Total minigames played
    gamesWon: 0             // Total minigames won
  }
});

const _loaded = load();
const _isFirstBoot = !_loaded;
let state = _loaded || defaultState();

// Minigame tracking (declared early, used by tick and minigame systems)
let minigameActive = false;
let pendingMinigame = null;  // "lit" or "corp"

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
  showCharacterCreation(() => {
    seedOffers(true);
    log(`New game started. Welcome to the firm, ${lawyerName()}.`);
    renderAll();
  });
});

function checkPerkUnlocks() {
  for (const perk of PERK_DEFS) {
    if (state.perks[perk.id]) continue;
    if (perk.progressFn() >= perk.threshold) {
      state.perks[perk.id] = true;
      log(`Perk unlocked: ${perk.name}! ${perk.desc}`);
    }
  }
}

function renderPerks() {
  const wrap = $("perk-list");
  wrap.innerHTML = "";

  for (const perk of PERK_DEFS) {
    const unlocked = state.perks[perk.id];
    const progress = perk.progressFn();
    const pct = Math.min(100, Math.round((progress / perk.threshold) * 100));

    const card = document.createElement("div");
    card.className = "perk-card" + (unlocked ? " unlocked" : "");
    card.innerHTML = `
      <div class="perk-top">
        <div class="perk-name">${perk.name}${unlocked ? ' <span class="tag tag-done">Unlocked</span>' : ""}</div>
      </div>
      <div class="perk-desc">${perk.desc}</div>
      ${unlocked
        ? ""
        : `<div class="perk-req">${perk.requirement}</div>
           <div class="perk-progress-label">${progress} / ${perk.threshold}</div>
           <div class="progress"><div class="pfill" style="width:${pct}%"></div></div>`
      }
    `;
    wrap.appendChild(card);
  }
}

// ---------- Achievements ----------

let achPanelOpen = false;

function checkAchievements() {
  if (!state.achievements) state.achievements = [];
  const unlocked = new Set(state.achievements.map(a => a.id));
  let newlyUnlocked = false;

  for (const def of ACHIEVEMENT_DEFS) {
    if (unlocked.has(def.id)) continue;
    try {
      if (def.check()) {
        state.achievements.push({ id: def.id, unlockedAt: now() });
        log(`Achievement unlocked: ${def.name}!`);
        newlyUnlocked = true;
      }
    } catch (_) { /* check may reference missing state fields */ }
  }

  if (newlyUnlocked) renderAchievements();
}

function renderAchievements() {
  const total = ACHIEVEMENT_DEFS.length;
  const unlocked = state.achievements ? state.achievements.length : 0;
  $("ach-header-count").textContent = `(${unlocked}/${total})`;

  const wrap = $("ach-list");
  wrap.innerHTML = "";

  const unlockedIds = new Set((state.achievements || []).map(a => a.id));

  for (const def of ACHIEVEMENT_DEFS) {
    const earned = unlockedIds.has(def.id);
    const div = document.createElement("div");
    div.className = "ach-item" + (earned ? " earned" : "");
    div.innerHTML = `<span class="ach-name">${earned ? def.name : "???"}</span><span class="ach-desc">${earned ? def.desc : "Keep playing to find out."}</span>`;
    wrap.appendChild(div);
  }
}

// ---------- Assistant actions ----------
$("btn-coffee").addEventListener("click", () => {
  const coffeeBoost = state.store.espressoMachine ? 46 : 35;
  state.stats.caffeine = clamp(state.stats.caffeine + coffeeBoost, 0, 100);
  state.stats.stress = clamp(state.stats.stress - 2, 0, 100);
  log(state.store.espressoMachine
    ? "Pulled a double shot. The espresso machine earns its keep. Caffeine way up."
    : "Refilled coffee pot. Caffeine up.");
});

$("btn-food").addEventListener("click", () => {
  if (state.money < 15) { log("Not enough money for takeout. ($15)"); return; }
  state.money -= 15;
  state.stats.hunger = clamp(state.stats.hunger + 40, 0, 100);
  state.stats.stress = clamp(state.stats.stress - 3, 0, 100);

  let lines;
  if (isCincoDeMayo(now())) {
    lines = [
      "Ordered takeout ($15). Tacos al pastor — the only good decision you've made today.",
      "Ordered takeout ($15). Enchiladas from the spot down the block. Feliz Cinco de Mayo.",
      "Ordered takeout ($15). Burrito the size of a deposition transcript. No complaints.",
      "Ordered takeout ($15). Chips, guac, and a brief moment of happiness. Viva.",
      "Ordered takeout ($15). Tamales from somebody's abuela. Best billable hour of your life."
    ];
  } else {
    lines = [
      "Ordered takeout ($15). Chinese again…",
      "Ordered takeout ($15). The delivery guy knows your floor by heart.",
      "Ordered takeout ($15). Ate over the keyboard like a professional.",
      "Ordered takeout ($15). It's technically dinner if it arrives after midnight.",
      "Ordered takeout ($15). The receipt looks like a billing statement."
    ];
  }
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
  else if (key === "designerWatch") state.store.designerWatch = true;
  else if (key === "golfClubs") state.store.golfClubs = true;
  else if (key === "leatherBriefcase") state.store.leatherBriefcase = true;
  else if (key === "espressoMachine") state.store.espressoMachine = true;
  else if (key === "cornerOfficeArt") state.store.cornerOfficeArt = true;
  else if (key === "monogrammedPen") state.store.monogrammedPen = true;
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
  if (item.category === "consumable") return false; // Consumables are always purchasable
  const key = item.id;
  if (key === "hat") return !!state.lawyer.outfit.hat;
  if (key === "tie") return !!state.lawyer.outfit.tie;
  if (key === "casual") return !!state.lawyer.outfit.casualFridays;
  if (key === "fridge") return !!state.store.fridge;
  if (key === "coffeeMaker") return !!state.store.coffeeMaker;
  if (key === "desk") return !!state.store.desk;
  if (key === "designerWatch") return !!state.store.designerWatch;
  if (key === "golfClubs") return !!state.store.golfClubs;
  if (key === "leatherBriefcase") return !!state.store.leatherBriefcase;
  if (key === "espressoMachine") return !!state.store.espressoMachine;
  if (key === "cornerOfficeArt") return !!state.store.cornerOfficeArt;
  if (key === "monogrammedPen") return !!state.store.monogrammedPen;
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

function applyConsumable(item) {
  const action = item.effect && item.effect.action;
  switch (action) {
    case "energyDrink":
      state.stats.caffeine = clamp(state.stats.caffeine + 25, 0, 100);
      state._energyDrinkUntil = now() + 1000 * 60 * 60 * 3;
      log("Cracked open a Monster Ultra. Caffeine surging. Productivity boosted for 3 hours.");
      break;
    case "therapistSession":
      state.stats.stress = clamp(state.stats.stress - 20, 0, 100);
      state.workChoices = Math.max(0, state.workChoices - 1);
      log("Dr. Feldman listened. Really listened. Stress down, and something feels lighter.");
      break;
    case "weekendGetaway":
      state.stats.sleep = clamp(state.stats.sleep + 30, 0, 100);
      state.stats.stress = clamp(state.stats.stress - 25, 0, 100);
      log("Traverse City. Lake views. No Wi-Fi. You feel human again.");
      break;
    case "flowersForSpouse":
      if (state.divorced) {
        state.stats.stress = clamp(state.stats.stress + 5, 0, 100);
        log("You bought flowers for… nobody. The vase sits on an empty kitchen table.");
      } else {
        state.workChoices = Math.max(0, state.workChoices - 2);
        state.stats.stress = clamp(state.stats.stress - 5, 0, 100);
        log(`Roses from Eastern Market. Your ${pn("wife", "husband")} smiled for the first time in weeks.`);
      }
      break;
    case "giftsForKids":
      state.workChoices = Math.max(0, state.workChoices - 1);
      state.stats.stress = clamp(state.stats.stress - 5, 0, 100);
      if (state.divorced) {
        log(`Dropped off gifts at the house. Your ${pn("daughter", "son")} ran to the door. That look on ${pn("her", "his")} face was worth everything.`);
      } else {
        log("Lego set and art supplies. Your kids built something they called 'Daddy's Office.' You laughed. Then you didn't.");
      }
      break;
    default:
      log(`Used ${item.name}.`);
  }
}

function buy(itemId) {
  const item = storeCatalog.find(i => i.id === itemId);
  if (!item) return;
  const isConsumable = item.category === "consumable";
  if (!isConsumable && isItemOwned(item)) {
    log("Already owned.");
    return;
  }
  if (state.money < item.cost) {
    log("Not enough money.");
    return;
  }
  state.money -= item.cost;
  if (isConsumable) {
    applyConsumable(item);
  } else {
    applyItemEffect(item);
    log(`Purchased: ${item.name}.`);
  }
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
    const isConsumable = item.category === "consumable";
    const div = document.createElement("div");
    div.className = "store-item" + (owned ? " owned" : "") + (isConsumable ? " consumable" : "");
    const btnLabel = owned ? "Owned" : isConsumable ? `Use ($${item.cost})` : `Buy ($${item.cost})`;
    div.innerHTML = `
      <div class="name">${item.name}${owned ? ' <span class="tag tag-done">Owned</span>' : ""}${isConsumable ? ' <span class="tag" style="background:#1a2a3a;color:#6fb3ff;border:1px solid #2b4a6a">Consumable</span>' : ""}</div>
      <div class="desc">${item.description || ""}</div>
      <button data-buy="${item.id}" ${owned ? "disabled" : ""}>${btnLabel}</button>
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

  const ri = rankIndex();

  // Scale billable hours with rank: higher rank = bigger assignments
  const baseMin = 2 + ri * 2;      // 2, 4, 6, 8, 10
  const baseMax = 12 + ri * 3;     // 12, 15, 18, 21, 24
  let billableHours = randInt(baseMin, baseMax);

  // Scale pay with rank: higher rank = better compensation
  let points = billableHours * randInt(18 + ri * 4, 28 + ri * 6);
  let stress = billableHours * 0.8;

  if (kind === "probono") {
    billableHours = randInt(2, 6);
    points = 0;
    stress = -6;
  }

  // Big ticket assignments (unchanged chance, scales with rank too)
  if (Math.random() < 0.18 && kind !== "probono") {
    billableHours += randInt(6, 12 + ri * 2);
    points += randInt(200 + ri * 50, 400 + ri * 100);
    stress += randInt(6, 14);
  }

  // Scale deadlines with rank: higher rank = tighter deadlines, bigger payoff
  const dlMin = Math.max(16, 24 - ri * 2);
  const dlMax = Math.max(dlMin + 16, 168 - ri * 16);
  const deadlineHours = kind === "probono" ? randInt(36, 120) : randInt(dlMin, dlMax);
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

function declineOffer(id) {
  const idx = state.offers.findIndex(o => o.id === id);
  if (idx === -1) return;
  const a = state.offers[idx];
  state.offers.splice(idx, 1);

  // Small rep cost for declining — the partner who assigned it noticed
  const repCost = 2 + rankIndex(); // Higher rank = more visible decline
  if (a.kind === "lit") state.reputation.lit = clamp(state.reputation.lit - repCost, 0, 9999);
  else if (a.kind === "corp") state.reputation.corp = clamp(state.reputation.corp - repCost, 0, 9999);
  else if (a.kind === "reg") state.reputation.reg = clamp(state.reputation.reg - repCost, 0, 9999);

  const declineLines = [
    `Declined: ${a.title}. (-${repCost} ${a.kind} rep) Someone else will handle it.`,
    `Passed on ${a.title}. (-${repCost} ${a.kind} rep) The assigning partner raised an eyebrow.`,
    `Declined: ${a.title}. (-${repCost} ${a.kind} rep) Sometimes you have to say no.`,
    `Turned down ${a.title}. (-${repCost} ${a.kind} rep) Strategic or suicidal? Time will tell.`
  ];
  log(randChoice(declineLines));
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
    log(`Your ${pn("wife", "husband")} filed for divorce. The papers arrived between two billing statements.`);
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
    if (!state.pipStrikeTimestamps) state.pipStrikeTimestamps = [];
    state.pipStrikeTimestamps.push(now());
    state.onTimeCompletions = 0;
    state.familyChoices = 0; // Reset so they can accumulate again
    log("HR called. Your 'work-life balance' has been noticed. PIP strike issued.");
    log(`The firm doesn't care about your ${pn("daughter", "son")}'s recital.`);
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
      name: `Your ${pn("daughter", "son")}'s dance recital is tonight. There's also a client dinner.`,
      a: { label: "Skip the recital, attend the dinner ($100 + rep)", effect: () => {
        state.stats.stress = clamp(state.stats.stress + 6, 0, 100);
        state.money += 100;
        state.reputation.corp += 5;
        log(`You went to the dinner. +$100, +rep. Your ${pn("daughter", "son")} wasn't impressed.`);
        choseWork();
      }},
      b: { label: "Go to the recital (stress down)", effect: () => {
        state.stats.stress = clamp(state.stats.stress - 12, 0, 100);
        log(`You watched ${pn("her", "him")} dance. ${pn("She", "He")} saw you in the audience and smiled. Stress way down.`);
        choseFamily();
      }}
    },
    {
      type: "work_family",
      name: `Your ${pn("son", "daughter")}'s baseball game is Saturday. A partner wants you in the office.`,
      a: { label: "Work Saturday ($95)", effect: () => {
        state.stats.stress = clamp(state.stats.stress + 8, 0, 100);
        state.stats.sleep = clamp(state.stats.sleep - 4, 0, 100);
        state.money += 95;
        log(`Another Saturday at the office. +$95. Your ${pn("son", "daughter")} hit a home run. You heard about it later.`);
        choseWork();
      }},
      b: { label: "Go to the game (stress down)", effect: () => {
        state.stats.stress = clamp(state.stats.stress - 10, 0, 100);
        state.stats.sleep = clamp(state.stats.sleep + 2, 0, 100);
        log(`You saw the home run. ${pn("He", "She")} ran to you after. Sometimes the small things aren't small.`);
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
        log(`The deal closed at 2 AM. +$140, +rep. Your ${pn("wife", "husband")} ate alone. Again.`);
        choseWork();
      }},
      b: { label: "Go to dinner (stress down, risk rep)", effect: () => {
        state.stats.stress = clamp(state.stats.stress - 14, 0, 100);
        if (Math.random() < 0.3) {
          state.reputation.corp = clamp(state.reputation.corp - 4, 0, 9999);
          log(`You went to dinner. The partner noticed your absence. Small rep hit — but your ${pn("wife", "husband")} was happy.`);
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

// --- Midlevel: Junior Management (Mentorship System) ---

// --- Jewish holiday helper (approximate dates for major observances) ---
function isJewishHoliday(ts) {
  // Approximate Gregorian dates for major Jewish holidays.
  // These shift ~11 days/year so we use a lookup for 2024-2028.
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = d.getMonth() + 1; // 1-indexed
  const day = d.getDate();
  const md = m * 100 + day; // e.g. 925 = Sep 25

  // Major holidays (Rosh Hashanah, Yom Kippur, Sukkot, Passover, Shavuot)
  const holidays = {
    2024: [1003,1004,1012,1017,1018,1019,1020,1021,1022,1023, 423,424,425,426,427,428,429,430, 612,613],
    2025: [923,924,1002,1007,1008,1009,1010,1011,1012,1013, 413,414,415,416,417,418,419,420, 602,603],
    2026: [912,913,921,926,927,928,929,930,1001,1002, 402,403,404,405,406,407,408,409, 522,523],
    2027: [1002,1003,1011,1016,1017,1018,1019,1020,1021,1022, 422,423,424,425,426,427,428,429, 611,612],
    2028: [921,922,930,1005,1006,1007,1008,1009,1010,1011, 411,412,413,414,415,416,417,418, 531,601]
  };
  const yearHolidays = holidays[y] || holidays[2026]; // fallback
  return yearHolidays.includes(md);
}

function isSaturday(ts) { return new Date(ts).getDay() === 6; }

// Each junior has unique personality traits that affect their work
const JUNIOR_PROFILES = [
  {
    name: "Dennis Ronaldo",
    desc: "Nontraditional student. Older, methodical. Good work product but writes in an old-fashioned style. Slow and steady.",
    tag: "Old School",
    tagColor: "#c9a27a",
    // Speed: slow (0.40-0.55), Quality: high but style may bother some clients
    baseSpeed: () => 0.40 + Math.random() * 0.15,
    qualityBase: 0.85,
    // Old-style drafting: 30% chance client cares → quality penalty
    qualityMod: () => Math.random() < 0.30 ? -0.20 : 0,
    available: () => true, // always available
    flavorAssign: "Dennis nods slowly. 'I'll get it done right.' He means it.",
    flavorDone: (q) => q > 0.7
      ? "Dennis delivered. Solid work — if a bit formal. The 'whereas' count is… high."
      : "Dennis delivered, but the partner flagged the 'old-school drafting.' Some clients prefer modern style.",
    flavorMiss: "Dennis sighed. 'I needed more time.' He looks genuinely disappointed in himself.",
    quirk: null
  },
  {
    name: "Keith Harrison",
    desc: "Harvard legacy. Dad's a donor. Fast worker, mediocre product. Oral advocacy is outstanding, though.",
    tag: "Blueblood",
    tagColor: "#a5c4ff",
    // Speed: fast (0.85-1.05), Quality: low baseline
    baseSpeed: () => 0.85 + Math.random() * 0.20,
    qualityBase: 0.45,
    // Lit tasks get a boost (oral advocacy shines in litigation)
    qualityMod: (j) => j.kind === "lit" ? 0.25 : 0,
    available: () => true,
    flavorAssign: "Keith shoots finger guns. 'On it, chief.' He's already walking away.",
    flavorDone: (q) => q > 0.7
      ? "Keith turned it in fast. The brief is rough around the edges, but his oral argument notes are brilliant."
      : "Keith's draft arrived quickly. It's… not great. Multiple typos. But his court presence notes are gold.",
    flavorMiss: "Keith shrugged. 'My bad.' His dad will probably call someone about it.",
    quirk: null
  },
  {
    name: "Catherine Janowicz",
    desc: "Excellent at everything. Fast, thorough, reliable. Observes Shabbat and Jewish holidays — no Saturday work.",
    tag: "Overachiever",
    tagColor: "#6fff9a",
    // Speed: fast (0.75-0.90), Quality: excellent
    baseSpeed: () => 0.75 + Math.random() * 0.15,
    qualityBase: 0.92,
    qualityMod: () => 0,
    // No work on Saturdays or Jewish holidays
    available: (ts) => !isSaturday(ts) && !isJewishHoliday(ts),
    flavorAssign: "Catherine checks her calendar, nods. 'I'll have it to you ahead of schedule.'",
    flavorDone: (q) => "Catherine's work is impeccable. Clean formatting, thorough analysis, zero typos. As always.",
    flavorMiss: "Catherine looks mortified. This almost never happens. 'The holiday schedule conflicted. I'm sorry.'",
    quirk: "shabbat" // tickJuniors checks this
  },
  {
    name: "Benjamin Slater",
    desc: "Workaholic. Medium speed, excellent quality. Works all day, every day. His personal life is suffering.",
    tag: "Workaholic",
    tagColor: "#f2d98a",
    // Speed: medium (0.60-0.75), Quality: very good
    baseSpeed: () => 0.60 + Math.random() * 0.15,
    qualityBase: 0.88,
    qualityMod: () => 0,
    available: () => true, // works every day, including weekends
    flavorAssign: "Benjamin was already at his desk. At 11 PM. 'Sure, add it to the pile.'",
    flavorDone: (q) => "Benjamin's work is thorough and clean. He sent it at 3 AM. You're not sure he's slept this week.",
    flavorMiss: "Benjamin looks haunted. He was so close. He's still at his desk, staring at the screen.",
    quirk: "workaholic"
  },
  {
    name: "Susie Heath",
    desc: "Stunning. Always eager to take assignments. Work product is unpredictable — sometimes great, sometimes rough.",
    tag: "Eager",
    tagColor: "#ff6fb3",
    // Speed: medium (0.60-0.75), Quality: wild variance
    baseSpeed: () => 0.60 + Math.random() * 0.15,
    qualityBase: 0.60,
    // Hit or miss: ±25% quality swing
    qualityMod: () => (Math.random() - 0.5) * 0.50,
    available: () => true,
    flavorAssign: "Susie beams. 'Absolutely! I'll get right on it!' She means it every time.",
    flavorDone: (q) => q > 0.7
      ? "Susie nailed it. When she's on, she's really on. The partner is impressed."
      : "Susie tried hard, but the work needs revisions. She's already asking for the next assignment, though.",
    flavorMiss: "Susie's face falls. 'I got pulled in too many directions.' She'll volunteer for something new within the hour.",
    quirk: null
  },
  {
    name: "Walter Carpenter",
    desc: "Spacey but enthusiastic about IP work. Starts strong, but quality degrades the more you use him without a break.",
    tag: "IP Nerd",
    tagColor: "#cfa5ff",
    // Speed: medium (0.55-0.70), Quality: starts high, degrades with consecutive use
    baseSpeed: () => 0.55 + Math.random() * 0.15,
    qualityBase: 0.82,
    // Quality degrades with consecutive tasks: -0.10 per recent task
    qualityMod: (j) => {
      const recentWalterTasks = (j._tasksCompleted || 0);
      return -(recentWalterTasks * 0.12);
    },
    available: () => true,
    flavorAssign: "Walter perks up. 'Is this IP-related? Please say yes.' (It doesn't matter — he'll do it either way.)",
    flavorDone: (q) => q > 0.7
      ? "Walter's work is sharp — especially the IP analysis sections. He's in his element."
      : "Walter's focus is slipping. The work has errors he wouldn't have made last week. He might need a break.",
    flavorMiss: "Walter stares out the window. 'I think I left my apartment unlocked three days ago.'",
    quirk: "degrades" // quality degrades with back-to-back use
  },
  {
    name: "Margaret Delano",
    desc: "Top-notch on employment matters. Oddball personality. Works in intense bursts, then completely zones out.",
    tag: "Burst Worker",
    tagColor: "#ff9a6f",
    // Speed: wildly variable — fast bursts then slacking
    baseSpeed: () => Math.random() < 0.4 ? (0.90 + Math.random() * 0.3) : (0.15 + Math.random() * 0.10),
    qualityBase: 0.78,
    // Employment/reg tasks get a quality bonus
    qualityMod: (j) => j.kind === "reg" ? 0.15 : 0,
    available: () => true,
    flavorAssign: "Margaret raises an eyebrow. 'Fine. But I work best between 2 and 4 AM.' She's not joking.",
    flavorDone: (q) => q > 0.7
      ? "Margaret's employment analysis is razor-sharp. The rest of the memo is… colorfully worded."
      : "Margaret's work is uneven. The good parts are very good. The rest reads like it was written during a fever dream.",
    flavorMiss: "Margaret shrugs. 'I had a burst at 3 AM and then lost the thread entirely. It happens.'",
    quirk: "burst"
  },
  {
    name: "Sarah Earnheart",
    desc: "The most balanced junior. Good work, reasonable speed, consistent. No drama. A rock.",
    tag: "Steady",
    tagColor: "#6fb3ff",
    // Speed: solid (0.60-0.75), Quality: reliably good
    baseSpeed: () => 0.60 + Math.random() * 0.15,
    qualityBase: 0.80,
    qualityMod: () => 0,
    available: () => true,
    flavorAssign: "Sarah takes the file. 'I'll have it done on time.' No fanfare. Just competence.",
    flavorDone: (q) => "Sarah delivered on time, as always. Clean, professional, no surprises. She's the standard everyone else is measured against.",
    flavorMiss: "Sarah winces. 'That's on me. Won't happen again.' You believe her.",
    quirk: null
  },
  {
    name: "Carter Melancon",
    desc: "Inferiority complex (especially around Benjamin). Workaholic. Slow start, but later work product shines. Burnout risk.",
    tag: "Late Bloomer",
    tagColor: "#a9b0bb",
    // Speed: slow (0.40-0.55), Quality: improves with tasks completed
    baseSpeed: () => 0.40 + Math.random() * 0.15,
    qualityBase: 0.55,
    // Quality improves with experience — each completed task adds +0.08
    qualityMod: (j) => {
      const carterTasks = (j._tasksCompleted || 0);
      return Math.min(0.35, carterTasks * 0.08);
    },
    available: () => true, // workaholic — always available
    flavorAssign: (j) => {
      const benActive = state.juniors.some(x => x.profileName === "Benjamin Slater" && x.assigned && !x.completed);
      return benActive
        ? "Carter glances at Benjamin's office. 'I'll get this done. Faster than him.' (He won't.)"
        : "Carter takes the file with a determined nod. 'I'll prove myself on this one.'";
    },
    flavorDone: (q) => q > 0.7
      ? "Carter's work is excellent. He's been improving steadily. The late nights are paying off — for the firm, at least."
      : "Carter's work is rough, but you can see the effort. He's getting better. He just needs more reps.",
    flavorMiss: "Carter slumps at his desk. He's been here since yesterday. The burnout is real.",
    quirk: "latebloomer" // quality improves with use, but burnout risk
  }
];

// Track per-junior persistent state across assignments (survives within a run)
// Keys: profile name → { tasksCompleted, lastAssignedAt, burnedOut, burnoutUntil }
function getJuniorMeta(name) {
  if (!state.juniorMeta) state.juniorMeta = {};
  if (!state.juniorMeta[name]) {
    state.juniorMeta[name] = { tasksCompleted: 0, lastAssignedAt: 0, burnedOut: false, burnoutUntil: 0 };
  }
  return state.juniorMeta[name];
}

const JUNIOR_TASK_NAMES = {
  lit: ["Draft discovery requests", "Research case law", "Prepare witness outline", "Index exhibits", "Draft motion to compel", "Prepare deposition summary"],
  corp: ["Organize data room", "Draft ancillary docs", "Review disclosure schedules", "Compile signature pages", "Redline merger agreement", "Draft board resolutions"],
  reg: ["Pull agency filings", "Summarize comment letters", "Update compliance tracker", "Draft FOIA request", "Review consent order", "Prepare regulatory memo"]
};

function spawnJunior() {
  const kinds = ["lit", "corp", "reg"];
  const kind = randChoice(kinds);
  const billableHours = randInt(2, 8);
  const points = billableHours * randInt(12, 20);
  const deadlineHours = randInt(24, 120);

  // Pick a profile not already active as a junior
  const activeNames = state.juniors.map(j => j.profileName);
  const available = JUNIOR_PROFILES.filter(p => !activeNames.includes(p.name));
  // Also filter out burned-out juniors
  const notBurnedOut = available.filter(p => {
    const meta = getJuniorMeta(p.name);
    return !meta.burnedOut || now() >= meta.burnoutUntil;
  });

  const pool = notBurnedOut.length > 0 ? notBurnedOut : available;
  if (pool.length === 0) return null;

  const profile = randChoice(pool);
  const meta = getJuniorMeta(profile.name);

  // Clear burnout if expired
  if (meta.burnedOut && now() >= meta.burnoutUntil) {
    meta.burnedOut = false;
    meta.burnoutUntil = 0;
  }

  return {
    id: Math.random().toString(36).slice(2),
    name: profile.name,
    profileName: profile.name,
    task: randChoice(JUNIOR_TASK_NAMES[kind]),
    kind,
    billableHours,
    billablesEarned: 0,
    points,
    deadlineAt: now() + deadlineHours * 60 * 60 * 1000,
    assignedAt: now(),
    progress: 0,
    completed: false,
    missed: false,
    assigned: false,
    _tasksCompleted: meta.tasksCompleted, // snapshot for quality calc
    _quality: null // calculated on completion
  };
}

function assignJunior(juniorId) {
  const j = state.juniors.find(x => x.id === juniorId);
  if (!j || j.assigned) return;
  j.assigned = true;
  j.assignedAt = now();
  const profile = JUNIOR_PROFILES.find(p => p.name === j.profileName);
  if (profile) {
    const msg = typeof profile.flavorAssign === "function" ? profile.flavorAssign(j) : profile.flavorAssign;
    log(`Delegated "${j.task}" to ${j.name}. ${msg}`);
  } else {
    log(`Delegated "${j.task}" to ${j.name}. They're on it.`);
  }
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
    const junior = spawnJunior();
    if (junior) {
      state.juniors.push(junior);
      const profile = JUNIOR_PROFILES.find(p => p.name === junior.profileName);
      const tagLabel = profile ? profile.tag : "";
      log(`${junior.name} is available${tagLabel ? ` [${tagLabel}]` : ""}. Awaiting your delegation.`);
    }
    state.nextJuniorSpawnAt = now() + 1000 * 60 * 60 * randInt(8, 18);
  }
  if (state.nextJuniorSpawnAt === 0) {
    state.nextJuniorSpawnAt = now() + 1000 * 60 * 60 * randInt(2, 6);
  }

  for (const j of state.juniors) {
    if (j.completed || j.missed || !j.assigned) continue;

    const profile = JUNIOR_PROFILES.find(p => p.name === j.profileName);
    if (!profile) continue;

    // Check availability (Catherine's Shabbat/holiday observance)
    if (!profile.available(now())) continue; // Skip this tick — not working today

    // Calculate speed from personality
    const juniorSpeed = profile.baseSpeed();
    const workDone = juniorSpeed * dtHours;
    const remaining = j.billableHours - j.billablesEarned;
    const toAdd = Math.min(remaining, workDone);
    j.billablesEarned += toAdd;
    j.progress = clamp(j.billablesEarned / j.billableHours, 0, 1);

    if (now() > j.deadlineAt && j.progress < 1 && !j.missed) {
      j.missed = true;
      log(`${j.name} missed the deadline on "${j.task}." ${profile.flavorMiss}`);
    }

    if (j.progress >= 1 && !j.completed) {
      j.completed = true;

      // Calculate quality
      const meta = getJuniorMeta(j.profileName);
      j._tasksCompleted = meta.tasksCompleted;
      let quality = profile.qualityBase + profile.qualityMod(j);
      quality = clamp(quality, 0.15, 1.0);
      j._quality = quality;

      // Update meta
      meta.tasksCompleted += 1;
      meta.lastAssignedAt = now();

      // Quality affects bonus: high quality = full bonus, low = reduced
      const qualityMult = 0.5 + quality * 0.5; // range: 0.575 to 1.0
      const bonus = Math.round(j.points * state.breakaway.multiplier * qualityMult);
      const billableCredit = j.billableHours * (0.2 + quality * 0.15); // 0.275 to 0.35

      state.money += bonus;
      state.billables += billableCredit;

      const flavorMsg = typeof profile.flavorDone === "function" ? profile.flavorDone(quality) : profile.flavorDone;
      const qualityLabel = quality >= 0.85 ? "Excellent" : quality >= 0.65 ? "Good" : quality >= 0.45 ? "Fair" : "Rough";
      log(`${j.name} completed "${j.task}" [${qualityLabel}]. +$${bonus}. ${flavorMsg}`);

      // Carter Melancon: burnout risk after 4+ consecutive tasks
      if (j.profileName === "Carter Melancon" && meta.tasksCompleted >= 4 && Math.random() < 0.35) {
        meta.burnedOut = true;
        meta.burnoutUntil = now() + 1000 * 60 * 60 * randInt(24, 72);
        log("Carter Melancon is burned out. He needs a few days before he's back. Someone check on him.");
      }

      // Walter Carpenter: hint quality is degrading
      if (j.profileName === "Walter Carpenter" && meta.tasksCompleted >= 3 && quality < 0.6) {
        log("Walter seems distracted lately. His work quality is slipping. Consider giving him a break.");
      }
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

  // If resolved, rival is gone — skip all rival logic
  if (state.rival.resolved) return;

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

  // Trigger pitch-off resolution: when total score is high enough (rivalry has matured)
  // and it hasn't been triggered yet
  const minScoreThreshold = 5000; // Both sides have been competing for a while
  if (!state.rival.pitchOffTriggered && total > minScoreThreshold) {
    // ~2% chance per tick once threshold is met (checks every second → triggers within a few hours)
    if (Math.random() < 0.02) {
      triggerPitchOff();
    }
  }
}

// --- Rival Resolution: Client Pitch-Off (CYOA) ---

// The pitch-off is a 4-stage choose-your-own-adventure event.
// Each choice affects an internal "edge" score. At the end,
// edge > 0 = player wins, edge <= 0 = rival wins.
// Momentum gives starting advantage/disadvantage.

function triggerPitchOff() {
  if (!state.rival.active || state.rival.pitchOffTriggered) return;
  state.rival.pitchOffTriggered = true;

  const rivalName = state.rival.name;
  const rivalFirst = rivalName.split(" ")[0];

  // Starting edge from momentum: player advantage if momentum > 0
  let edge = Math.round(state.rival.momentum / 25); // -4 to +4

  // Stage tracking
  let stage = 0;

  const stages = [
    // STAGE 1: The Setup — how do you prepare?
    {
      intro: `The managing partner announces: a major client, Meridian Capital, is considering the firm for a hostile takeover defense. Both you and ${rivalName} have been asked to pitch.\n\nThis is it. Winner gets the client — and the inside track to Counsel.`,
      question: "How do you prepare for the pitch?",
      options: [
        {
          label: "Deep research — pull all-nighters studying Meridian's filings",
          effect: () => {
            edge += 2;
            state.stats.sleep = clamp(state.stats.sleep - 12, 0, 100);
            state.stats.stress = clamp(state.stats.stress + 6, 0, 100);
            return `You spent 72 hours buried in SEC filings and proxy statements. You know Meridian's cap table better than their own CFO. Sleep is gone, but you're armed.`;
          }
        },
        {
          label: "Network — call in favors from contacts at Meridian",
          effect: () => {
            const bonus = state.store.leatherBriefcase ? 2 : 1;
            edge += bonus;
            state.stats.stress = clamp(state.stats.stress + 3, 0, 100);
            return `You worked the phones. A college friend at Meridian's advisory firm tipped you off about their real concerns — the board is split.${bonus > 1 ? " (The briefcase opened doors.)" : ""}`;
          }
        },
        {
          label: "Wing it — you know this area cold",
          effect: () => {
            if (state.reputation.corp > 150 || state.reputation.lit > 150) {
              edge += 1;
              return "Your reputation precedes you. Sometimes confidence is preparation enough. The partners notice your composure.";
            } else {
              edge -= 1;
              return `You walk in cool, but ${rivalFirst} clearly did the homework. The partners exchange a glance. Not ideal.`;
            }
          }
        }
      ]
    },

    // STAGE 2: The Opening — how do you start the pitch?
    {
      intro: `You and ${rivalName} are in the main conference room. Meridian's General Counsel, two board members, and three firm partners are seated. ${rivalFirst} goes first — a slick deck about market positioning. Competent, but generic.\n\nYour turn.`,
      question: "How do you open your pitch?",
      options: [
        {
          label: "Lead with the board split — show you've done insider-level research",
          effect: () => {
            edge += 2;
            state.stats.stress = clamp(state.stats.stress + 4, 0, 100);
            return `You opened by naming the two dissenting board members and outlining their objections. The GC leaned forward. ${rivalFirst}'s jaw tightened. You have their attention.`;
          }
        },
        {
          label: "Tell a story — open with a past deal you saved from collapse",
          effect: () => {
            const bonus = state.perks.goldenVoice ? 2 : 1;
            edge += bonus;
            return `You told the story of a hostile defense that everyone thought was lost — and how you found the poison pill that saved it. The room was quiet. ${bonus > 1 ? "Your golden voice carried every word." : "It landed."}`;
          }
        },
        {
          label: "Go aggressive — directly challenge the rival's approach",
          effect: () => {
            if (Math.random() < 0.5) {
              edge += 2;
              return `You pointed out three gaps in ${rivalFirst}'s analysis. Publicly. In front of the client. Ruthless — but the partners looked impressed. ${rivalFirst} is rattled.`;
            } else {
              edge -= 1;
              state.stats.stress = clamp(state.stats.stress + 6, 0, 100);
              return `You went after ${rivalFirst}'s pitch, but it came off as petty. The GC frowned. One of the partners shook their head slightly. Overplayed.`;
            }
          }
        }
      ]
    },

    // STAGE 3: The Curveball — the client throws a hard question
    {
      intro: `Meridian's GC interrupts: "Let's cut to it. We've had three firms pitch this week. What happens if the acquirer launches a tender offer at $47 — above our current trading price? Our shareholders will be tempted. Walk me through your defense, step by step."`,
      question: "How do you respond?",
      options: [
        {
          label: "Lay out a detailed three-phase defense strategy",
          effect: () => {
            edge += 2;
            state.stats.stress = clamp(state.stats.stress + 2, 0, 100);
            return "You walked through it: Phase 1, shareholder rights plan. Phase 2, white knight solicitation. Phase 3, litigation to challenge the tender. Timeline, cost estimates, everything. The GC nodded slowly. That's what they needed to hear.";
          }
        },
        {
          label: "Redirect — focus on why the $47 offer undervalues the company",
          effect: () => {
            edge += 1;
            return `Smart reframe. You pulled up their five-year revenue projections and argued the intrinsic value is north of $60. The board members perked up. ${rivalFirst} scrambled to add something — too late.`;
          }
        },
        {
          label: "Admit uncertainty — 'It depends, and here's why that's actually good'",
          effect: () => {
            if (Math.random() < 0.4) {
              edge += 2;
              return "Radical honesty. You laid out three scenarios with different outcomes and explained your framework for adapting in real-time. The GC said, 'Finally, someone who doesn't pretend they know everything.' Home run.";
            } else {
              edge -= 1;
              return `The GC wanted confidence, not caveats. ${rivalFirst} jumped in with a crisp answer. You lost the room for a moment.`;
            }
          }
        }
      ]
    },

    // STAGE 4: The Close — how do you seal it?
    {
      intro: `The pitch is winding down. Both sides have made their case. The GC leans back and says, "We'll decide by end of week." As everyone stands to leave, you have one last moment.`,
      question: "How do you close?",
      options: [
        {
          label: "Confident handshake — 'We're ready to start Monday if you are'",
          effect: () => {
            edge += 1;
            return "You looked the GC in the eye, firm handshake, and said it like you already won. Confident without arrogance. The GC smiled. 'I like that.'";
          }
        },
        {
          label: "Personal touch — mention something specific about their company culture",
          effect: () => {
            edge += 2;
            return "You mentioned their employee retention program — something you noticed in their proxy filing. 'That's worth defending.' The GC paused. 'Nobody else mentioned that.' Sometimes the human angle wins.";
          }
        },
        {
          label: "Leave behind a one-page strategy brief — let the work speak",
          effect: () => {
            edge += 1;
            state.stats.stress = clamp(state.stats.stress + 2, 0, 100);
            return `You slid a single page across the table: "MERIDIAN DEFENSE — 90-DAY ROADMAP." Clean. Professional. ${rivalFirst} had nothing to leave behind. The GC picked it up immediately.`;
          }
        }
      ]
    }
  ];

  // Run the CYOA sequence
  function runStage() {
    if (stage >= stages.length) {
      // Resolution
      resolvePitchOff(edge);
      return;
    }

    const s = stages[stage];
    const introText = stage === 0 ? s.intro : s.intro;

    // Build the confirm-dialog sequence for this stage
    // We use a series of confirms since the game uses confirm() for events
    const header = `--- CLIENT PITCH-OFF: Round ${stage + 1} of ${stages.length} ---\n\n${introText}\n\n${s.question}\n\n`;
    let choiceText = "";
    for (let i = 0; i < s.options.length; i++) {
      choiceText += `${i + 1}. ${s.options[i].label}\n`;
    }

    // Use a prompt() to get the player's choice (1, 2, or 3)
    const input = prompt(
      header + choiceText + "\nEnter 1, 2, or 3:",
      "1"
    );

    let choiceIdx = parseInt(input, 10) - 1;
    if (isNaN(choiceIdx) || choiceIdx < 0 || choiceIdx >= s.options.length) {
      choiceIdx = 0; // Default to first option if invalid
    }

    const result = s.options[choiceIdx].effect();
    log(result);

    stage++;

    // Small delay before next stage for dramatic pacing
    setTimeout(runStage, 800);
  }

  log(`--- CLIENT PITCH-OFF: ${lawyerName()} vs. ${rivalName} ---`);
  log("Meridian Capital needs a hostile takeover defense team. The firm is running a bake-off.");

  // Kick off after a brief pause
  setTimeout(runStage, 600);
}

function resolvePitchOff(edge) {
  const rivalName = state.rival.name;
  const rivalFirst = rivalName.split(" ")[0];

  if (edge > 0) {
    // Player wins
    state.rival.resolved = true;
    state.rival.resolvedAt = now();
    state.rival.active = false;

    const moneyBonus = randInt(400, 800);
    const repBonus = randInt(20, 40);
    state.money += moneyBonus;
    state.reputation.corp += repBonus;
    state.reputation.lit += Math.round(repBonus * 0.5);
    state.stats.stress = clamp(state.stats.stress - 15, 0, 100);

    log(`Meridian Capital chose YOU. The conference room erupted (internally — lawyers don't show emotion).`);
    log(`+$${moneyBonus} signing bonus. +${repBonus} corp rep. +${Math.round(repBonus * 0.5)} lit rep.`);
    log(`${rivalName} cleaned out their office a week later. Word is they left to do… y'know… plaintiff-side work.`);
    log(`The path to Counsel is wide open.`);
  } else {
    // Rival wins — reset the arc
    state.rival.pitchOffTriggered = false;
    state.rival.score = 0;
    state.rival.playerScore = 0;
    state.rival.momentum = 0;

    state.stats.stress = clamp(state.stats.stress + 15, 0, 100);
    state.reputation.corp = clamp(state.reputation.corp - 10, 0, 9999);

    log(`Meridian Capital chose ${rivalName}. The conference room felt very small.`);
    log(`-10 corp rep. Stress up. ${rivalFirst} sent you a "commiserations" email. You didn't read it.`);
    log(`The rivalry resets. There will be other clients — other chances.`);
  }

  renderAll();
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

  // Preserve achievements and minigame stats across breakaways
  const savedAchievements = state.achievements ? [...state.achievements] : [];
  const savedMinigameStats = state.minigameBoost
    ? { gamesPlayed: state.minigameBoost.gamesPlayed, gamesWon: state.minigameBoost.gamesWon }
    : { gamesPlayed: 0, gamesWon: 0 };

  // Reset to fresh state
  const fresh = defaultState();
  fresh.breakaway = breakawayData;
  fresh.achievements = savedAchievements;
  fresh.minigameBoost.gamesPlayed = savedMinigameStats.gamesPlayed;
  fresh.minigameBoost.gamesWon = savedMinigameStats.gamesWon;
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

// ---------- Holidays ----------

function holidayKey(id) {
  return id + "_" + new Date().getFullYear();
}

function holidayFired(id) {
  if (!state.holidaysTriggered) state.holidaysTriggered = [];
  return state.holidaysTriggered.includes(holidayKey(id));
}

function fireHoliday(id) {
  if (!state.holidaysTriggered) state.holidaysTriggered = [];
  state.holidaysTriggered.push(holidayKey(id));
}

function tickHolidays() {
  const t = now();
  const d = new Date(t);
  const year = d.getFullYear();
  const month = d.getMonth(); // 0-indexed
  const day = d.getDate();

  // Valentine's Day — Feb 14
  if (month === 1 && day === 14 && !holidayFired("valentines")) {
    fireHoliday("valentines");
    if (state.divorced) {
      log(`Happy Valentine's Day. The only thing you hate more than your ex-${pn("wife", "husband")} is billing hours.`);
    } else {
      log(`Happy Valentine's Day. The only thing you love more than your ${pn("wife", "husband")} is talking about contracts.`);
    }
    state.stats.stress = clamp(state.stats.stress + (state.divorced ? 6 : 3), 0, 100);
  }

  // Easter — variable Sunday
  const easter = easterSunday(year);
  if (isSameDay(t, easter) && !holidayFired("easter")) {
    fireHoliday("easter");
    log("Happy Easter. Just another Sunday.");
  }

  // Cinco de Mayo — May 5
  if (month === 4 && day === 5 && !holidayFired("cincodemayo")) {
    fireHoliday("cincodemayo");
    log("Feliz Cinco de Mayo! The taqueria down the block is doing two-for-one. All takeout today is Mexican.");
    state.stats.stress = clamp(state.stats.stress - 3, 0, 100);
  }

  // Independence Day — July 4
  if (month === 6 && day === 4 && !holidayFired("july4")) {
    fireHoliday("july4");
    log("Happy 4th of July! It's a great day for freedom. Well, not for you…");
    state.stats.stress = clamp(state.stats.stress + 4, 0, 100);
  }

  // Labor Day — First Monday of September
  const labor = laborDay(year);
  if (isSameDay(t, labor) && !holidayFired("laborday")) {
    fireHoliday("laborday");
    log("Happy Labor Day. Thank God for the unions who fight for the workers — they give you more work to bill…");
    state.stats.stress = clamp(state.stats.stress + 2, 0, 100);
  }

  // Halloween — Oct 31
  if (month === 9 && day === 31 && !holidayFired("halloween")) {
    fireHoliday("halloween");
    log("Happy Halloween. You thought that motion to dismiss on your desk was a pink slip. Scariest thing you've seen all season…");
    state.stats.stress = clamp(state.stats.stress + 8, 0, 100);
  }

  // Thanksgiving — 4th Thursday of November
  const tg = thanksgivingDay(year);
  if (isSameDay(t, tg) && !holidayFired("thanksgiving")) {
    fireHoliday("thanksgiving");
    log("Happy Thanksgiving. Be grateful today — who else but the firm would let you work today?");
    state.stats.hunger = clamp(state.stats.hunger + 15, 0, 100);
    state.stats.stress = clamp(state.stats.stress - 5, 0, 100);
  }

  // Christmas Day — Dec 25
  if (month === 11 && day === 25 && !holidayFired("christmas")) {
    fireHoliday("christmas");
    log("Merry Christmas. You and the other associates are getting stuck in the snow… of some sort…");
    state.stats.stress = clamp(state.stats.stress - 4, 0, 100);
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

  // Store items
  if (state.store.designerWatch) mult *= 1.05;

  // Burnout: massive productivity penalty
  if (state.burnout && state.burnoutUntil > now()) mult *= 0.35;

  // Minigame boost: +20% when active
  if (state.minigameBoost) {
    if (state.minigameBoost.litBoostUntil > now()) mult *= 1.20;
    if (state.minigameBoost.corpBoostUntil > now()) mult *= 1.20;
    if (state.minigameBoost.regBoostUntil > now()) mult *= 1.20;
  }

  // Energy drink consumable boost
  if (state._energyDrinkUntil && state._energyDrinkUntil > now()) mult *= 1.10;

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
  if (state.store.cornerOfficeArt) stressRise *= 0.90;
  if (state.store.golfClubs) stressRise *= 0.85;
  if (state.lawyer.outfit.casualFridays && isFriday(now())) stressRise *= 0.9;

  // Divorced: +40% passive stress rise
  if (state.divorced) stressRise *= 1.4;

  state.stats.stress = clamp(state.stats.stress + stressRise, 0, 100);

  const prod = productivityMultiplier();

  for (const a of state.queue) {
    if (a.progress >= 1) continue;

    const workHoursThisTick = prod * dtHours;
    const billableGainMult = (state.perks.masterBiller ? 1.12 : 1.0) * (state.store.monogrammedPen ? 1.08 : 1.0) * state.breakaway.multiplier;

    const remainingBillables = a.billableHours - a.billablesEarned;
    const billablesToAdd = Math.min(remainingBillables, workHoursThisTick * billableGainMult);

    a.billablesEarned += billablesToAdd;
    state.billables += billablesToAdd;

    a.progress = clamp(a.billablesEarned / a.billableHours, 0, 1);

    if (now() > a.deadlineAt && a.progress < 1 && !a._missed) {
      a._missed = true;
      state.missedDeadlines += 1;
      state.pipStrikes += 1;
      if (!state.pipStrikeTimestamps) state.pipStrikeTimestamps = [];
      state.pipStrikeTimestamps.push(now());
      state.onTimeCompletions = 0; // Reset on-time streak
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
      if (state.store.leatherBriefcase) repGain = Math.round(repGain * 1.15);
      repGain = Math.round(repGain * state.breakaway.multiplier);

      if (a.kind === "lit") state.reputation.lit += repGain;
      if (a.kind === "corp") state.reputation.corp += repGain;
      if (a.kind === "reg") state.reputation.reg += repGain;
      if (a.kind === "probono") state.reputation.reg += 2;

      // Track perk progress
      if (state.stats.sleep < 30) state.perkProgress.nightOwlTasks += 1;
      if (a.kind === "lit") state.perkProgress.litTasksCompleted += 1;
      // masterBiller tracks via state.billables (already incremented above)
      checkPerkUnlocks();

      // PIP recovery: on-time completions work off strikes
      if (!a._missed && a.kind !== "probono") {
        state.onTimeCompletions = (state.onTimeCompletions || 0) + 1;
        if (state.pipStrikes > 0 && state.onTimeCompletions >= 5) {
          state.pipStrikes = Math.max(0, state.pipStrikes - 1);
          state.onTimeCompletions = 0;
          if (state.pipStrikeTimestamps && state.pipStrikeTimestamps.length > 0) {
            state.pipStrikeTimestamps.shift(); // Remove oldest strike
          }
          log("Consistent performance noted. One PIP strike removed. Keep it up.");
        }
      }

      log(`Completed: ${a.title}. +$${earnedPoints}, +rep.`);

      // ~30% chance to trigger a minigame on lit, corp, or reg completion
      if ((a.kind === "lit" || a.kind === "corp" || a.kind === "reg") && Math.random() < 0.30 && !minigameActive) {
        pendingMinigame = a.kind;
      }
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

  // Holiday flavor text
  tickHolidays();

  // Arc ticks
  tickJuniors(dtHours);
  tickRival(dtHours);
  tickNpcs(dtHours);
  tickBitcoin(dtHours);

  if (state.pipStrikes >= 3) {
    state.dismissed = true;
    if (rankIndex() >= 1 && state.divorced) {
      // Secret ending: fired post-divorce — empty house
      log("Dismissed. The firm has decided you are not 'a good fit.'");
      setTimeout(() => showDivorceEnding(), 600);
    } else if (rankIndex() >= 1) {
      // Secret ending: fired beyond first year — go home to family
      log("Dismissed. The firm has decided you are not 'a good fit.'");
      setTimeout(() => showFamilyEnding(), 600);
    } else {
      log("Dismissed. The firm has decided you are not 'a good fit.' (Run ended.)");
    }
  }

  const critical =
    (state.stats.hunger < 8) ||
    (state.stats.caffeine < 8) ||
    (state.stats.sleep < 8) ||
    (state.stats.stress > 95);

  if (critical && Math.random() < 0.002 * dtMs) {
    state.pipStrikes += 1;
    if (!state.pipStrikeTimestamps) state.pipStrikeTimestamps = [];
    state.pipStrikeTimestamps.push(now());
    state.onTimeCompletions = 0;
    log("Critical condition persisted. HR is 'circling back' (PIP strike).");
  }

  // PIP auto-decay: strikes expire after 3 months (90 days)
  if (state.pipStrikes > 0 && state.pipStrikeTimestamps && state.pipStrikeTimestamps.length > 0) {
    const THREE_MONTHS_MS = 1000 * 60 * 60 * 24 * 90;
    const expiredCount = state.pipStrikeTimestamps.filter(ts => now() - ts >= THREE_MONTHS_MS).length;
    if (expiredCount > 0) {
      state.pipStrikeTimestamps = state.pipStrikeTimestamps.filter(ts => now() - ts < THREE_MONTHS_MS);
      state.pipStrikes = Math.max(0, state.pipStrikes - expiredCount);
      log(`${expiredCount} PIP strike${expiredCount > 1 ? "s" : ""} expired. Time heals… some things.`);
    }
  }

  checkAchievements();
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
  const onTime = state.onTimeCompletions || 0;
  const pipLabel = state.pipStrikes > 0 && onTime > 0
    ? `${state.pipStrikes} (${onTime}/5 toward recovery)`
    : state.pipStrikes.toString();
  $("pip").textContent = pipLabel;

  const prod = productivityMultiplier();
  const boostActive = state.minigameBoost && (state.minigameBoost.litBoostUntil > now() || state.minigameBoost.corpBoostUntil > now() || state.minigameBoost.regBoostUntil > now());
  let prodLabel = state.breakaway.multiplier > 1
    ? `${Math.round(prod * 100)}% (${state.breakaway.multiplier.toFixed(2)}x prestige)`
    : `${Math.round(prod * 100)}%`;
  if (boostActive) prodLabel += " [BOOSTED]";
  $("prod").textContent = prodLabel;

  $("rep-lit").textContent = Math.floor(state.reputation.lit);
  $("rep-corp").textContent = Math.floor(state.reputation.corp);
  $("rep-reg").textContent = Math.floor(state.reputation.reg);

  const rankSuffix = state.dismissed ? " — DISMISSED" : (state.breakaway.count > 0 ? ` (Run #${state.breakaway.count + 1})` : "");
  const nameLabel = state.lawyer.name ? `${state.lawyer.name} — ` : "";
  $("rank").textContent = `${nameLabel}${rankName()}${rankSuffix}`;
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
    const repCost = 2 + rankIndex();
    card.innerHTML = `
      <div class="top">
        <div>
          <div class="name">${o.title}</div>
          <div class="meta">${o.kind.toUpperCase()} • Deadline: ${dl}</div>
        </div>
        <div style="display:flex;gap:6px;">
          <button data-accept="${o.id}">Accept</button>
          <button class="btn-decline" data-decline="${o.id}" title="Decline (-${repCost} ${o.kind} rep)">Decline</button>
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
  wrap.querySelectorAll("[data-decline]").forEach(btn => {
    btn.addEventListener("click", () => {
      declineOffer(btn.getAttribute("data-decline"));
      renderOffers();
    });
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

  // lawyer sprite (gender-aware)
  const s = state.stats;
  const slump = (s.sleep < 25 || s.stress > 85) ? 6 : 0;
  const ax = 240, ay = 150 + slump;
  const female = isFemale();

  if (female) {
    // --- Female sprite ---
    // Blazer (slightly tapered)
    px(ax + 2, ay, 56, 58, "#1f2740");
    px(ax + 8, ay + 10, 10, 33, "#2a3554");   // left lapel
    px(ax + 42, ay + 10, 10, 33, "#2a3554");  // right lapel
    px(ax + 26, ay + 12, 8, 38, "#d9dbe6");   // blouse

    // Tie / necklace
    if (state.lawyer.outfit.tie) {
      px(ax + 29, ay + 18, 2, 12, "#ff6fb3"); // pendant chain
      px(ax + 27, ay + 30, 6, 4, "#ff6fb3");  // pendant
    }

    // Skirt
    px(ax + 6, ay + 54, 48, 10, "#1f2740");
    px(ax + 10, ay + 64, 40, 4, "#1f2740");

    // Arms
    px(ax - 8, ay + 14, 10, 34, "#1f2740");
    px(ax + 58, ay + 14, 10, 34, "#1f2740");

    // Head
    const hx = ax + 18, hy = ay - 28;
    px(hx, hy, 24, 24, "#b9926a");

    // Longer hair (shoulder length, layered)
    px(hx - 3, hy - 2, 30, 8, "#5b3a29");     // top
    px(hx - 4, hy + 4, 4, 18, "#5b3a29");     // left side
    px(hx + 24, hy + 4, 4, 18, "#5b3a29");    // right side
    px(hx - 3, hy + 6, 3, 14, "#4a2e22");     // highlight left
    px(hx + 25, hy + 6, 3, 14, "#4a2e22");    // highlight right

    // Face
    px(hx + 6, hy + 10, 3, 3, "#1a1a1a");     // left eye
    px(hx + 15, hy + 10, 3, 3, "#1a1a1a");    // right eye
    px(hx + 9, hy + 18, 6, 1, "#1a1a1a");     // mouth

    // Earrings
    px(hx - 1, hy + 16, 2, 3, "#f2d98a");
    px(hx + 23, hy + 16, 2, 3, "#f2d98a");

    // Hat (if owned)
    if (state.lawyer.outfit.hat) {
      px(hx - 4, hy - 6, 32, 6, "#6fff9a");
      px(hx, hy - 10, 24, 4, "#6fff9a");
    }
  } else {
    // --- Male sprite ---
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
  }

  ctx.fillStyle = pal.text;
  ctx.font = "12px monospace";
  const mood = (s.stress > 80) ? "!!!" : (s.stress > 55 ? "..." : ":)");
  ctx.fillText(mood, ax + 74, ay - 8);

  ctx.fillStyle = "#a9b0bb";
  ctx.font = "10px monospace";
  ctx.fillText("BOOKS", shelfX + 16, shelfY + 12);
  ctx.fillText("DESK", 240, 202);

  // Nameplate on desk
  if (state.lawyer.name) {
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(340, 195, 50, 12);
    ctx.fillStyle = "#f2d98a";
    ctx.font = "7px monospace";
    ctx.textAlign = "center";
    ctx.fillText(state.lawyer.name.substring(0, 8).toUpperCase(), 365, 204);
    ctx.textAlign = "start";
  }
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

    const profile = JUNIOR_PROFILES.find(p => p.name === j.profileName);
    const tagLabel = profile ? profile.tag : "";
    const tagColor = profile ? profile.tagColor : "#6fb3ff";
    const profileDesc = profile ? profile.desc : "";
    const meta = getJuniorMeta(j.profileName);

    const statusTag = j.completed
      ? ' <span class="tag tag-done">Done</span>'
      : j.missed
        ? ' <span class="tag tag-missed">Missed</span>'
        : !j.assigned
          ? ' <span class="tag" style="background:#1a2a3a;color:#6fb3ff;border:1px solid #2b4a6a">Awaiting</span>'
          : "";

    const personalityTag = tagLabel
      ? ` <span class="tag" style="background:transparent;color:${tagColor};border:1px solid ${tagColor}">${tagLabel}</span>`
      : "";

    const qualityLabel = j._quality != null
      ? (j._quality >= 0.85 ? '<span style="color:#6fff9a">Excellent</span>'
        : j._quality >= 0.65 ? '<span style="color:#6fb3ff">Good</span>'
        : j._quality >= 0.45 ? '<span style="color:#f2d98a">Fair</span>'
        : '<span style="color:#ff6f6f">Rough</span>')
      : "";

    const xpLabel = meta.tasksCompleted > 0
      ? `<span style="color:var(--muted);font-size:10px">${meta.tasksCompleted} task${meta.tasksCompleted !== 1 ? "s" : ""} done</span>`
      : "";

    card.innerHTML = `
      <div class="junior-top">
        <div class="junior-name">${j.name}${personalityTag}${statusTag}</div>
        ${!j.assigned && !j.completed && !j.missed
          ? `<button class="btn-delegate" data-delegate="${j.id}">Delegate</button>`
          : !j.completed && !j.missed && j.assigned
            ? `<div style="color:var(--muted);font-size:11px">${pct}%</div>`
            : j.completed || j.missed
              ? `<button class="btn-clear" data-dismiss-junior="${j.id}">Clear</button>`
              : ""
        }
      </div>
      ${!j.assigned && !j.completed && !j.missed
        ? `<div class="junior-desc" style="color:var(--muted);font-size:10px;margin:2px 0 4px;line-height:1.3">${profileDesc}</div>`
        : ""
      }
      <div class="junior-task">${j.task} (${j.kind.toUpperCase()})${qualityLabel ? " — " + qualityLabel : ""}</div>
      <div class="junior-meta">
        <span>${j.billableHours}h • +$${j.points} bonus ${xpLabel}</span>
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

  // Show resolved state if player won the pitch-off
  if (rankIndex() === 2 && state.rival.resolved) {
    panel.style.display = "";
    $("rival-name-label").textContent = state.rival.name;
    $("rival-pscore").textContent = Math.floor(state.rival.playerScore);
    $("rival-rscore").textContent = "—";
    $("tug-fill").style.width = "100%";
    const status = $("rival-status");
    status.textContent = `${state.rival.name} left the firm. Plaintiff-side work, apparently. You won.`;
    status.style.color = "#6fff9a";
    return;
  }

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
  renderAchievements();
  renderBitcoin();
  renderJuniors();
  renderRival();
  renderBreakaway();
  renderNpcs();
  renderLog();
  drawScene();
}

// ---------- Minigames ----------

let minigameLoop = null;     // animation frame or interval ID
let minigameKeyHandler = null;

const mgCanvas = () => $("minigame-canvas");
const mgCtx = () => mgCanvas().getContext("2d");

function showMinigamePrompt(kind) {
  const overlay = $("minigame-overlay");
  const prompt = $("minigame-prompt");
  const result = $("minigame-result");
  const scoreEl = $("minigame-score");
  const controls = $("minigame-controls");

  overlay.style.display = "flex";
  prompt.style.display = "";
  result.style.display = "none";
  scoreEl.textContent = "";

  if (kind === "lit") {
    $("minigame-title").textContent = "Paper Blitz";
    $("minigame-prompt-text").innerHTML =
      "A litigation assignment is complete! Time to celebrate.<br>" +
      "Fire legal briefs at the descending jurors. Hit enough to earn a <strong style='color:#6fff9a'>+20% productivity boost</strong> for 6 hours.";
    controls.textContent = "Arrow keys to move, Space to fire";
  } else if (kind === "corp") {
    $("minigame-title").textContent = "Contract Crawler";
    $("minigame-prompt-text").innerHTML =
      "A corporate deal just closed! Time to collect the clauses.<br>" +
      "Guide the contract snake to gather deal terms. Collect enough for a <strong style='color:#6fff9a'>+20% productivity boost</strong> for 6 hours.";
    controls.textContent = "Arrow keys to change direction";
  } else {
    $("minigame-title").textContent = "Redaction Rush";
    $("minigame-prompt-text").innerHTML =
      "A regulatory filing is done! Time to redact the sensitive info.<br>" +
      "Move your cursor and redact classified terms — but leave public records alone. Redact enough for a <strong style='color:#6fff9a'>+20% productivity boost</strong> for 6 hours.";
    controls.textContent = "Arrow keys to move, Space to redact";
  }

  // Draw a preview frame on the minigame canvas
  const c = mgCtx();
  const W = mgCanvas().width, H = mgCanvas().height;
  c.fillStyle = "#0b0c10";
  c.fillRect(0, 0, W, H);
  c.fillStyle = "#252a36";
  c.font = "28px monospace";
  c.textAlign = "center";
  c.fillText(kind === "lit" ? "PAPER BLITZ" : "CONTRACT CRAWLER", W / 2, H / 2 - 10);
  c.font = "14px monospace";
  c.fillStyle = "#555";
  c.fillText("Press Play to start", W / 2, H / 2 + 20);
  c.textAlign = "start";

  $("btn-minigame-play").onclick = () => {
    prompt.style.display = "none";
    if (kind === "lit") startPaperBlitz();
    else if (kind === "corp") startContractCrawler();
    else startRedactionRush();
  };

  $("btn-minigame-skip").onclick = () => {
    overlay.style.display = "none";
    log("Skipped the minigame. Back to billing.");
  };
}

function endMinigame(won, kind) {
  minigameActive = false;
  if (minigameLoop) { clearInterval(minigameLoop); minigameLoop = null; }
  if (minigameKeyHandler) {
    document.removeEventListener("keydown", minigameKeyHandler);
    document.removeEventListener("keyup", minigameKeyHandler);
    minigameKeyHandler = null;
  }

  state.minigameBoost.gamesPlayed += 1;

  const result = $("minigame-result");
  const resultText = $("minigame-result-text");
  result.style.display = "";

  if (won) {
    state.minigameBoost.gamesWon += 1;
    const boostDuration = 1000 * 60 * 60 * 6; // 6 hours
    if (kind === "lit") {
      state.minigameBoost.litBoostUntil = now() + boostDuration;
    } else if (kind === "corp") {
      state.minigameBoost.corpBoostUntil = now() + boostDuration;
    } else {
      state.minigameBoost.regBoostUntil = now() + boostDuration;
    }
    const label = kind === "lit" ? "Litigation" : kind === "corp" ? "Corporate" : "Regulatory";
    resultText.innerHTML = `<span style="color:#6fff9a;font-weight:700">You won!</span><br>${label} productivity boosted +20% for 6 hours.`;
    log(`Minigame won! ${label} productivity boosted for 6 hours.`);
  } else {
    resultText.innerHTML = `<span style="color:#ff6f6f;font-weight:700">Time's up!</span><br>No boost this time. Better luck next round.`;
    log("Minigame lost. No boost earned.");
  }

  checkAchievements();

  $("btn-minigame-close").onclick = () => {
    $("minigame-overlay").style.display = "none";
  };
}

// ---- Paper Blitz (Galaga-like) ----

function startPaperBlitz() {
  minigameActive = true;
  const c = mgCtx();
  const W = mgCanvas().width, H = mgCanvas().height;

  const GAME_DURATION = 25000; // 25 seconds
  const TARGET_HITS = 12;
  const startTime = Date.now();

  // Player (lawyer at bottom)
  const player = { x: W / 2 - 16, y: H - 40, w: 32, h: 28, speed: 5 };
  const keys = { left: false, right: false, space: false };
  let spaceReleased = true;

  // Projectiles (papers fired upward)
  const papers = [];
  const PAPER_SPEED = 6;
  let lastShotAt = 0;
  const SHOT_COOLDOWN = 200;

  // Jurors descending
  const jurors = [];
  let jurorSpawnTimer = 0;
  const JUROR_SPEED_BASE = 1.0;
  let hits = 0;
  let missed = 0;

  const JUROR_LABELS = [
    "J1", "J2", "J3", "J4", "J5", "J6",
    "J7", "J8", "J9", "J10", "J11", "J12",
    "ALT"
  ];
  let labelIdx = 0;

  function spawnJurorWave() {
    const count = randInt(3, 6);
    const row_y = -20;
    const spacing = W / (count + 1);
    for (let i = 0; i < count; i++) {
      jurors.push({
        x: spacing * (i + 1) - 12,
        y: row_y - randInt(0, 20),
        w: 24, h: 24,
        speed: JUROR_SPEED_BASE + Math.random() * 0.6,
        label: JUROR_LABELS[labelIdx % JUROR_LABELS.length],
        alive: true,
        sway: Math.random() * Math.PI * 2, // phase offset for horizontal sway
        swayAmp: 0.3 + Math.random() * 0.5
      });
      labelIdx++;
    }
  }

  function update() {
    const elapsed = Date.now() - startTime;
    if (elapsed >= GAME_DURATION) {
      endMinigame(hits >= TARGET_HITS, "lit");
      return;
    }

    // Move player
    if (keys.left) player.x = Math.max(0, player.x - player.speed);
    if (keys.right) player.x = Math.min(W - player.w, player.x + player.speed);

    // Fire
    if (keys.space && spaceReleased && Date.now() - lastShotAt > SHOT_COOLDOWN) {
      papers.push({ x: player.x + player.w / 2 - 3, y: player.y - 6, w: 6, h: 10 });
      lastShotAt = Date.now();
      spaceReleased = false;
    }
    if (!keys.space) spaceReleased = true;

    // Move papers
    for (let i = papers.length - 1; i >= 0; i--) {
      papers[i].y -= PAPER_SPEED;
      if (papers[i].y < -10) papers.splice(i, 1);
    }

    // Spawn jurors in waves
    jurorSpawnTimer += 33;
    if (jurorSpawnTimer > 2200) {
      spawnJurorWave();
      jurorSpawnTimer = 0;
    }

    // Move jurors
    for (let i = jurors.length - 1; i >= 0; i--) {
      const j = jurors[i];
      if (!j.alive) { jurors.splice(i, 1); continue; }
      j.y += j.speed;
      j.sway += 0.04;
      j.x += Math.sin(j.sway) * j.swayAmp;
      if (j.y > H + 10) {
        missed++;
        jurors.splice(i, 1);
      }
    }

    // Collision: papers vs jurors
    for (let pi = papers.length - 1; pi >= 0; pi--) {
      const p = papers[pi];
      for (let ji = jurors.length - 1; ji >= 0; ji--) {
        const j = jurors[ji];
        if (!j.alive) continue;
        if (p.x < j.x + j.w && p.x + p.w > j.x && p.y < j.y + j.h && p.y + p.h > j.y) {
          j.alive = false;
          papers.splice(pi, 1);
          hits++;
          break;
        }
      }
    }

    // Draw
    c.fillStyle = "#0b0c10";
    c.fillRect(0, 0, W, H);

    // Timer bar at top
    const timeLeft = Math.max(0, GAME_DURATION - elapsed);
    const timePct = timeLeft / GAME_DURATION;
    c.fillStyle = "#1c2230";
    c.fillRect(0, 0, W, 6);
    c.fillStyle = timePct > 0.25 ? "#6fb3ff" : "#ff6f6f";
    c.fillRect(0, 0, W * timePct, 6);

    // Draw jurors
    for (const j of jurors) {
      if (!j.alive) continue;
      // Juror body
      c.fillStyle = "#2a3554";
      c.fillRect(j.x, j.y, j.w, j.h);
      // Juror head
      c.fillStyle = "#b9926a";
      c.fillRect(j.x + 6, j.y - 8, 12, 10);
      // Label
      c.fillStyle = "#ff6f6f";
      c.font = "9px monospace";
      c.textAlign = "center";
      c.fillText(j.label, j.x + j.w / 2, j.y + j.h - 4);
    }

    // Draw papers (projectiles)
    for (const p of papers) {
      c.fillStyle = "#d9dbe6";
      c.fillRect(p.x, p.y, p.w, p.h);
      c.fillStyle = "#6fb3ff";
      c.fillRect(p.x + 1, p.y + 2, p.w - 2, 1);
      c.fillRect(p.x + 1, p.y + 5, p.w - 2, 1);
    }

    // Draw player (lawyer)
    c.fillStyle = "#1f2740";
    c.fillRect(player.x, player.y, player.w, player.h);
    // Suit jacket
    c.fillStyle = "#2a3554";
    c.fillRect(player.x + 4, player.y + 4, 24, 20);
    // Head
    c.fillStyle = "#b9926a";
    c.fillRect(player.x + 8, player.y - 14, 16, 14);
    // Hair
    c.fillStyle = "#5b3a29";
    c.fillRect(player.x + 8, player.y - 14, 16, 4);
    // Tie
    c.fillStyle = "#ff6fb3";
    c.fillRect(player.x + 14, player.y + 4, 4, 12);

    c.textAlign = "start";

    // HUD
    $("minigame-score").textContent = `Hits: ${hits}/${TARGET_HITS} | ${Math.ceil(timeLeft / 1000)}s`;
  }

  // Initial wave
  spawnJurorWave();

  minigameKeyHandler = (e) => {
    if (e.key === "ArrowLeft" || e.key === "a") keys.left = (e.type === "keydown");
    if (e.key === "ArrowRight" || e.key === "d") keys.right = (e.type === "keydown");
    if (e.key === " ") { keys.space = (e.type === "keydown"); e.preventDefault(); }
  };
  document.addEventListener("keydown", minigameKeyHandler);
  document.addEventListener("keyup", minigameKeyHandler);

  $("minigame-controls").textContent = "Arrow keys / A,D to move | Space to fire";
  minigameLoop = setInterval(update, 33); // ~30fps
}

// ---- Contract Crawler (Snake-like) ----

function startContractCrawler() {
  minigameActive = true;
  const c = mgCtx();
  const CW = mgCanvas().width, CH = mgCanvas().height;

  const CELL = 14;
  const COLS = Math.floor(CW / CELL);
  const ROWS = Math.floor(CH / CELL);
  const TARGET_CLAUSES = 10;
  const GAME_DURATION = 30000; // 30 seconds

  const startTime = Date.now();
  let collected = 0;
  let gameOver = false;

  // Snake starts in the middle, heading right
  let snake = [
    { x: Math.floor(COLS / 2), y: Math.floor(ROWS / 2) },
    { x: Math.floor(COLS / 2) - 1, y: Math.floor(ROWS / 2) },
    { x: Math.floor(COLS / 2) - 2, y: Math.floor(ROWS / 2) }
  ];
  let dir = { x: 1, y: 0 };
  let nextDir = { x: 1, y: 0 };

  const CLAUSE_LABELS = [
    "NDA", "IP", "LIQ", "REP", "WAR",
    "IND", "GOV", "ARB", "COV", "TER",
    "AML", "ESC", "MAE", "FEE", "SPA"
  ];
  let clauseIdx = 0;

  // Food (deal clause)
  function spawnClause() {
    let x, y, attempts = 0;
    do {
      x = randInt(1, COLS - 2);
      y = randInt(1, ROWS - 2);
      attempts++;
    } while (snake.some(s => s.x === x && s.y === y) && attempts < 100);
    return { x, y, label: CLAUSE_LABELS[clauseIdx++ % CLAUSE_LABELS.length] };
  }

  let clause = spawnClause();

  function update() {
    if (gameOver) return;

    const elapsed = Date.now() - startTime;
    if (elapsed >= GAME_DURATION) {
      gameOver = true;
      endMinigame(collected >= TARGET_CLAUSES, "corp");
      return;
    }

    // Apply buffered direction change
    dir = { ...nextDir };

    // Move snake
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

    // Wall collision (wrap around)
    if (head.x < 0) head.x = COLS - 1;
    if (head.x >= COLS) head.x = 0;
    if (head.y < 0) head.y = ROWS - 1;
    if (head.y >= ROWS) head.y = 0;

    // Self collision
    if (snake.some(s => s.x === head.x && s.y === head.y)) {
      gameOver = true;
      endMinigame(collected >= TARGET_CLAUSES, "corp");
      return;
    }

    snake.unshift(head);

    // Eat clause
    if (head.x === clause.x && head.y === clause.y) {
      collected++;
      if (collected >= TARGET_CLAUSES) {
        gameOver = true;
        endMinigame(true, "corp");
        return;
      }
      clause = spawnClause();
      // Don't remove tail (snake grows)
    } else {
      snake.pop();
    }

    // Draw
    c.fillStyle = "#0b0c10";
    c.fillRect(0, 0, CW, CH);

    // Timer bar
    const timeLeft = Math.max(0, GAME_DURATION - elapsed);
    const timePct = timeLeft / GAME_DURATION;
    c.fillStyle = "#1c2230";
    c.fillRect(0, 0, CW, 4);
    c.fillStyle = timePct > 0.25 ? "#6fb3ff" : "#ff6f6f";
    c.fillRect(0, 0, CW * timePct, 4);

    // Draw grid lines (subtle)
    c.strokeStyle = "#151820";
    c.lineWidth = 0.5;
    for (let x = 0; x <= COLS; x++) {
      c.beginPath(); c.moveTo(x * CELL, 0); c.lineTo(x * CELL, CH); c.stroke();
    }
    for (let y = 0; y <= ROWS; y++) {
      c.beginPath(); c.moveTo(0, y * CELL); c.lineTo(CW, y * CELL); c.stroke();
    }

    // Draw snake
    for (let i = 0; i < snake.length; i++) {
      const seg = snake[i];
      const isHead = i === 0;
      c.fillStyle = isHead ? "#6fff9a" : (i % 2 === 0 ? "#2b7a44" : "#1a5a30");
      c.fillRect(seg.x * CELL + 1, seg.y * CELL + 1, CELL - 2, CELL - 2);
      if (isHead) {
        // Eyes on the head
        c.fillStyle = "#0b0c10";
        const ex = seg.x * CELL + (dir.x === 1 ? CELL - 5 : dir.x === -1 ? 3 : 4);
        const ey = seg.y * CELL + (dir.y === 1 ? CELL - 5 : dir.y === -1 ? 3 : 4);
        c.fillRect(ex, ey, 2, 2);
        c.fillRect(ex + (dir.y !== 0 ? 5 : 0), ey + (dir.x !== 0 ? 5 : 0), 2, 2);
      }
    }

    // Draw clause (food)
    c.fillStyle = "#f2d98a";
    c.fillRect(clause.x * CELL, clause.y * CELL, CELL, CELL);
    c.fillStyle = "#0b0c10";
    c.font = "7px monospace";
    c.textAlign = "center";
    c.fillText(clause.label, clause.x * CELL + CELL / 2, clause.y * CELL + CELL - 3);
    c.textAlign = "start";

    // HUD
    $("minigame-score").textContent = `Clauses: ${collected}/${TARGET_CLAUSES} | ${Math.ceil(timeLeft / 1000)}s`;
  }

  minigameKeyHandler = (e) => {
    // Buffer direction changes to prevent 180 turns
    if ((e.key === "ArrowUp" || e.key === "w") && dir.y === 0) { nextDir = { x: 0, y: -1 }; e.preventDefault(); }
    if ((e.key === "ArrowDown" || e.key === "s") && dir.y === 0) { nextDir = { x: 0, y: 1 }; e.preventDefault(); }
    if ((e.key === "ArrowLeft" || e.key === "a") && dir.x === 0) { nextDir = { x: -1, y: 0 }; e.preventDefault(); }
    if ((e.key === "ArrowRight" || e.key === "d") && dir.x === 0) { nextDir = { x: 1, y: 0 }; e.preventDefault(); }
  };
  document.addEventListener("keydown", minigameKeyHandler);

  $("minigame-controls").textContent = "Arrow keys / WASD to steer";
  minigameLoop = setInterval(update, 140); // Snake speed: ~7 moves/sec
}

// ---- Redaction Rush (Grid-based redaction game) ----

function startRedactionRush() {
  minigameActive = true;
  const c = mgCtx();
  const CW = mgCanvas().width, CH = mgCanvas().height;

  const GAME_DURATION = 25000; // 25 seconds
  const TARGET_REDACTIONS = 12;
  const startTime = Date.now();

  const COLS = 5, ROWS = 4;
  const CELL_W = Math.floor(CW / COLS);
  const CELL_H = Math.floor((CH - 20) / ROWS); // Reserve top 20px for timer bar
  const Y_OFFSET = 20;

  const SENSITIVE_LABELS = [
    "SSN", "$AMT", "CLIENT", "ADDR", "DOB",
    "ACCT#", "SALARY", "INSIDER", "NDA-BRK", "PRIV",
    "TAX ID", "WIRE#", "PII", "SEALED", "SECRET"
  ];
  const SAFE_LABELS = [
    "WHEREAS", "HEREBY", "PURSUANT", "PARTY A", "SECTION",
    "CLAUSE", "THEREOF", "AGREED", "DATED", "FILED",
    "EXHIBIT", "RECITAL", "TERM", "NOTICE", "AMEND"
  ];

  let cursorX = 0, cursorY = 0;
  let correctRedactions = 0;
  let wrongRedactions = 0;
  let gameOver = false;

  // Build grid of words
  let grid = [];
  function fillGrid() {
    grid = [];
    for (let r = 0; r < ROWS; r++) {
      const row = [];
      for (let col = 0; col < COLS; col++) {
        const isSensitive = Math.random() < 0.45; // ~45% sensitive
        row.push({
          label: isSensitive
            ? SENSITIVE_LABELS[Math.floor(Math.random() * SENSITIVE_LABELS.length)]
            : SAFE_LABELS[Math.floor(Math.random() * SAFE_LABELS.length)],
          sensitive: isSensitive,
          redacted: false,
          flashUntil: 0 // flash feedback timer
        });
      }
      row.push(); // noop, just for clarity
      grid.push(row);
    }
  }

  function replaceCell(r, col) {
    const isSensitive = Math.random() < 0.45;
    grid[r][col] = {
      label: isSensitive
        ? SENSITIVE_LABELS[Math.floor(Math.random() * SENSITIVE_LABELS.length)]
        : SAFE_LABELS[Math.floor(Math.random() * SAFE_LABELS.length)],
      sensitive: isSensitive,
      redacted: false,
      flashUntil: 0
    };
  }

  fillGrid();

  function redactCurrent() {
    const cell = grid[cursorY][cursorX];
    if (cell.redacted) return;
    cell.redacted = true;
    if (cell.sensitive) {
      correctRedactions++;
      cell.flashUntil = Date.now() + 300;
      if (correctRedactions >= TARGET_REDACTIONS) {
        gameOver = true;
        endMinigame(true, "reg");
        return;
      }
    } else {
      wrongRedactions++;
      correctRedactions = Math.max(0, correctRedactions - 1); // Penalty
      cell.flashUntil = Date.now() + 300;
    }
    // Replace redacted cell after a short delay
    setTimeout(() => {
      if (!gameOver) replaceCell(cursorY, cursorX);
    }, 400);
  }

  function update() {
    if (gameOver) return;

    const elapsed = Date.now() - startTime;
    if (elapsed >= GAME_DURATION) {
      gameOver = true;
      endMinigame(correctRedactions >= TARGET_REDACTIONS, "reg");
      return;
    }

    // Draw background
    c.fillStyle = "#0b0c10";
    c.fillRect(0, 0, CW, CH);

    // Timer bar
    const timeLeft = Math.max(0, GAME_DURATION - elapsed);
    const timePct = timeLeft / GAME_DURATION;
    c.fillStyle = "#1c2230";
    c.fillRect(0, 0, CW, 6);
    c.fillStyle = timePct > 0.25 ? "#6fb3ff" : "#ff6f6f";
    c.fillRect(0, 0, CW * timePct, 6);

    // Draw "document" header
    c.fillStyle = "#252a36";
    c.fillRect(0, 8, CW, 10);
    c.fillStyle = "#555";
    c.font = "8px monospace";
    c.textAlign = "center";
    c.fillText("CONFIDENTIAL — REGULATORY FILING — REDACT SENSITIVE TERMS", CW / 2, 16);

    // Draw grid cells
    for (let r = 0; r < ROWS; r++) {
      for (let col = 0; col < COLS; col++) {
        const cell = grid[r][col];
        const x = col * CELL_W + 2;
        const y = r * CELL_H + Y_OFFSET + 2;
        const w = CELL_W - 4;
        const h = CELL_H - 4;
        const isSelected = (col === cursorX && r === cursorY);
        const flashing = cell.flashUntil > Date.now();

        // Cell background
        if (cell.redacted) {
          // Redacted — show feedback
          if (flashing && cell.sensitive) {
            c.fillStyle = "#1a3a2a"; // green flash (correct)
          } else if (flashing && !cell.sensitive) {
            c.fillStyle = "#3a1a1a"; // red flash (wrong)
          } else {
            c.fillStyle = "#0a0a0a"; // blacked out
          }
        } else if (cell.sensitive) {
          c.fillStyle = isSelected ? "#3a1a1a" : "#1a1020"; // sensitive = reddish tint
        } else {
          c.fillStyle = isSelected ? "#1a2a3a" : "#10131a"; // safe = bluish tint
        }
        c.fillRect(x, y, w, h);

        // Border
        c.strokeStyle = isSelected ? "#f2d98a" : "#252a36";
        c.lineWidth = isSelected ? 2 : 1;
        c.strokeRect(x, y, w, h);

        // Label
        if (!cell.redacted) {
          // Color code: sensitive = red-ish, safe = dim blue
          c.fillStyle = cell.sensitive ? "#ff6f6f" : "#6fb3ff";
          c.font = "bold 11px monospace";
          c.textAlign = "center";
          c.fillText(cell.label, x + w / 2, y + h / 2 + 4);
        } else if (flashing) {
          c.fillStyle = cell.sensitive ? "#6fff9a" : "#ff6f6f";
          c.font = "bold 12px monospace";
          c.textAlign = "center";
          c.fillText(cell.sensitive ? "OK" : "X", x + w / 2, y + h / 2 + 4);
        } else {
          // Solid redaction bar
          c.fillStyle = "#1a1a1a";
          c.fillRect(x + 8, y + h / 2 - 3, w - 16, 6);
        }

        // Sensitivity marker (small dot)
        if (!cell.redacted) {
          c.fillStyle = cell.sensitive ? "#ff6f6f" : "#2a3554";
          c.fillRect(x + 4, y + 4, 4, 4);
        }
      }
    }

    // Legend
    c.font = "9px monospace";
    c.textAlign = "start";
    c.fillStyle = "#ff6f6f";
    c.fillRect(4, CH - 14, 6, 6);
    c.fillStyle = "#a9b0bb";
    c.fillText("Sensitive (redact)", 14, CH - 8);
    c.fillStyle = "#2a3554";
    c.fillRect(140, CH - 14, 6, 6);
    c.fillStyle = "#a9b0bb";
    c.fillText("Public (skip)", 150, CH - 8);
    c.textAlign = "start";

    // HUD
    $("minigame-score").textContent = `Redacted: ${correctRedactions}/${TARGET_REDACTIONS} | Errors: ${wrongRedactions} | ${Math.ceil(timeLeft / 1000)}s`;
  }

  minigameKeyHandler = (e) => {
    if (e.type !== "keydown") return;
    if (e.key === "ArrowLeft" || e.key === "a") { cursorX = Math.max(0, cursorX - 1); e.preventDefault(); }
    if (e.key === "ArrowRight" || e.key === "d") { cursorX = Math.min(COLS - 1, cursorX + 1); e.preventDefault(); }
    if (e.key === "ArrowUp" || e.key === "w") { cursorY = Math.max(0, cursorY - 1); e.preventDefault(); }
    if (e.key === "ArrowDown" || e.key === "s") { cursorY = Math.min(ROWS - 1, cursorY + 1); e.preventDefault(); }
    if (e.key === " ") { redactCurrent(); e.preventDefault(); }
  };
  document.addEventListener("keydown", minigameKeyHandler);

  $("minigame-controls").textContent = "Arrow keys / WASD to move cursor | Space to redact";
  minigameLoop = setInterval(update, 33); // ~30fps
}

// ---------- Secret Ending Cutscenes ----------

// Shared cutscene utilities
function openCutscene() {
  const overlay = $("cutscene-overlay");
  overlay.style.display = "flex";
  return {
    overlay,
    cvs: $("cutscene-canvas"),
    ctx: $("cutscene-canvas").getContext("2d"),
    W: $("cutscene-canvas").width,
    H: $("cutscene-canvas").height
  };
}

function closeCutscene() {
  $("cutscene-overlay").style.display = "none";
  $("cutscene-text").classList.remove("visible");
  $("btn-cutscene-close").classList.remove("visible");
  $("btn-cutscene-close").style.display = "none";
  $("cutscene-text").textContent = "";
}

function finishCutscene(drawFrame, text) {
  drawFrame();
  setTimeout(() => {
    const textEl = $("cutscene-text");
    textEl.textContent = text;
    textEl.classList.add("visible");
  }, 800);
  setTimeout(() => {
    const btn = $("btn-cutscene-close");
    btn.style.display = "";
    btn.classList.add("visible");
  }, 3500);
  $("btn-cutscene-close").onclick = closeCutscene;
}

// Shared drawing helpers (used by both endings)
function drawCutsceneSprite(px, x, y, isFemaleSprite, s) {
  s = s || 1;
  const p = (rx, ry, rw, rh, c) => px(x + rx * s, y + ry * s, rw * s, rh * s, c);

  if (isFemaleSprite) {
    p(2, 0, 26, 28, "#1f2740");
    p(6, 4, 6, 16, "#2a3554");
    p(18, 4, 6, 16, "#2a3554");
    p(12, 4, 6, 20, "#d9dbe6");
    p(4, 26, 22, 6, "#1f2740");
    p(-4, 6, 6, 16, "#1f2740");
    p(28, 6, 6, 16, "#1f2740");
    p(6, 32, 6, 10, "#b9926a");
    p(18, 32, 6, 10, "#b9926a");
    p(5, -16, 20, 16, "#b9926a");
    p(3, -18, 24, 6, "#5b3a29");
    p(1, -14, 4, 16, "#5b3a29");
    p(25, -14, 4, 16, "#5b3a29");
    p(2, -4, 2, 3, "#f2d98a");
    p(26, -4, 2, 3, "#f2d98a");
  } else {
    p(0, 0, 30, 30, "#1f2740");
    p(4, 4, 6, 18, "#2a3554");
    p(20, 4, 6, 18, "#2a3554");
    p(12, 4, 6, 22, "#d9dbe6");
    p(14, 8, 2, 16, "#2a3040");
    p(13, 8, 4, 3, "#2a3040");
    p(-6, 6, 6, 18, "#1f2740");
    p(30, 6, 6, 18, "#1f2740");
    p(6, 30, 7, 12, "#1a1a2a");
    p(17, 30, 7, 12, "#1a1a2a");
    p(5, -16, 20, 16, "#b9926a");
    p(5, -16, 20, 4, "#5b3a29");
  }
}

function drawCutsceneSmile(px, x, y, f, s) {
  s = s || 1;
  const p = (rx, ry, rw, rh, c) => px(x + rx * s, y + ry * s, rw * s, rh * s, c);
  p(9, -10, 3, 2, "#1a1a1a");
  p(18, -10, 3, 2, "#1a1a1a");
  p(11, -4, 8, 1, "#1a1a1a");
  p(10, -5, 2, 1, "#1a1a1a");
  p(19, -5, 2, 1, "#1a1a1a");
}

function drawCutsceneNeutral(px, x, y, f, s) {
  s = s || 1;
  const p = (rx, ry, rw, rh, c) => px(x + rx * s, y + ry * s, rw * s, rh * s, c);
  p(9, -10, 3, 2, "#1a1a1a");
  p(18, -10, 3, 2, "#1a1a1a");
  p(11, -4, 6, 1, "#1a1a1a");
}

function drawCutsceneSadFace(px, x, y, f, s) {
  s = s || 1;
  const p = (rx, ry, rw, rh, c) => px(x + rx * s, y + ry * s, rw * s, rh * s, c);
  p(9, -10, 3, 2, "#1a1a1a");
  p(18, -10, 3, 2, "#1a1a1a");
  // Frown (curved down)
  p(11, -3, 8, 1, "#1a1a1a");
  p(10, -3, 2, 1, "#1a1a1a");
  p(19, -3, 2, 1, "#1a1a1a");
  p(10, -4, 2, 1, "#1a1a1a");
  p(19, -4, 2, 1, "#1a1a1a");
}

function drawCutsceneChild(px, x, y, childIdx) {
  const s = 0.7;
  const p = (rx, ry, rw, rh, c) => px(x + rx * s, y + ry * s, rw * s, rh * s, c);
  p(2, 0, 18, 18, childIdx === 0 ? "#3a4a6a" : "#6a3a4a");
  p(-3, 4, 5, 10, childIdx === 0 ? "#3a4a6a" : "#6a3a4a");
  p(20, 4, 5, 10, childIdx === 0 ? "#3a4a6a" : "#6a3a4a");
  p(4, 18, 5, 8, "#1a1a2a");
  p(13, 18, 5, 8, "#1a1a2a");
  p(3, -12, 16, 12, "#c9a27a");
  p(3, -12, 16, 4, childIdx === 0 ? "#5b3a29" : "#8b5a39");
  p(6, -7, 2, 2, "#1a1a1a");
  p(13, -7, 2, 2, "#1a1a1a");
  p(8, -3, 6, 1, "#1a1a1a");
  p(7, -4, 2, 1, "#1a1a1a");
  p(14, -4, 2, 1, "#1a1a1a");
}

// --- Warm sky (family ending) ---
function drawWarmSky(px, W) {
  px(0, 0, W, 140, "#1a1030");
  px(0, 0, W, 50, "#0e0820");
  px(0, 50, W, 40, "#241838");
  px(0, 90, W, 50, "#3a2040");
  px(0, 130, W, 10, "#6a3838");
  px(0, 136, W, 4, "#c87050");
  const starSeed = 42;
  for (let i = 0; i < 30; i++) {
    const sx = ((starSeed * (i + 1) * 7) % W);
    const sy = ((starSeed * (i + 1) * 3) % 100);
    px(sx, sy, 2, 2, i % 3 === 0 ? "#f2d98a" : "#cfe1ff");
  }
}

// --- Cold sky (divorce ending) ---
function drawColdSky(px, W) {
  px(0, 0, W, 140, "#080a12");
  px(0, 0, W, 50, "#040610");
  px(0, 50, W, 40, "#0a0e1a");
  px(0, 90, W, 50, "#10142a");
  // No sunset glow — just a dull grey horizon
  px(0, 130, W, 10, "#1a1a22");
  px(0, 136, W, 4, "#252530");
  // Fewer, dimmer stars
  const starSeed = 42;
  for (let i = 0; i < 15; i++) {
    const sx = ((starSeed * (i + 1) * 7) % W);
    const sy = ((starSeed * (i + 1) * 3) % 100);
    px(sx, sy, 2, 2, "#555566");
  }
}

// --- House drawing (shared, but with warm/dark window option) ---
function drawCutsceneHouse(px, warm) {
  // Grass
  px(0, 220, 480, 80, warm ? "#1a3a1a" : "#101a10");
  px(0, 220, 480, 4, warm ? "#2b5a2a" : "#1a2a1a");
  // Sidewalk
  px(0, 250, 480, 8, "#3a3a3a");
  // House body
  px(300, 140, 140, 80, warm ? "#2a2040" : "#1a1828");
  // Roof
  for (let i = 0; i < 30; i++) {
    px(300 - i + 10, 140 - i, 140 + (i - 10) * 2 - 20, 2, warm ? "#4a2030" : "#2a1820");
  }
  // Door
  px(350, 180, 22, 40, warm ? "#5a3020" : "#2a1a10");
  px(368, 200, 3, 3, warm ? "#f2d98a" : "#555548");
  // Windows
  const winC = warm ? "#f2d98a" : "#1a1a22";
  const frameC = warm ? "#2a2040" : "#1a1828";
  px(312, 158, 24, 18, winC);
  px(312, 158, 24, 2, frameC);
  px(323, 158, 2, 18, frameC);
  px(400, 158, 24, 18, winC);
  px(400, 158, 24, 2, frameC);
  px(411, 158, 2, 18, frameC);
  // Porch light
  px(340, 172, 6, 6, warm ? "#f2d98a" : "#333338");
  px(340, 170, 6, 2, frameC);
}

// ==========================================
// ENDING 1: Family ending (fired, not divorced)
// ==========================================
function showFamilyEnding() {
  const { overlay, cvs, ctx, W, H } = openCutscene();
  const px = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  const female = isFemale();

  let lawyerX = -60;
  const lawyerTargetX = 160;
  const familyX = 260;
  let phase = "walk";
  let fadeAlpha = 0;
  let embraceTimer = 0;

  function drawFrame() {
    ctx.clearRect(0, 0, W, H);
    drawWarmSky(px, W);
    drawCutsceneHouse(px, true);

    // Spouse
    const spouseY = 200;
    drawCutsceneSprite(px, familyX, spouseY, !female, 1);
    drawCutsceneSmile(px, familyX, spouseY, !female, 1);

    // Kids
    drawCutsceneChild(px, familyX - 30, spouseY + 12, 0);
    drawCutsceneChild(px, familyX + 36, spouseY + 12, 1);

    // Lawyer
    const lawyerY = 200;
    drawCutsceneSprite(px, lawyerX, lawyerY, female, 1);
    if (phase === "walk") {
      drawCutsceneNeutral(px, lawyerX, lawyerY, female, 1);
    } else {
      drawCutsceneSmile(px, lawyerX, lawyerY, female, 1);
    }

    // Kids raise arms when lawyer is close
    if (lawyerX >= lawyerTargetX - 30) {
      const s = 0.7;
      px(familyX - 30 + (-3) * s, (spouseY + 12) + (-2) * s, 5 * s, 6 * s, "#3a4a6a");
      px(familyX + 36 + 20 * s, (spouseY + 12) + (-2) * s, 5 * s, 6 * s, "#6a3a4a");
    }

    if (fadeAlpha > 0) {
      ctx.fillStyle = `rgba(0,0,0,${fadeAlpha})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  let animFrame;
  function animate() {
    if (phase === "walk") {
      lawyerX += 1.5;
      if (lawyerX >= lawyerTargetX) {
        lawyerX = lawyerTargetX;
        phase = "embrace";
        embraceTimer = 0;
      }
    } else if (phase === "embrace") {
      embraceTimer++;
      if (embraceTimer > 120) phase = "fadeout";
    } else if (phase === "fadeout") {
      fadeAlpha += 0.008;
      if (fadeAlpha >= 1) {
        fadeAlpha = 1;
        cancelAnimationFrame(animFrame);
        finishCutscene(drawFrame, "You were fired, but your family has never been happier to see you.");
        return;
      }
    }
    drawFrame();
    animFrame = requestAnimationFrame(animate);
  }

  animFrame = requestAnimationFrame(animate);
}

// ==========================================
// ENDING 2: Divorce ending (fired + divorced)
// ==========================================
function showDivorceEnding() {
  const { overlay, cvs, ctx, W, H } = openCutscene();
  const px = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  const female = isFemale();

  let lawyerX = -60;
  const lawyerTargetX = 220; // walks to the empty porch, alone
  let phase = "walk";
  let fadeAlpha = 0;
  let standTimer = 0;

  function drawFrame() {
    ctx.clearRect(0, 0, W, H);
    drawColdSky(px, W);
    drawCutsceneHouse(px, false);

    // No family — empty porch

    // Lawyer
    const lawyerY = 200;
    drawCutsceneSprite(px, lawyerX, lawyerY, female, 1);

    if (phase === "walk") {
      drawCutsceneNeutral(px, lawyerX, lawyerY, female, 1);
    } else {
      drawCutsceneSadFace(px, lawyerX, lawyerY, female, 1);
    }

    if (fadeAlpha > 0) {
      ctx.fillStyle = `rgba(0,0,0,${fadeAlpha})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  let animFrame;
  function animate() {
    if (phase === "walk") {
      lawyerX += 1.2; // slower, heavier walk
      if (lawyerX >= lawyerTargetX) {
        lawyerX = lawyerTargetX;
        phase = "stand";
        standTimer = 0;
      }
    } else if (phase === "stand") {
      standTimer++;
      // Stand alone for ~3 seconds, then fade
      if (standTimer > 180) phase = "fadeout";
    } else if (phase === "fadeout") {
      fadeAlpha += 0.006; // slower, heavier fade
      if (fadeAlpha >= 1) {
        fadeAlpha = 1;
        cancelAnimationFrame(animFrame);
        finishCutscene(drawFrame, "You lost everything. But at what cost?");
        return;
      }
    }
    drawFrame();
    animFrame = requestAnimationFrame(animate);
  }

  animFrame = requestAnimationFrame(animate);
}

// ---------- Character Creation ----------

let charCreateGender = "male";

function drawCharPreview(gender) {
  const cvs = $("charcreate-canvas");
  if (!cvs) return;
  const c = cvs.getContext("2d");
  const W = cvs.width, H = cvs.height;
  c.clearRect(0, 0, W, H);
  c.fillStyle = "#0b0c10";
  c.fillRect(0, 0, W, H);

  const px = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
  const ax = 30, ay = 32;

  if (gender === "female") {
    // Blazer
    px(ax + 2, ay, 56, 54, "#1f2740");
    px(ax + 8, ay + 10, 10, 30, "#2a3554");
    px(ax + 42, ay + 10, 10, 30, "#2a3554");
    px(ax + 26, ay + 12, 8, 34, "#d9dbe6");
    // Skirt
    px(ax + 6, ay + 50, 48, 10, "#1f2740");
    px(ax + 10, ay + 60, 40, 4, "#1f2740");
    // Arms
    px(ax - 8, ay + 14, 10, 30, "#1f2740");
    px(ax + 58, ay + 14, 10, 30, "#1f2740");
    // Head
    const hx = ax + 18, hy = ay - 28;
    px(hx, hy, 24, 24, "#b9926a");
    // Hair (long)
    px(hx - 3, hy - 2, 30, 8, "#5b3a29");
    px(hx - 4, hy + 4, 4, 18, "#5b3a29");
    px(hx + 24, hy + 4, 4, 18, "#5b3a29");
    px(hx - 3, hy + 6, 3, 14, "#4a2e22");
    px(hx + 25, hy + 6, 3, 14, "#4a2e22");
    // Face
    px(hx + 6, hy + 10, 3, 3, "#1a1a1a");
    px(hx + 15, hy + 10, 3, 3, "#1a1a1a");
    px(hx + 9, hy + 18, 6, 1, "#1a1a1a");
    // Earrings
    px(hx - 1, hy + 16, 2, 3, "#f2d98a");
    px(hx + 23, hy + 16, 2, 3, "#f2d98a");
  } else {
    // Suit
    px(ax, ay, 60, 56, "#1f2740");
    px(ax + 6, ay + 10, 10, 32, "#2a3554");
    px(ax + 44, ay + 10, 10, 32, "#2a3554");
    px(ax + 26, ay + 12, 8, 36, "#d9dbe6");
    px(ax + 29, ay + 18, 2, 30, "#2a3040");
    px(ax + 27, ay + 18, 6, 4, "#2a3040");
    // Arms
    px(ax - 10, ay + 14, 10, 32, "#1f2740");
    px(ax + 60, ay + 14, 10, 32, "#1f2740");
    // Head
    const hx = ax + 18, hy = ay - 28;
    px(hx, hy, 24, 24, "#b9926a");
    px(hx, hy, 24, 6, "#5b3a29");
    px(hx + 6, hy + 10, 3, 3, "#1a1a1a");
    px(hx + 15, hy + 10, 3, 3, "#1a1a1a");
    px(hx + 9, hy + 18, 6, 1, "#1a1a1a");
  }
}

function showCharacterCreation(onComplete) {
  const overlay = $("charcreate-overlay");
  overlay.style.display = "flex";
  charCreateGender = "male";

  const maleBtn = $("btn-gender-male");
  const femaleBtn = $("btn-gender-female");
  const nameInput = $("input-lawyer-name");
  nameInput.value = "";

  maleBtn.className = "gender-btn selected";
  femaleBtn.className = "gender-btn";

  drawCharPreview("male");

  maleBtn.onclick = () => {
    charCreateGender = "male";
    maleBtn.className = "gender-btn selected";
    femaleBtn.className = "gender-btn";
    drawCharPreview("male");
  };

  femaleBtn.onclick = () => {
    charCreateGender = "female";
    femaleBtn.className = "gender-btn selected";
    maleBtn.className = "gender-btn";
    drawCharPreview("female");
  };

  $("btn-charcreate-start").onclick = () => {
    const name = nameInput.value.trim();
    state.lawyer.name = name;
    state.lawyer.gender = charCreateGender;
    overlay.style.display = "none";
    onComplete();
  };
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

  // Achievement panel toggle
  $("btn-toggle-ach").addEventListener("click", () => {
    achPanelOpen = !achPanelOpen;
    $("ach-list").style.display = achPanelOpen ? "flex" : "none";
    $("btn-toggle-ach").textContent = achPanelOpen ? "Hide" : "Show";
  });

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
  if (!state.juniorMeta) state.juniorMeta = {};
  // Migrate old juniors that lack profileName
  for (const j of state.juniors) {
    if (!j.profileName) j.profileName = j.name;
    if (j._tasksCompleted === undefined) j._tasksCompleted = 0;
    if (j._quality === undefined) j._quality = null;
  }
  if (!state.nextJuniorSpawnAt) state.nextJuniorSpawnAt = 0;
  if (!state.rival) state.rival = { name: "", score: 0, playerScore: 0, momentum: 0, lastTrashTalkAt: 0, active: false, pitchOffTriggered: false, resolved: false, resolvedAt: 0 };
  if (state.rival.pitchOffTriggered === undefined) state.rival.pitchOffTriggered = false;
  if (state.rival.resolved === undefined) state.rival.resolved = false;
  if (state.rival.resolvedAt === undefined) state.rival.resolvedAt = 0;
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
  if (!state.perkProgress) state.perkProgress = { nightOwlTasks: 0, litTasksCompleted: 0 };
  if (!state.achievements) state.achievements = [];
  if (!state.minigameBoost) state.minigameBoost = { litBoostUntil: 0, corpBoostUntil: 0, regBoostUntil: 0, gamesPlayed: 0, gamesWon: 0 };
  if (state.minigameBoost.regBoostUntil === undefined) state.minigameBoost.regBoostUntil = 0;
  if (!state.pipStrikeTimestamps) state.pipStrikeTimestamps = [];
  if (state.onTimeCompletions === undefined) state.onTimeCompletions = 0;
  if (!state.holidaysTriggered) state.holidaysTriggered = [];
  if (state.lawyer.name === undefined) state.lawyer.name = "";
  // Store item migrations
  if (state.store.designerWatch === undefined) state.store.designerWatch = false;
  if (state.store.golfClubs === undefined) state.store.golfClubs = false;
  if (state.store.leatherBriefcase === undefined) state.store.leatherBriefcase = false;
  if (state.store.espressoMachine === undefined) state.store.espressoMachine = false;
  if (state.store.cornerOfficeArt === undefined) state.store.cornerOfficeArt = false;
  if (state.store.monogrammedPen === undefined) state.store.monogrammedPen = false;

  // Show character creation on first boot (no save found)
  if (_isFirstBoot) {
    showCharacterCreation(() => {
      seedOffers(true);
      log(`Welcome to Lyle Cheatem & Steele, ${lawyerName()}. Don't get comfortable.`);
      renderAll();
    });
  }

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
    if (minigameActive) return; // Pause main sim during minigames

    const t = now();
    const dt = t - state.lastTick;
    state.lastTick = t;

    const capped = Math.min(dt, 1000 * 60 * 60 * 6);
    tick(capped);

    renderAll();

    // Show minigame prompt if one is pending
    if (pendingMinigame && !minigameActive) {
      showMinigamePrompt(pendingMinigame);
      pendingMinigame = null;
    }
  }, 1000);

  setInterval(() => {
    save();
  }, 1000 * 60 * 3);

  window.addEventListener("beforeunload", () => {
    saveSilent();
  });
}

init();
