// End-to-end local check of the Function against the in-memory fake database.
// Run: node dev/api-test.mjs   (expects dev/server.mjs running on port 8000)
const BASE = "http://127.0.0.1:8000/functions/v1/app";
let failures = 0;

function check(name, condition, detail = "") {
  if (condition) console.log(`PASS ${name}`);
  else { failures += 1; console.log(`FAIL ${name} ${detail}`); }
}

async function api(action, { method = "GET", token, body } = {}) {
  const url = new URL(`${BASE}?action=${action}`);
  if (token) url.searchParams.set("st", token);
  const init = { method, headers: { "content-type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await fetch(url, init);
  return { status: response.status, json: await response.json() };
}

// Positive = this partner owes money; negative = this partner is owed money.
function debtOwedBy(debts, id) {
  const d = (debts ?? []).find((x) => x.fromId === id || x.toId === id);
  if (!d) return 0;
  return d.fromId === id ? d.amountPaise : -d.amountPaise;
}

async function main() {
  await fetch("http://127.0.0.1:8000/__reset", { method: "POST" });

  const boot1 = await api("bootstrap");
  check("bootstrap reports setup required", boot1.json.setupRequired === true);

  // ---- setup (single partner) + invite flow ----
  const setup = await api("setup", { method: "POST", body: {
    name: "Ajeer", username: "ajeer", password: "secret123",
  } });
  check("setup succeeds", setup.json.ok === true, JSON.stringify(setup.json));

  const setup2 = await api("setup", { method: "POST", body: {
    name: "Xavier", username: "xavier", password: "xxxxxx",
  } });
  check("second setup rejected", setup2.status === 409 && setup2.json.error === "already_set_up");

  const badLogin = await api("login", { method: "POST", body: { username: "ajeer", password: "wrong1" } });
  check("wrong password rejected", badLogin.status === 401 && badLogin.json.error === "invalid_credentials");

  const loginA = await api("login", { method: "POST", body: { username: "ajeer", password: "secret123" } });
  check("login A", loginA.json.ok === true && typeof loginA.json.token === "string");
  const tokenA = loginA.json.token;
  const idA = loginA.json.partner.id;

  const dataInvite = await api("data", { token: tokenA });
  const code1 = dataInvite.json.inviteCode;
  check("invite code issued after setup", typeof code1 === "string" && /^[A-Z2-9]{8}$/.test(code1),
    String(code1));

  const badAccept = await api("accept_invite", { method: "POST", body: {
    code: "ZZZZZZZZ", name: "Partner", username: "partner", password: "secret456",
  } });
  check("wrong invite code rejected", badAccept.status === 404 && badAccept.json.error === "invalid_invite");

  const acceptB = await api("accept_invite", { method: "POST", body: {
    code: code1, name: "Partner", username: "partner", password: "secret456",
  } });
  check("invite accepted creates partner B", acceptB.json.ok === true && acceptB.json.partner.position === 1,
    JSON.stringify(acceptB.json));

  const dupName = await api("accept_invite", { method: "POST", body: {
    code: code1, name: "Clone", username: "clone1", password: "clonepass",
  } });
  check("consumed invite code rejected", dupName.status === 404 && dupName.json.error === "invalid_invite");

  const loginB = await api("login", { method: "POST", body: { username: "partner", password: "secret456" } });
  check("login B", loginB.json.ok === true);
  const tokenB = loginB.json.token;
  const idB = loginB.json.partner.id;

  const dataB = await api("data", { token: tokenB });
  check("invite consumed after accept", dataB.json.inviteCode === null);
  check("two partners listed", dataB.json.partners.length === 2);
  check("monthCloses starts empty", Array.isArray(dataB.json.monthCloses) && dataB.json.monthCloses.length === 0);

  // ---- invite regeneration (one-time, rotating) ----
  const regen1 = await api("regenerate_invite", { method: "POST", token: tokenA, body: {} });
  const regen2 = await api("regenerate_invite", { method: "POST", token: tokenB, body: {} });
  check("regenerate invite rotates code", regen1.json.ok && regen2.json.ok &&
    regen1.json.inviteCode !== regen2.json.inviteCode);
  const stale = await api("accept_invite", { method: "POST", body: {
    code: regen1.json.inviteCode, name: "Third", username: "third3", password: "thirdpass",
  } });
  check("stale invite code rejected after rotation", stale.status === 404);
  const taken = await api("accept_invite", { method: "POST", body: {
    code: regen2.json.inviteCode, name: "Copy", username: "ajeer", password: "copypass1",
  } });
  check("invite with taken username rejected", taken.status === 409 && taken.json.error === "invalid_username");

  const third = await api("accept_invite", { method: "POST", body: {
    code: regen2.json.inviteCode, name: "Third", username: "third3", password: "thirdpass",
  } });
  check("third partner blocked at two", third.status === 409 && third.json.error === "already_two_partners",
    JSON.stringify(third.json));

  const signupAsJoin = await api("join", { method: "POST", body: { code: regen2.json.inviteCode } });
  check("signup code rejected by joining flow", signupAsJoin.status === 404 && signupAsJoin.json.error === "invalid_join");

  // ---- auth guards ----
  const noAuth = await api("data");
  check("data without token rejected", noAuth.status === 401 && noAuth.json.error === "login_required");
  const badToken = await api("data", { token: "0".repeat(64) });
  check("data with unknown token rejected", badToken.status === 401);

  // ---- expenses & balance (shares JSON, custom splits) ----
  const add1 = await api("add_expense", { method: "POST", token: tokenA, body: {
    date: "2026-10-05", merchant: "Big Bazaar", category: "Groceries", note: "weekly shop",
    amountPaise: 500000, paidBy: idA, splitType: "equal",
  } });
  check("add equal expense", add1.json.ok === true);
  check("equal shares JSON", (() => { const s = JSON.parse(add1.json.expense.shares); return s[idA] === 250000 && s[idB] === 250000; })());

  const add2 = await api("add_expense", { method: "POST", token: tokenB, body: {
    date: "2026-10-06", merchant: "Indian Oil", category: "Fuel", note: "",
    amountPaise: 120000, paidBy: idB, splitType: "equal",
  } });
  check("add expense by B", add2.json.ok === true);

  const add3 = await api("add_expense", { method: "POST", token: tokenA, body: {
    date: "2026-10-07", merchant: "Barbeque Nation", category: "Dining", note: "A's solo dinner",
    amountPaise: 80000, paidBy: idA, splitType: "personal",
  } });
  check("personal split charges payer fully", (() => {
    const s = JSON.parse(add3.json.expense.shares);
    return s[idA] === 80000 && s[idB] === undefined;
  })());

  const add4 = await api("add_expense", { method: "POST", token: tokenB, body: {
    date: "2026-10-08", merchant: "Amazon", category: "Electronics", note: "cable",
    amountPaise: 100000, paidBy: idB, splitType: "custom", customShares: { [idA]: 70000, [idB]: 30000 },
  } });
  check("custom split 70/30", (() => {
    const s = JSON.parse(add4.json.expense.shares);
    return s[idA] === 70000 && s[idB] === 30000;
  })());

  const badAmount = await api("add_expense", { method: "POST", token: tokenA, body: {
    date: "2026-10-08", merchant: "X", category: "Y", note: "", amountPaise: 0, paidBy: idA, splitType: "equal",
  } });
  check("zero amount rejected", badAmount.status === 400 && badAmount.json.error === "invalid_amount");

  const badDate = await api("add_expense", { method: "POST", token: tokenA, body: {
    date: "2026-02-30", merchant: "X", category: "Y", note: "", amountPaise: 100, paidBy: idA, splitType: "equal",
  } });
  check("impossible date rejected", badDate.status === 400 && badDate.json.error === "invalid_date");

  // netA = paidA 5800 - shareA (2500+600+800+700) = +1200 -> B owes A 1200
  const data1 = await api("data", { token: tokenA });
  check("balance before rent", debtOwedBy(data1.json.debts, idA) === -120000,
    JSON.stringify(data1.json.debts));

  const rule1 = await api("add_recurring", { method: "POST", token: tokenB, body: {
    merchant: "Landlord Rent", category: "Rent", note: "monthly rent",
    amountPaise: 1500000, paidBy: idB, splitType: "equal", dayOfMonth: 1, active: true,
  } });
  check("add recurring rule", rule1.json.ok === true);

  const data2 = await api("data", { token: tokenA });
  const rentExpense = data2.json.expenses.find((e) => e.recurring_rule_id);
  check("current month rent generated (day 1 already passed)", !!rentExpense && rentExpense.expense_date === "2026-10-01",
    JSON.stringify(data2.json.expenses.map((e) => e.expense_date)));
  // netA = 5800 - (4600+7500) = -6300 -> A owes B 6300
  check("balance after rent", debtOwedBy(data2.json.debts, idA) === 630000,
    JSON.stringify(data2.json.debts));

  await api("sync", { method: "POST", token: tokenA });
  const data3 = await api("data", { token: tokenA });
  check("recurring is idempotent", data3.json.expenses.length === 5, `got ${data3.json.expenses.length}`);

  const settle1 = await api("add_settlement", { method: "POST", token: tokenA, body: {
    date: "2026-10-10", fromId: idA, toId: idB, amountPaise: 500000, note: "UPI transfer",
  } });
  check("settlement recorded", settle1.json.ok === true);

  const data4 = await api("data", { token: tokenB });
  // netA = -6300 + 5000 = -1300 -> A owes B 1300
  check("balance after settlement", debtOwedBy(data4.json.debts, idA) === 130000,
    JSON.stringify(data4.json.debts));
  check("settlement listed", data4.json.settlements.length === 1 && data4.json.settlements[0].note === "UPI transfer");

  const upd1 = await api("update_expense", { method: "POST", token: tokenB, body: {
    id: add3.json.expense.id, date: "2026-10-07", merchant: "Barbeque Nation", category: "Dining",
    note: "dinner for both", amountPaise: 80000, paidBy: idA, splitType: "equal",
  } });
  check("update expense to equal split", upd1.json.ok === true && JSON.parse(upd1.json.expense.shares)[idA] === 40000);

  const data5 = await api("data", { token: tokenA });
  // shareA 2500+600+400+700+7500=11700; netA = 5800-11700+5000 = -900
  check("balance after edit", debtOwedBy(data5.json.debts, idA) === 90000,
    JSON.stringify(data5.json.debts));

  const del1 = await api("delete_expense", { method: "POST", token: tokenA, body: { id: add4.json.expense.id } });
  check("delete expense", del1.json.ok === true);
  // shareA 11700-700=11000; netA = 5800-11000+5000 = -200
  const data6 = await api("data", { token: tokenA });
  check("balance after delete", debtOwedBy(data6.json.debts, idA) === 20000,
    JSON.stringify(data6.json.debts));
  check("lists populated", data6.json.lists.merchants.some((m) => m.name === "Big Bazaar"));

  const delMissing = await api("delete_expense", { method: "POST", token: tokenA, body: { id: add4.json.expense.id } });
  check("delete missing expense 404", delMissing.status === 404);

  // ---- recurring pause ----
  const ruleUpd = await api("update_recurring", { method: "POST", token: tokenB, body: {
    id: rule1.json.rule.id, merchant: "Landlord Rent", category: "Rent", note: "monthly rent",
    amountPaise: 1600000, paidBy: idB, splitType: "equal", dayOfMonth: 1, active: false,
  } });
  check("recurring can be paused", ruleUpd.json.ok === true && ruleUpd.json.rule.active === false);

  const delSettle = await api("delete_settlement", { method: "POST", token: tokenA, body: { id: settle1.json.settlement.id } });
  check("delete settlement", delSettle.json.ok === true);
  // netA = 5800-11000 = -5200 -> A owes B 5200
  const data7 = await api("data", { token: tokenA });
  check("balance after settlement delete", debtOwedBy(data7.json.debts, idA) === 520000,
    JSON.stringify(data7.json.debts));

  // ---- month closing ----
  const sepA = await api("add_expense", { method: "POST", token: tokenA, body: {
    date: "2026-09-10", merchant: "Dmart", category: "Groceries", note: "september stock",
    amountPaise: 400000, paidBy: idA, splitType: "equal",
  } });
  check("september expense added", sepA.json.ok === true);

  const closeCur = await api("close_month", { method: "POST", token: tokenA, body: { month: "2026-10" } });
  check("current month cannot be closed", closeCur.status === 400);
  const closeBad = await api("close_month", { method: "POST", token: tokenA, body: { month: "2026-13" } });
  check("invalid month key rejected", closeBad.status === 400);

  const closeSep = await api("close_month", { method: "POST", token: tokenB, body: { month: "2026-09" } });
  check("close september", closeSep.json.ok === true &&
    closeSep.json.summary.totalPaise === 400000 && closeSep.json.summary.expenseCount === 1,
    JSON.stringify(closeSep.json.summary));
  check("close summary has category and debts", closeSep.json.summary.byCategory[0].name === "Groceries" &&
    Array.isArray(closeSep.json.summary.debts));

  const closeDup = await api("close_month", { method: "POST", token: tokenA, body: { month: "2026-09" } });
  check("double close rejected", closeDup.status === 409 && closeDup.json.error === "already_closed");

  const addClosed = await api("add_expense", { method: "POST", token: tokenA, body: {
    date: "2026-09-15", merchant: "X", category: "Y", note: "", amountPaise: 100, paidBy: idA, splitType: "equal",
  } });
  check("add into closed month rejected", addClosed.status === 409 && addClosed.json.error === "month_closed");
  const updClosed = await api("update_expense", { method: "POST", token: tokenA, body: {
    id: sepA.json.expense.id, date: "2026-09-10", merchant: "Dmart", category: "Groceries",
    note: "edited", amountPaise: 400000, paidBy: idA, splitType: "equal",
  } });
  check("edit inside closed month rejected", updClosed.status === 409 && updClosed.json.error === "month_closed");
  const moveIntoClosed = await api("update_expense", { method: "POST", token: tokenA, body: {
    id: data7.json.expenses.find((e) => e.expense_date === "2026-10-05").id,
    date: "2026-09-20", merchant: "Big Bazaar", category: "Groceries", note: "moved",
    amountPaise: 500000, paidBy: idA, splitType: "equal",
  } });
  check("move into closed month rejected", moveIntoClosed.status === 409 && moveIntoClosed.json.error === "month_closed");
  const delClosed = await api("delete_expense", { method: "POST", token: tokenA, body: { id: sepA.json.expense.id } });
  check("delete inside closed month rejected", delClosed.status === 409 && delClosed.json.error === "month_closed");
  const settleClosed = await api("add_settlement", { method: "POST", token: tokenA, body: {
    date: "2026-09-20", fromId: idA, toId: idB, amountPaise: 100, note: "",
  } });
  check("settlement in closed month rejected", settleClosed.status === 409 && settleClosed.json.error === "month_closed");

  const dataClosed = await api("data", { token: tokenA });
  check("monthCloses listed", dataClosed.json.monthCloses.length === 1 &&
    dataClosed.json.monthCloses[0].month === "2026-09" &&
    dataClosed.json.monthCloses[0].summary.totalPaise === 400000);

  const reopenSep = await api("reopen_month", { method: "POST", token: tokenA, body: { month: "2026-09" } });
  check("reopen september", reopenSep.json.ok === true);
  const reopenTwice = await api("reopen_month", { method: "POST", token: tokenA, body: { month: "2026-09" } });
  check("reopen without close 404", reopenTwice.status === 404 && reopenTwice.json.error === "not_closed");

  const addAgain = await api("add_expense", { method: "POST", token: tokenB, body: {
    date: "2026-09-15", merchant: "Z", category: "Y", note: "", amountPaise: 100000, paidBy: idB, splitType: "equal",
  } });
  check("add works again after reopen", addAgain.json.ok === true);
  const delTemp = await api("delete_expense", { method: "POST", token: tokenB, body: { id: addAgain.json.expense.id } });
  check("delete works again after reopen", delTemp.json.ok === true);

  // netA = -5200 + (4000 paid - 2000 share) = -3200 -> A still owes B 3200.
  const dataFinal = await api("data", { token: tokenA });
  check("final balance across closed month intact", debtOwedBy(dataFinal.json.debts, idA) === 320000,
    JSON.stringify(dataFinal.json.debts));

  // ---- avatars ----
  check("avatar defaults null", dataFinal.json.partners.every(
    (p) => (p.avatar_emoji ?? null) === null && (p.avatar_url ?? null) === null));

  const avEmoji = await api("update_avatar", { method: "POST", token: tokenA, body: { avatarEmoji: "🦊", avatarUrl: null } });
  check("emoji avatar set", avEmoji.json.ok === true && avEmoji.json.avatarEmoji === "🦊", JSON.stringify(avEmoji.json));

  const avBadEmoji = await api("update_avatar", { method: "POST", token: tokenA, body: { avatarEmoji: "💥", avatarUrl: null } });
  check("non-whitelisted emoji rejected", avBadEmoji.status === 400 && avBadEmoji.json.error === "invalid_avatar");

  const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const avPhoto = await api("update_avatar", { method: "POST", token: tokenA, body: { avatarEmoji: null, avatarUrl: tinyPng } });
  check("photo avatar set", avPhoto.json.ok === true && avPhoto.json.avatarUrl === tinyPng);

  const avBadUrl = await api("update_avatar", { method: "POST", token: tokenA, body: { avatarEmoji: null, avatarUrl: "data:text/html;base64,PHNjcmlwdD4=" } });
  check("non-image data URL rejected", avBadUrl.status === 400 && avBadUrl.json.error === "invalid_avatar");

  const avHuge = await api("update_avatar", { method: "POST", token: tokenA, body: { avatarEmoji: null, avatarUrl: "data:image/png;base64," + "A".repeat(130000) } });
  check("oversized avatar rejected", avHuge.status === 400 && avHuge.json.error === "invalid_avatar");

  const avListed = await api("data", { token: tokenB });
  const partnerAInList = avListed.json.partners.find((p) => p.id === idA);
  check("avatar visible to the other partner", partnerAInList.avatar_url === tinyPng && (partnerAInList.avatar_emoji ?? null) === null);

  const avClear = await api("update_avatar", { method: "POST", token: tokenA, body: { avatarEmoji: null, avatarUrl: null } });
  const avCleared = await api("data", { token: tokenA });
  const partnerACleared = avCleared.json.partners.find((p) => p.id === idA);
  check("avatar cleared", avClear.json.ok === true &&
    (partnerACleared.avatar_emoji ?? null) === null && (partnerACleared.avatar_url ?? null) === null);

  // ---- password change, lockout, logout ----
  const changePw = await api("change_password", { method: "POST", token: tokenB, body: {
    currentPassword: "wrong", newPassword: "newsecret9",
  } });
  check("wrong current password rejected", changePw.status === 401);

  const changePw2 = await api("change_password", { method: "POST", token: tokenB, body: {
    currentPassword: "secret456", newPassword: "newsecret9",
  } });
  check("change password", changePw2.json.ok === true);

  const reloginOld = await api("login", { method: "POST", body: { username: "partner", password: "secret456" } });
  check("old password no longer works", reloginOld.status === 401);
  const reloginNew = await api("login", { method: "POST", body: { username: "partner", password: "newsecret9" } });
  check("new password works", reloginNew.json.ok === true);
  const stillValid = await api("data", { token: tokenB });
  check("current session survives password change", stillValid.json.ok === true);

  for (let i = 0; i < 5; i++) {
    await api("login", { method: "POST", body: { username: "ajeer", password: "nope" + i } });
  }
  const locked = await api("login", { method: "POST", body: { username: "ajeer", password: "secret123" } });
  check("login locked after 5 failures", locked.status === 429 && locked.json.error === "login_locked",
    JSON.stringify(locked.json));

  const logout = await api("logout", { method: "POST", token: tokenB });
  check("logout", logout.json.ok === true);
  const afterLogout = await api("data", { token: tokenB });
  check("token invalid after logout", afterLogout.status === 401);

  const notFound = await api("bogus_action", { token: tokenA });
  check("unknown action 404", notFound.status === 404);

  const getMutate = await fetch(`${BASE}?action=add_expense&st=${tokenA}`);
  check("GET on POST-only action rejected", getMutate.status === 405);

  // ---- manual add + one-tap joining link (fresh book) ----
  await fetch("http://127.0.0.1:8000/__reset", { method: "POST" });
  await api("setup", { method: "POST", body: { name: "Owner", username: "owner", password: "secret123" } });
  const freshLogin = await api("login", { method: "POST", body: { username: "owner", password: "secret123" } });
  const freshToken = freshLogin.json.token;

  const manual = await api("add_partner", { method: "POST", token: freshToken, body: {
    name: "Sara", username: "sara", password: "secret456",
  } });
  const joinCode = manual.json.inviteCode;
  check("manual add creates partner B + joining code", manual.json.ok === true && manual.json.partner.position === 1 &&
    typeof joinCode === "string" && /^[A-Z2-9]{8}$/.test(joinCode), JSON.stringify(manual.json));
  const saraId = manual.json.partner.id;

  const freshData = await api("data", { token: freshToken });
  check("joining link visible to owner", freshData.json.inviteCode === joinCode && freshData.json.invitePartnerId === saraId);

  const joinAsSignup = await api("accept_invite", { method: "POST", body: {
    code: joinCode, name: "X", username: "xx1x", password: "xxxxxx",
  } });
  check("joining code rejected by signup flow", joinAsSignup.status === 404 && joinAsSignup.json.error === "join_link");

  const rejoin = await api("regenerate_invite", { method: "POST", token: freshToken, body: {} });
  check("regenerate keeps joining kind", rejoin.json.ok === true &&
    rejoin.json.invitePartnerId === saraId && rejoin.json.inviteCode !== joinCode, JSON.stringify(rejoin.json));
  const oldJoin = await api("join", { method: "POST", body: { code: joinCode } });
  check("rotated joining code rejected", oldJoin.status === 404 && oldJoin.json.error === "invalid_join");

  const badJoin = await api("join", { method: "POST", body: { code: "nope" } });
  check("malformed joining code rejected", badJoin.status === 404 && badJoin.json.error === "invalid_join");

  const joinCode2 = rejoin.json.inviteCode;
  const joined = await api("join", { method: "POST", body: { code: joinCode2 } });
  check("joining link signs the partner in", joined.json.ok === true &&
    typeof joined.json.token === "string" && joined.json.partner.id === saraId, JSON.stringify(joined.json));

  const joinedData = await api("data", { token: joined.json.token });
  check("joined session reads the book", joinedData.json.partners.length === 2);

  const reuse = await api("join", { method: "POST", body: { code: joinCode2 } });
  check("joining link is one-time", reuse.status === 404 && reuse.json.error === "invalid_join");

  const afterJoin = await api("data", { token: freshToken });
  check("joining link cleared after use", afterJoin.json.inviteCode === null && afterJoin.json.invitePartnerId === null);

  const overAdd = await api("add_partner", { method: "POST", token: freshToken, body: {
    name: "Third", username: "third9", password: "thirdpass",
  } });
  check("manual add beyond two blocked", overAdd.status === 409 && overAdd.json.error === "already_two_partners");

  const joinGet = await fetch(`${BASE}?action=join`);
  check("GET on join rejected", joinGet.status === 405);

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => { console.error("harness error:", error); process.exitCode = 1; });
