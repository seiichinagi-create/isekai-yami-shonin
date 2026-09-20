// Plays the REAL prototype script (prototype/ledger.html) in Node with the DOM
// stubbed out, N games per policy, and prints win rates.
//   node tools/sim.js <ledger.html> [games=2000] [key=value ...]
// key=value pairs rewrite constants in the script text before it runs
// (START_GOLD, GOAL, POWER_SCALE, ...), so a tuning can be tried without
// editing the file. The IIFE is opened up with one injected line that hands
// the internals to the harness.
"use strict";
const fs = require("fs");
const file = process.argv[2];
const N = +(process.argv[3] || 2000);
const over = {};
process.argv.slice(4).forEach(a => { const [k, v] = a.split("="); over[k] = v; });

let src = fs.readFileSync(file, "utf8");
src = src.split("<script>")[1].split("</script>")[0];
for (const k of Object.keys(over)) {
  if (k === "DIFFS") continue;
  const re = new RegExp("(\\b" + k + "\\s*=\\s*)[-0-9.]+");
  if (!re.test(src)) { console.error("no constant " + k); process.exit(1); }
  src = src.replace(re, "$1" + over[k]);
}
src = src.replace("function render(){", "function render(){ if(globalThis.__NORENDER) return;");
src = src.replace("  start(null);\n})();", "  globalThis.__G = {get S(){return S;}, set S(v){S=v;}, fresh:fresh, newWeek:newWeek, buy:buy, appraise:appraise, toShelf:toShelf, toMarket:toMarket, endWeek:endWeek, apprCost:apprCost, lv:lv, RENT:RENT, WAGE:WAGE};\n})();");
if (!src.includes("__G")) { console.error("hook not injected"); process.exit(1); }

function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const dummy = () => ({ style: {}, dataset: {}, textContent: "", innerHTML: "", className: "", hidden: false,
  addEventListener() {}, remove() {}, appendChild() {}, focus() {}, closest() { return null; } });
globalThis.document = { getElementById: dummy, querySelector: () => null, createElement: dummy, addEventListener() {}, body: { appendChild() {} } };
globalThis.window = { scrollTo() {} };
globalThis.__NORENDER = true;
(0, eval)(src);
const G = globalThis.__G;

const POLICIES = {
  "blind (buy every unknown at 90%)":        { needEst: false, ground: false },
  "est>ask only":                              { needEst: true,  ground: false },
  "est>ask + skip 'cursed?' flag":            { needEst: true,  ground: false, skipHunch: true },
};

function playOne(pol, seed, diff) {
  Math.random = mulberry(seed);
  G.S = G.fresh(diff); G.newWeek();
  const stat = { windfall: 0, maxDepth: 1, weapons: 0, deep: 0, g3: null };
  let guard = 0;
  while (!G.S.over && guard++ < 40) {
    const S = G.S;
    for (const o of S.offers.slice()) {
      const price = Math.round(o.ask * 0.9 / 5) * 5;
      if (price > S.gold) continue;
      if (pol.skipHunch && o.hunch) continue;
      if (o.unknown) { if (pol.needEst && !(o.est > o.ask)) continue; }
      else if (o.item.v * 0.6 < price) continue;
      if (!o.unknown && !pol.ground && o.item.t === 0) continue;
      if (o.item.f && o.item.f >= 4) stat.windfall++;
      if (o.item.f && !o.item.x && o.item.f >= G.S.depth + 2) stat.deep++;
      G.buy(o.id, price);
    }
    for (const st of G.S.stock.slice()) {
      if (st.revealed) continue;
      const c = G.apprCost(st);
      if (G.S.gold - c >= G.RENT + G.WAGE) G.appraise(st.id); else G.toMarket(st.id);
    }
    for (const st of G.S.stock.slice()) {
      if (!st.revealed || st.item.x || st.shelf != null) continue;
      if (G.S.gold < G.RENT + G.WAGE) G.toMarket(st.id);
      else G.toShelf(st.id, Math.round(st.item.v * 0.8));
    }
    G.endWeek();
    if (G.S.depth) stat.maxDepth = Math.max(stat.maxDepth, G.S.depth);
    if (G.S.week === 4 && stat.g3 === null) stat.g3 = G.S.gold;
  }
  const S = G.S;
  return { win: !!(S.over && S.over.win), broke: !!(S.over && !S.over.win && S.gold < 0), week: Math.min(S.week, 12), depth: S.depth || 1, windfall: stat.windfall, deep: stat.deep, g3: stat.g3 };
}

function pct(a, q) { return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * q))] : "-"; }
const diffs = (over.DIFFS || "dboy,normal,hard").split(",");
for (const diff of diffs) {
  console.log("== " + diff);
  for (const [name, pol] of Object.entries(POLICIES)) {
    let w = 0, b = 0, t = 0, wk = [], dp = 0, wfN = 0, deepN = 0, deepWin = 0, d3 = 0, d4 = 0;
    let lowN = 0, lowW = 0, hiN = 0, hiW = 0;
    for (let i = 0; i < N; i++) {
      const r = playOne(pol, 1000 + i, diff);
      if (r.win) { w++; wk.push(r.week); } else if (r.broke) b++; else t++;
      dp += r.depth; if (r.depth >= 3) d3++; if (r.depth >= 4) d4++;
      if (r.windfall > 0) wfN++;
      if (r.deep > 0) { deepN++; if (r.win) deepWin++; }
      if (r.g3 !== null) { if (r.g3 < 900) { lowN++; if (r.win) lowW++; } else { hiN++; if (r.win) hiW++; } }
    }
    wk.sort((a, b) => a - b);
    console.log("  " + name.padEnd(34) + " win " + (100 * w / N).toFixed(1).padStart(5) + "%  broke " + (100 * b / N).toFixed(1).padStart(5) + "%  timeout " + (100 * t / N).toFixed(1).padStart(4) + "%  win week p10/50/90 " + pct(wk, .1) + "/" + pct(wk, .5) + "/" + pct(wk, .9));
    console.log("  " + "".padEnd(34) + " depth mean " + (dp / N).toFixed(2) + "  >=3: " + (100 * d3 / N).toFixed(0) + "%  >=4: " + (100 * d4 / N).toFixed(0) + "%  | bought floor>=4 in " + (100 * wfN / N).toFixed(1) + "% of games  | bought a floor>=depth+2 item in " + (100 * deepN / N).toFixed(1) + "% (win " + (deepN ? (100 * deepWin / deepN).toFixed(0) : "-") + "%)");
    console.log("  " + "".padEnd(34) + " gold after wk3: <900 -> win " + (lowN ? (100 * lowW / lowN).toFixed(0) : "-") + "% (" + (100 * lowN / N).toFixed(0) + "% of games)  >=900 -> win " + (hiN ? (100 * hiW / hiN).toFixed(0) : "-") + "%");
  }
}
