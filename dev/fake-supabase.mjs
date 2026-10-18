// In-memory fake of the Supabase query-builder subset used by functions/handler.mjs.
// Local preview only; never deployed. Models PK/UNIQUE violations as error code 23505.
// The builder is thenable like supabase-js, so filter methods can follow select().

const UNIQUE_COLUMNS = {
  partners: ["id", "username", "position"],
  sessions: ["token"],
  expenses: ["id"],
  settlements: ["id"],
  recurring_rules: ["id"],
  invites: ["code"],
  month_closes: ["month"],
};

const state = {
  partners: [],
  sessions: [],
  expenses: [],
  settlements: [],
  recurring_rules: [],
  invites: [],
  month_closes: [],
};

export function resetState() {
  for (const table of Object.keys(state)) state[table] = [];
}

function project(row, cols) {
  if (!cols || cols === "*") return { ...row };
  const names = cols.split(",").map((c) => c.trim()).filter(Boolean);
  const out = {};
  for (const name of names) out[name] = row[name];
  return out;
}

function compareValues(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1;
  if (b === null || b === undefined) return 1;
  return a < b ? -1 : 1;
}

class Builder {
  constructor(table) {
    this.table = table;
    this.op = null;
    this.payload = null;
    this.returnCols = "*";
    this.countMode = null;
    this.filters = [];
    this.orders = [];
    this.rangeSpec = null;
    this.limitSpec = null;
  }

  select(cols, opts = {}) {
    if (!this.op) this.op = "select";
    this.returnCols = cols;
    if (opts && opts.count === "exact") this.countMode = "exact";
    return this;
  }

  insert(payload) {
    this.op = "insert";
    this.payload = Array.isArray(payload) ? payload : [payload];
    return this;
  }

  update(fields) {
    this.op = "update";
    this.payload = fields;
    return this;
  }

  delete() {
    this.op = "delete";
    return this;
  }

  eq(col, val) { this.filters.push({ type: "eq", col, val }); return this; }
  neq(col, val) { this.filters.push({ type: "neq", col, val }); return this; }
  gte(col, val) { this.filters.push({ type: "gte", col, val }); return this; }
  lte(col, val) { this.filters.push({ type: "lte", col, val }); return this; }
  lt(col, val) { this.filters.push({ type: "lt", col, val }); return this; }
  order(col, opts = {}) { this.orders.push({ col, ascending: !!(opts && opts.ascending) }); return this; }
  range(start, end) { this.rangeSpec = [start, end]; return this; }
  limit(n) { this.limitSpec = n; return this; }

  matches(row) {
    return this.filters.every(({ type, col, val }) => {
      const value = row[col];
      switch (type) {
        case "eq": return value === val;
        case "neq": return value !== val;
        case "gte": return value >= val;
        case "lte": return value <= val;
        case "lt": return value < val;
        default: return false;
      }
    });
  }

  sorted(rows) {
    if (!this.orders.length) return rows;
    const out = [...rows];
    out.sort((a, b) => {
      for (const { col, ascending } of this.orders) {
        const cmp = compareValues(a[col], b[col]);
        if (cmp !== 0) return ascending ? cmp : -cmp;
      }
      return 0;
    });
    return out;
  }

  windowed(rows) {
    let out = rows;
    if (this.rangeSpec) out = out.slice(this.rangeSpec[0], this.rangeSpec[1] + 1);
    if (this.limitSpec !== null && this.limitSpec !== undefined) out = out.slice(0, this.limitSpec);
    return out;
  }

  execute() {
    const rows = state[this.table];
    if (this.op === "select" || !this.op) {
      const filtered = rows.filter((r) => this.matches(r));
      const result = { data: this.windowed(this.sorted(filtered)).map((r) => project(r, this.returnCols)), error: null };
      if (this.countMode === "exact") result.count = filtered.length;
      return result;
    }
    if (this.op === "insert") {
      const unique = UNIQUE_COLUMNS[this.table] ?? [];
      for (const row of this.payload) {
        for (const col of unique) {
          if (row[col] !== undefined && rows.some((r) => r[col] === row[col])) {
            return { data: null, error: { code: "23505", message: "duplicate key" } };
          }
        }
      }
      for (const row of this.payload) rows.push({ ...row });
      return { data: this.payload.map((r) => project(r, this.returnCols)), error: null };
    }
    if (this.op === "update") {
      const targets = rows.filter((r) => this.matches(r));
      for (const row of targets) Object.assign(row, this.payload);
      return { data: targets.map((r) => project(r, this.returnCols)), error: null };
    }
    if (this.op === "delete") {
      const targets = rows.filter((r) => this.matches(r));
      for (const row of targets) {
        const idx = rows.indexOf(row);
        rows.splice(idx, 1);
      }
      return { data: targets.map((r) => project(r, this.returnCols)), error: null };
    }
    return { data: null, error: { code: "unsupported", message: "unknown op" } };
  }

  then(onFulfilled, onRejected) {
    return Promise.resolve(this.execute()).then(onFulfilled, onRejected);
  }

  maybeSingle() {
    const result = this.execute();
    const data = Array.isArray(result.data) && result.data.length ? result.data[0] : null;
    return Promise.resolve({ data, error: result.error });
  }

  single() {
    const result = this.execute();
    if (result.error) return Promise.resolve({ data: null, error: result.error });
    if (!Array.isArray(result.data) || result.data.length !== 1) {
      return Promise.resolve({ data: null, error: { code: "PGRST116", message: "not exactly one row" } });
    }
    return Promise.resolve({ data: result.data[0], error: null });
  }
}

export function fakeSupabase() {
  return { from: (table) => new Builder(table) };
}
