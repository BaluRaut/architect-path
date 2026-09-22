import pg from "pg";

/**
 * One pool for every module.
 *
 * Connection details come from the environment so the same code runs against
 * the Docker database, a local Postgres, or something real later. The default
 * matches docker-compose.yml.
 */
export const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://architect:architect@localhost:55432/architect";

export const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  // A small pool on purpose. Exhausting it is a lesson, not an accident:
  // module 04 makes you watch a query queue behind a held connection.
  max: 10,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
});

/** Run a query and return the rows, typed by you. */
export async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(sql, params);
  return result.rows;
}

/** Run a query and return exactly one row, or throw. */
export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const rows = await q<T>(sql, params);
  if (rows.length !== 1) throw new Error(`expected exactly 1 row, got ${rows.length}`);
  return rows[0]!;
}

/** Run a single scalar query. */
export async function scalar<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  const rows = await pool.query(sql, params);
  const row = rows.rows[0];
  if (!row) throw new Error("query returned no rows");
  return Object.values(row)[0] as T;
}

/**
 * The plan for a query, as Postgres actually executed it.
 *
 * This is the single most useful tool in module 04 and 05. A plan tells you
 * what the database did; a stopwatch only tells you that it was slow.
 */
export interface Plan {
  /** The full text plan, as EXPLAIN ANALYZE prints it. */
  text: string;
  /** Milliseconds, from the plan itself rather than from your clock. */
  executionMs: number;
  planningMs: number;
  /** True when any node in the plan is a sequential scan. */
  usedSeqScan: boolean;
  /** True when any node used an index. */
  usedIndex: boolean;
  /** Names of indexes the plan actually used. */
  indexes: string[];
  /**
   * Startup cost of the top node: the planner's estimate of the work done before
   * the first row can be returned.
   *
   * This is the number that separates "an index was used" from "an index helped".
   * A composite index on (a, b) will still be used for a filter on b alone, but it
   * has to scan the whole index to find matches rather than seeking into it, and
   * the startup cost is where that shows up.
   */
  startupCost: number;
  /** Total cost estimate of the top node. */
  totalCost: number;
  /** True when the plan reached the table through a bitmap of index matches. */
  usedBitmapScan: boolean;
  /** True when the answer came out of an index without touching the table. */
  indexOnly: boolean;
}

export async function explain(sql: string, params: unknown[] = []): Promise<Plan> {
  const rows = await pool.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`, params);
  const text = rows.rows.map((r) => Object.values(r)[0] as string).join("\n");
  const exec = /Execution Time:\s*([\d.]+)\s*ms/.exec(text);
  const plan = /Planning Time:\s*([\d.]+)\s*ms/.exec(text);
  // Two different spellings, and missing the second one makes half of all index
  // usage invisible: "Index Scan using plots_pkey" but "Bitmap Index Scan on plots_pkey".
  const indexes = [
    ...[...text.matchAll(/Index(?: Only)? Scan[^\n]*? using (\S+)/g)].map((m) => m[1]!),
    ...[...text.matchAll(/Bitmap Index Scan on (\S+)/g)].map((m) => m[1]!),
  ];
  const cost = /cost=([\d.]+)\.\.([\d.]+)/.exec(text);
  return {
    text,
    executionMs: exec ? Number(exec[1]) : NaN,
    planningMs: plan ? Number(plan[1]) : NaN,
    usedSeqScan: /Seq Scan/.test(text),
    usedIndex: indexes.length > 0,
    indexes: [...new Set(indexes)],
    startupCost: cost ? Number(cost[1]) : NaN,
    totalCost: cost ? Number(cost[2]) : NaN,
    usedBitmapScan: /Bitmap Heap Scan/.test(text),
    indexOnly: /Index Only Scan/.test(text),
  };
}

/** True when the database is reachable and PostGIS is installed. */
export async function ready(): Promise<{ ok: boolean; detail: string }> {
  try {
    const version = await scalar<string>("SELECT postgis_lib_version()");
    return { ok: true, detail: `PostGIS ${version}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, detail: message };
  }
}

export async function close(): Promise<void> {
  await pool.end();
}
