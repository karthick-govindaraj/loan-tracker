const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_STATE, ensureExpectedEmis, applyTrackedEvents, projectLoan,
  simulatePrepayment, parseBackup, serializeState, loadState, saveState
} = require("./app.js");

const fresh = () => JSON.parse(JSON.stringify(DEFAULT_STATE));

test("statement baseline amortizes in about 173 payments and ends at zero", () => {
  const result = projectLoan(DEFAULT_STATE.loan.baselineBalance, fresh(), "2026-10-07");
  assert.equal(result.schedule.length, 173);
  assert.equal(result.schedule.at(-1).balance, 0);
  assert.ok(result.schedule.at(-1).payment < DEFAULT_STATE.loan.emi);
});

test("₹50,000 preview shortens tenure and interest without mutating state", () => {
  const state = fresh();
  const before = serializeState(state);
  const base = projectLoan(state.loan.baselineBalance,state,state.loan.baselineDate);
  const preview = simulatePrepayment(state,state.loan.baselineDate,50000,state.loan.baselineDate);
  assert.ok(preview.schedule.length < base.schedule.length);
  assert.ok(preview.interestSaved > 0);
  assert.equal(serializeState(state),before);
});

test("effective-date rate changes leave earlier history unchanged", () => {
  const state = fresh();
  state.events.push({id:"emi-2026-10",type:"emi",period:"2026-10",date:"2026-10-15",amount:19730,status:"confirmed"});
  state.rateChanges.push({id:"higher",date:"2026-11-01",annualRate:12});
  const tracked = applyTrackedEvents(state,"2026-10-31");
  assert.equal(tracked.details[0].interest,Math.round(state.loan.baselineBalance*10.15/1200*100)/100);
  const base = projectLoan(tracked.balance,fresh(),"2026-10-31");
  const changed = projectLoan(tracked.balance,state,"2026-10-31");
  assert.ok(changed.totalInterest > base.totalInterest);
});

test("failed EMI does not reduce balance", () => {
  const state = fresh();
  state.events.push({id:"emi-2026-10",type:"emi",period:"2026-10",date:"2026-10-15",amount:19730,status:"failed"});
  const result = applyTrackedEvents(state,"2026-10-31");
  assert.equal(result.balance,state.loan.baselineBalance);
  assert.equal(result.details[0].principal,0);
});

test("pending EMI generation observes the 15th, catches up and prevents duplicates", () => {
  const before = fresh();
  assert.equal(ensureExpectedEmis(before,"2026-10-14"),0);
  assert.equal(before.events.length,0);
  assert.equal(ensureExpectedEmis(before,"2026-10-15"),1);
  assert.equal(before.events[0].status,"pending");
  assert.equal(ensureExpectedEmis(before,"2026-12-16"),2);
  assert.equal(before.events.length,3);
  assert.equal(ensureExpectedEmis(before,"2026-12-31"),0);
});

test("invalid inputs and negative amortization are rejected", () => {
  const state = fresh();
  assert.throws(()=>simulatePrepayment(state,state.loan.baselineDate,-1),/positive/);
  state.loan.annualRate=100;
  assert.throws(()=>projectLoan(state.loan.baselineBalance,state,state.loan.baselineDate),/too low/);
  assert.throws(()=>parseBackup("not json"));
  const duplicate=fresh();
  duplicate.events=[
    {id:"a",type:"emi",period:"2026-10",date:"2026-10-15",amount:19730,status:"pending"},
    {id:"b",type:"emi",period:"2026-10",date:"2026-10-16",amount:19730,status:"confirmed"}
  ];
  assert.throws(()=>parseBackup(JSON.stringify(duplicate)),/Duplicate/);
});

test("validated JSON persists across reload", () => {
  const values = new Map();
  const storage = {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const state=fresh();
  state.goalDate="2035-10-15";
  saveState(storage,state);
  assert.deepEqual(loadState(storage),state);
  values.set("loan-freedom-v1","broken");
  assert.deepEqual(loadState(storage),fresh());
});
