/* Lift Log – onboarding questionnaire and rule-based plan generator.
   Loaded before app.js; UI functions use app.js globals (S, save, sheet, toast…) at call time. */

/* ---------- movement patterns → candidate exercises (best first) ---------- */
const PATTERNS = {
  squat:   {role:"c", list:["squat","legpress","hacksq","smithsq","gobletsq","kbgoblet","dbbss","bss","airsq"]},
  squat2:  {role:"c", list:["legpress","hacksq","frontsq","smithsq","gobletsq","kbgoblet","dbbss","bss","stepup","airsq"]},
  hinge:   {role:"c", list:["deadlift","trapbar","rdl","dbrdl","kbswing","hipthrust","slrdl","glutebridge"]},
  hinge2:  {role:"c", list:["rdl","hipthrust","dbrdl","kbswing","legcurl","slrdl","glute"]},
  lunge:   {role:"c", list:["lunge","dbbss","dbstep","revlunge","bss","stepup"]},
  hpush:   {role:"c", list:["bench","dbbench","machpress","pushup","deficitpush","inclinepush","kneepush"]},
  hpush2:  {role:"c", list:["incdb","incbar","machpress","dbbench","deficitpush","pushup","inclinepush"]},
  vpush:   {role:"c", list:["ohp","dbohp","machshoulder","arnold","pike"]},
  hpull:   {role:"c", list:["crow","chestrow","bbrow","dbrow","tbar","bandrow","bagrow","invrow"]},
  vpull:   {role:"c", list:["pulldown","pullup","chinup","closepull","negpull","bandrow","invrow"]},
  sidedelt:{role:"i", list:["latraise","cablelat","bandpull","pike"]},
  reardelt:{role:"i", list:["facepull","reardelt","reardb","bandpull"]},
  biceps:  {role:"i", list:["dbcurl","cablecurl","bbcurl","hammer","incurl","chinup"]},
  triceps: {role:"i", list:["pushdown","ohtri","skull","ropeoh","dbkick","diamond","benchdip"]},
  hamiso:  {role:"i", list:["legcurl","seatcurl","nordic","slrdl","glutebridge"]},
  quadiso: {role:"i", list:["legext","wallsit","airsq"]},
  glute:   {role:"i", list:["hipthrust","glutekick","hipabd","glute","glutebridge"]},
  calves:  {role:"i", list:["calfmach","seatcalf","dbcalf","calfraise"]},
  chestiso:{role:"i", list:["cablefly","pecdeck","dbfly","deficitpush","pushup"]},
  core:    {role:"k", list:["cablecrunch","hangknee","pallof","plank","deadbug","hollow","legraise","birddog"]}
};
const TEMPLATES = {
  FB_A:{name:"Full Body A", p:["squat","hpush","hpull","hinge2","sidedelt","core","biceps"]},
  FB_B:{name:"Full Body B", p:["hinge","vpush","vpull","lunge","reardelt","core","triceps"]},
  FB_C:{name:"Full Body C", p:["squat2","hpush2","hpull","glute","sidedelt","core","calves"]},
  UP_A:{name:"Upper A", p:["hpush","hpull","vpush","vpull","sidedelt","biceps","triceps"]},
  LO_A:{name:"Lower A", p:["squat","hinge2","lunge","hamiso","calves","core"]},
  UP_B:{name:"Upper B", p:["hpush2","vpull","vpush","hpull","reardelt","triceps","biceps"]},
  LO_B:{name:"Lower B", p:["hinge","squat2","glute","quadiso","calves","core"]},
  PUSH:{name:"Push", p:["hpush","vpush","hpush2","sidedelt","triceps","chestiso"]},
  PULL:{name:"Pull", p:["vpull","hpull","reardelt","biceps","hpull","core"]},
  LEGS:{name:"Legs", p:["squat","hinge2","lunge","quadiso","hamiso","calves"]},
  PUSH2:{name:"Push B", p:["hpush2","vpush","hpush","sidedelt","triceps","chestiso"]},
  PULL2:{name:"Pull B", p:["hpull","vpull","reardelt","biceps","hpull","core"]},
  LEGS2:{name:"Legs B", p:["squat2","hinge","glute","quadiso","hamiso","calves"]}
};
const SPLITS = {1:["FB_A"],2:["FB_A","FB_B"],3:["FB_A","FB_B","FB_C"],4:["UP_A","LO_A","UP_B","LO_B"],5:["UP_A","LO_A","PUSH","PULL","LEGS"],6:["PUSH","PULL","LEGS","PUSH2","PULL2","LEGS2"]};
const FOCUS_PATTERNS = {Chest:["chestiso"],Arms:["biceps","triceps"],Shoulders:["sidedelt"],Back:["hpull"],Legs:["quadiso"],Glutes:["glute"],Core:["core"]};
const INJURY_EXCLUDE = {
  "Lower back":["slrdl","deadlift","sumodl","goodmorning","bbrow","pendlay","squat","rdl","trapbar","frontsq","kbswing","dbrdl","tbar","backext","superman","legraise"],
  "Knees":["jumpsq","lunge","revlunge","bss","dbbss","hacksq","legext","burpee","finisher","squat","frontsq","stepup","dbstep","nordic"],
  "Shoulders":["ohp","pushpress","uprow","dips","benchdip","bench","skull","pike","arnold","incbar","pullover","closegrip"],
  "Wrists":["pushup","diamond","kneepush","inclinepush","deficitpush","pike","frontsq","burpee","mountain","finisher","bbcurl","skull"]
};
const ADVANCED = ["deadlift","sumodl","frontsq","pendlay","pushpress","goodmorning","nordic","pullup","chinup","skull"];
const NEEDS_BENCH = ["dbbench","incdb","dbfly","pullover","incurl","hipthrust","bench","incbar","closegrip"];
const NEEDS_BAR = ["pullup","chinup","negpull","hangknee"];

function allowedFor(loc, prof){
  const eq = new Set(prof.homeEq || []);
  const excl = new Set([...(prof.injuries||[]).flatMap(k => INJURY_EXCLUDE[k] || []), ...(prof.exp === "new" ? ADVANCED : [])]);
  return id => { const e = EX[id]; if(!e || excl.has(id)) return false;
    if(loc === "gym") return true;
    if(NEEDS_BAR.includes(id)) return eq.has("Pull-up bar");
    if(NEEDS_BENCH.includes(id) && !eq.has("Bench")) return false;
    if(e.eq === "bw") return true;
    if(e.eq === "db") return eq.has("Dumbbells");
    if(e.eq === "kb") return eq.has("Kettlebell");
    if(e.eq === "band") return eq.has("Resistance bands");
    if(e.eq === "bar") return eq.has("Barbell + rack");
    return false; };
}
function prescription(pat, exId, prof, idx, short){
  const e = EX[exId]; const role = PATTERNS[pat]?.role || "i"; const g = prof.goal, x = prof.exp;
  if(e.type === "t") return {sets: short?2:3, lo:30, hi:60, rest:60};
  if(e.type === "bw") return role === "c" ? {sets:3, lo:8, hi:20, rest:90} : {sets: short?2:3, lo:10, hi:20, rest:60};
  if(role === "c"){
    let lo, hi, rest; if(g === "strength"){ lo = 4; hi = 6; rest = 180; } else if(g === "muscle"){ lo = 6; hi = 10; rest = 120; } else { lo = 8; hi = 12; rest = 90; }
    if(x === "new"){ lo = Math.max(lo, 8); hi = Math.max(hi, 12); rest = Math.min(rest, 120); }
    if(e.big && g !== "strength" && x !== "new" && idx === 0){ lo = Math.max(5, lo-2); hi = Math.max(lo+2, hi-2); rest = Math.max(rest, 150); }
    const sets = x === "new" ? 3 : (idx < 2 && !short) ? 4 : 3;
    return {sets, lo, hi, rest};
  }
  if(role === "k") return {sets: short?2:3, lo:10, hi:15, rest:60};
  return {sets: short?2:3, lo: g==="strength"?8:10, hi: g==="lean"?15:12, rest:60};
}
function generatePlan(prof){
  const days = Math.max(1, Math.min(6, prof.days|0)); const gym = Math.max(0, Math.min(days, prof.gymDays|0));
  const keys = SPLITS[days]; const n = {30:4,45:5,60:6,75:7}[prof.length] || 5; const short = prof.length <= 30;
  // interleave home days between gym days: e.g. 2 gym + 1 home -> gym, home, gym
  const homeN = days - gym; const locs = Array(days).fill("gym");
  for(let k=0;k<homeN;k++) locs[Math.min(days-1, Math.floor((2*k+1)*days/(2*homeN)))] = "home";
  for(let i=0, c=locs.filter(l => l==="home").length; c < homeN && i < days; i++) if(locs[i]==="gym"){ locs[i]="home"; c++; }
  const globalUsed = new Set(); const routines = [];
  keys.forEach((k, di) => {
    const t = TEMPLATES[k]; const loc = locs[di]; const ok = allowedFor(loc, prof); const used = new Set();
    const comp = t.p.filter(p => PATTERNS[p].role === "c"); const rest = t.p.filter(p => PATTERNS[p].role !== "c");
    const focus = (prof.focus || []).flatMap(f => FOCUS_PATTERNS[f] || []).filter(p => !t.p.includes(p) || PATTERNS[p].role !== "c");
    const nComp = Math.min(comp.length, n <= 4 ? 3 : 4);
    let order = [...comp.slice(0, nComp), ...focus, ...rest.filter(p => !focus.includes(p)), ...comp.slice(nComp)];
    order = order.filter((p, i) => order.indexOf(p) === i || p === "hpull");
    const items = [];
    for(const p of order){ if(items.length >= n) break;
      const cands = PATTERNS[p].list.filter(id => ok(id) && !used.has(id));
      const pickId = cands.find(id => !globalUsed.has(id)) || cands[0]; if(!pickId) continue;
      used.add(pickId); globalUsed.add(pickId);
      items.push({ex:pickId, ...prescription(p, pickId, prof, items.length, short), alts:PATTERNS[p].list.filter(id => id !== pickId && ok(id)).slice(0,4)}); }
    // superset the last two accessories to save time on shorter sessions
    if(prof.length <= 45 && items.length >= 4){ const a = items[items.length-2], b = items[items.length-1]; if(PATTERNS[order.find(p => PATTERNS[p].list.includes(a.ex))]?.role !== "c"){ a.group = "A"; b.group = "A"; } }
    if((prof.goal === "lean" || prof.goal === "health") && prof.length > 30){
      const cond = loc === "home" ? (ok("finisher") ? {ex:"finisher",sets:1,lo:8,hi:10} : {ex:"walk",sets:1,lo:10,hi:20}) : {ex: ok("bike") && (prof.injuries||[]).includes("Knees") ? "bike" : "walk", sets:1, lo:10, hi:15};
      items.push({...cond, rest:null}); }
    const name = `${t.name}${gym && gym < days ? (loc === "gym" ? " · Gym" : " · Home") : ""}`;
    routines.push({id:uid("p"), name, sub: items.slice(0,3).map(i => EX[i.ex].name.replace(/ \(.*\)/,"")).join(", "), items, rotate:true, generated:true});
  });
  return routines;
}

/* ---------- profile text for coach + Claude prompts ---------- */
const GOAL_TXT = {lean:"lose fat and get lean and defined", muscle:"build muscle", strength:"get stronger", health:"improve general health and fitness"};
const EXP_TXT = {new:"I'm new to lifting (under 6 months).", some:"I have some lifting experience (6 months to 2 years).", exp:"I'm an experienced lifter (2+ years)."};
function describeProfile(){
  const p = S.profile; if(!p) return "My goals: general health, muscle and getting leaner.";
  const bits = [`My main goal is to ${GOAL_TXT[p.goal]||p.goal}.`, EXP_TXT[p.exp]||"",
    `I train ${p.days} day${p.days>1?"s":""} a week: ${p.gymDays} at a gym and ${p.days-p.gymDays} at home${p.days-p.gymDays ? ` (home equipment: ${(p.homeEq||[]).length ? p.homeEq.join(", ") : "none"})` : ""}.`,
    `Sessions are about ${p.length} minutes.`];
  if(p.focus?.length) bits.push(`I'd like extra focus on: ${p.focus.join(", ")}.`);
  if(p.injuries?.length) bits.push(`Avoid aggravating: ${p.injuries.join(", ")}.`);
  if(p.weight) bits.push(`I weigh ${p.weight} kg${p.height?` and I'm ${p.height} cm tall`:""}.`);
  return bits.join(" ");
}

/* ---------- questionnaire UI ---------- */
const Q = [
  {k:"name", type:"text", title:"Welcome to Lift Log", help:"Answer a few quick questions and the coach will build a plan around you. Takes about a minute.", label:"Your first name (optional)"},
  {k:"goal", type:"one", title:"What's your main goal?", opts:[["lean","Lose fat, get lean & defined"],["muscle","Build muscle"],["strength","Get stronger"],["health","General health & fitness"]]},
  {k:"exp", type:"one", title:"How much lifting experience do you have?", opts:[["new","New: under 6 months"],["some","Some: 6 months – 2 years"],["exp","Experienced: 2+ years"]]},
  {k:"days", type:"one", title:"How many days a week can you train?", opts:[[2,"2 days"],[3,"3 days"],[4,"4 days"],[5,"5 days"],[6,"6 days"]]},
  {k:"gymDays", type:"one", title:"How many of those days are at a gym?", help:"The rest are planned as home workouts.", opts: p => Array.from({length:(p.days||3)+1}, (_,i) => [i, i===0 ? "None, all at home" : i===(p.days||3) ? `All ${i} at the gym` : `${i} at the gym, ${(p.days||3)-i} at home`])},
  {k:"homeEq", type:"many", title:"What do you have at home?", help:"Pick everything that applies. No equipment is fine.", skip: p => p.gymDays >= p.days, opts:[["Dumbbells","Dumbbells"],["Kettlebell","Kettlebell"],["Resistance bands","Resistance bands"],["Pull-up bar","Pull-up bar"],["Bench","Bench"],["Barbell + rack","Barbell + rack"]]},
  {k:"length", type:"one", title:"How long is a typical session?", opts:[[30,"About 30 min"],[45,"About 45 min"],[60,"About 60 min"],[75,"75+ min"]]},
  {k:"focus", type:"many", title:"Anything you want extra focus on?", help:"Optional. Adds extra work for these areas.", opts:[["Chest","Chest"],["Arms","Arms"],["Shoulders","Shoulders"],["Back","Back"],["Legs","Legs"],["Glutes","Glutes"],["Core","Core"]]},
  {k:"injuries", type:"many", title:"Any areas to go easy on?", help:"Optional. The coach avoids exercises that commonly aggravate these.", opts:[["Lower back","Lower back"],["Knees","Knees"],["Shoulders","Shoulders"],["Wrists","Wrists"]]},
  {k:"body", type:"body", title:"Body stats (optional)", help:"Used for your protein target and weight trend. Stays on your phone."}
];
let ob = null;
function openOnboarding(firstRun){
  ob = {i:0, firstRun, p: S.profile ? clone(S.profile) : {name:"", goal:null, exp:null, days:3, gymDays:2, homeEq:[], length:45, focus:[], injuries:[], weight:null, height:null}};
  renderQ();
}
function qVisible(i){ const q = Q[i]; return !(q.skip && q.skip(ob.p)); }
function renderQ(){
  const q = Q[ob.i]; const p = ob.p; const total = Q.filter((_,i) => qVisible(i)).length; const pos = Q.slice(0, ob.i+1).filter((_,i) => qVisible(i)).length;
  const opts = typeof q.opts === "function" ? q.opts(p) : q.opts;
  let body = "";
  if(q.type === "text") body = `<label class="small" for="qName">${q.label}</label><input type="text" id="qName" class="full" maxlength="30" value="${esc(p.name||"")}" autocomplete="given-name">`;
  if(q.type === "one") body = `<div class="qopts">${opts.map(([v,l]) => `<button class="qopt" data-v="${v}" aria-pressed="${String(p[q.k])===String(v)}">${esc(l)}</button>`).join("")}</div>`;
  if(q.type === "many") body = `<div class="qopts">${opts.map(([v,l]) => `<button class="qopt" data-v="${v}" aria-pressed="${(p[q.k]||[]).includes(v)}">${esc(l)}</button>`).join("")}</div>`;
  if(q.type === "body") body = `<div class="row"><label class="small">Weight (kg)<br><input type="number" id="qW" inputmode="decimal" min="30" max="300" step="0.1" value="${p.weight??""}" style="width:110px"></label><label class="small">Height (cm)<br><input type="number" id="qH" inputmode="numeric" min="120" max="230" value="${p.height??""}" style="width:110px"></label></div>`;
  const needsAnswer = q.type === "one" && (p[q.k] == null);
  sheet(`<div class="sheethead"><span class="label">Setup · ${pos} of ${total}</span>${ob.firstRun && ob.i===0 ? `<button class="btn sm ghost" id="qSkip">Skip for now</button>` : `<button class="btn sm ghost" data-close>Close</button>`}</div>
    <div class="qprog"><i style="width:${pos/total*100}%"></i></div>
    <h2>${esc(q.title)}</h2>${q.help?`<p class="muted">${esc(q.help)}</p>`:""}
    ${body}
    <div class="row" style="margin-top:6px">${ob.i>0?`<button class="btn ghost" id="qBack">Back</button>`:""}<button class="btn" id="qNext" style="flex:1" ${needsAnswer?"disabled":""}>${ob.i===Q.length-1?"Build my plan":q.type==="many"&&!(p[q.k]||[]).length?"None, next":"Next"}</button></div>`);
  const sh = $("#sheet");
  sh.querySelectorAll(".qopt").forEach(b => b.onclick = () => { const v = b.dataset.v; const typed = isNaN(+v) ? v : +v;
    if(q.type === "one"){ p[q.k] = typed; if(q.k === "days" && p.gymDays > typed) p.gymDays = typed; renderQ(); setTimeout(() => $("#qNext")?.focus(), 0); }
    else { const arr = p[q.k] || (p[q.k] = []); const i = arr.indexOf(typed); if(i >= 0) arr.splice(i,1); else arr.push(typed); renderQ(); } });
  const nx = $("#qNext"); nx.onclick = () => { collectQ(); let j = ob.i+1; while(j < Q.length && !qVisible(j)) j++; if(j >= Q.length) return showPlanPreview(); ob.i = j; renderQ(); };
  const bk = $("#qBack"); if(bk) bk.onclick = () => { collectQ(); let j = ob.i-1; while(j > 0 && !qVisible(j)) j--; ob.i = Math.max(0,j); renderQ(); };
  const sk = $("#qSkip"); if(sk) sk.onclick = () => { S.onboardSkipped = true; save(); closeSheet(); renderAll(); };
  if(q.type === "text") $("#qName").focus();
}
function collectQ(){ const q = Q[ob.i]; const p = ob.p;
  if(q.type === "text") p.name = $("#qName").value.trim();
  if(q.type === "body"){ const w = parseFloat($("#qW").value), h = parseFloat($("#qH").value); p.weight = w>30&&w<300 ? w : null; p.height = h>120&&h<230 ? h : null; }
  if(p.gymDays >= p.days) p.homeEq = p.homeEq || [];
}
let previewPlan = null;
function showPlanPreview(){
  const p = ob.p; previewPlan = generatePlan(p);
  const protein = p.weight ? `${Math.round(p.weight*1.6)}–${Math.round(p.weight*2.2)} g of protein a day` : null;
  sheet(`<div class="sheethead"><h2>${p.name?esc(p.name)+"'s":"Your"} plan</h2><button class="btn sm ghost" id="pvBack">Back</button></div>
    <p class="muted">${p.days} workouts a week, ${previewPlan.length} routines in rotation. Weights adjust automatically as you log.</p>
    ${previewPlan.map(r => `<div class="card"><h3>${esc(r.name)}</h3><ul class="plist">${r.items.map(i => `<li><span>${esc(EX[i.ex].name)}${i.group?` <span class="ssbadge">SS</span>`:""}</span><span>${i.sets} × ${i.lo}–${i.hi}${EX[i.ex].type==="t"?"s":EX[i.ex].type==="min"?" min":""}</span></li>`).join("")}</ul></div>`).join("")}
    <div class="card guide"><h3>Coach notes</h3><ul>
      ${p.goal==="lean"?`<li>For definition, eat about 300–500 kcal below maintenance and aim to lose 0.25–0.5 kg a week.</li>`:p.goal==="muscle"?`<li>Eat at or slightly above maintenance (about +200 kcal) so you have fuel to grow.</li>`:p.goal==="strength"?`<li>Rest fully between heavy sets (2–3 min). Strength grows fastest when you're fresh.</li>`:`<li>Consistency beats intensity. Hit your ${p.days} sessions and walk daily.</li>`}
      ${protein?`<li>Target ${protein}.</li>`:`<li>Aim for 1.6–2.2 g of protein per kg of body weight a day.</li>`}
      <li>Walk 8–10k steps a day. It helps recovery and fat loss without hurting your lifting.</li>
      ${p.exp==="new"?`<li>Start lighter than you think. Learn the movements first; the app adds weight for you.</li>`:""}
      ${(p.injuries||[]).length?`<li>Exercises that commonly bother your ${p.injuries.join(", ").toLowerCase()} were left out. Stop anything that causes sharp pain.</li>`:""}</ul></div>
    <button class="btn block" id="pvUse">Use this plan</button>
    <button class="btn ghost block" id="pvClaude">Ask Claude to design it instead</button>
    <p class="small muted">Your current routines are kept, just taken out of the rotation. You can edit everything in Routines.</p>`);
  $("#pvBack").onclick = () => { ob.i = Q.length-1; renderQ(); };
  $("#pvUse").onclick = () => { S.profile = {...p, updatedAt:Date.now()}; S.routines.forEach(r => r.rotate = false); S.routines = [...previewPlan, ...S.routines]; S.settings.weekTarget = p.days; save(); closeSheet(); renderAll(); showTab("home"); toast("Plan ready. Your first workout is up next."); };
  $("#pvClaude").onclick = () => { S.profile = {...p, updatedAt:Date.now()}; S.settings.weekTarget = p.days; save(); renderAll(); openAI("plan"); };
}
