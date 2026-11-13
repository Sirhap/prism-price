export interface D1Cost {
  queries: number;
  rowsRead: number;
  rowsWritten: number;
  statements: Array<{ sql: string; rowsRead: number; rowsWritten: number }>;
}

/** 请求内计量 D1 返回的真实行数；不保存绑定值，不向 D1 写入计量日志。 */
export function observeD1(database: D1Database, recordStatements = false): { db: D1Database; cost: D1Cost } {
  const cost: D1Cost = { queries: 0, rowsRead: 0, rowsWritten: 0, statements: [] };
  const rawStatements = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const sqlByStatement = new WeakMap<D1PreparedStatement, string>();
  const record = (result: D1Result, sql: string) => {
    const rowsRead = Number(result.meta?.rows_read || 0);
    const rowsWritten = Number(result.meta?.rows_written || 0);
    cost.queries += 1;
    cost.rowsRead += rowsRead;
    cost.rowsWritten += rowsWritten;
    if (recordStatements) cost.statements.push({ sql: sql.replace(/\s+/g, " ").trim(), rowsRead, rowsWritten });
  };
  const wrap = (statement: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const proxy = new Proxy(statement, {
      get(target, key) {
        if (key === "bind") return (...values: unknown[]) => wrap(target.bind(...values), sql);
        if (key === "first") return async (column?: string) => {
          const result = await target.all<Record<string, unknown>>();
          record(result, sql);
          const row = result.results[0];
          if (!row) return null;
          if (column !== undefined && !Object.hasOwn(row, column)) throw new Error(`D1_COLUMN_NOTFOUND: ${column}`);
          return column === undefined ? row : row[column];
        };
        if (key === "all" || key === "run") return async () => {
          const result = key === "all" ? await target.all() : await target.run();
          record(result, sql);
          return result;
        };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    rawStatements.set(proxy, statement);
    sqlByStatement.set(proxy, sql);
    return proxy;
  };
  const db = new Proxy(database, {
    get(target, key) {
      if (key === "prepare") return (sql: string) => wrap(target.prepare(sql), sql);
      if (key === "batch") return async (statements: D1PreparedStatement[]) => {
        const results = await target.batch(statements.map((statement) => rawStatements.get(statement) || statement));
        results.forEach((result, index) => record(result, sqlByStatement.get(statements[index]) || "batch"));
        return results;
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { db, cost };
}
