/* Lift Log app. Data lives in this browser (localStorage), with JSON backup/restore. */
const APP_VERSION = "3.0.0";

/* ================= utils ================= */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const iso = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0,10); };
const todayStr = () => iso(new Date());
const fmtDate = s => new Date(s + "T12:00:00").toLocaleDateString(undefined,{weekday:"short",day:"numeric",month:"short"});
const mmss = s => { s = Math.max(0, Math.round(s)); return Math.floor(s/60) + ":" + String(s%60).padStart(2,"0"); };
const hms = s => { s = Math.floor(s); const h = Math.floor(s/3600), m = Math.floor(s%3600/60); return (h ? h + ":" + String(m).padStart(2,"0") : m) + ":" + String(s%60).padStart(2,"0"); };
const roundTo = (x, step) => Math.round(x/step)*step;
const fmtKg = w => { w = +w; return Number.isInteger(w) ? String(w) : String(+w.toFixed(2)); };
const e1rm = (w, r) => (+w) * (1 + (+r)/30);
const uid = p => p + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
const clone = o => JSON.parse(JSON.stringify(o));
const weekStart = d => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay()+6)%7)); x.setHours(0,0,0,0); return x; };
const daysSince = ts => (Date.now() - ts) / 864e5;
const sTs = s => s.ts || new Date(s.date + "T18:00:00").getTime();
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,40) || "ex";
function toast(msg, cls){ const t=$("#toast"); t.textContent=msg; t.className="toast"+(cls?" "+cls:""); t.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>t.hidden=true, 2800); }

/* ================= storage ================= */
const KEY = "liftlog.v3";
const DEFAULT_SETTINGS = {bar:20, restBig:150, restSmall:90, sound:1, weekTarget:3, theme:"system"};
function freshState(){ return {v:3, sessions:[], bw:[], routines:clone(DEFAULT_ROUTINES), custom:{}, settings:{...DEFAULT_SETTINGS}, active:null}; }
function load(){
  try{ const raw = localStorage.getItem(KEY); if(raw){ const s = JSON.parse(raw); s.settings = {...DEFAULT_SETTINGS, ...(s.settings||{})}; s.custom = s.custom||{}; s.routines = s.routines||clone(DEFAULT_ROUTINES); s.sessions = s.sessions||[]; s.bw = s.bw||[]; return s; } }catch(e){}
  return freshState();
}
let S = load();
function save(){ try{ localStorage.setItem(KEY, JSON.stringify(S)); }catch(e){ toast("Couldn't save: phone storage is full. Export a backup and clear old data."); } }
function mergeCustom(){ Object.values(S.custom).forEach(c => { EX[c.id] = {...c, custom:true}; }); }
mergeCustom();
const exName = id => EX[id]?.name || id;
function applyTheme(){ const t=S.settings.theme; if(t==="light"||t==="dark") document.documentElement.setAttribute("data-theme",t); else document.documentElement.removeAttribute("data-theme"); }
applyTheme();

/* ================= history helpers ================= */
const sessions = () => S.sessions.slice().sort((a,b)=> b.date.localeCompare(a.date) || sTs(b)-sTs(a));
const working = sets => sets.filter(x => x.t !== "w" && +x.r > 0);
function histFor(exId){
  const out=[];
  for(const s of sessions()) for(const it of s.items||[]) if(it.ex===exId){ const w = working(it.sets||[]); if(w.length) out.push({date:s.date, ts:sTs(s), sets:w, rating:it.rating||null}); }
  return out;
}
function bestE1(exId){ let b=0; for(const s of S.sessions) for(const it of s.items||[]) if(it.ex===exId) for(const x of working(it.sets||[])) b=Math.max(b,e1rm(x.w,x.r)); return b; }
const topE1 = sets => Math.max(...sets.map(x => e1rm(x.w,x.r)));

/* ================= progression engine ================= */
function stepFor(e){ return e.inc>0 ? e.inc : 2.5; }
function suggest(exId, spec){
  const e = EX[exId]; const h = histFor(exId); const last = h[0];
  const n = spec.sets, lo = spec.lo, hi = spec.hi;
  if(!e) return {tag:"",text:"",w:"",prev:[]};
  if(!last){
    if(e.type==="w") return {tag:"Start",text:`First time: pick a weight you could lift about ${hi+2} times, then do ${n} sets of ${lo}–${hi}.`,w:"",prev:[]};
    if(e.type==="t") return {tag:"Start",text:`Hold ${lo}s each set, building toward ${hi}s.`,w:"",prev:[]};
    if(e.type==="min") return {tag:"Start",text:`Go ${lo}–${hi} minutes at a pace you could hold a conversation.`,w:"",prev:[]};
    return {tag:"Start",text:`Aim for ${lo}+ clean reps each set.`,w:"",prev:[]};
  }
  const prev = last.sets;
  const hitAll = prev.length >= n && prev.every(x => +x.r >= hi);
  const missed = prev.filter(x => +x.r < lo).length >= Math.ceil(prev.length/2);
  const rating = last.rating; const rt = rating ? ` (felt ${rating==="ideal"?"good":rating})` : "";
  const away = daysSince(last.ts);
  if(e.type==="w"){
    const top = Math.max(...prev.map(x => +x.w||0)); const st = stepFor(e);
    if(away > 14 && top > 0){ const d = Math.max(0, roundTo(top*0.9, st)); return {tag:"Welcome back",down:1,text:`${Math.round(away)} days since you last did this. Start at ${fmtKg(d)} kg (about 90%) and build back up.`,w:d,prev}; }
    const stalled = h.length >= 3 && !hitAll && topE1(h[0].sets) <= topE1(h[2].sets) && topE1(h[1].sets) <= topE1(h[2].sets)+0.01;
    if(stalled && top > 0){ const d = Math.max(0, roundTo(top*0.9, st)); return {tag:"Stalled",down:1,text:`No progress for 3 sessions. Drop to ${fmtKg(d)} kg for a fresh run at it, or tap More → Swap for a variation.`,w:d,prev}; }
    if(hitAll && rating==="hard") return {tag:"Repeat",text:`Top of the range on every set, but it felt hard. Own ${fmtKg(top)} kg one more session.`,w:top,prev};
    if(hitAll){ const jump = rating==="easy" ? st*2 : st; return {tag:"Add weight",up:1,text:`You hit ${hi} reps on every set${rt}. Go ${fmtKg(top+jump)} kg (+${fmtKg(jump)}).`,w:top+jump,prev}; }
    if(missed && rating==="hard"){ const d = Math.max(0, roundTo(top*0.9, st)); return {tag:"Reset",down:1,text:`Missed ${lo} reps on most sets and it felt hard. Drop to ${fmtKg(d)} kg and build back up.`,w:d,prev}; }
    return {tag:"Beat it",text:`Stay at ${fmtKg(top)} kg and add a rep to one or two sets${rt}.`,w:top,prev};
  }
  if(e.type==="min"){ if(hitAll) return {tag:"Level up",up:1,text:`Hit ${hi} min last time. Keep the time and go a little faster or steeper.`,w:"",prev}; return {tag:"Build",text:`Add 1–2 minutes, or cover a bit more distance.`,w:"",prev}; }
  if(e.type==="t"){ if(hitAll) return {tag:"Level up",up:1,text:`${hi}s every set. Switch to a harder version.`,w:"",prev}; return {tag:"Build",text:`Add 5 seconds to each hold.`,w:"",prev}; }
  if(hitAll) return {tag:"Level up",up:1,text:`Top of the range every set. Make it harder: loaded backpack, slower lowering, or a harder variation.`,w:"",prev};
  return {tag:"Build",text:`Aim for +1 rep on each set${rt}.`,w:"",prev};
}
function warmups(exId, w){
  const e = EX[exId]; if(!e || !e.big || !(w >= S.settings.bar + 20)) return [];
  const bar = S.settings.bar; const out = [{w:bar,r:10}];
  [[.5,5],[.7,3],[.85,1]].forEach(([p,r]) => { const x = Math.max(bar, roundTo(w*p,2.5)); if(x > out[out.length-1].w && x < w) out.push({w:x,r}); });
  return out;
}
function plates(total){
  const per = (total - S.settings.bar)/2; if(per < 0) return null;
  const avail=[25,20,15,10,5,2.5,1.25]; let left=per; const out=[];
  for(const p of avail) while(left >= p-1e-9){ out.push(p); left -= p; }
  return {out, left:Math.round(left*100)/100};
}
const PLATE_COL = {25:"#C2352B",20:"#1F5BD6",15:"#C98F00",10:"#1E8A4C",5:"#6B7280",2.5:"#374151",1.25:"#9CA3AF"};

/* ================= rotation, recovery, volume ================= */
function rotation(){ return S.routines.filter(r => r.rotate !== false); }
function nextRoutine(){
  const rot = rotation(); if(!rot.length) return S.routines[0] || null;
  const last = sessions().find(s => rot.some(r => r.id === s.routine));
  if(!last) return rot[0];
  const i = rot.findIndex(r => r.id === last.routine); return rot[(i+1) % rot.length];
}
const BODY = MUSCLES;
function setsPerMuscle(days){
  const since = Date.now() - days*864e5; const cnt = {}; BODY.forEach(m => cnt[m]=0);
  S.sessions.filter(s => sTs(s) >= since).forEach(s => (s.items||[]).forEach(it => { const e = EX[it.ex]; if(!e) return; const n = working(it.sets||[]).length; e.m.forEach((m,i) => { if(m in cnt) cnt[m] += n*(i===0?1:.5); }); }));
  return cnt;
}
function recovery(){
  const now = Date.now(); const r = {}; BODY.forEach(m => r[m] = 100);
  for(const s of S.sessions){ const hrs = (now - sTs(s))/36e5; if(hrs > 24*7) continue; const per = {};
    (s.items||[]).forEach(it => { const e = EX[it.ex]; if(!e) return; const n = working(it.sets||[]).length; e.m.forEach((m,i) => per[m] = (per[m]||0) + n*(i===0?1:.5)); });
    for(const [m,n] of Object.entries(per)){ if(!(m in r)) continue; const full = 48 + Math.min(n,12)*3; const p = Math.min(100, Math.max(5, hrs/full*100)); if(p < r[m]) r[m] = p; } }
  return r;
}
const recCol = p => p>=85 ? "var(--good)" : p>=50 ? "var(--pr)" : "var(--warn)";

/* ================= smart coach (offline rules) ================= */
function insights(){
  const out = []; const s = sessions(); const t = S.settings.weekTarget;
  if(!s.length){ out.push({lvl:"info",text:"Do your first workout and the coach will start spotting stalls, low-volume muscles and weight trends."}); return out; }
  const ws = iso(weekStart(new Date())); const thisWeek = s.filter(x => x.date >= ws).length;
  const since = daysSince(sTs(s[0]));
  if(since >= 14) out.push({lvl:"warn",text:`Welcome back. It's been ${Math.round(since)} days, so weights are eased to about 90% for returning lifts.`});
  else if(since >= 4) out.push({lvl:"warn",text:`${Math.floor(since)} days since your last workout. Even a 30-minute session keeps momentum.`});
  if(thisWeek >= t) out.push({lvl:"good",text:`Weekly goal hit: ${thisWeek} of ${t} workouts. Nice.`});
  else out.push({lvl:"info",text:`${thisWeek} of ${t} workouts this week.`});
  const seen = new Set(); const stalled = [];
  for(const x of s) for(const it of x.items||[]){ if(seen.has(it.ex)) continue; seen.add(it.ex); const e = EX[it.ex]; if(!e || e.type !== "w") continue; const h = histFor(it.ex);
    if(h.length >= 3 && topE1(h[0].sets) <= topE1(h[2].sets) && topE1(h[1].sets) <= topE1(h[2].sets)+0.01) stalled.push(e.name); }
  if(stalled.length) out.push({lvl:"warn",text:`Stalled for 3 sessions: ${stalled.slice(0,3).join(", ")}. The app will suggest a 10% reset. A swap to a similar exercise also works.`});
  const recent = s.filter(x => daysSince(sTs(x)) <= 7).length;
  if(recent >= 2){ const v = setsPerMuscle(7); const low = BODY.filter(m => m !== "Calves" && v[m] < 6).sort((a,b) => v[a]-v[b]);
    if(low.length) out.push({lvl:"info",text:`Low volume this week: ${low.slice(0,3).map(m => `${m} (${+v[m].toFixed(1)} sets)`).join(", ")}. 10+ hard sets per muscle per week is a good target.`}); }
  let prs = 0; const weekStartTs = weekStart(new Date()).getTime();
  for(const x of s.filter(x => sTs(x) >= weekStartTs)) for(const it of x.items||[]){ const e = EX[it.ex]; if(!e || e.type!=="w") continue; const before = Math.max(0,...S.sessions.filter(y => sTs(y) < sTs(x)).flatMap(y => (y.items||[]).filter(i => i.ex===it.ex).flatMap(i => working(i.sets).map(z => e1rm(z.w,z.r))))); if(before > 0 && working(it.sets).some(z => e1rm(z.w,z.r) > before)) prs++; }
  if(prs) out.push({lvl:"good",text:`${prs} personal best${prs>1?"s":""} this week.`});
  const b = S.bw.slice().sort((a,c) => a.date.localeCompare(c.date)).filter(x => daysSince(new Date(x.date+"T12:00:00").getTime()) <= 28);
  if(b.length >= 3){ const first = b[0], lastB = b[b.length-1]; const wks = Math.max(1, (new Date(lastB.date) - new Date(first.date))/6048e5); const rate = (lastB.kg - first.kg)/wks; const pct = rate/lastB.kg*100;
    if(pct < -1) out.push({lvl:"warn",text:`Losing ${Math.abs(rate).toFixed(2)} kg/week. That's fast. Eat a little more to protect muscle.`});
    else if(pct <= -0.2) out.push({lvl:"good",text:`Losing ${Math.abs(rate).toFixed(2)} kg/week: a steady pace for getting lean while keeping muscle.`});
    else if(pct > 0.3) out.push({lvl:"info",text:`Weight up ${rate.toFixed(2)} kg/week. If leanness is the goal, trim about 300 kcal a day.`});
    else out.push({lvl:"info",text:`Weight is steady. For more definition, a small deficit (about 300–500 kcal a day) is the lever.`}); }
  return out;
}

/* ================= AI bridge (copy to Claude / paste back) ================= */
function trainingSummary(days){
  const since = Date.now() - days*864e5; const lines = [];
  lines.push(`Lift Log export, ${todayStr()}. Last ${days} days.`);
  const s = sessions().filter(x => sTs(x) >= since).reverse();
  if(!s.length) lines.push("No workouts logged in this period.");
  s.forEach(x => { lines.push(`\n${x.date} · ${x.name||x.routine}${x.dur?` · ${Math.round(x.dur/60)} min`:""}`);
    (x.items||[]).forEach(it => { const e = EX[it.ex]; if(!e) return; const w = (it.sets||[]).filter(z => +z.r > 0);
      const t = w.map(z => (z.t==="w"?"W:":z.t==="d"?"D:":z.t==="f"?"F:":"") + (e.type==="w" ? `${fmtKg(z.w)}kg×${z.r}` : e.type==="t" ? `${z.r}s` : e.type==="min" ? `${z.r}min${+z.w?` ${z.w}km`:""}` : `${z.r}`)).join(", ");
      lines.push(`- ${e.name}: ${t}${it.rating?` [felt ${it.rating==="ideal"?"good":it.rating}]`:""}${it.note?` (note: ${it.note})`:""}`); });
    if(x.notes) lines.push(`  Session note: ${x.notes}`); });
  const b = S.bw.slice().sort((a,c) => a.date.localeCompare(c.date)).filter(x => new Date(x.date+"T12:00:00").getTime() >= since);
  if(b.length) lines.push(`\nBody weight: ${b.map(x => `${x.date} ${x.kg}kg`).join("; ")}`);
  lines.push(`\nCurrent routines:`); S.routines.forEach(r => lines.push(`- ${r.name}${r.rotate===false?" (not in rotation)":""}: ${r.items.map(i => `${exName(i.ex)} ${i.sets}×${i.lo}-${i.hi}${i.group?` [superset ${i.group}]`:""}`).join("; ")}`));
  return lines.join("\n");
}
const GOAL = "My goals: general health, muscle definition and getting leaner. I train 1 day at home (bodyweight, little equipment) and 1–2 heavy gym days a week, plus walking.";
function routineFormat(){
  const ids = Object.values(EX).map(e => `${e.id}=${e.name}`).join(", ");
  return `Reply with ONLY a JSON object in this exact format, no other text:
{"name":"Routine name","sub":"Short description","items":[{"ex":"squat","sets":4,"lo":5,"hi":7,"rest":150,"group":null}]}
- "ex" must be one of these exercise ids: ${ids}
- If you need an exercise that isn't listed, use {"ex":"new","name":"Exercise name","type":"w|bw|t","muscle":"Chest"} instead.
- "lo"/"hi" are the rep range (seconds for holds, minutes for cardio). "rest" is seconds. Give two or more consecutive items the same "group" letter (e.g. "A") to make a superset.`;
}
const AI_PROMPTS = {
  checkin: () => `You're my strength coach. ${GOAL}\nReview my last 4 weeks of training below. Tell me in plain language: what's going well, what's lagging (lifts, muscles, consistency, body weight trend), and 3 specific changes for next week. Keep it short and concrete.\n\n${trainingSummary(28)}`,
  review: () => { const s = sessions()[0]; return `You're my strength coach. ${GOAL}\nReview my most recent workout (${s?s.date:"none"}) in the context of the previous weeks. Point out PRs, anything that looks off (form fatigue, too few reps, rating patterns) and what to do next session. Keep it brief.\n\n${trainingSummary(21)}`; },
  stall: () => `You're my strength coach. ${GOAL}\nSome of my lifts have stopped progressing. Look at the data below, identify which lifts are stuck, explain the likely reason, and give me a specific plan for each (deload, rep-range change, variation swap, frequency). Be concrete with weights.\n\n${trainingSummary(42)}`,
  routine: goal => `You're my strength coach. ${GOAL}\nDesign a workout routine for this request: "${goal||"a balanced full-body session"}".\nUse my training history below to pick sensible exercises.\n\n${routineFormat()}\n\nMy recent training:\n${trainingSummary(28)}`
};
async function copyText(text){
  try{ await navigator.clipboard.writeText(text); return true; }catch(e){ return false; }
}

/* ================= HOME ================= */
function renderHome(){
  const el = $("#tab-home"); const s = sessions(); const ws = weekStart(new Date()); const t = todayStr();
  let week = ""; for(let i=0;i<7;i++){ const d = new Date(ws); d.setDate(ws.getDate()+i); const ds = iso(d); const hit = s.filter(x => x.date === ds);
    week += `<div class="day ${hit.length?"done":""} ${ds===t?"today":""}"><div class="d">${d.toLocaleDateString(undefined,{weekday:"short"})}</div><div class="t">${hit.length?hit.map(h => esc((h.name||"✓").replace(/^Gym /,"").slice(0,4))).join(" "):"·"}</div></div>`; }
  let hero;
  if(S.active){ const a = S.active; const done = a.items.reduce((n,it) => n + it.sets.filter(x => x.done && x.t!=="w").length, 0);
    hero = `<div class="hero"><div class="label">In progress · ${hms((Date.now()-a.startedAt)/1000)}</div><h2>${esc(a.name)}</h2><p class="small">${done} sets done so far.</p><button class="btn" data-go="workout">Continue workout</button></div>`;
  } else { const r = nextRoutine();
    if(!r) hero = `<div class="hero"><h2>No routines</h2><button class="btn" data-go="routines">Create a routine</button></div>`;
    else { const n = s.filter(x => x.date >= iso(ws)).length; const rec = recovery(); const tired = [...new Set(r.items.map(i => EX[i.ex]?.m[0]).filter(m => m && rec[m] < 50))];
      hero = `<div class="hero"><div class="label">Up next · ${n} of ${S.settings.weekTarget} this week</div><h2>${esc(r.name)}${r.sub?": "+esc(r.sub):""}</h2>
        <ul>${r.items.map(i => `<li><span>${esc(exName(i.ex))}${i.group?` <span class="label" style="color:inherit">SS ${esc(i.group)}</span>`:""}</span><span>${i.sets} × ${i.lo}–${i.hi}${EX[i.ex]?.type==="t"?"s":EX[i.ex]?.type==="min"?" min":""}</span></li>`).join("")}</ul>
        ${tired.length?`<p class="small">Heads up: ${tired.join(", ")} still recovering. Go a bit lighter or pick another routine.</p>`:""}
        <button class="btn" data-start="${esc(r.id)}">Start ${esc(r.name)}</button>
        <div class="chips">${S.routines.filter(x => x.id!==r.id).slice(0,4).map(x => `<button class="chip" data-start="${esc(x.id)}">Do ${esc(x.name)} instead</button>`).join("")}<button class="chip" data-start="__empty">Empty workout</button></div></div>`; } }
  const rec = recovery(); const ins = insights(); const b = S.bw.slice().sort((a,c) => a.date.localeCompare(c.date));
  el.innerHTML = `<div class="week" aria-label="This week">${week}</div>${hero}
    <div class="card"><div class="between" style="margin-bottom:4px"><h3>Coach</h3><span class="label">Updates after each workout</span></div>
      ${ins.map(i => `<div class="insight"><span class="dot" style="background:${i.lvl==="good"?"var(--good)":i.lvl==="warn"?"var(--warn)":"var(--accent)"}"></span><span>${esc(i.text)}</span></div>`).join("")}</div>
    <div class="card"><div class="between"><h3>Ask Claude</h3><span class="label">AI coach</span></div>
      <p class="small muted" style="margin:4px 0 10px">Copies your training data with a ready-made prompt. Paste it into Claude for a deeper review or a new routine.</p>
      <div class="chips"><button class="chip" data-ai="checkin">Weekly check-in</button><button class="chip" data-ai="review">Review last workout</button><button class="chip" data-ai="stall">Fix stalled lifts</button><button class="chip" data-ai="routine">Design a routine</button><button class="chip" data-ai="import">Paste routine from Claude</button></div></div>
    <div class="card"><div class="between" style="margin-bottom:10px"><h3>Muscle recovery</h3><span class="label">100% = rested</span></div>
      <div class="rec">${BODY.map(m => `<div class="m"><div class="between"><span>${m}</span><span>${Math.round(rec[m])}%</span></div><div class="bar"><i style="width:${rec[m]}%;background:${recCol(rec[m])}"></i></div></div>`).join("")}</div></div>
    <div class="card"><div class="between"><h3>Body weight</h3><div class="row"><input type="number" id="bwInput" step="0.1" min="30" max="300" placeholder="kg" style="width:84px" aria-label="Body weight in kg"><button class="btn sm" id="bwBtn">Log</button></div></div>
      <p class="small muted" style="margin-top:6px">${b.length?`Last: ${b[b.length-1].kg} kg on ${fmtDate(b[b.length-1].date)}${b.length>1?` · ${(b[b.length-1].kg-b[0].kg>0?"+":"")+(b[b.length-1].kg-b[0].kg).toFixed(1)} kg since ${fmtDate(b[0].date)}`:""}`:"Weigh in a few mornings a week to see your trend."}</p></div>`;
}
$("#tab-home").addEventListener("click", e => {
  const st = e.target.closest("[data-start]"); if(st){ startWorkout(st.dataset.start); return; }
  const g = e.target.closest("[data-go]"); if(g){ showTab(g.dataset.go); return; }
  const ai = e.target.closest("[data-ai]"); if(ai){ openAI(ai.dataset.ai); return; }
  if(e.target.id === "bwBtn"){ const v = parseFloat($("#bwInput").value); if(!(v>30 && v<300)){ toast("Enter your weight in kg, e.g. 82.4"); return; }
    const d = todayStr(); S.bw = S.bw.filter(x => x.date !== d); S.bw.push({date:d,kg:v}); save(); renderHome(); renderProgress(); toast("Weight logged"); }
});

/* ================= AI sheet ================= */
function openAI(kind){
  if(kind === "import"){ openImport(); return; }
  const titles = {checkin:"Weekly check-in",review:"Review last workout",stall:"Fix stalled lifts",routine:"Design a routine"};
  sheet(`<div class="sheethead"><h2>${titles[kind]}</h2><button class="btn sm ghost" data-close>Close</button></div>
    ${kind==="routine"?`<label class="small" for="aiGoal">What do you want?</label><input type="text" id="aiGoal" class="full" placeholder="e.g. 45-min upper body, dumbbells only">`:""}
    <p class="small muted">Tap Copy, open Claude, paste and send. ${kind==="routine"?"Then copy Claude's reply and use <b>Paste routine from Claude</b> to load it.":"Claude's answer stays in that chat."}</p>
    <button class="btn block" id="aiCopy">Copy prompt + my data</button>
    <a class="btn ghost block" style="text-align:center;text-decoration:none;display:block" href="https://claude.ai/new" target="_blank" rel="noopener">Open Claude</a>
    <textarea id="aiText" readonly aria-label="Prompt text" hidden></textarea>
    ${kind==="routine"?`<button class="btn ghost block" data-ai2="import">I have Claude's reply: paste routine</button>`:""}`);
  $("#aiCopy").onclick = async () => { const text = AI_PROMPTS[kind]($("#aiGoal")?.value.trim());
    if(await copyText(text)) toast("Copied. Paste it into Claude.");
    else { const ta = $("#aiText"); ta.hidden = false; ta.value = text; ta.focus(); ta.select(); toast("Select all and copy the text below."); } };
  const imp = document.querySelector("[data-ai2]"); if(imp) imp.onclick = openImport;
}
function openImport(){
  sheet(`<div class="sheethead"><h2>Paste routine</h2><button class="btn sm ghost" data-close>Close</button></div>
    <p class="small muted">Paste the JSON routine Claude gave you. It will be added to your routines, and any new exercises are added to your library.</p>
    <textarea id="impText" placeholder='{"name":"…","items":[…]}'></textarea>
    <button class="btn block" id="impGo">Add routine</button>`);
  $("#impGo").onclick = () => { try{ const n = importRoutines($("#impText").value); closeSheet(); renderAll(); showTab("routines"); toast(`Added ${n} routine${n>1?"s":""}`); }catch(err){ toast(err.message || "That doesn't look like a routine. Copy Claude's whole reply."); } };
}
function importRoutines(text){
  let t = String(text).trim(); const f = t.match(/```(?:json)?\s*([\s\S]*?)```/); if(f) t = f[1];
  const starts = ["{","["].map(c => t.indexOf(c)).filter(i => i >= 0); if(!starts.length) throw new Error("No routine found in that text."); const a = Math.min(...starts);
  const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]")); const data = JSON.parse(t.slice(a, end+1));
  const list = Array.isArray(data) ? data : Array.isArray(data.routines) ? data.routines : [data];
  let added = 0;
  for(const r of list){ if(!r || !Array.isArray(r.items) || !r.items.length) continue;
    const items = [];
    for(const it of r.items){ let id = it.ex;
      if(!EX[id]){ const nm = String(it.name || it.ex || "").trim(); if(!nm) continue; const found = Object.values(EX).find(e => e.name.toLowerCase() === nm.toLowerCase());
        if(found) id = found.id; else { id = "c_" + slug(nm); if(!EX[id]){ const mus = MUSCLES.includes(it.muscle) ? it.muscle : "Core"; S.custom[id] = {id,name:nm,type:["w","bw","t","min"].includes(it.type)?it.type:"w",eq:"machine",inc:2.5,m:[mus],cue:it.cue||""}; mergeCustom(); } } }
      items.push({ex:id, sets:clampInt(it.sets,1,10,3), lo:clampInt(it.lo,1,600,8), hi:clampInt(it.hi,1,600,12), rest:it.rest?clampInt(it.rest,15,600,90):null, group:it.group?String(it.group).slice(0,2).toUpperCase():null}); }
    if(!items.length) continue; items.forEach(i => { if(i.hi < i.lo) i.hi = i.lo; });
    S.routines.push({id:uid("r"), name:String(r.name||"Claude routine").slice(0,40), sub:String(r.sub||"").slice(0,60), items, rotate:false}); added++; }
  if(!added) throw new Error("No exercises found in that routine.");
  save(); return added;
}
function clampInt(v, lo, hi, d){ v = parseInt(v,10); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; }

/* ================= sheets ================= */
function sheet(html){ const s = $("#sheet"); s.innerHTML = `<div class="in">${html}</div>`; s.hidden = false; s.scrollTop = 0; document.body.style.overflow = "hidden"; }
function closeSheet(){ $("#sheet").hidden = true; $("#sheet").innerHTML = ""; document.body.style.overflow = ""; }
$("#sheet").addEventListener("click", e => { if(e.target.closest("[data-close]")) closeSheet(); });

/* ================= WORKOUT ================= */
let audioCtx = null, wakeLock = null, openDrawer = null, finishConfirm = false;
function unlockAudio(){ try{ if(!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)(); if(audioCtx.state === "suspended") audioCtx.resume(); }catch(e){} }
function beep(){ if(!+S.settings.sound || !audioCtx) return; try{ [0,.25,.5].forEach(t => { const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination); g.gain.setValueAtTime(.2, audioCtx.currentTime+t); g.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime+t+.18); o.start(audioCtx.currentTime+t); o.stop(audioCtx.currentTime+t+.2); }); }catch(e){} }
async function keepAwake(){ try{ if(navigator.wakeLock && !wakeLock){ wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => wakeLock = null); } }catch(e){} }
document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible" && S.active) keepAwake(); });

function makeItem(spec){
  const e = EX[spec.ex]; const sg = suggest(spec.ex, spec); const w = sg.w === "" ? "" : String(sg.w);
  const sets = Array.from({length:spec.sets}, () => ({w, r:"", done:false, t:"n"}));
  const wu = e && e.type==="w" && sg.w ? warmups(spec.ex, +sg.w) : [];
  return {ex:spec.ex, lo:spec.lo, hi:spec.hi, n:spec.sets, rest:spec.rest||null, group:spec.group||null, alts:spec.alts||null, note:"", rating:null,
    sets:[...wu.map(x => ({w:String(x.w), r:String(x.r), done:false, t:"w"})), ...sets]};
}
function startWorkout(rid){
  unlockAudio();
  if(S.active){ toast("Finish or discard the current workout first."); showTab("workout"); return; }
  if(rid === "__empty") S.active = {routine:null, name:"Workout", date:todayStr(), startedAt:Date.now(), items:[], notes:""};
  else { const r = S.routines.find(x => x.id === rid); if(!r) return; S.active = {routine:r.id, name:r.name, date:todayStr(), startedAt:Date.now(), items:r.items.map(i => makeItem({...i})), notes:""}; }
  openDrawer = null; finishConfirm = false; save(); keepAwake(); renderAll(); showTab("workout");
  if(!S.active.items.length) openPicker("workout");
}
const W = () => S.active;
function groupMembers(i){ const a = W(); const g = a.items[i].group; if(!g) return [i]; let s = i, e = i; while(s > 0 && a.items[s-1].group === g) s--; while(e < a.items.length-1 && a.items[e+1].group === g) e++; const out=[]; for(let k=s;k<=e;k++) out.push(k); return out; }
function unitFor(e){ return e.type==="t" ? "sec" : e.type==="min" ? "min" : "reps"; }
function itemHTML(i){
  const a = W(), it = a.items[i], e = EX[it.ex] || {name:it.ex,type:"w",m:[],cue:"",eq:"bw",inc:2.5};
  const sg = suggest(it.ex, {sets:it.n, lo:it.lo, hi:it.hi});
  const work = it.sets.filter(s => s.t !== "w"); const allDone = work.length && work.every(s => s.done);
  const best = bestE1(it.ex); let wi = 0;
  const members = groupMembers(i); const inSS = members.length > 1;
  const rows = it.sets.map((s,j) => {
    const isWarm = s.t === "w"; if(!isWarm) wi++;
    const label = isWarm ? "W" : s.t==="d" ? "D" : s.t==="f" ? "F" : String(wi);
    const p = isWarm ? null : sg.prev[wi-1];
    const prevTxt = p ? (e.type==="w" ? `${fmtKg(p.w)}×${p.r}` : e.type==="min" ? `${p.r}m` : `${p.r}${e.type==="t"?"s":""}`) : "–";
    const isPR = !isWarm && s.done && e.type==="w" && best > 0 && e1rm(s.w,s.r) > best;
    const col1 = e.type==="w" ? `<input type="number" inputmode="decimal" step="0.5" min="0" id="w-${i}-${j}" data-f="w" data-j="${j}" value="${esc(s.w)}" placeholder="kg" aria-label="Weight kg">`
      : e.type==="min" ? `<input type="number" inputmode="decimal" step="0.1" min="0" id="w-${i}-${j}" data-f="w" data-j="${j}" value="${esc(s.w)}" placeholder="km" aria-label="Distance km (optional)">`
      : `<span class="muted small" style="text-align:center">${e.type==="t"?"hold":"body"}</span>`;
    return `<div class="grid5 set ${s.done?"isdone":""}">
      <button class="stype ${s.t}" data-stype="${j}" aria-label="Set type: ${({n:"normal",w:"warm-up",d:"drop set",f:"to failure"})[s.t]}. Tap to change">${isPR?'<span class="prb">PR</span>':""}${label}</button>
      <button class="prev" data-copy="${j}" ${p?"":"disabled"} aria-label="Copy last time's numbers">${prevTxt}</button>
      ${col1}
      <input type="number" inputmode="numeric" min="0" id="r-${i}-${j}" data-f="r" data-j="${j}" value="${esc(s.r)}" placeholder="${isWarm?"":it.lo+"–"+it.hi}" aria-label="${unitFor(e)}">
      <button class="tick" data-tick="${j}" aria-pressed="${!!s.done}" aria-label="Mark set done">✓</button></div>`; }).join("");
  const dr = openDrawer && openDrawer.i === i ? openDrawer.k : null;
  let drawer = "";
  if(dr === "more"){ const alts = (it.alts && it.alts.length ? it.alts : altsFor(it.ex)).filter(x => x !== it.ex && EX[x]);
    drawer = `<div class="drawer">
      <span class="label">Note for this exercise</span><input type="text" id="note-${i}" data-note="${i}" value="${esc(it.note)}" placeholder="e.g. seat height 4, left knee tight">
      <span class="label">Swap for (machine busy, no equipment, or it hurts)</span>
      <div class="chips">${alts.map(x => `<button class="chip" data-swap="${x}">${esc(EX[x].name)}</button>`).join("") || '<span class="muted">No similar exercises.</span>'}<button class="chip" data-swapany="1">Search all…</button></div>
      <div class="chips"><button class="chip" data-move="-1" ${i===0?"disabled":""}>Move up</button><button class="chip" data-move="1" ${i===a.items.length-1?"disabled":""}>Move down</button>
        <button class="chip" data-ss="1">${it.group?"Unlink superset":"Superset with next"}</button>
        <a class="chip" style="text-decoration:none" target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=${encodeURIComponent(e.name+" proper form")}">How-to video</a>
        <button class="chip" data-remove="1" style="color:var(--bad);border-color:var(--bad)">Remove exercise</button></div></div>`; }
  if(dr === "plates"){ const w = +((it.sets.find(s => s.t!=="w" && !s.done) || it.sets.find(s => s.t!=="w") || {}).w || 0); const pl = plates(w);
    drawer = `<div class="drawer"><span class="label">Plates per side for ${fmtKg(w)} kg (${fmtKg(S.settings.bar)} kg bar)</span>${!w?'<span class="muted">Enter a weight first.</span>':!pl?'<span class="muted">Lighter than the bar.</span>':`<div class="plates"><span class="sleeve"></span>${pl.out.map(p => `<span class="plate" style="background:${PLATE_COL[p]};height:${18+p*1.1}px">${fmtKg(p)}</span>`).join("") || '<span class="muted">Just the bar.</span>'}</div><span class="small">${pl.out.map(fmtKg).join(" + ") || "0"} each side${pl.left?` (${fmtKg(pl.left)} kg can't be made)`:""}</span>`}</div>`; }
  const ssLbl = inSS ? `<div class="sslabel">Superset ${esc(it.group)} · ${members.indexOf(i)+1} of ${members.length}${members.indexOf(i) < members.length-1 ? " · no rest, go straight to next" : " · rest after this"}</div>` : "";
  return `<div class="ex ${allDone?"complete":""} ${inSS?"ss":""}" data-i="${i}">${ssLbl}
    <div class="exhead"><div><h3>${esc(e.name)}</h3>${e.cue?`<p class="cue">${esc(e.cue)}</p>`:""}</div><span class="target">${it.n} × ${it.lo}–${it.hi}${e.type==="t"?"s":e.type==="min"?" min":""}</span></div>
    ${sg.tag?`<div class="hint"><span class="tag ${sg.up?"up":sg.down?"down":""}">${esc(sg.tag)}</span><span>${esc(sg.text)}</span></div>`:""}
    ${it.note && dr!=="more" ? `<div class="exnote">${esc(it.note)}</div>` : ""}
    <div class="grid5 colhead"><span>Set</span><span>Last</span><span>${e.type==="w"?"kg":e.type==="min"?"km":""}</span><span>${unitFor(e)}</span><span></span></div>
    ${rows}
    <div class="extools">
      <button class="chip" data-addset="1">+ Set</button>${work.length>1?'<button class="chip" data-rmset="1">− Set</button>':""}
      ${e.type==="w"?`<button class="chip" data-adj="-${stepFor(e)}">−${fmtKg(stepFor(e))} kg</button><button class="chip" data-adj="${stepFor(e)}">+${fmtKg(stepFor(e))} kg</button>`:""}
      ${e.eq==="bar"?`<button class="chip" data-drawer="plates" aria-pressed="${dr==="plates"}">Plates</button>`:""}
      <button class="chip" data-drawer="more" aria-pressed="${dr==="more"}">More</button></div>
    ${drawer}
    ${allDone?`<div class="rate"><span class="muted">How did that feel?</span>${[["easy","Easy"],["ideal","Good"],["hard","Hard"]].map(([k,l]) => `<button class="chip" data-r="${k}" aria-pressed="${it.rating===k}">${l}</button>`).join("")}</div>`:""}
  </div>`;
}
function countSets(){ const a = W(); let d=0,t=0; a.items.forEach(it => it.sets.forEach(s => { if(s.t!=="w"){ t++; if(s.done) d++; } })); return [d,t]; }
function renderWorkout(){
  const el = $("#tab-workout"); $("#liveDot").innerHTML = S.active ? '<span class="live"></span>' : "";
  if(!S.active){ const nx = nextRoutine();
    el.innerHTML = `<h2 style="margin-bottom:12px">Start a workout</h2><div class="stack">${S.routines.map(r => `<div class="card"><div class="between"><div><h3>${esc(r.name)}</h3><p class="small muted">${esc(r.sub||"")}${r.sub?" · ":""}${r.items.length} exercises</p></div><button class="btn sm" data-start="${esc(r.id)}">${nx&&r.id===nx.id?"Start (up next)":"Start"}</button></div></div>`).join("")}
      <div class="card"><div class="between"><div><h3>Empty workout</h3><p class="small muted">Pick exercises as you go</p></div><button class="btn sm ghost" data-start="__empty">Start</button></div></div></div>`;
    return; }
  const a = W(); const [d,t] = countSets();
  el.innerHTML = `<div class="wohead"><div class="between"><div><h2>${esc(a.name)}</h2><span class="clock" id="woClock">${hms((Date.now()-a.startedAt)/1000)}</span> <span class="clock">· <span id="woCount">${d}/${t}</span> sets</span></div>
      <button class="btn sm" id="finishBtn">Finish</button></div>
      ${finishConfirm?`<div class="confirm">${d<t?`${t-d} sets not ticked. They won't be saved.`:"Save this workout?"} <button class="btn sm" id="finishYes">Save</button><button class="btn sm danger" id="discardYes">Discard</button><button class="btn sm ghost" id="finishNo">Keep going</button></div>`:""}</div>
    <div id="items">${a.items.map((_,i) => itemHTML(i)).join("")}</div>
    <button class="btn ghost block" id="addExBtn" style="margin-bottom:12px">+ Add exercise</button>
    <input type="text" id="woNotes" class="full" placeholder="Workout notes (sleep, energy, anything sore)" value="${esc(a.notes)}">
    <p class="small muted" style="margin-top:10px">Tip: tap a set number to mark it as a Warm-up, Drop set or to Failure.</p>`;
}
function rerenderItem(i){ const old = document.querySelector(`.ex[data-i="${i}"]`); if(old) old.outerHTML = itemHTML(i); const c = $("#woCount"); if(c){ const [d,t] = countSets(); c.textContent = d+"/"+t; } }
function rerenderGroup(i){ groupMembers(i).forEach(rerenderItem); }

$("#tab-workout").addEventListener("input", e => {
  const t = e.target; if(!S.active) return;
  if(t.id === "woNotes"){ S.active.notes = t.value; save(); return; }
  if(t.dataset.note != null){ S.active.items[+t.dataset.note].note = t.value; save(); return; }
  const card = t.closest(".ex"); if(!card || !t.dataset.f) return; const i = +card.dataset.i, j = +t.dataset.j; const it = S.active.items[i];
  it.sets[j][t.dataset.f] = t.value;
  if(t.dataset.f === "w" && it.sets[j].t !== "w") it.sets.forEach((s,k) => { if(k > j && !s.done && s.t !== "w"){ s.w = t.value; const el = $(`#w-${i}-${k}`); if(el) el.value = t.value; } });
  save();
});
$("#tab-workout").addEventListener("click", async e => {
  const st = e.target.closest("[data-start]"); if(st){ startWorkout(st.dataset.start); return; }
  if(!S.active) return; const a = S.active;
  const id = e.target.id;
  if(id === "finishBtn"){ finishConfirm = true; renderWorkout(); return; }
  if(id === "finishNo"){ finishConfirm = false; renderWorkout(); return; }
  if(id === "discardYes"){ finishConfirm = false; S.active = null; save(); stopRest(); releaseWake(); renderAll(); toast("Workout discarded"); return; }
  if(id === "finishYes"){ finishConfirm = false; finishWorkout(); return; }
  if(id === "addExBtn"){ openPicker("workout"); return; }
  const card = e.target.closest(".ex"); if(!card) return; const i = +card.dataset.i; const it = a.items[i]; const ex = EX[it.ex] || {type:"w",inc:2.5};
  const tk = e.target.closest("[data-tick]");
  if(tk){ unlockAudio(); const j = +tk.dataset.tick; const s = it.sets[j]; s.done = !s.done;
    if(s.done){
      const wi = it.sets.slice(0,j+1).filter(x => x.t !== "w").length; const sg = suggest(it.ex, {sets:it.n, lo:it.lo, hi:it.hi}); const p = sg.prev[wi-1];
      if(s.r === ""){ s.r = String(p ? p.r : it.lo); }
      if(ex.type === "w" && s.w === ""){ toast("Enter the weight for this set"); s.done = false; rerenderItem(i); $(`#w-${i}-${j}`)?.focus(); return; }
      const best = bestE1(it.ex); if(s.t !== "w" && ex.type === "w" && best > 0 && e1rm(s.w,s.r) > best) toast(`New PR on ${ex.name}: ${fmtKg(s.w)} kg × ${s.r}`, "pr");
      const mem = groupMembers(i); const pos = mem.indexOf(i);
      if(mem.length > 1 && pos < mem.length-1 && s.t !== "w"){ toast(`Superset: go to ${exName(a.items[mem[pos+1]].ex)}`); stopRest(); }
      else { const restSec = s.t==="w" ? 60 : (it.rest || (ex.big ? S.settings.restBig : S.settings.restSmall)); const lastWork = it.sets.filter(x => x.t !== "w").every(x => x.done); startRest(restSec, lastWork && (mem.length===1 || pos===mem.length-1) ? "Next exercise" : "Rest"); }
    }
    save(); rerenderItem(i); return; }
  const ty = e.target.closest("[data-stype]"); if(ty){ const s = it.sets[+ty.dataset.stype]; const order = ["n","w","d","f"]; s.t = order[(order.indexOf(s.t||"n")+1) % 4]; save(); rerenderItem(i); toast(({n:"Normal set",w:"Warm-up set (not counted)",d:"Drop set",f:"Set to failure"})[s.t]); return; }
  const cp = e.target.closest("[data-copy]"); if(cp){ const j = +cp.dataset.copy; const wi = it.sets.slice(0,j+1).filter(x => x.t !== "w").length; const p = suggest(it.ex, {sets:it.n, lo:it.lo, hi:it.hi}).prev[wi-1]; if(p){ if(ex.type==="w"||ex.type==="min") it.sets[j].w = String(p.w); it.sets[j].r = String(p.r); save(); rerenderItem(i); } return; }
  if(e.target.closest("[data-addset]")){ const l = it.sets[it.sets.length-1]; it.sets.push({w:l?l.w:"", r:"", done:false, t:"n"}); save(); rerenderItem(i); return; }
  if(e.target.closest("[data-rmset]")){ let idx = -1; it.sets.forEach((s,k) => { if(s.t!=="w" && !s.done) idx = k; }); if(idx >= 0){ it.sets.splice(idx,1); save(); rerenderItem(i); } else toast("Only unticked sets can be removed"); return; }
  const adj = e.target.closest("[data-adj]"); if(adj){ const d = +adj.dataset.adj; it.sets.forEach(s => { if(!s.done && s.t !== "w") s.w = String(Math.max(0, +((+s.w||0)+d).toFixed(2))); }); save(); rerenderItem(i); return; }
  const dw = e.target.closest("[data-drawer]"); if(dw){ openDrawer = openDrawer && openDrawer.i===i && openDrawer.k===dw.dataset.drawer ? null : {i, k:dw.dataset.drawer}; rerenderItem(i); return; }
  const sw = e.target.closest("[data-swap]"); if(sw){ swapItem(i, sw.dataset.swap); return; }
  if(e.target.closest("[data-swapany]")){ openPicker("swap", i); return; }
  const mv = e.target.closest("[data-move]"); if(mv){ const d = +mv.dataset.move; const j = i+d; if(j<0 || j>=a.items.length) return; [a.items[i], a.items[j]] = [a.items[j], a.items[i]]; openDrawer = {i:j, k:"more"}; save(); renderWorkout(); return; }
  if(e.target.closest("[data-ss]")){ if(it.group){ const g = it.group; a.items.forEach(x => { if(x.group === g) x.group = null; }); }
    else { if(i >= a.items.length-1){ toast("Add another exercise after this one first"); return; } const used = new Set(a.items.map(x => x.group).filter(Boolean)); const g = (a.items[i+1].group) || "ABCDEFGH".split("").find(c => !used.has(c)); it.group = g; a.items[i+1].group = g; }
    openDrawer = null; save(); renderWorkout(); return; }
  if(e.target.closest("[data-remove]")){ if(it.sets.some(s => s.done)){ toast("This exercise has ticked sets. Untick them first to remove it."); return; } a.items.splice(i,1); openDrawer = null; save(); renderWorkout(); return; }
  const rt = e.target.closest("[data-r]"); if(rt){ it.rating = it.rating === rt.dataset.r ? null : rt.dataset.r; save(); rerenderItem(i);
    if(it.rating){ const nxt = document.querySelector(`.ex[data-i="${i+1}"]`); if(nxt) nxt.scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth", block:"start"}); } return; }
});
function swapItem(i, exId){
  const it = S.active.items[i]; if(it.sets.some(s => s.done)){ toast("Swap before ticking any sets"); return; }
  const n = makeItem({ex:exId, sets:it.n, lo:it.lo, hi:it.hi, rest:it.rest, group:it.group, alts:it.alts}); n.note = it.note; S.active.items[i] = n;
  openDrawer = null; save(); rerenderItem(i); toast("Swapped to " + exName(exId));
}
function releaseWake(){ try{ wakeLock && wakeLock.release(); }catch(x){} }
function finishWorkout(){
  const a = S.active; const items = []; let n = 0, vol = 0; const prs = [];
  for(const it of a.items){ const e = EX[it.ex]; const done = it.sets.filter(s => s.done && +s.r > 0).map(s => ({w:s.w===""?0:+s.w, r:+s.r, t:s.t||"n"}));
    if(!done.length) continue; const before = bestE1(it.ex);
    items.push({ex:it.ex, sets:done, rating:it.rating||null, note:it.note||""});
    const w = working(done); n += w.length; if(e && e.type === "w") w.forEach(s => vol += s.w*s.r);
    if(e && e.type === "w" && before > 0 && w.length){ const top = w.reduce((x,s) => e1rm(s.w,s.r) > e1rm(x.w,x.r) ? s : x); if(e1rm(top.w,top.r) > before) prs.push(`${e.name}: ${fmtKg(top.w)} kg × ${top.r}`); }
    if(a.routine && it.note){ const r = S.routines.find(x => x.id === a.routine); const ri = r && r.items.find(x => x.ex === it.ex); if(ri) ri.note = it.note; } }
  if(!items.length){ toast("Tick at least one set before saving, or discard."); return; }
  const dur = Math.round((Date.now() - a.startedAt)/1000);
  S.sessions.push({id:uid("s"), routine:a.routine, name:a.name, date:a.date, ts:Date.now(), dur, items, notes:a.notes||""});
  S.active = null; save(); stopRest(); releaseWake();
  try{ navigator.storage && navigator.storage.persist && navigator.storage.persist(); }catch(e){}
  const nx = nextRoutine();
  sheet(`<span class="label">Workout saved</span><div class="big">${esc(a.name)} done</div>
    <div class="stats"><div class="stat"><div class="v">${Math.round(dur/60)}</div><div class="k">Minutes</div></div><div class="stat"><div class="v">${n}</div><div class="k">Working sets</div></div><div class="stat"><div class="v">${Math.round(vol).toLocaleString()}</div><div class="k">kg lifted</div></div></div>
    ${prs.length?`<div class="card"><h3 style="margin-bottom:4px">New personal bests</h3>${prs.map(p => `<div class="pr"><span>${esc(p)}</span><span class="val" style="color:var(--pr)">PR</span></div>`).join("")}</div>`:""}
    ${nx?`<div class="card"><h3>Next up: ${esc(nx.name)}</h3><p class="small muted">${esc(nx.sub||"")}. Get some protein in and hit your steps.</p></div>`:""}
    <button class="btn ghost block" id="sumAI">Ask Claude to review this workout</button>
    <button class="btn block" data-close>Done</button>`);
  $("#sumAI").onclick = () => openAI("review");
  renderAll(); showTab("home");
}

/* rest timer */
let restEnd = 0, restLen = 0, restTick = null, restBeeped = false;
function startRest(sec, lbl){ restLen = sec; restEnd = Date.now() + sec*1000; restBeeped = false; $("#restLbl").textContent = lbl; $("#rest").hidden = false; $("#rest").classList.remove("over"); clearInterval(restTick); restTick = setInterval(tickRest, 250); tickRest(); }
function stopRest(){ clearInterval(restTick); $("#rest").hidden = true; }
function tickRest(){ const left = (restEnd - Date.now())/1000; $("#restT").textContent = left >= 0 ? mmss(left) : "+" + mmss(-left); $("#restBar").style.width = Math.max(0, Math.min(100, (1 - left/restLen)*100)) + "%";
  if(left <= 0 && !restBeeped){ restBeeped = true; $("#rest").classList.add("over"); $("#restLbl").textContent = "Go: next set"; beep(); try{ navigator.vibrate && navigator.vibrate([200,100,200]); }catch(e){} }
  if(left < -30) stopRest(); }
$("#restMinus").onclick = () => { restEnd -= 15000; restLen = Math.max(15, restLen-15); tickRest(); };
$("#restPlus").onclick = () => { restEnd += 15000; restLen += 15; restBeeped = false; $("#rest").classList.remove("over"); tickRest(); };
$("#restSkip").onclick = stopRest;
setInterval(() => { const c = $("#woClock"); if(c && S.active) c.textContent = hms((Date.now() - S.active.startedAt)/1000); }, 1000);

/* ================= exercise picker (library sheet) ================= */
let pick = {mode:null, idx:null, q:"", m:"All", picked:[]};
function libFilter(q, m, eq){
  q = q.trim().toLowerCase();
  return Object.values(EX).filter(e => (m==="All" || (m==="Cardio" ? e.type==="min" : m==="Custom" ? e.custom : e.m.includes(m))) && (!eq || eq==="all" || e.eq===eq) && (!q || e.name.toLowerCase().includes(q) || e.m.join(" ").toLowerCase().includes(q)))
    .sort((a,b) => a.name.localeCompare(b.name));
}
function openPicker(mode, idx){
  pick = {mode, idx, q:"", m:"All", picked:[]};
  const title = mode==="swap" ? "Swap exercise" : mode==="routine" ? "Add to routine" : "Add exercise";
  sheet(`<div class="sheethead"><h2>${title}</h2><button class="btn sm" id="pickDone">${mode==="swap"?"Cancel":"Done"}</button></div>
    <input type="search" id="pickQ" class="full" placeholder="Search ${Object.keys(EX).length} exercises" aria-label="Search exercises">
    <div class="chips scroll" id="pickM">${["All",...MUSCLES,"Cardio","Custom"].map(m => `<button class="chip" data-m="${m}" aria-pressed="${m==="All"}">${m}</button>`).join("")}</div>
    <div class="card" id="pickList" style="padding-block:4px"></div>`);
  renderPickList(); $("#pickQ").focus();
  $("#pickQ").oninput = e => { pick.q = e.target.value; renderPickList(); };
  $("#pickM").onclick = e => { const b = e.target.closest("[data-m]"); if(!b) return; pick.m = b.dataset.m; document.querySelectorAll("#pickM .chip").forEach(c => c.setAttribute("aria-pressed", c===b)); renderPickList(); };
  $("#pickDone").onclick = () => { closeSheet(); if(pick.mode==="routine") renderEditor(); };
  $("#pickList").onclick = e => { const b = e.target.closest("[data-pick]"); if(!b) return; const id = b.dataset.pick;
    if(pick.mode === "swap"){ closeSheet(); swapItem(pick.idx, id); return; }
    if(pick.mode === "workout"){ const e2 = EX[id]; const spec = e2.type==="t" ? {ex:id,sets:3,lo:30,hi:60} : e2.type==="min" ? {ex:id,sets:1,lo:15,hi:30} : e2.big ? {ex:id,sets:3,lo:5,hi:8} : {ex:id,sets:3,lo:8,hi:12};
      S.active.items.push(makeItem(spec)); save(); renderWorkout(); toast("Added " + e2.name); return; }
    if(pick.mode === "routine"){ const e2 = EX[id]; editing.items.push(e2.type==="t" ? {ex:id,sets:3,lo:30,hi:60} : e2.type==="min" ? {ex:id,sets:1,lo:15,hi:30} : e2.big ? {ex:id,sets:4,lo:5,hi:8} : {ex:id,sets:3,lo:8,hi:12}); toast("Added " + e2.name); b.textContent = "Added ✓"; } };
}
function renderPickList(){
  const list = libFilter(pick.q, pick.m).slice(0, 150);
  $("#pickList").innerHTML = list.length ? list.map(e => `<div class="ritem"><div><div>${esc(e.name)}</div><div class="small muted">${esc(e.m.join(", "))} · ${EQUIP[e.eq]||e.eq}</div></div><button class="btn sm ${pick.mode==="swap"?"":"ghost"}" data-pick="${e.id}">${pick.mode==="swap"?"Use":"Add"}</button></div>`).join("") : `<div class="empty">No matches. Create it in the Exercises tab.</div>`;
}

/* ================= ROUTINES ================= */
let editing = null, editConfirmDel = false;
function renderRoutines(){
  const el = $("#tab-routines"); const nx = nextRoutine();
  el.innerHTML = `<div class="between"><h2>Routines</h2><button class="btn sm" id="newRoutine">+ New</button></div>
    <p class="small muted">Routines marked <b>In rotation</b> cycle as "Up next" in this order. Use the arrows to reorder.</p>
    ${S.routines.map((r,i) => `<div class="card" data-rid="${esc(r.id)}">
      <div class="between"><div style="min-width:0"><h3>${esc(r.name)}${nx&&nx.id===r.id&&!S.active?' <span class="label" style="color:var(--accent)">Up next</span>':""}</h3><p class="small muted">${esc(r.sub||"")}${r.sub?" · ":""}${r.items.length} exercises</p></div>
        <div class="row"><button class="mini" data-rmove="-1" aria-label="Move up" ${i===0?"disabled":""}>↑</button><button class="mini" data-rmove="1" aria-label="Move down" ${i===S.routines.length-1?"disabled":""}>↓</button></div></div>
      <p class="small" style="margin-top:6px">${r.items.map(it => esc(exName(it.ex))).join(" · ")}</p>
      <div class="row" style="margin-top:10px"><button class="btn sm" data-rstart="1">Start</button><button class="btn sm ghost" data-redit="1">Edit</button><button class="btn sm ghost" data-rdup="1">Duplicate</button>
        <button class="chip" data-rrot="1" aria-pressed="${r.rotate!==false}">${r.rotate!==false?"In rotation":"Not in rotation"}</button></div></div>`).join("")}
    <div class="card"><h3>Get routines from Claude</h3><p class="small muted" style="margin:4px 0 10px">Describe what you want and Claude writes a routine you can paste straight in.</p>
      <div class="row"><button class="btn sm" data-ai="routine">Design with Claude</button><button class="btn sm ghost" data-ai="import">Paste routine</button></div></div>
    <button class="btn ghost block" id="restoreDefaults">Restore default routines (Gym A, Home, Gym B)</button>`;
}
$("#tab-routines").addEventListener("click", e => {
  const ai = e.target.closest("[data-ai]"); if(ai){ openAI(ai.dataset.ai); return; }
  if(e.target.id === "newRoutine"){ openEditor({id:uid("r"), name:"New routine", sub:"", items:[], rotate:false}, true); return; }
  if(e.target.id === "restoreDefaults"){ let n = 0; DEFAULT_ROUTINES.forEach(d => { if(!S.routines.some(r => r.id === d.id)){ S.routines.push(clone(d)); n++; } }); save(); renderAll(); toast(n ? `Restored ${n} routine${n>1?"s":""}` : "Defaults are already there"); return; }
  const card = e.target.closest("[data-rid]"); if(!card) return; const idx = S.routines.findIndex(r => r.id === card.dataset.rid); const r = S.routines[idx];
  if(e.target.closest("[data-rstart]")){ startWorkout(r.id); return; }
  if(e.target.closest("[data-redit]")){ openEditor(clone(r), false); return; }
  if(e.target.closest("[data-rdup]")){ const c = clone(r); c.id = uid("r"); c.name = r.name + " copy"; c.rotate = false; S.routines.splice(idx+1, 0, c); save(); renderAll(); toast("Duplicated"); return; }
  if(e.target.closest("[data-rrot]")){ r.rotate = r.rotate === false; save(); renderAll(); return; }
  const mv = e.target.closest("[data-rmove]"); if(mv){ const j = idx + +mv.dataset.rmove; if(j<0 || j>=S.routines.length) return; [S.routines[idx], S.routines[j]] = [S.routines[j], S.routines[idx]]; save(); renderAll(); }
});
function openEditor(r, isNew){ editing = r; editing._new = isNew; editConfirmDel = false; renderEditor(); }
function renderEditor(){
  const r = editing; if(!r) return;
  sheet(`<div class="sheethead"><h2>${r._new?"New routine":"Edit routine"}</h2><div class="row"><button class="btn sm ghost" data-close>Cancel</button><button class="btn sm" id="edSave">Save</button></div></div>
    <div class="card stack"><label class="small" for="edName">Name</label><input type="text" id="edName" value="${esc(r.name)}" maxlength="40">
      <label class="small" for="edSub">Description</label><input type="text" id="edSub" value="${esc(r.sub||"")}" maxlength="60" placeholder="e.g. Heavy legs + push">
      <label class="row small"><input type="checkbox" id="edRot" ${r.rotate!==false?"checked":""}> Include in "Up next" rotation</label></div>
    <div class="card" id="edItems" style="padding-block:4px">${r.items.length ? r.items.map((it,i) => { const e = EX[it.ex] || {name:it.ex,type:"w"}; const prevG = i>0 && r.items[i-1].group && r.items[i-1].group===it.group;
      return `<div class="ritem" data-ei="${i}"><div style="min-width:0"><div>${esc(e.name)}${it.group?`<span class="ssbadge">SS ${esc(it.group)}</span>`:""}</div>
        <div class="rnums"><label>Sets<input type="number" min="1" max="10" data-ef="sets" value="${it.sets}"></label><label>${e.type==="t"?"Min s":e.type==="min"?"Min min":"Min reps"}<input type="number" min="1" max="600" data-ef="lo" value="${it.lo}"></label><label>${e.type==="t"?"Max s":e.type==="min"?"Max min":"Max reps"}<input type="number" min="1" max="600" data-ef="hi" value="${it.hi}"></label><label>Rest s<input type="number" min="0" max="600" step="15" data-ef="rest" value="${it.rest||""}" placeholder="auto"></label></div></div>
        <div class="stack" style="gap:4px"><button class="mini" data-eup="1" aria-label="Move up" ${i===0?"disabled":""}>↑</button><button class="mini" data-edown="1" aria-label="Move down" ${i===r.items.length-1?"disabled":""}>↓</button><button class="mini" data-ess="1" aria-label="${it.group?"Unlink superset":"Superset with next"}" title="Superset with next">${it.group?"⛓̸":"⛓"}</button><button class="mini" data-edel="1" aria-label="Remove" style="color:var(--bad)">✕</button></div></div>`; }).join("") : `<div class="empty">No exercises yet.</div>`}</div>
    <button class="btn ghost block" id="edAdd">+ Add exercises</button>
    <p class="small muted">⛓ links an exercise with the one below it as a superset: do one set of each back to back, then rest. "Rest: auto" uses your settings (longer for big lifts).</p>
    ${r._new?"":`${editConfirmDel?`<div class="confirm">Delete this routine? Past workouts stay in your history. <button class="btn sm danger" id="edDelYes">Delete</button><button class="btn sm ghost" id="edDelNo">Keep</button></div>`:`<button class="btn danger block" id="edDel">Delete routine</button>`}`}`);
  const pull = () => { r.name = $("#edName").value.trim() || "Routine"; r.sub = $("#edSub").value.trim(); r.rotate = $("#edRot").checked; };
  $("#edItems").oninput = e => { const row = e.target.closest("[data-ei]"); const f = e.target.dataset.ef; if(!row || !f) return; const it = r.items[+row.dataset.ei]; const v = parseInt(e.target.value,10); it[f] = f==="rest" ? (v>0 ? v : null) : (Number.isFinite(v) ? v : it[f]); };
  $("#edItems").onclick = e => { const row = e.target.closest("[data-ei]"); if(!row) return; pull(); const i = +row.dataset.ei;
    if(e.target.closest("[data-eup]") && i>0){ [r.items[i-1], r.items[i]] = [r.items[i], r.items[i-1]]; }
    else if(e.target.closest("[data-edown]") && i<r.items.length-1){ [r.items[i+1], r.items[i]] = [r.items[i], r.items[i+1]]; }
    else if(e.target.closest("[data-edel]")){ r.items.splice(i,1); }
    else if(e.target.closest("[data-ess]")){ const it = r.items[i]; if(it.group){ const g = it.group; r.items.forEach(x => { if(x.group===g) x.group = null; }); } else { if(i >= r.items.length-1){ toast("Add an exercise below this one first"); return; } const used = new Set(r.items.map(x => x.group).filter(Boolean)); const g = r.items[i+1].group || "ABCDEFGH".split("").find(c => !used.has(c)); it.group = g; r.items[i+1].group = g; } }
    else return; renderEditor(); };
  $("#edAdd").onclick = () => { pull(); openPicker("routine"); };
  $("#edSave").onclick = () => { pull(); if(!r.items.length){ toast("Add at least one exercise"); return; }
    r.items.forEach(it => { it.sets = clampInt(it.sets,1,10,3); it.lo = clampInt(it.lo,1,600,8); it.hi = Math.max(it.lo, clampInt(it.hi,1,600,12)); });
    const isNew = r._new; delete r._new; const i = S.routines.findIndex(x => x.id === r.id); if(i>=0) S.routines[i] = r; else S.routines.push(r);
    save(); editing = null; closeSheet(); renderAll(); toast(isNew ? "Routine created" : "Routine saved"); };
  const del = $("#edDel"); if(del) del.onclick = () => { pull(); editConfirmDel = true; renderEditor(); };
  const dy = $("#edDelYes"); if(dy) dy.onclick = () => { S.routines = S.routines.filter(x => x.id !== r.id); save(); editing = null; closeSheet(); renderAll(); toast("Routine deleted"); };
  const dn = $("#edDelNo"); if(dn) dn.onclick = () => { editConfirmDel = false; renderEditor(); };
}

/* ================= LIBRARY ================= */
let lib = {q:"", m:"All", eq:"all", open:null, creating:false};
function renderLibrary(){
  const el = $("#tab-library");
  el.innerHTML = `<div class="between"><h2>Exercises</h2><button class="btn sm" id="newEx">+ Create</button></div>
    <input type="search" id="libQ" class="full" placeholder="Search ${Object.keys(EX).length} exercises" value="${esc(lib.q)}" aria-label="Search exercises">
    <div class="chips scroll" id="libM">${["All",...MUSCLES,"Cardio","Custom"].map(m => `<button class="chip" data-m="${m}" aria-pressed="${lib.m===m}">${m}</button>`).join("")}</div>
    <select id="libEq" aria-label="Equipment"><option value="all">All equipment</option>${Object.entries(EQUIP).map(([k,v]) => `<option value="${k}" ${lib.eq===k?"selected":""}>${v}</option>`).join("")}</select>
    ${lib.creating ? createForm() : ""}
    <div class="card" id="libList" style="padding-block:4px"></div>`;
  renderLibList();
}
function createForm(){
  return `<div class="card stack"><h3>New exercise</h3>
    <label class="small" for="cxName">Name</label><input type="text" id="cxName" maxlength="40" placeholder="e.g. Landmine press">
    <div class="row"><label class="small">Type <select id="cxType"><option value="w">Weight + reps</option><option value="bw">Bodyweight reps</option><option value="t">Timed hold</option><option value="min">Cardio (minutes)</option></select></label>
      <label class="small">Equipment <select id="cxEq">${Object.entries(EQUIP).map(([k,v]) => `<option value="${k}">${v}</option>`).join("")}</select></label></div>
    <div class="row"><label class="small">Main muscle <select id="cxM">${MUSCLES.map(m => `<option>${m}</option>`).join("")}</select></label>
      <label class="small">Also works <select id="cxM2"><option value="">None</option>${MUSCLES.map(m => `<option>${m}</option>`).join("")}</select></label></div>
    <label class="small" for="cxCue">Form cue (optional)</label><input type="text" id="cxCue" maxlength="120">
    <div class="row"><button class="btn sm" id="cxSave">Save exercise</button><button class="btn sm ghost" id="cxCancel">Cancel</button></div></div>`;
}
function renderLibList(){
  const list = libFilter(lib.q, lib.m, lib.eq);
  $("#libList").innerHTML = list.length ? list.map(e => { const open = lib.open === e.id; let body = "";
    if(open){ const h = histFor(e.id); const best = h.length ? (e.type==="w" ? (() => { let b = null; h.forEach(x => x.sets.forEach(s => { if(!b || e1rm(s.w,s.r) > e1rm(b.w,b.r)) b = s; })); return `${fmtKg(b.w)} kg × ${b.r}`; })() : `${Math.max(...h.flatMap(x => x.sets.map(s => +s.r)))} ${unitFor(e)}`) : null;
      body = `<div class="body">${e.cue?`<p>${esc(e.cue)}</p>`:""}<p class="muted">Works: ${esc(e.m.join(", "))} · ${EQUIP[e.eq]||e.eq}</p>
        ${h.length?`<p>Done ${h.length} time${h.length>1?"s":""}. Last ${fmtDate(h[0].date)}. Best: <b>${best}</b></p>`:`<p class="muted">Not done yet.</p>`}
        <div class="row"><a class="btn sm ghost" style="text-decoration:none" target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=${encodeURIComponent(e.name+" proper form")}">How-to video</a>
          <select data-addto="${e.id}" aria-label="Add to routine"><option value="">Add to routine…</option>${S.routines.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("")}</select>
          ${S.active?`<button class="btn sm ghost" data-addwo="${e.id}">Add to workout</button>`:""}
          ${e.custom?`<button class="btn sm danger" data-delex="${e.id}">Delete</button>`:""}</div></div>`; }
    return `<div class="libitem"><button data-open="${e.id}" aria-expanded="${open}"><span><span>${esc(e.name)}</span><br><span class="meta">${esc(e.m.join(", "))} · ${EQUIP[e.eq]||e.eq}${e.custom?" · custom":""}</span></span><span class="muted" aria-hidden="true">${open?"−":"+"}</span></button>${body}</div>`; }).join("")
    : `<div class="empty">No exercises match. Tap <b>+ Create</b> to add your own.</div>`;
}
$("#tab-library").addEventListener("input", e => { if(e.target.id === "libQ"){ lib.q = e.target.value; renderLibList(); } });
$("#tab-library").addEventListener("change", e => {
  if(e.target.id === "libEq"){ lib.eq = e.target.value; renderLibList(); return; }
  const at = e.target.dataset.addto; if(at && e.target.value){ const r = S.routines.find(x => x.id === e.target.value); const ex = EX[at]; if(r){ r.items.push(ex.type==="t" ? {ex:at,sets:3,lo:30,hi:60} : ex.type==="min" ? {ex:at,sets:1,lo:15,hi:30} : ex.big ? {ex:at,sets:4,lo:5,hi:8} : {ex:at,sets:3,lo:8,hi:12}); save(); renderRoutines(); renderHome(); toast(`Added to ${r.name}`); } e.target.value = ""; }
});
$("#tab-library").addEventListener("click", e => {
  if(e.target.id === "newEx"){ lib.creating = !lib.creating; renderLibrary(); if(lib.creating) $("#cxName").focus(); return; }
  if(e.target.id === "cxCancel"){ lib.creating = false; renderLibrary(); return; }
  if(e.target.id === "cxSave"){ const name = $("#cxName").value.trim(); if(!name){ toast("Give the exercise a name"); return; }
    let id = "c_" + slug(name); let k = 2; while(EX[id]) id = "c_" + slug(name) + "-" + (k++);
    const m = [$("#cxM").value]; if($("#cxM2").value && $("#cxM2").value !== m[0]) m.push($("#cxM2").value);
    const type = $("#cxType").value; const eq = $("#cxEq").value;
    S.custom[id] = {id, name, type, eq, inc: type==="w" ? (eq==="db"?2:eq==="machine"?5:2.5) : 0, m: type==="min" ? ["Cardio"] : m, cue:$("#cxCue").value.trim()};
    mergeCustom(); save(); lib.creating = false; lib.q = name; lib.m = "All"; lib.open = id; renderLibrary(); toast("Exercise created"); return; }
  const mb = e.target.closest("#libM [data-m]"); if(mb){ lib.m = mb.dataset.m; document.querySelectorAll("#libM .chip").forEach(c => c.setAttribute("aria-pressed", c===mb)); renderLibList(); return; }
  const op = e.target.closest("[data-open]"); if(op){ lib.open = lib.open === op.dataset.open ? null : op.dataset.open; renderLibList(); return; }
  const aw = e.target.closest("[data-addwo]"); if(aw && S.active){ const id = aw.dataset.addwo; const ex = EX[id]; S.active.items.push(makeItem(ex.type==="t" ? {ex:id,sets:3,lo:30,hi:60} : ex.type==="min" ? {ex:id,sets:1,lo:15,hi:30} : {ex:id,sets:3,lo:8,hi:12})); save(); renderWorkout(); toast("Added to workout"); return; }
  const de = e.target.closest("[data-delex]"); if(de){ const id = de.dataset.delex; if(S.routines.some(r => r.items.some(i => i.ex === id))){ toast("It's used in a routine. Remove it there first."); return; } delete S.custom[id]; delete EX[id]; save(); lib.open = null; renderLibrary(); toast("Exercise deleted"); }
});

/* ================= PROGRESS ================= */
function niceTicks(min, max, n=4){ if(min === max){ min -= 1; max += 1; } const step0 = (max-min)/n; const mag = Math.pow(10, Math.floor(Math.log10(step0))); const step = [1,2,2.5,5,10].map(m => m*mag).find(s => s >= step0); const lo = Math.floor(min/step)*step, hi = Math.ceil(max/step)*step; const t = []; for(let v=lo; v<=hi+1e-9; v+=step) t.push(+v.toFixed(2)); return t; }
function lineChart(pts, unit){
  if(pts.length < 2) return `<div class="empty">${pts.length ? "One entry so far. Log another to see the trend." : "Nothing logged yet."}</div>`;
  const Wd=600, H=220, L=44, R=14, T=16, B=30; const xs = pts.map(p => p.x), ys = pts.map(p => p.y); const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const ticks = niceTicks(Math.min(...ys), Math.max(...ys)); const y0 = ticks[0], y1 = ticks[ticks.length-1];
  const sx = x => L + (x-x0)/((x1-x0)||1)*(Wd-L-R), sy = y => T + (1-(y-y0)/((y1-y0)||1))*(H-T-B);
  const path = pts.map((p,i) => (i?"L":"M") + sx(p.x).toFixed(1) + "," + sy(p.y).toFixed(1)).join("");
  const area = path + `L${sx(x1).toFixed(1)},${H-B}L${sx(x0).toFixed(1)},${H-B}Z`; const last = pts[pts.length-1];
  const fmt = t => new Date(t).toLocaleDateString(undefined,{day:"numeric",month:"short"});
  return `<svg viewBox="0 0 ${Wd} ${H}" role="img" aria-label="Trend in ${unit}">${ticks.map(t => `<line x1="${L}" x2="${Wd-R}" y1="${sy(t)}" y2="${sy(t)}" stroke="var(--line)"/><text x="${L-8}" y="${sy(t)+4}" text-anchor="end" font-size="11" font-family="IBM Plex Mono, monospace" fill="var(--muted)">${t}</text>`).join("")}
    <path d="${area}" fill="var(--accent)" fill-opacity="0.10"/><path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${pts.map(p => `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="3" fill="var(--surface)" stroke="var(--accent)" stroke-width="2"/>`).join("")}
    <circle cx="${sx(last.x)}" cy="${sy(last.y)}" r="5.5" fill="var(--accent)"/><text x="${Math.min(sx(last.x), Wd-R-4)}" y="${Math.max(sy(last.y)-12, 12)}" text-anchor="end" font-size="12" font-weight="600" font-family="Public Sans, sans-serif" fill="var(--ink)">${last.y.toFixed(1)} ${unit}</text>
    <text x="${L}" y="${H-8}" font-size="11" font-family="IBM Plex Mono, monospace" fill="var(--muted)">${fmt(x0)}</text><text x="${Wd-R}" y="${H-8}" text-anchor="end" font-size="11" font-family="IBM Plex Mono, monospace" fill="var(--muted)">${fmt(x1)}</text></svg>`;
}
let progLift = null, histDel = null, histLimit = 20;
function renderProgress(){
  const el = $("#tab-progress"); const s = sessions(); const ws = iso(weekStart(new Date())); const thisWeek = s.filter(x => x.date >= ws).length;
  const byWeek = {}; s.forEach(x => { const k = iso(weekStart(new Date(x.date+"T12:00:00"))); byWeek[k] = (byWeek[k]||0)+1; });
  let streak = 0; const w = weekStart(new Date()); if((byWeek[iso(w)]||0) < 2) w.setDate(w.getDate()-7); while((byWeek[iso(w)]||0) >= 2){ streak++; w.setDate(w.getDate()-7); }
  const has = new Set(); s.forEach(x => (x.items||[]).forEach(i => has.add(i.ex)));
  const wEx = Object.keys(EX).filter(k => EX[k].type === "w" && has.has(k));
  if(!progLift || !has.has(progLift)) progLift = wEx[0] || null;
  const vol = setsPerMuscle(7); const mx = 24;
  const prRows = [...has].filter(k => EX[k]).map(k => { const e = EX[k]; const h = histFor(k); if(!h.length) return "";
    let txt; if(e.type === "w"){ let b = null; h.forEach(x => x.sets.forEach(z => { if(!b || e1rm(z.w,z.r) > e1rm(b.w,b.r)) b = z; })); txt = `${fmtKg(b.w)} kg × ${b.r}`; }
    else txt = `${Math.max(...h.flatMap(x => x.sets.map(z => +z.r)))} ${unitFor(e)}`;
    return `<div class="pr"><span>${esc(e.name)}</span><span class="val">${txt}</span></div>`; }).join("");
  el.innerHTML = `<h2>Progress</h2>
    <div class="stats"><div class="stat"><div class="v">${thisWeek}<span style="font-size:1rem;color:var(--muted)">/${S.settings.weekTarget}</span></div><div class="k">Workouts this week</div></div><div class="stat"><div class="v">${streak}</div><div class="k">Weeks in a row with 2+</div></div><div class="stat"><div class="v">${s.length}</div><div class="k">Total workouts</div></div></div>
    <div class="card"><div class="between" style="margin-bottom:8px"><h3>Strength</h3>${wEx.length?`<select id="liftSel" aria-label="Choose lift">${wEx.map(k => `<option value="${k}" ${k===progLift?"selected":""}>${esc(EX[k].name)}</option>`).join("")}</select>`:""}</div>
      <div class="chart" id="liftChart"></div><p class="small muted">Estimated 1-rep max from your best set each session.</p></div>
    <div class="card"><div class="between" style="margin-bottom:8px"><h3>Sets per muscle, last 7 days</h3><span class="label">Green = 10–20</span></div>
      <div class="vol">${BODY.map(m => `<div class="r"><span>${m}</span><div class="vtrack"><div class="band" style="left:${10/mx*100}%;width:${10/mx*100}%"></div><i style="width:${Math.min(100, vol[m]/mx*100)}%"></i></div><span>${+vol[m].toFixed(1)}</span></div>`).join("")}<p class="small muted">Main muscle counts 1 per set, secondary ½. Warm-ups don't count.</p></div></div>
    <div class="card"><h3 style="margin-bottom:8px">Body weight</h3><div class="chart">${lineChart(S.bw.slice().sort((a,b) => a.date.localeCompare(b.date)).map(x => ({x:new Date(x.date+"T12:00:00").getTime(), y:+x.kg})), "kg")}</div></div>
    <div class="card"><h3 style="margin-bottom:4px">Personal bests</h3>${prRows || `<div class="empty">Your best sets show up here after your first workout.</div>`}</div>
    <h2 style="margin-top:8px">History</h2>
    <div class="stack" id="hist">${historyHTML(s)}</div>`;
  renderLift();
}
function historyHTML(s){
  if(!s.length) return `<div class="empty">No workouts yet. Start one from Home and tap <b>Finish</b> when you're done.</div>`;
  return s.slice(0, histLimit).map(x => { let vol = 0, n = 0;
    const items = (x.items||[]).map(it => { const e = EX[it.ex] || {name:it.ex,type:"w"};
      working(it.sets||[]).forEach(y => { if(e.type==="w") vol += y.w*y.r; n++; });
      const t = (it.sets||[]).map(y => (y.t==="w"?"W ":y.t==="d"?"D ":y.t==="f"?"F ":"") + (e.type==="w" ? `${fmtKg(y.w)}×${y.r}` : e.type==="min" ? `${y.r}m` : `${y.r}${e.type==="t"?"s":""}`)).join("  ");
      return `<li><span>${esc(e.name)}${it.rating?` <span class="label">${it.rating==="ideal"?"good":it.rating}</span>`:""}${it.note?`<br><span class="small">${esc(it.note)}</span>`:""}</span><span>${t}</span></li>`; }).join("");
    return `<div class="card hitem"><div class="between"><div><h3>${esc(x.name||"Workout")} · ${fmtDate(x.date)}</h3><p class="small muted">${n} sets${vol?` · ${Math.round(vol).toLocaleString()} kg`:""}${x.dur?` · ${Math.round(x.dur/60)} min`:""}</p></div><button class="btn sm ghost" data-del="${x.id}">Delete</button></div>
      ${x.notes?`<p class="small muted" style="margin-top:4px">${esc(x.notes)}</p>`:""}<ul>${items}</ul>
      ${histDel===x.id?`<div class="confirm">Delete this workout for good? <button class="btn sm danger" data-yes="${x.id}">Delete</button><button class="btn sm ghost" data-no="1">Keep</button></div>`:""}</div>`; }).join("")
    + (s.length > histLimit ? `<button class="btn ghost block" data-more="1">Show older workouts</button>` : "");
}
function renderLift(){ const c = $("#liftChart"); if(!c) return; if(!progLift){ c.innerHTML = `<div class="empty">Log a weighted exercise to see your strength trend.</div>`; return; }
  const pts = sessions().slice().reverse().map(s => { const sets = (s.items||[]).filter(i => i.ex === progLift).flatMap(i => working(i.sets||[])); return sets.length ? {x:new Date(s.date+"T12:00:00").getTime(), y:topE1(sets)} : null; }).filter(Boolean);
  c.innerHTML = lineChart(pts, "kg"); }
$("#tab-progress").addEventListener("change", e => { if(e.target.id === "liftSel"){ progLift = e.target.value; renderLift(); } });
$("#tab-progress").addEventListener("click", e => {
  const d = e.target.closest("[data-del]"), y = e.target.closest("[data-yes]"), n = e.target.closest("[data-no]");
  if(d){ histDel = d.dataset.del; $("#hist").innerHTML = historyHTML(sessions()); }
  else if(y){ histDel = null; S.sessions = S.sessions.filter(s => s.id !== y.dataset.yes); save(); renderAll(); toast("Workout deleted"); }
  else if(n){ histDel = null; $("#hist").innerHTML = historyHTML(sessions()); }
  else if(e.target.closest("[data-more]")){ histLimit += 20; $("#hist").innerHTML = historyHTML(sessions()); }
});

/* ================= SETTINGS & DATA ================= */
function download(name, text, type){ const blob = new Blob([text], {type}); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); }
function csv(){
  const rows = [["date","workout","exercise","set","type","weight_kg","reps_or_seconds","rating","note"]];
  sessions().slice().reverse().forEach(s => (s.items||[]).forEach(it => (it.sets||[]).forEach((z,k) => rows.push([s.date, s.name||"", exName(it.ex), k+1, ({n:"normal",w:"warmup",d:"drop",f:"failure"})[z.t||"n"], z.w, z.r, it.rating||"", it.note||""]))));
  return rows.map(r => r.map(v => { v = String(v ?? ""); return /[",\n]/.test(v) ? `"${v.replace(/"/g,'""')}"` : v; }).join(",")).join("\n");
}
let resetConfirm = false;
function openSettings(){
  const st = S.settings;
  sheet(`<div class="sheethead"><h2>Settings</h2><button class="btn sm" data-close>Done</button></div>
    <div class="card"><h3 style="margin-bottom:4px">Training</h3>
      <div class="setting"><label for="setTarget">Workouts per week goal</label><input type="number" id="setTarget" min="1" max="7" value="${st.weekTarget}"></div>
      <div class="setting"><label for="setBar">Barbell weight (kg)</label><input type="number" id="setBar" step="0.5" min="5" max="30" value="${st.bar}"></div>
      <div class="setting"><label for="setRestBig">Rest after big lifts (sec)</label><input type="number" id="setRestBig" step="15" min="30" max="600" value="${st.restBig}"></div>
      <div class="setting"><label for="setRestSmall">Rest after other exercises (sec)</label><input type="number" id="setRestSmall" step="15" min="15" max="600" value="${st.restSmall}"></div>
      <div class="setting"><label for="setSound">Rest timer beep</label><select id="setSound"><option value="1" ${+st.sound?"selected":""}>On</option><option value="0" ${+st.sound?"":"selected"}>Off</option></select></div>
      <div class="setting"><label for="setTheme">Theme</label><select id="setTheme">${["system","light","dark"].map(t => `<option value="${t}" ${st.theme===t?"selected":""}>${t[0].toUpperCase()+t.slice(1)}</option>`).join("")}</select></div></div>
    <div class="card stack"><h3>Your data</h3><p class="small muted">Everything is stored on this phone. Export a backup now and then, and to move to a new phone.</p>
      <div class="row"><button class="btn sm" id="expJson">Export backup</button><button class="btn sm ghost" id="expCsv">Export spreadsheet (CSV)</button></div>
      <label class="btn sm ghost" style="text-align:center">Restore from backup<input type="file" id="impFile" accept="application/json,.json" hidden></label>
      ${resetConfirm?`<div class="confirm">Erase all workouts, routines and settings on this phone? <button class="btn sm danger" id="resetYes">Erase everything</button><button class="btn sm ghost" id="resetNo">Cancel</button></div>`:`<button class="btn sm danger" id="resetBtn">Erase all data</button>`}</div>
    <div class="card guide"><h3>Getting lean and defined</h3><ul>
      <li><b>Definition is mostly body fat.</b> Lifting builds and keeps muscle; a small deficit of about 300–500 kcal a day shows it. Aim for 0.25–0.5 kg loss a week.</li>
      <li><b>Protein:</b> 1.6–2.2 g per kg of body weight daily, over 3–4 meals.</li>
      <li><b>Steps</b> (8–10k a day) are the easiest extra fat loss that won't hurt your lifting.</li>
      <li><b>Sleep 7–9 h.</b> It drives recovery and appetite control.</li>
      <li>Finish most sets with 1–2 good reps left. Rate exercises Easy/Good/Hard so the suggestions adapt.</li></ul></div>
    <div class="card"><h3>About</h3><p class="small muted">Lift Log ${APP_VERSION}. Updates install automatically when you open the app online.</p><button class="btn sm ghost" id="checkUpd" style="margin-top:8px">Check for update now</button>
      <p class="small muted" style="margin-top:8px">General fitness guidance, not medical advice. Sharp pain (not effort) means stop that exercise and get it checked.</p></div>`);
  const bind = (id, key) => $(id).addEventListener("change", e => { const v = key==="theme" ? e.target.value : +e.target.value; if(key==="theme" || v >= 0){ S.settings[key] = v; save(); applyTheme(); renderAll(); toast("Saved"); } });
  bind("#setTarget","weekTarget"); bind("#setBar","bar"); bind("#setRestBig","restBig"); bind("#setRestSmall","restSmall"); bind("#setSound","sound"); bind("#setTheme","theme");
  $("#expJson").onclick = () => { download(`liftlog-backup-${todayStr()}.json`, JSON.stringify({...S, exportedAt:new Date().toISOString(), app:"liftlog"}, null, 1), "application/json"); toast("Backup saved to Downloads"); };
  $("#expCsv").onclick = () => { download(`liftlog-${todayStr()}.csv`, csv(), "text/csv"); toast("Spreadsheet saved to Downloads"); };
  $("#impFile").onchange = e => { const f = e.target.files[0]; if(!f) return; const rd = new FileReader(); rd.onload = () => { try{ const d = JSON.parse(rd.result); if(!d || !Array.isArray(d.sessions) || !Array.isArray(d.routines)) throw 0;
      S = {...freshState(), ...d, settings:{...DEFAULT_SETTINGS, ...(d.settings||{})}}; delete S.exportedAt; delete S.app; mergeCustom(); save(); applyTheme(); closeSheet(); renderAll(); toast(`Restored ${S.sessions.length} workouts`); }catch(err){ toast("That file isn't a Lift Log backup."); } }; rd.readAsText(f); };
  const rb = $("#resetBtn"); if(rb) rb.onclick = () => { resetConfirm = true; openSettings(); };
  const ry = $("#resetYes"); if(ry) ry.onclick = () => { resetConfirm = false; S = freshState(); save(); applyTheme(); closeSheet(); renderAll(); toast("All data erased"); };
  const rn = $("#resetNo"); if(rn) rn.onclick = () => { resetConfirm = false; openSettings(); };
  $("#checkUpd").onclick = async () => { if(!swReg){ toast("Updates work once the app is installed from the website."); return; } try{ await swReg.update(); toast(swReg.waiting ? "Update found" : "You're on the latest version"); }catch(e){ toast("Couldn't check. Are you online?"); } };
}
$("#settingsBtn").addEventListener("click", () => { resetConfirm = false; openSettings(); });

/* ================= tabs & boot ================= */
const TABS = ["home","workout","routines","library","progress"];
function showTab(t){ document.querySelectorAll("nav.tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === t)); TABS.forEach(k => $("#tab-"+k).hidden = k !== t); try{ localStorage.setItem("liftlog.tab", t); }catch(e){} window.scrollTo({top:0}); }
document.querySelector("nav.tabs").addEventListener("click", e => { const b = e.target.closest("button[data-tab]"); if(b) showTab(b.dataset.tab); });
function renderAll(){ renderHome(); renderWorkout(); renderRoutines(); renderLibrary(); renderProgress(); }
renderAll();
let startTab = "home"; try{ startTab = new URLSearchParams(location.search).get("tab") || localStorage.getItem("liftlog.tab") || "home"; }catch(e){}
showTab(S.active ? "workout" : (TABS.includes(startTab) ? startTab : "home"));
if(S.active) keepAwake();
setInterval(() => { if(!$("#tab-home").hidden && $("#sheet").hidden && !document.activeElement?.matches("input,textarea,select")) renderHome(); }, 60000);

/* ================= PWA: service worker + updates ================= */
let swReg = null, reloading = false;
if("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")){
  window.addEventListener("load", async () => {
    try{
      swReg = await navigator.serviceWorker.register("sw.js");
      const showUpdate = () => { $("#updateBanner").hidden = false; };
      if(swReg.waiting && navigator.serviceWorker.controller) showUpdate();
      swReg.addEventListener("updatefound", () => { const nw = swReg.installing; nw && nw.addEventListener("statechange", () => { if(nw.state === "installed" && navigator.serviceWorker.controller) showUpdate(); }); });
      document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible") swReg.update().catch(() => {}); });
    }catch(e){}
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => { if(reloading) return; reloading = true; location.reload(); });
}
$("#updateBtn").addEventListener("click", () => {
  if(S.active){ toast("Saved your workout in progress. Updating…"); }
  save(); if(swReg && swReg.waiting) swReg.waiting.postMessage("SKIP_WAITING"); else location.reload();
});
