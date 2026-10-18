import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

// Run with Node 22. No build output, browser, credentials, network, or disk writes.
// Every fixture owns a new VM, module cache, storage map, and event targets.
const root = fileURLToPath(new URL("../", import.meta.url));
const read = (name) => readFileSync(path.join(root, name), "utf8");
const KEY = "pe_preferences";
const defaults = { theme: "system", currencyCode: "INR", avatars: {}, archivedMonths: [] };
const plain = (value) => JSON.parse(JSON.stringify(value));
const compiled = new Map();
const allowedModules = new Set(["preferences", "money", "compute", "types", "usePrefs"]);
const cases = [];
const test = (name, run) => cases.push({ name, run });

class MemoryStorage {
  values = new Map();
  denyRead = false;
  denyWrite = false;
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) {
    if (this.denyRead) throw new Error("fixture: storage read denied");
    return this.values.get(String(key)) ?? null;
  }
  setItem(key, value) {
    if (this.denyWrite) throw new Error("fixture: storage write denied");
    this.values.set(String(key), String(value));
  }
  removeItem(key) { this.values.delete(String(key)); }
  clear() { this.values.clear(); }
}

function fixture({ raw, systemDark = false, react } = {}) {
  const storage = new MemoryStorage();
  if (raw !== undefined) storage.setItem(KEY, raw);
  const window = new EventTarget();
  const media = new EventTarget();
  media.matches = systemDark;
  media.media = "(prefers-color-scheme: dark)";
  const matchMedia = (query) => {
    assert.equal(query, media.media);
    return media;
  };
  window.matchMedia = matchMedia;
  window.localStorage = storage;
  const classes = new Set();
  const meta = {
    content: "#0f766e",
    setAttribute(name, value) {
      assert.equal(name, "content");
      this.content = value;
    },
  };
  const document = {
    documentElement: {
      classList: {
        toggle(name, force) {
          const enabled = force ?? !classes.has(name);
          if (enabled) classes.add(name); else classes.delete(name);
          return enabled;
        },
        contains: (name) => classes.has(name),
      },
      style: {},
    },
    querySelector(selector) {
      assert.equal(selector, 'meta[name="theme-color"]');
      return meta;
    },
  };
  window.document = document;
  const context = vm.createContext({ window, localStorage: storage, document, matchMedia, Event, EventTarget });
  const modules = new Map();
  function load(name) {
    assert.ok(allowedModules.has(name), `Module not permitted in isolated fixture: ${name}`);
    if (modules.has(name)) return modules.get(name).exports;
    if (!compiled.has(name)) {
      const result = ts.transpileModule(read(`src/${name}.ts`), {
        fileName: path.join(root, "src", `${name}.ts`),
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
        reportDiagnostics: true,
      });
      const errors = (result.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
      assert.equal(errors.length, 0, errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n"));
      compiled.set(name, result.outputText);
    }
    const module = { exports: {} };
    modules.set(name, module);
    const localRequire = (request) => {
      if (request === "react" && react) return react;
      assert.match(request, /^\.\/[A-Za-z]+$/, `Import not permitted: ${request}`);
      return load(request.slice(2));
    };
    const execute = new vm.Script(`(function(require, module, exports) {\n${compiled.get(name)}\n})`, {
      filename: path.join(root, "src", `${name}.ts`),
    }).runInContext(context, { timeout: 1000 });
    execute(localRequire, module, module.exports);
    return module.exports;
  }
  return {
    storage, window, document, meta, context, load,
    preferences: load("preferences"), money: load("money"), compute: load("compute"), types: load("types"),
    systemChange(dark) {
      if (media.matches === dark) return;
      media.matches = dark;
      media.dispatchEvent(new Event("change"));
    },
    externalWrite(value, key = KEY) {
      const oldValue = key === null ? null : storage.getItem(key);
      if (key === null) storage.clear();
      else if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
      // A remote tab changes shared storage first; only this receiving tab gets the event.
      const event = new Event("storage");
      Object.assign(event, { key, oldValue, newValue: value, storageArea: storage, url: "https://fixture.invalid/other-tab" });
      window.dispatchEvent(event);
    },
  };
}

function assertTheme(f, dark, checkMeta = true) {
  assert.equal(f.document.documentElement.classList.contains("dark"), dark);
  assert.equal(f.document.documentElement.style.colorScheme, dark ? "dark" : "light");
  if (checkMeta) assert.equal(f.meta.content, dark ? "#0c0a09" : "#0f766e");
}

// A single-hook lifecycle stub: checks subscriptions/state updates, not React rendering.
function hookStub() {
  let value;
  let initialized = false;
  let mounted = false;
  let effect;
  let cleanup;
  let updates = 0;
  return {
    react: {
      useState(initial) {
        if (!initialized) { value = typeof initial === "function" ? initial() : initial; initialized = true; }
        return [value, (next) => { value = typeof next === "function" ? next(value) : next; updates++; }];
      },
      useEffect(callback, dependencies) {
        assert.equal(dependencies.length, 0);
        if (!mounted) effect = callback;
      },
    },
    render(hook) {
      const result = hook();
      if (!mounted) { cleanup = effect(); mounted = true; }
      return result;
    },
    unmount() { cleanup?.(); },
    get updates() { return updates; },
  };
}

const html = read("index.html");
const css = read("src/globals.css");
const mainSource = read("src/main.tsx");
const appSource = read("src/App.tsx");
const moreSource = read("src/views/MoreView.tsx");
const forms = ["ExpenseForm", "RecurringForm", "SettleForm"].map((name) => [name, read(`src/components/${name}.tsx`)]);

for (const systemDark of [false, true]) {
  test(`default/system theme follows system (${systemDark ? "dark" : "light"})`, () => {
    const f = fixture({ systemDark });
    assert.deepEqual(plain(f.preferences.getPrefs()), defaults);
    f.preferences.initializeTheme();
    assertTheme(f, systemDark);
    f.systemChange(!systemDark);
    assertTheme(f, !systemDark);
    assert.equal(f.preferences.getPrefs().theme, "system");
    assert.equal(f.storage.length, 0, "Reading/applying defaults must not persist them");
  });
}

test("light/dark overrides survive system changes; system resumes tracking", () => {
  const f = fixture();
  f.preferences.initializeTheme();
  for (const [mode, system, dark] of [["dark", false, true], ["light", true, false], ["system", true, true]]) {
    f.preferences.setTheme(mode);
    f.systemChange(system);
    assertTheme(f, dark);
    assert.equal(JSON.parse(f.storage.getItem(KEY)).theme, mode);
  }
  f.systemChange(false);
  assertTheme(f, false);
});

test("cross-tab changes, removal, clear and malformed data update theme", () => {
  const f = fixture({ systemDark: true });
  f.preferences.initializeTheme();
  for (const [raw, dark] of [
    ['{"theme":"light"}', false], ['{"theme":"dark"}', true],
    ['{"theme":"system"}', true], ['{"theme":"light"}', false],
    [null, true], ['{"theme":"light"}', false], ["{broken", true],
  ]) {
    f.externalWrite(raw);
    assertTheme(f, dark);
  }
  f.preferences.setTheme("light");
  f.externalWrite("unrelated", "other-fixture-key");
  assertTheme(f, false);
  f.externalWrite(null, null);
  assertTheme(f, true);
});

test("pre-paint HTML and runtime theme agree for valid/malformed storage", () => {
  const script = html.match(/<script\s*>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "Missing pre-paint theme script");
  assert.ok(html.indexOf(script) < html.indexOf('src="/src/main.tsx"'));
  for (const raw of [undefined, "null", "[]", "{bad", '"dark"', '{"theme":true}', '{"theme":"unknown"}', ...["light", "dark", "system"].map((theme) => JSON.stringify({ theme }))]) {
    for (const systemDark of [false, true]) {
      const f = fixture({ raw, systemDark });
      const mode = f.preferences.getPrefs().theme;
      const dark = mode === "dark" || (mode === "system" && systemDark);
      new vm.Script(script).runInContext(f.context, { timeout: 1000 });
      assertTheme(f, dark, false);
      f.preferences.initializeTheme();
      assertTheme(f, dark);
    }
  }
});

test("preference persistence preserves unrelated fields and dispatches changes", () => {
  const f = fixture({ raw: JSON.stringify({ ...defaults, avatars: { a: "fixture-avatar" }, archivedMonths: ["2026-09"] }) });
  let changes = 0;
  f.window.addEventListener("pe-prefs-change", () => changes++);
  f.preferences.setCurrency("EUR");
  f.preferences.setTheme("dark");
  f.preferences.setAvatar("b", "fixture-avatar-b");
  f.preferences.archiveMonth("2026-08");
  f.preferences.archiveMonth("2026-08");
  assert.equal(changes, 4, "Duplicate archive must not emit a write event");
  const expected = { theme: "dark", currencyCode: "EUR", avatars: { a: "fixture-avatar", b: "fixture-avatar-b" }, archivedMonths: ["2026-09", "2026-08"] };
  assert.deepEqual(JSON.parse(f.storage.getItem(KEY)), expected);
  assert.deepEqual(plain(fixture({ raw: f.storage.getItem(KEY) }).preferences.getPrefs()), expected);
  f.preferences.removeAvatar("b");
  f.preferences.unarchiveMonth("2026-08");
  f.preferences.setCurrency("not-a-currency");
  assert.equal(changes, 7);
  assert.deepEqual(plain(f.preferences.getPrefs()), { ...expected, currencyCode: "INR", avatars: { a: "fixture-avatar" }, archivedMonths: ["2026-09"] });
});

test("malformed root storage and invalid theme/currency safely normalize", () => {
  for (const raw of ["", "{", "null", "true", "42", '"text"', "[]", '{"theme":[],"currencyCode":{}}', '{"theme":"sepia","currencyCode":"XXX"}']) {
    assert.deepEqual(plain(fixture({ raw }).preferences.getPrefs()), defaults, `raw=${raw}`);
  }
});

for (const field of ["avatars", "archivedMonths"]) {
  test(`malformed nested preference ${field} normalizes before helper use`, () => {
    for (const invalid of [null, 42, "invalid", field === "avatars" ? [] : {}]) {
      const f = fixture({ raw: JSON.stringify({ ...defaults, [field]: invalid }) });
      assert.deepEqual(plain(f.preferences.getPrefs())[field], defaults[field], `${field}=${JSON.stringify(invalid)} must normalize`);
      if (field === "avatars") f.preferences.setAvatar("a", "fixture-avatar");
      else f.preferences.archiveMonth("2026-09");
    }
  });
}

test("clearing persisted preferences does not resurrect a default avatar", () => {
  const f = fixture();
  f.preferences.setAvatar("a", "fixture-avatar");
  assert.equal(JSON.parse(f.storage.getItem(KEY)).avatars.a, "fixture-avatar");
  f.storage.clear();
  assert.deepEqual(plain(f.preferences.getPrefs()), defaults, "Default nested objects must not be mutated by setters");
});

test("unavailable storage reads fall back; failed writes are surfaced without a change event", () => {
  const f = fixture({ systemDark: true });
  f.storage.denyRead = true;
  assert.deepEqual(plain(f.preferences.getPrefs()), defaults);
  f.preferences.initializeTheme();
  assertTheme(f, true);
  const script = html.match(/<script\s*>([\s\S]*?)<\/script>/)[1];
  new vm.Script(script).runInContext(f.context, { timeout: 1000 });
  assertTheme(f, true);
  f.storage.denyRead = false;
  f.storage.denyWrite = true;
  let changes = 0;
  f.window.addEventListener("pe-prefs-change", () => changes++);
  assert.throws(() => f.preferences.setTheme("light"), /write denied/);
  assert.throws(() => f.preferences.setCurrency("USD"), /write denied/);
  assert.equal(changes, 0);
  assert.equal(f.storage.length, 0);
});

test("usePrefs/useCurrency subscribe to same-tab and cross-tab events and clean up", () => {
  for (const name of ["usePrefs", "useCurrency"]) {
    const hooks = hookStub();
    const f = fixture({ react: hooks.react });
    const hook = f.load("usePrefs")[name];
    const code = (result) => name === "usePrefs" ? result.currencyCode : result.code;
    assert.equal(code(hooks.render(hook)), "INR");
    f.preferences.setCurrency("USD");
    assert.equal(code(hooks.render(hook)), "USD");
    f.externalWrite('{"theme":"dark","currencyCode":"EUR"}');
    const next = hooks.render(hook);
    assert.equal(code(next), "EUR");
    if (name === "usePrefs") assert.equal(next.theme, "dark");
    f.externalWrite(null, null);
    assert.equal(code(hooks.render(hook)), "INR");
    assert.equal(hooks.updates, 3);
    hooks.unmount();
    f.preferences.setCurrency("GBP");
    f.externalWrite('{"currencyCode":"CAD"}');
    assert.equal(hooks.updates, 3, "Unmount must detach both subscriptions");
  }
});

function expectedMoney(paise, config) {
  const value = paise / 100;
  const digits = Number.isInteger(value) ? 0 : 2;
  if (config.code === "SAR") {
    const number = new Intl.NumberFormat("en-SA", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(value));
    return `${value < 0 ? "-" : ""}\u20C1\u00A0${number}`;
  }
  return new Intl.NumberFormat(config.locale, { style: "currency", currency: config.code, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

test("default money formatters follow every selected currency without conversion", () => {
  const f = fixture();
  assert.equal(f.money.formatINR(123456789), "\u20b912,34,567.89");
  for (const config of f.preferences.CURRENCIES) {
    f.preferences.setCurrency(config.code);
    for (const paise of [0, 1, 99, 100, 101, 123456789, -1, -123456789, 100000000000]) {
      assert.equal(f.money.formatINR(paise), expectedMoney(paise, config), `${config.code}: ${paise}`);
      assert.equal(f.money.formatINR(paise, null), expectedMoney(paise, config));
      const value = paise / 100;
      assert.equal(f.money.formatNumber(paise), new Intl.NumberFormat(config.locale, { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 }).format(value));
    }
  }
  f.externalWrite('{"currencyCode":"EUR"}');
  assert.equal(f.money.formatINR(12345), new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(123.45));
});

test("explicit formatter configuration overrides selection including compact units", () => {
  const f = fixture();
  f.preferences.setCurrency("EUR");
  const usd = f.preferences.getCurrencyConfig("USD");
  const inr = f.preferences.getCurrencyConfig("INR");
  assert.equal(f.money.formatINR(-12345, usd), "-$123.45");
  assert.equal(f.money.formatINRCompact(10000000, usd), "$100K");
  assert.equal(f.money.formatINRCompact(10000000, inr), "\u20b91L");
  f.storage.denyRead = true;
  assert.equal(f.money.formatINR(12345, usd), "$123.45");
});

test("compact formatting preserves sign/fractions and Indian/generic magnitude", () => {
  const f = fixture();
  const inrCases = [[0, "0"], [1250, "12.5"], [-1250, "-12.5"], [99900, "999"], [100000, "1k"], [-150000, "-1.5k"], [10000000, "1L"], [-12400000, "-1.2L"], [1000000000, "1Cr"], [-1500000000, "-1.5Cr"]];
  const genericCases = [[0, "0"], [1250, "12.5"], [-1250, "-12.5"], [100000, "1K"], [-150000, "-1.5K"], [10000000, "100K"], [100000000, "1M"], [-150000000, "-1.5M"], [100000000000, "1B"], [-100000000000, "-1B"]];
  for (const config of f.preferences.CURRENCIES) {
    f.preferences.setCurrency(config.code);
    for (const [paise, suffix] of config.code === "INR" ? inrCases : genericCases) {
      const spacing = config.code === "SAR" ? "\u00A0" : "";
      assert.equal(f.money.formatINRCompact(paise), `${config.symbol}${spacing}${suffix}`, `${config.code}: ${paise}`);
    }
  }
});

test("Saudi riyal uses the new official symbol with a bundled glyph", () => {
  const f = fixture();
  f.preferences.setCurrency("SAR");
  assert.equal(f.preferences.getCurrencyConfig("SAR").symbol, "\u20C1");
  assert.equal(f.money.formatINR(10050), "\u20C1\u00A0100.50");
  assert.equal(f.money.formatINR(-10050), "-\u20C1\u00A0100.50");
  assert.equal(f.money.formatINRCompact(150000), "\u20C1\u00A01.5K");
  assert.equal(f.money.parseAmountToPaise("\u20C1\u00A0100.50"), 10050);
  assert.equal(f.money.parseAmountToPaise("\u20C1 -1"), null);
  assert.match(css, /unicode-range: U\+20C1/);
  assert.match(css, /font-family: "Partners Saudi Riyal", system-ui/);
  assert.match(html, /rel="preload" href="\/saudi-riyal\.ttf"/);
  assert.equal(readFileSync(path.join(root, "public/saudi-riyal.ttf")).readUInt32BE(0), 0x00010000);
});

test("parser accepts supported dot-decimal/grouped values with exact integer units", () => {
  const f = fixture();
  const accepted = [[".01", 1], ["1.", 100], ["0.29", 29], [" 1234.50 ", 123450], ["1,234.5", 123450], ["12,345", 1234500], ["1,23,456.78", 12345678], ["12,34,56,789.01", 12345678901], ["$ 12.50", 1250], ["\u20b912.50", 1250], ["1000000000", 100000000000]];
  for (const code of ["INR", "USD", "EUR"]) {
    f.preferences.setCurrency(code);
    for (const [input, paise] of accepted) assert.equal(f.money.parseAmountToPaise(input), paise, `${code}: ${input}`);
  }
});

test("parser rejects negative/comma-decimal input instead of changing its meaning", () => {
  const f = fixture();
  const rejected = ["-1", "-0.01", "\u221212.50", "$-12.50", "-$12.50", "12-", "(12.50)", "12,50", "0,01", "1,23", "1234,56", "1.234,56", "1,234,56", "12,34,567,89", "1 234,56", "", " ", ".", "0", "0.00", "+12", "1.234", "1e3", "NaN", "Infinity", "1/2", "1,2,3", "1000000000.01"];
  for (const code of ["INR", "EUR", "AED"]) {
    f.preferences.setCurrency(code);
    for (const input of rejected) assert.equal(f.money.parseAmountToPaise(input), null, `${code}: ${input}`);
  }
});

// Execute only the actual custom-total and submit expressions, not the component,
// React, or imported API. Stubbed writes are captured in memory without a token.
function variableInitializer(source, name) {
  const ast = ts.createSourceFile("ExpenseForm.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) found.push(node.initializer.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(found.length, 1, `Expected exactly one ${name} initializer`);
  return found[0];
}

test("custom split submission rejects negative/comma-decimal shares rather than dropping them", async () => {
  const source = forms.find(([name]) => name === "ExpenseForm")[1];
  const { outputText } = ts.transpileModule(`const customTotal = ${variableInitializer(source, "customTotal")};\nglobalThis.fixtureSubmit = ${variableInitializer(source, "submit")};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  async function submit(customAmounts) {
    const f = fixture();
    const writes = [];
    const errors = [];
    Object.assign(f.context, {
      useMemo: (callback) => callback(),
      parseAmountToPaise: f.money.parseAmountToPaise,
      formatINR: f.money.formatINR,
      customAmounts, paise: 10000, merchant: "Fixture shop", category: "Home",
      solo: false, paidBy: "b", splitMode: "custom", splitPartners: ["a", "b"],
      partners: [{ id: "a", name: "Alex" }, { id: "b", name: "Blair" }],
      date: "2026-10-01", note: "fixture", session: { partner: { id: "b" } }, editing: null,
      setBusy() {}, onOpenChange() {}, refresh: async () => {},
      addExpense: async (_unusedToken, input) => { writes.push(plain(input)); },
      updateExpense: async () => { throw new Error("Unexpected update in add fixture"); },
      toast: { error: (message) => errors.push(message), success() {} },
    });
    new vm.Script(outputText, { filename: "ExpenseForm-isolated-handler.js" }).runInContext(f.context, { timeout: 1000 });
    await f.context.fixtureSubmit();
    return { writes, errors };
  }
  const valid = await submit({ a: "25", b: "75" });
  assert.equal(valid.writes.length, 1, "Control: a valid custom split must reach the stubbed API");
  assert.deepEqual(valid.writes[0].customShares, { a: 2500, b: 7500 });
  assert.equal(valid.errors.length, 0);
  const failures = [];
  for (const input of ["-1", "12,50"]) {
    const result = await submit({ a: input, b: "100" });
    if (result.writes.length || !result.errors.length) failures.push(`${JSON.stringify(input)} was not rejected; submitted shares=${JSON.stringify(result.writes[0]?.customShares)}`);
  }
  assert.equal(failures.length, 0, failures.join("; "));
});

function ledger() {
  const partners = [{ id: "a", position: 0, name: "Alex" }, { id: "b", position: 1, name: "Blair" }];
  const expenses = [
    { id: "e2", expense_date: "2026-10-02", merchant: "Shop", category: "Home", note: "", amount_paise: 1, paid_by: "b", split_type: "personal", shares: '{"b":1}', recurring_rule_id: null },
    { id: "e1", expense_date: "2026-10-01", merchant: 'Market, "Local"', category: "Groceries", note: "fixture", amount_paise: 12345, paid_by: "a", split_type: "equal", shares: '{"a":6173,"b":6172}', recurring_rule_id: null },
  ];
  const settlements = [{ id: "s1", settle_date: "2026-10-03", from_partner: "b", to_partner: "a", amount_paise: 2345, note: "fixture repayment" }];
  return { partners, expenses, settlements };
}

test("CSV uses selected code, stable decimal values, quoting, and no conversion/mutation", () => {
  const f = fixture();
  const { expenses, settlements, partners } = ledger();
  const snapshot = JSON.stringify({ expenses, settlements, partners });
  const expectedBody = [
    '2026-10-01,Expense,"Market, ""Local""",Groceries,fixture,123.45,Alex,Equal /2',
    "2026-10-02,Expense,Shop,Home,,0.01,Blair,Personal",
    "2026-10-03,Settlement,Blair -> Alex,Settle up,fixture repayment,23.45,Blair,-",
  ].join("\r\n");
  for (const config of f.preferences.CURRENCIES) {
    f.preferences.setCurrency(config.code);
    const csv = f.compute.toCSV(expenses, settlements, partners, f.preferences.getPrefs().currencyCode);
    assert.equal(csv, `\uFEFFDate,Kind,Where,What,Note,Amount (${config.code}),Paid by,Split\r\n${expectedBody}`);
    assert.equal(JSON.stringify({ expenses, settlements, partners }), snapshot);
  }
  for (const code of [undefined, "usd", "US", "USD,Injected"]) {
    assert.ok(f.compute.toCSV([], [], [], code).includes("Amount (INR)"));
  }
});

test("compute/types retain integer totals/shares/net position across label changes", () => {
  const f = fixture();
  const { expenses, settlements, partners } = ledger();
  assert.deepEqual(plain(f.types.parseShares(expenses[1])), { a: 6173, b: 6172 });
  for (const shares of ["{", "null", "[]", "42"]) assert.deepEqual(plain(f.types.parseShares({ shares })), {});
  for (const code of ["INR", "EUR", "JPY"]) {
    f.preferences.setCurrency(code);
    assert.equal(f.compute.totalPaise(expenses), 12346);
    assert.deepEqual(plain(f.compute.partnerStats(expenses, partners)).map(({ paidPaise, sharePaise, deltaPaise }) => ({ paidPaise, sharePaise, deltaPaise })), [
      { paidPaise: 12345, sharePaise: 6173, deltaPaise: 6172 },
      { paidPaise: 1, sharePaise: 6173, deltaPaise: -6172 },
    ]);
    const statement = f.compute.monthStatement(expenses, settlements, partners, "2026-10");
    assert.equal(statement.totalPaise, 12346);
    assert.equal(statement.netAEndPaise, 3827);
    assert.equal(f.compute.cumulativeNetSeries(expenses, settlements, partners, "2026-10", 1)[0].netAPaise, 3827);
  }
});

test("source wiring: startup, reactive app, toast theme, settings confirmation and CSV code", () => {
  assert.ok(mainSource.indexOf("initializeTheme();") >= 0 && mainSource.indexOf("initializeTheme();") < mainSource.indexOf("createRoot(document"));
  assert.match(appSource, /const prefs = usePrefs\(\)/);
  assert.match(appSource, /getCurrencyConfig\(prefs\.currencyCode\)/);
  const toasters = appSource.match(/<Toaster\b[^>]*\/\s*>/g) ?? [];
  assert.ok(toasters.length > 0);
  for (const toaster of toasters) assert.match(toaster, /theme=\{prefs\.theme\}/);
  assert.match(moreSource, /setTheme\(mode\)/);
  assert.match(moreSource, /aria-pressed=\{prefs\.theme === mode\}/);
  assert.match(moreSource, /<AlertDialog open=\{pendingCurrency !== null\}/);
  assert.match(moreSource, /setCurrency\(pendingCurrency\)/);
  assert.match(moreSource, /does not convert money or change saved amounts/);
  assert.match(moreSource, /toCSV\(data\.expenses, data\.settlements, data\.partners, prefs\.currencyCode\)/);
});

for (const [name, source] of forms) {
  test(`source wiring: ${name} uses reactive currency, dot-decimal guidance and strict main parser`, () => {
    assert.match(source, /const currency = useCurrency\(\)/);
    assert.match(source, /Amount \(\{currency\.code\}\)/);
    assert.match(source, /dot(?: for)? decimals/);
    assert.match(source, /const paise = parseAmountToPaise\(amount\)/);
    assert.match(source, /if \(paise === null\)/);
    assert.doesNotMatch(source, /setAmount\(format(?:INR|Number)\(/, "Localized display must not seed a dot-decimal input");
  });
}

function palette(selector) {
  const block = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]+)\\}`))?.[1];
  assert.ok(block, `Missing CSS palette ${selector}`);
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[\da-f]+)/gi)].map((match) => [match[1], match[2]]));
}
function luminance(hex) {
  assert.match(hex, /^#[\da-f]{6}$/i);
  const channels = hex.slice(1).match(/../g).map((part) => parseInt(part, 16) / 255).map((s) => s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("source/CSS: dark class drives palette; debt badge has light/dark text and surfaces", () => {
  assert.match(css, /@custom-variant dark \(&:where\(\.dark, \.dark \*\)\)/);
  assert.match(css, /body\s*\{[^}]*background:\s*var\(--background\);[^}]*color:\s*var\(--foreground\)/);
  for (const token of ["bg-slate-100", "text-slate-900", "dark:bg-slate-800", "dark:text-slate-100"]) assert.ok(appSource.includes(token));
});

for (const selector of [":root", ".dark"]) {
  test(`CSS ${selector} main text/control token pairs reach 4.5:1 contrast`, () => {
    const colors = palette(selector);
    for (const [foreground, background] of [["foreground", "background"], ["card-foreground", "card"], ["popover-foreground", "popover"], ["primary-foreground", "primary"], ["secondary-foreground", "secondary"], ["accent-foreground", "accent"], ["sidebar-foreground", "sidebar"]]) {
      const ratio = contrast(colors[foreground], colors[background]);
      assert.ok(ratio >= 4.5, `${selector} ${foreground}/${background}: ${ratio.toFixed(3)}:1 < 4.5:1`);
    }
  });
  test(`CSS ${selector} small muted text reaches 4.5:1 on muted/card/background`, () => {
    const colors = palette(selector);
    const failures = ["muted", "card", "background"].map((background) => ({ background, ratio: contrast(colors["muted-foreground"], colors[background]) })).filter(({ ratio }) => ratio < 4.5);
    assert.equal(failures.length, 0, failures.map(({ background, ratio }) => `${selector} muted-foreground/${background}: ${ratio.toFixed(3)}:1 < 4.5:1`).join("; "));
  });
}

test("fixtures remain independent and expose no network/process/disk APIs", () => {
  const a = fixture();
  const b = fixture();
  a.preferences.setTheme("dark");
  a.preferences.setCurrency("USD");
  assert.deepEqual(plain(b.preferences.getPrefs()), defaults);
  for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "process", "require"]) {
    assert.equal(vm.runInContext(`typeof ${name}`, a.context), "undefined");
  }
});

let passed = 0;
let failed = 0;
for (const { name, run } of cases) {
  try {
    await run();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}\n  ${String(error.message).replace(/\n/g, "\n  ")}`);
  }
}
console.log(`\n${passed}/${cases.length} passed; ${failed} failed. In-memory Node fixtures/source checks only; no browser or network.`);
if (failed) process.exitCode = 1;
