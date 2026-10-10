const STORAGE_KEY = "loan-freedom-v1";
const SUPABASE_TABLE = "loan_tracker_state";
const VERSION = 1;

const HISTORY = [
  ["2025-04-30",2639,17091,2006440],["2025-05-31",2093,17637,2004347],
  ["2025-06-30",2763,17051,2001584],["2025-07-31",2305,17425,1999279],
  ["2025-08-31",2599,17405,1996680],["2025-09-30",3010,16821,1993670],
  ["2025-10-31",2468,17356,1991202],["2025-11-30",3055,16775,1988147],
  ["2025-12-31",2521,17308,1985626],["2026-01-31",2600,17286,1983026],
  ["2026-02-28",4243,15593,1978783],["2026-03-31",2588,17226,1976195],
  ["2026-04-30",28359,16486,1947836],["2026-05-31",9493,16791,1938343],
  ["2026-06-30",3657,16171,1934686],["2026-07-31",68129,16678,1866557],
  ["2026-08-31",3848,16091,1862709],["2026-09-30",74272,15540,1788437]
].map(([date,principal,interest,balance])=>({date,principal,interest,balance}));

const DEFAULT_STATE = {
  version: VERSION,
  loan: {
    originalPrincipal: 2009232,
    baselineBalance: 1788437,
    baselineDate: "2026-10-07",
    firstTrackedEmi: "2026-10-15",
    emi: 19730,
    annualRate: 10.15,
    dueDay: 15,
    bankRemainingEmis: 173,
    principalPaid: 220795,
    interestPaid: 391598
  },
  history: HISTORY,
  events: [],
  rateChanges: [],
  goalDate: "",
  theme: "dark"
};

const clone = value => JSON.parse(JSON.stringify(value));
const round2 = value => Math.round((value + Number.EPSILON) * 100) / 100;
const isoDate = value => {
  const d = value instanceof Date ? value : new Date(`${value}T12:00:00`);
  if (Number.isNaN(d.getTime())) throw new TypeError("Invalid date");
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
const dateOf = value => new Date(`${value}T12:00:00`);
const addMonths = (value, count, day = dateOf(value).getDate()) => {
  const d = dateOf(value);
  const target = new Date(d.getFullYear(), d.getMonth()+count, 1, 12);
  target.setDate(Math.min(day,new Date(target.getFullYear(),target.getMonth()+1,0).getDate()));
  return isoDate(target);
};
const monthKey = date => date.slice(0,7);
const isPositive = value => Number.isFinite(Number(value)) && Number(value) > 0;

function rateAt(state, date) {
  let rate = state.loan.annualRate;
  for (const change of [...state.rateChanges].sort((a,b)=>a.date.localeCompare(b.date))) {
    if (change.date <= date) rate = change.annualRate;
  }
  return rate;
}

function nextDueDate(fromDate, dueDay) {
  const from = dateOf(fromDate);
  const sameMonth = new Date(from.getFullYear(),from.getMonth(),dueDay,12);
  if (from.getDate() < dueDay) return isoDate(sameMonth);
  return isoDate(new Date(from.getFullYear(),from.getMonth()+1,dueDay,12));
}

function ensureExpectedEmis(state, today) {
  if (today < state.loan.firstTrackedEmi) return 0;
  let due = state.loan.firstTrackedEmi;
  let added = 0;
  while (due <= today) {
    const period = monthKey(due);
    if (!state.events.some(event=>event.type === "emi" && event.period === period)) {
      state.events.push({id:`emi-${period}`,type:"emi",period,date:due,amount:state.loan.emi,status:"pending"});
      added++;
    }
    due = addMonths(due,1,state.loan.dueDay);
  }
  return added;
}

function applyTrackedEvents(state, asOfDate) {
  let balance = state.loan.baselineBalance;
  let addedInterest = 0;
  const details = [];
  const events = [...state.events]
    .filter(event=>event.date >= state.loan.baselineDate && event.date <= asOfDate)
    .sort((a,b)=>a.date.localeCompare(b.date) || ({prepayment:0,emi:1}[a.type]-{prepayment:0,emi:1}[b.type]));

  for (const event of events) {
    if (event.type === "prepayment") {
      if (event.status === "confirmed") {
        if (event.amount >= balance) throw new RangeError("Part-payment must be smaller than the outstanding balance.");
        const principal = event.amount;
        balance = round2(balance-principal);
        details.push({...event,principal,interest:0,balance});
      }
      continue;
    }
    if (event.status === "failed") {
      details.push({...event,principal:0,interest:0,balance});
      continue;
    }
    const interest = round2(balance * rateAt(state,event.date) / 1200);
    if (event.amount <= interest && balance > 0) throw new RangeError("EMI is too low: the balance would grow.");
    const payment = Math.min(event.amount,balance+interest);
    const principal = round2(payment-interest);
    balance = round2(Math.max(0,balance-principal));
    addedInterest = round2(addedInterest+interest);
    details.push({...event,amount:payment,principal,interest,balance});
  }
  return {balance,addedInterest,details};
}

function projectLoan(principal, state, asOfDate) {
  if (!isPositive(principal)) return {schedule:[],totalInterest:0,payoffDate:asOfDate};
  if (!isPositive(state.loan.emi)) throw new RangeError("EMI must be positive.");
  let balance = round2(principal);
  let due = nextDueDate(asOfDate,state.loan.dueDay);
  let totalInterest = 0;
  const schedule = [];
  for (let i=0; balance > 0 && i<1200; i++) {
    const interest = round2(balance * rateAt(state,due) / 1200);
    if (state.loan.emi <= interest) throw new RangeError("EMI is too low: the balance would grow.");
    const payment = round2(Math.min(state.loan.emi,balance+interest));
    const principalPaid = round2(payment-interest);
    balance = round2(Math.max(0,balance-principalPaid));
    totalInterest = round2(totalInterest+interest);
    schedule.push({date:due,payment,principal:principalPaid,interest,balance});
    due = addMonths(due,1,state.loan.dueDay);
  }
  if (balance > 0) throw new RangeError("Projection exceeds 100 years.");
  return {schedule,totalInterest,payoffDate:schedule.at(-1)?.date || asOfDate};
}

function buildModel(state, asOfDate) {
  const tracked = applyTrackedEvents(state,asOfDate);
  const projection = projectLoan(tracked.balance,state,asOfDate);
  return {
    ...tracked,
    projection,
    totalInterestPaid: round2(state.loan.interestPaid+tracked.addedInterest),
    principalPaid: round2(state.loan.originalPrincipal-tracked.balance)
  };
}

function simulatePrepayment(state, asOfDate, amount, paymentDate = asOfDate) {
  amount = Number(amount);
  if (!isPositive(amount)) throw new RangeError("Part-payment must be positive.");
  const model = buildModel(state,asOfDate);
  if (amount >= model.balance) throw new RangeError("Use an amount smaller than the outstanding balance.");
  const base = model.projection;
  if (paymentDate <= asOfDate) {
    const draft = clone(state);
    draft.events.push({id:"preview-prepayment",type:"prepayment",date:paymentDate,amount,status:"confirmed"});
    const accelerated = buildModel(draft,asOfDate);
    return {
      amount,
      balanceAfter: accelerated.balance,
      schedule: accelerated.projection.schedule,
      payoffDate: accelerated.projection.payoffDate,
      paymentsSaved: Math.max(0,base.schedule.length-accelerated.projection.schedule.length),
      remainingInterest: accelerated.projection.totalInterest,
      interestSaved: round2(Math.max(0,base.totalInterest-accelerated.projection.totalInterest))
    };
  }
  const before = base.schedule.filter(row=>row.date < paymentDate);
  const balanceAtPayment = before.at(-1)?.balance ?? model.balance;
  if (amount >= balanceAtPayment) throw new RangeError("Amount exceeds the projected balance on that date.");
  const after = projectLoan(round2(balanceAtPayment-amount),state,paymentDate);
  const schedule = [...before,...after.schedule];
  const acceleratedInterest = round2(before.reduce((sum,row)=>sum+row.interest,0)+after.totalInterest);
  return {
    amount,
    balanceAfter: round2(balanceAtPayment-amount),
    schedule,
    payoffDate: schedule.at(-1)?.date || paymentDate,
    paymentsSaved: Math.max(0,base.schedule.length-schedule.length),
    remainingInterest: acceleratedInterest,
    interestSaved: round2(Math.max(0,base.totalInterest-acceleratedInterest))
  };
}

function requiredPayment(principal, annualRate, months) {
  if (!isPositive(principal) || !Number.isInteger(months) || months < 1) throw new RangeError("A future target is required.");
  const rate = annualRate/1200;
  return rate === 0 ? round2(principal/months) : round2(principal*rate*Math.pow(1+rate,months)/(Math.pow(1+rate,months)-1));
}

function validateState(candidate) {
  if (!candidate || candidate.version !== VERSION || !candidate.loan || !Array.isArray(candidate.history) || !Array.isArray(candidate.events) || !Array.isArray(candidate.rateChanges)) throw new TypeError("This is not a Loan Freedom v1 backup.");
  const loan = candidate.loan;
  for (const key of ["originalPrincipal","baselineBalance","emi","annualRate","dueDay","principalPaid","interestPaid"]) if (!isPositive(loan[key])) throw new TypeError(`Invalid loan value: ${key}`);
  if (!Number.isInteger(loan.dueDay) || loan.dueDay < 1 || loan.dueDay > 28) throw new TypeError("Invalid EMI day.");
  const emiPeriods = new Set();
  for (const row of candidate.history) {
    if (!row || !isPositive(row.principal) || !isPositive(row.interest) || !isPositive(row.balance)) throw new TypeError("Invalid statement history.");
    isoDate(row.date);
  }
  for (const event of candidate.events) {
    if (!["emi","prepayment"].includes(event.type) || !["pending","confirmed","failed"].includes(event.status) || !isPositive(event.amount)) throw new TypeError("Invalid payment event.");
    isoDate(event.date);
    if (event.date < loan.baselineDate) throw new TypeError("Payment event predates the statement baseline.");
    if (event.type === "emi") {
      const period = monthKey(event.date);
      if (event.period !== period) throw new TypeError("EMI period does not match its date.");
      if (emiPeriods.has(period)) throw new TypeError("Duplicate monthly EMI event.");
      emiPeriods.add(period);
    }
  }
  for (const change of candidate.rateChanges) {
    if (!isPositive(change.annualRate) || change.annualRate > 100) throw new TypeError("Invalid rate change.");
    isoDate(change.date);
    if (change.date < loan.baselineDate) throw new TypeError("Rate change predates the statement baseline.");
  }
  isoDate(loan.baselineDate); isoDate(loan.firstTrackedEmi);
  if (candidate.theme !== "dark" && candidate.theme !== "light") throw new TypeError("Invalid theme.");
  if (candidate.goalDate) isoDate(candidate.goalDate);
  const checked = clone(candidate);
  const lastEventDate = checked.events.reduce((latest,event)=>event.date>latest?event.date:latest,checked.loan.baselineDate);
  buildModel(checked,lastEventDate);
  return checked;
}

const serializeState = state => JSON.stringify(validateState(state),null,2);
const parseBackup = json => validateState(JSON.parse(json));

function loadLegacyState(storage) {
  try {
    const saved = storage?.getItem(STORAGE_KEY);
    return saved ? parseBackup(saved) : null;
  } catch { return null; }
}

function createCloudStore(client) {
  return {
    async load(userId) {
      const {data,error}=await client.from(SUPABASE_TABLE).select("state").eq("user_id",userId).maybeSingle();
      if(error) throw error;
      return data ? validateState(data.state) : null;
    },
    async save(userId,state) {
      const checked=validateState(state);
      const {error}=await client.from(SUPABASE_TABLE).upsert({user_id:userId,state:checked,updated_at:new Date().toISOString()},{onConflict:"user_id"});
      if(error) throw error;
      return checked;
    }
  };
}

if (typeof module !== "undefined") module.exports = {DEFAULT_STATE,rateAt,nextDueDate,ensureExpectedEmis,applyTrackedEvents,projectLoan,buildModel,simulatePrepayment,requiredPayment,validateState,serializeState,parseBackup,loadLegacyState,createCloudStore};
if (typeof document !== "undefined") boot().catch(error=>console.error("Loan tracker startup failed",error));

async function boot() {
  const $ = selector => document.querySelector(selector);
  const money = new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0});
  const number = new Intl.NumberFormat("en-IN",{maximumFractionDigits:0});
  const prettyDate = date => dateOf(date).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"});
  const compactMoney = value => value >= 10000000 ? `₹${(value/10000000).toFixed(2)}Cr` : value >= 100000 ? `₹${(value/100000).toFixed(2)}L` : money.format(value);
  const today = (()=>{const d=new Date();return isoDate(new Date(d.getFullYear(),d.getMonth(),d.getDate(),12));})();
  let state = clone(DEFAULT_STATE);
  let currentUser = null;
  let cloudStore = null;
  let supabaseClient = null;
  let saveQueue = Promise.resolve(true);
  let model;
  let preview = null;
  let previewPayload = null;

  const setError = (id,message="") => { const el=$(id); el.textContent=message; el.classList.toggle("hidden",!message); };
  const toast = message => { const el=$("#toast"); el.textContent=message; el.classList.add("show"); setTimeout(()=>el.classList.remove("show"),2600); };
  const setCloudStatus = (message,status="") => { const el=$("#cloud-status"); el.textContent=`● ${message}`; el.className=`privacy ${status}`; };
  const celebrate = () => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const box=$("#confetti"); box.innerHTML=Array.from({length:28},(_,i)=>`<i style="left:${(i*37)%100}%;--x:${(i%2?1:-1)*(20+i*3)}px;animation-delay:${(i%7)*.04}s;background:${i%3===0?'var(--cyan)':i%3===1?'var(--green)':'var(--amber)'}"></i>`).join("");
    setTimeout(()=>box.replaceChildren(),1900);
  };

  function persist(message) {
    render();
    const snapshot=clone(state), userId=currentUser?.id;
    if(!cloudStore||!userId) return Promise.resolve(false);
    setCloudStatus("Saving…","saving");
    saveQueue=saveQueue.then(async()=>{
      try {
        await cloudStore.save(userId,snapshot);
        setCloudStatus("Cloud synced");
        if(message) toast(message);
        return true;
      } catch(error) {
        setCloudStatus("Cloud save failed","failed");
        toast(`Cloud save failed: ${error.message}`);
        return false;
      }
    });
    return saveQueue;
  }

  function showSignedOut(message="Sign in to load your loan tracker.") {
    currentUser=null;
    $("#main").classList.add("hidden");
    $("#auth-gate").classList.remove("hidden");
    $("#sign-out").classList.add("hidden");
    $("#auth-message").textContent=message;
    setCloudStatus("Sign-in required","saving");
  }

  async function loadCloudState(user) {
    setCloudStatus("Loading…","saving");
    $("#auth-submit").disabled=true;
    try {
      let next=await cloudStore.load(user.id);
      const legacy=loadLegacyState(localStorage);
      if(!next) {
        next=legacy || clone(DEFAULT_STATE);
        ensureExpectedEmis(next,today);
        await cloudStore.save(user.id,next);
      } else if(ensureExpectedEmis(next,today)) {
        await cloudStore.save(user.id,next);
      }
      if(legacy) try { localStorage.removeItem(STORAGE_KEY); } catch {}
      state=next;
      currentUser=user;
      $("#auth-gate").classList.add("hidden");
      $("#main").classList.remove("hidden");
      $("#sign-out").classList.remove("hidden");
      setCloudStatus("Cloud synced");
      render();
      if(legacy) toast("Existing browser data moved to Supabase.");
    } catch(error) {
      showSignedOut(`Could not load Supabase data: ${error.message}`);
      setCloudStatus("Cloud unavailable","failed");
    } finally {
      $("#auth-submit").disabled=false;
    }
  }

  function render() {
    model = buildModel(state,today);
    const progress = Math.max(0,Math.min(100,model.principalPaid/state.loan.originalPrincipal*100));
    document.documentElement.dataset.theme=state.theme;
    $("#theme-toggle").textContent=state.theme === "dark" ? "☀︎" : "☾";
    $("#hero-balance").textContent=compactMoney(model.balance);
    $("#metric-balance").textContent=money.format(model.balance);
    $("#metric-payoff").textContent=prettyDate(model.projection.payoffDate);
    $("#metric-emis").textContent=number.format(model.projection.schedule.length);
    $("#metric-interest").textContent=money.format(model.totalInterestPaid);
    $("#metric-interest-left").textContent=money.format(model.projection.totalInterest);
    $("#metric-interest-total").textContent=`Lifetime estimate ${money.format(model.totalInterestPaid+model.projection.totalInterest)}`;
    $("#progress-ring").style.setProperty("--p",progress);
    $("#progress-pct").textContent=`${progress.toFixed(1)}%`;
    $("#principal-paid").textContent=money.format(model.principalPaid);
    $("#original-loan").textContent=money.format(state.loan.originalPrincipal);
    $("#last-verified").textContent=`Last verified ${prettyDate(state.loan.baselineDate)}`;
    renderNextEmi(); renderChart(); renderSplit(); renderMilestones(progress); renderActivity(); renderRates(); renderGoal();
  }

  function renderNextEmi() {
    const pending=[...state.events].filter(e=>e.type==="emi"&&e.status==="pending").sort((a,b)=>a.date.localeCompare(b.date))[0];
    const nextDate=pending?.date || nextDueDate(today,state.loan.dueDay);
    $("#next-emi-date").textContent=prettyDate(nextDate);
    const badge=$("#next-status"); badge.textContent=pending?"Pending confirmation":"Upcoming"; badge.className=`status ${pending?"pending":"confirmed"}`;
    $("#pending-actions").innerHTML=pending?`<button class="btn primary small" data-edit-event="${pending.id}" type="button">Review EMI</button>`:"";
  }

  function renderChart() {
    const base=[{balance:model.balance},...model.projection.schedule];
    const faster=preview?[{balance:model.balance},...preview.schedule]:[];
    const maxLen=Math.max(base.length,faster.length,2)-1;
    const maxBalance=Math.max(model.balance,...base.map(p=>p.balance),1);
    const x=i=>50+i/maxLen*820, y=v=>20+(1-v/maxBalance)*190;
    const path=rows=>rows.map((row,i)=>`${i?"L":"M"}${x(i).toFixed(1)},${y(row.balance).toFixed(1)}`).join(" ");
    const basePath=path(base), previewPath=faster.length?`<path class="preview-line" d="${path(faster)}"/>`:"";
    const area=`${basePath} L${x(base.length-1).toFixed(1)},210 L50,210 Z`;
    $("#balance-chart").innerHTML=`<title>Projected outstanding loan balance</title><desc>A monthly estimate declining from ${money.format(model.balance)} to zero.</desc><defs><linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--green)" stop-opacity=".26"/><stop offset="1" stop-color="var(--green)" stop-opacity="0"/></linearGradient></defs><line class="gridline" x1="50" y1="20" x2="870" y2="20"/><line class="gridline" x1="50" y1="115" x2="870" y2="115"/><line class="gridline" x1="50" y1="210" x2="870" y2="210"/><text class="axis" x="3" y="24">${compactMoney(maxBalance)}</text><text class="axis" x="24" y="214">₹0</text><text class="axis" x="50" y="235">Now</text><text class="axis" x="815" y="235">${prettyDate(model.projection.payoffDate)}</text><path class="area" d="${area}"/><path class="loan-line" d="${basePath}"/>${previewPath}`;
  }

  function renderSplit() {
    const total=model.principalPaid+model.totalInterestPaid;
    const principalPct=total?model.principalPaid/total*100:0;
    $("#principal-split").style.width=`${principalPct}%`; $("#interest-split").style.width=`${100-principalPct}%`;
    $("#split-principal-label").textContent=money.format(model.principalPaid); $("#split-interest-label").textContent=money.format(model.totalInterestPaid);
  }

  function renderMilestones(progress) {
    $("#milestones").innerHTML=[25,50,75,100].map(pct=>`<article class="panel milestone ${progress>=pct?"done":""}"><span class="flag">${progress>=pct?"✓":"⚑"}</span><strong>${pct}% repaid</strong><small>${money.format(state.loan.originalPrincipal*pct/100)} principal</small><div class="bar"><span style="width:${Math.min(100,progress/pct*100)}%"></span></div></article>`).join("");
  }

  function renderActivity() {
    const eventRows=model.details.map(row=>({
      ...row,
      label:row.type==="emi"?"Monthly EMI":"Part-payment",
      action:`<button class="btn small" data-edit-event="${row.id}" type="button">Review</button>`
    }));
    const imported=state.history.map(row=>({...row,amount:row.principal+row.interest,label:"Statement payment",status:"confirmed",action:"<span class=\"source-tag\">Read-only</span>"}));
    const rows=[...eventRows,...imported].sort((a,b)=>b.date.localeCompare(a.date));
    $("#activity-rows").innerHTML=rows.map(row=>`<tr><td>${prettyDate(row.date)}</td><td>${row.label}</td><td>${money.format(row.amount)}</td><td>${money.format(row.principal||0)}</td><td>${money.format(row.interest||0)}</td><td>${money.format(row.balance)}</td><td><span class="status ${row.status}">${row.status==="confirmed"?"Confirmed":row.status==="failed"?"Failed":"Pending"}</span></td><td><div class="row-actions">${row.action}</div></td></tr>`).join("");
  }

  function renderRates() {
    const changes=[...state.rateChanges].sort((a,b)=>b.date.localeCompare(a.date));
    $("#rate-list").innerHTML=changes.length?changes.map(r=>`${prettyDate(r.date)} · <strong>${r.annualRate.toFixed(2)}%</strong>`).join("<br>"):`Current statement rate · <strong>${state.loan.annualRate.toFixed(2)}%</strong>`;
  }

  function renderGoal() {
    $("#goal-date").value=state.goalDate || "";
    const result=$("#goal-result");
    if (!state.goalDate) { result.classList.add("hidden"); return; }
    let due=nextDueDate(today,state.loan.dueDay), months=0;
    while(due<=state.goalDate&&months<1200){months++;due=addMonths(due,1,state.loan.dueDay);}
    try {
      const payment=requiredPayment(model.balance,rateAt(state,today),months);
      $("#goal-payment").textContent=money.format(payment); $("#goal-extra").textContent=money.format(Math.max(0,payment-state.loan.emi)); result.classList.remove("hidden");
    } catch { result.classList.add("hidden"); }
  }

  function openEvent(id) {
    const event=state.events.find(item=>item.id===id); if (!event) return;
    $("#event-dialog-title").textContent=event.type==="emi"?"Review EMI":"Review part-payment";
    $("#event-id").value=event.id; $("#event-date").value=event.date; $("#event-amount").value=event.amount; $("#event-status").value=event.status; $("#event-status").disabled=event.type!=="emi"; $("#event-dialog").showModal();
  }

  document.addEventListener("click",event=>{ const button=event.target.closest("[data-edit-event]"); if(button) openEvent(button.dataset.editEvent); });
  $("#theme-toggle").addEventListener("click",()=>{state.theme=state.theme==="dark"?"light":"dark";persist();});

  $("#event-form").addEventListener("submit",event=>{
    event.preventDefault();
    const item=state.events.find(e=>e.id===$("#event-id").value); if(!item) return;
    const date=$("#event-date").value, amount=Number($("#event-amount").value), status=item.type==="emi"?$("#event-status").value:"confirmed";
    if(date<state.loan.baselineDate || !isPositive(amount)) return toast("Enter a valid date and amount.");
    const period=monthKey(date);
    if(item.type==="emi"&&state.events.some(e=>e.type==="emi"&&e.id!==item.id&&e.period===period)) return toast("An EMI already exists for that month.");
    const draft=clone(state), next=draft.events.find(e=>e.id===item.id); Object.assign(next,{date,amount,status}); if(next.type==="emi")next.period=period;
    try{validateState(draft);}catch(error){return toast(error.message);}
    state=draft; $("#event-dialog").close(); persist(status==="confirmed"?"Payment confirmed. One step closer.":"EMI updated.").then(saved=>{if(saved&&status==="confirmed")celebrate();});
  });
  $("#cancel-event").addEventListener("click",()=>$("#event-dialog").close());

  $("#prepayment-form").addEventListener("submit",event=>{
    event.preventDefault(); setError("#prepay-error");
    try {
      const amount=Number($("#prepay-amount").value), date=$("#prepay-date").value;
      if(!date || date<state.loan.baselineDate || date>today) throw new RangeError("Choose a date from the statement date through today.");
      preview=simulatePrepayment(state,today,amount,date); previewPayload={amount,date};
      $("#preview-payoff").textContent=prettyDate(preview.payoffDate); $("#preview-months").textContent=`${preview.paymentsSaved} months`; $("#preview-interest").textContent=money.format(preview.interestSaved); $("#preview-interest-left").textContent=money.format(preview.remainingInterest); $("#preview-balance").textContent=money.format(preview.balanceAfter);
      $("#prepay-preview").classList.remove("hidden"); $("#record-prepayment").classList.remove("hidden"); renderChart();
    } catch(error) { preview=null; previewPayload=null; $("#prepay-preview").classList.add("hidden"); $("#record-prepayment").classList.add("hidden"); setError("#prepay-error",error.message); renderChart(); }
  });

  $("#record-prepayment").addEventListener("click",()=>{
    if(!previewPayload) return;
    state.events.push({id:`prepay-${Date.now()}`,type:"prepayment",date:previewPayload.date,amount:previewPayload.amount,status:"confirmed"});
    preview=null; previewPayload=null; $("#prepay-preview").classList.add("hidden"); $("#record-prepayment").classList.add("hidden"); persist("Part-payment recorded. Your finish line moved closer!").then(saved=>{if(saved)celebrate();});
  });

  $("#rate-form").addEventListener("submit",event=>{
    event.preventDefault(); setError("#rate-error");
    const annualRate=Number($("#rate-value").value), date=$("#rate-date").value;
    if(!isPositive(annualRate)||annualRate>100||!date||date<state.loan.baselineDate) return setError("#rate-error","Enter a valid rate and an effective date on or after the statement date.");
    const draft=clone(state), existing=draft.rateChanges.find(item=>item.date===date); existing?existing.annualRate=annualRate:draft.rateChanges.push({id:`rate-${Date.now()}`,date,annualRate});
    try{validateState(draft);}catch(error){return setError("#rate-error",error.message);}
    state=draft; persist("Floating rate saved.");
  });

  $("#goal-form").addEventListener("submit",event=>{event.preventDefault();const date=$("#goal-date").value;if(date&&date<=today)return toast("Choose a future target date.");state.goalDate=date;persist(date?"Payoff target saved.":"Payoff target cleared.");});
  $("#clear-goal").addEventListener("click",()=>{state.goalDate="";persist("Payoff target cleared.");});

  $("#export-data").addEventListener("click",()=>{const blob=new Blob([serializeState(state)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`loan-freedom-backup-${today}.json`;a.click();URL.revokeObjectURL(url);toast("Backup exported.");});
  $("#import-data").addEventListener("change",async event=>{try{const next=parseBackup(await event.target.files[0].text());if(!confirm("Replace current tracker data with this validated backup?"))return;state=next;preview=null;persist("Backup restored.");}catch(error){toast(`Import rejected: ${error.message}`);}finally{event.target.value="";}});
  $("#reset-data").addEventListener("click",()=>{if(!confirm("Reset all activity to the 7 October 2026 statement baseline?"))return;state=clone(DEFAULT_STATE);ensureExpectedEmis(state,today);preview=null;persist("Tracker reset to statement baseline.");});

  $("#prepay-date").value=today; $("#prepay-date").max=today; $("#rate-date").value=today;

  const config=window.LOAN_TRACKER_SUPABASE;
  if(!config?.url || !config?.publishableKey || config.publishableKey.includes("PASTE_")) {
    showSignedOut("Supabase setup is incomplete. Add the publishable key to supabase-config.js, then reload.");
    $("#auth-submit").disabled=true;
    return;
  }
  if(!window.supabase?.createClient) {
    showSignedOut("The Supabase browser library could not be loaded. Check your connection and reload.");
    $("#auth-submit").disabled=true;
    return;
  }

  supabaseClient=window.supabase.createClient(config.url,config.publishableKey);
  cloudStore=createCloudStore(supabaseClient);

  $("#auth-form").addEventListener("submit",async event=>{
    event.preventDefault();
    const email=$("#auth-email").value.trim();
    if(!email) return;
    $("#auth-submit").disabled=true;
    $("#auth-message").textContent="Sending secure sign-in link…";
    const {error}=await supabaseClient.auth.signInWithOtp({email,options:{emailRedirectTo:`${location.origin}${location.pathname}`}});
    $("#auth-submit").disabled=false;
    $("#auth-message").textContent=error?`Sign-in failed: ${error.message}`:"Check your email and open the sign-in link on this device.";
  });

  $("#sign-out").addEventListener("click",async()=>{
    const {error}=await supabaseClient.auth.signOut();
    if(error) toast(`Sign-out failed: ${error.message}`);
  });

  const {data:{session},error:sessionError}=await supabaseClient.auth.getSession();
  if(sessionError) showSignedOut(`Could not check your Supabase session: ${sessionError.message}`);
  else if(session?.user) await loadCloudState(session.user);
  else showSignedOut();

  supabaseClient.auth.onAuthStateChange((event,session)=>{
    if(event==="SIGNED_OUT") showSignedOut("Signed out. Your loan data remains safely stored in Supabase.");
    else if(event==="SIGNED_IN"&&session?.user&&session.user.id!==currentUser?.id) loadCloudState(session.user);
  });
}
