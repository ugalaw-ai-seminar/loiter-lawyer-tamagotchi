// BigLaw Associate Sim — stable rollback
// Real-time slow decay (hours/days), assignment queue, billables, rank, events, office interactions.
// Persistence: JSON file in user home directory.

const fs = require("fs");
const path = require("path");
const os = require("os");

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

  points: 0,
  billables: 0,

  reputation: { lit: 0, corp: 0, reg: 0 },

  pipStrikes: 0,
  missedDeadlines: 0,

  offers: [],
  queue: [],

  nextEventAt: now() + 1000 * 60 * 60 * 10,
  nextOfferRefreshAt: now() + 1000 * 60 * 60 * 8,
  nextChristmasPartyAt: nextChristmasPartyTimestamp(now()),

  log: []
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

function bindPerks() {
  $("perk-nightowl").checked = state.perks.nightOwl;
  $("perk-masterbiller").checked = state.perks.masterBiller;
  $("perk-goldenvoice").checked = state.perks.goldenVoice;

  $("perk-nightowl").addEventListener("change", (e) => {
    state.perks.nightOwl = !!e.target.checked;
    log(`Perk toggled: Night Owl = ${state.perks.nightOwl}`);
  });
  $("perk-masterbiller").addEventListener("change", (e) => {
    state.perks.masterBiller = !!e.target.checked;
    log(`Perk toggled: Master Biller = ${state.perks.masterBiller}`);
  });
  $("perk-goldenvoice").addEventListener("change", (e) => {
    state.perks.goldenVoice = !!e.target.checked;
    log(`Perk toggled: Golden Voice = ${state.perks.goldenVoice}`);
  });
}

// ---------- Assistant actions ----------
$("btn-coffee").addEventListener("click", () => {
  state.stats.caffeine = clamp(state.stats.caffeine + 35, 0, 100);
  state.stats.stress = clamp(state.stats.stress - 2, 0, 100);
  log("Refilled coffee pot. Caffeine up.");
});

$("btn-food").addEventListener("click", () => {
  state.stats.hunger = clamp(state.stats.hunger + 40, 0, 100);
  state.stats.stress = clamp(state.stats.stress - 3, 0, 100);

  const lines = [
    "Ordered takeout. Chinese again…",
    "Ordered takeout. The delivery guy knows your floor by heart.",
    "Ordered takeout. Ate over the keyboard like a professional.",
    "Ordered takeout. It’s technically dinner if it arrives after midnight.",
    "Ordered takeout. The receipt looks like a billing statement."
  ];
  log(randChoice(lines));
});

$("btn-nap").addEventListener("click", () => {
  state.stats.sleep = clamp(state.stats.sleep + 28, 0, 100);
  state.stats.stress = clamp(state.stats.stress - 8, 0, 100);
  log("Power nap. Sleep up, stress down.");
});

$("btn-sin").addEventListener("click", () => {
  state._sinUntil = now() + 1000 * 60 * 60 * 6; // 6 hours
  state.stats.stress = clamp(state.stats.stress + 6, 0, 100);
  state.stats.sleep = clamp(state.stats.sleep - 6, 0, 100);
  log("Used a 'Sin' pouch. Productivity up (6h), but sleep/stress take a hit.");
});

$("btn-probono").addEventListener("click", () => {
  const a = makeAssignment({ kind: "probono" });
  state.queue.push(a);
  log("Accepted a pro bono matter. Low points, stress relief on completion.");
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

// Store buys
document.querySelectorAll("[data-buy]").forEach(btn => {
  btn.addEventListener("click", () => buy(btn.getAttribute("data-buy")));
});

function buy(key) {
  const costs = {
    hat: 250, tie: 200, casual: 500,
    fridge: 800, coffeeMaker: 800, desk: 900
  };
  const cost = costs[key];
  if (state.points < cost) {
    log("Not enough points.");
    return;
  }
  state.points -= cost;

  if (key === "hat") state.lawyer.outfit.hat = true;
  if (key === "tie") state.lawyer.outfit.tie = true;
  if (key === "casual") state.lawyer.outfit.casualFridays = true;
  if (key === "fridge") state.store.fridge = true;
  if (key === "coffeeMaker") state.store.coffeeMaker = true;
  if (key === "desk") state.store.desk = true;

  log(`Purchased: ${key}.`);
  renderAll();
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

// ---------- Events ----------
function triggerRandomEvent() {
  const events = [
    {
      name: "Partner email: 'Need this tonight.'",
      a: { label: "Pull all-nighter (points)", effect: () => {
        state.stats.stress = clamp(state.stats.stress + 10, 0, 100);
        state.stats.sleep = clamp(state.stats.sleep - 10, 0, 100);
        state.points += 120;
        log("You chose the all-nighter. Points up, stress/sleep down.");
      }},
      b: { label: "Negotiate deadline (safer)", effect: () => {
        state.stats.stress = clamp(state.stats.stress - 6, 0, 100);
        if (Math.random() < 0.25) {
          state.reputation.lit = clamp(state.reputation.lit - 5, 0, 9999);
          log("Deadline negotiation worked… but someone noticed. Small rep hit.");
        } else {
          log("Deadline negotiation worked. Stress down.");
        }
      }}
    },
    {
      name: "Family conflict: date night vs urgent filing",
      a: { label: "Skip date, file tonight (points)", effect: () => {
        state.stats.stress = clamp(state.stats.stress + 8, 0, 100);
        state.points += 90;
        log("Career choice: more points, more stress.");
      }},
      b: { label: "Go on the date (stress down)", effect: () => {
        state.stats.stress = clamp(state.stats.stress - 10, 0, 100);
        log("Family choice: stress down, no points.");
      }}
    },
    {
      name: "Child sick at childcare: pick up vs push through",
      a: { label: "Push through (points)", effect: () => {
        state.stats.stress = clamp(state.stats.stress + 10, 0, 100);
        state.points += 110;
        log("Pushed through. Points up, stress up.");
      }},
      b: { label: "Pick up child (stress down)", effect: () => {
        state.stats.stress = clamp(state.stats.stress - 8, 0, 100);
        state.stats.sleep = clamp(state.stats.sleep + 4, 0, 100);
        log("Picked up child. Stress down; a rare human moment.");
      }}
    },
    {
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

  const ev = randChoice(events);
  const pickA = confirm(`${ev.name}\n\nOK = ${ev.a.label}\nCancel = ${ev.b.label}`);
  if (pickA) ev.a.effect();
  else ev.b.effect();

  state.nextEventAt = now() + 1000 * 60 * 60 * randInt(10, 20);
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

  const workload = state.queue.length;
  let stressRise = (0.22 + workload * 0.08) * dtHours;
  if (state.store.desk) stressRise *= 0.78;
  if (state.lawyer.outfit.casualFridays && isFriday(now())) stressRise *= 0.9;

  state.stats.stress = clamp(state.stats.stress + stressRise, 0, 100);

  const prod = productivityMultiplier();

  for (const a of state.queue) {
    if (a.progress >= 1) continue;

    const workHoursThisTick = prod * dtHours;
    const billableGainMult = state.perks.masterBiller ? 1.12 : 1.0;

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

      state.points += a.points;

      state.stats.stress = clamp(state.stats.stress + (a.stressImpact * 0.2), 0, 100);
      if (a.kind === "probono") state.stats.stress = clamp(state.stats.stress - 10, 0, 100);

      let repGain = Math.max(4, Math.round(a.billableHours * 1.2));
      if (state.perks.goldenVoice && a.kind === "lit") repGain = Math.round(repGain * 1.25);
      if (state.lawyer.outfit.tie) repGain += 1;

      if (a.kind === "lit") state.reputation.lit += repGain;
      if (a.kind === "corp") state.reputation.corp += repGain;
      if (a.kind === "reg") state.reputation.reg += repGain;
      if (a.kind === "probono") state.reputation.reg += 2;

      log(`Completed: ${a.title}. +${a.points} points, +rep.`);
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
  const repTotal = state.reputation.lit + state.reputation.corp + state.reputation.reg;
  let current = RANKS[0].name;
  for (const r of RANKS) {
    if (state.billables >= r.billables && repTotal >= r.rep) current = r.name;
  }
  return current;
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

  $("points").textContent = Math.floor(state.points).toString();
  $("billables").textContent = Math.floor(state.billables).toString();
  $("pip").textContent = state.pipStrikes.toString();

  const prod = productivityMultiplier();
  $("prod").textContent = `${Math.round(prod * 100)}%`;

  $("rep-lit").textContent = Math.floor(state.reputation.lit);
  $("rep-corp").textContent = Math.floor(state.reputation.corp);
  $("rep-reg").textContent = Math.floor(state.reputation.reg);

  $("rank").textContent = `Rank: ${rankName()}${state.dismissed ? " — DISMISSED" : ""}`;
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
        <div>+${o.points} points</div>
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

    card.innerHTML = `
      <div class="top">
        <div>
          <div class="name">${a.title}</div>
          <div class="meta">${a.kind.toUpperCase()} • Deadline: ${dl}</div>
        </div>
        <div class="meta">${pct}%</div>
      </div>
      <div class="mini">
        <div>${Math.floor(a.billablesEarned)}/${a.billableHours}h</div>
        <div>${a.points} pts</div>
      </div>
      <div class="progress"><div class="pfill" style="width:${pct}%"></div></div>
    `;
    wrap.appendChild(card);
  }
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

function renderAll() {
  renderClock();
  renderStats();
  renderOffers();
  renderQueue();
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
  bindPerks();
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
