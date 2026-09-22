import { check, finish, info, measure, section } from "../../src/lib/check.js";
import { close, explain, q, ready } from "../../src/lib/db.js";
import { ms, speedup, time } from "../../src/lib/timing.js";
import {
  COVERED,
  LEADING_COLUMN,
  NARROW,
  NON_LEADING_COLUMN,
  SELECTIVE,
  SELECTIVE_COUNT_ONLY,
  UNSELECTIVE,
} from "./queries.js";

const state = await ready();
if (!state.ok) {
  console.error(`\nThe database is not reachable: ${state.detail}`);
  console.error("Run: npm run db:up && npm run seed");
  process.exit(1);
}

section("04 · Postgres: indexes and the plan (solution)");
info(state.detail);

// Start from a known state so this is repeatable.
await q(`DROP INDEX IF EXISTS plots_crop_idx, plots_district_crop_sown_idx, plots_covered_idx`);
await q("ANALYZE plots");

// ── 1. A table with no useful index ────────────────────────────────────────
section("1. Before any index");
const before = await explain(NARROW);
const beforeTiming = (await time(() => q(NARROW))).timing;
measure("plan", before.usedSeqScan ? "Seq Scan over the whole table" : "something else");
measure("execution time (median of 5)", ms(beforeTiming.medianMs));
check("the narrow query starts with a sequential scan", before.usedSeqScan);
check("no index is used yet", !before.usedIndex);

// ── 2. A composite index, in a deliberate column order ─────────────────────
section("2. A composite index on (district, crop, sown_on)");
await q(`CREATE INDEX plots_district_crop_sown_idx ON plots (district, crop, sown_on)`);
await q("ANALYZE plots");

const after = await explain(NARROW);
const afterTiming = (await time(() => q(NARROW))).timing;
measure("plan", after.usedIndex ? `index: ${after.indexes.join(", ")}` : "still a scan");
measure("execution time (median of 5)", ms(afterTiming.medianMs));
measure("difference", speedup(beforeTiming.medianMs, afterTiming.medianMs));
check("the narrow query now uses the composite index", after.indexes.includes("plots_district_crop_sown_idx"));
check("it is no longer a sequential scan", !after.usedSeqScan);
check(
  "it is at least five times faster",
  beforeTiming.medianMs / afterTiming.medianMs > 5,
  `before ${ms(beforeTiming.medianMs)}, after ${ms(afterTiming.medianMs)}`,
);

// ── 3. Leading column versus non-leading column ────────────────────────────
//
// This is the step worth slowing down for, and it is not what most articles say.
//
// The common claim is that an index on (a, b) "cannot" serve a filter on b. Run it
// and you will see Postgres use the index anyway. What it cannot do is *seek* into
// it, because the index is sorted by district first, so every bajra row is scattered
// through it. It scans the whole index instead.
//
// So "is an index being used" is the wrong question. "How much did it eliminate
// before the first row came back" is the right one, and that is the startup cost.
section("3. Leading column versus non-leading column");
const leading = await explain(LEADING_COLUMN);
const nonLeading = await explain(NON_LEADING_COLUMN);

measure("district = 'Latur'   (leading column)", `startup cost ${leading.startupCost.toFixed(0)}, ${ms(leading.executionMs)}`);
measure("crop = 'bajra'       (second column)", `startup cost ${nonLeading.startupCost.toFixed(0)}, ${ms(nonLeading.executionMs)}`);

check("both filters use the same composite index", leading.usedIndex && nonLeading.usedIndex);
check(
  "the non-leading filter pays a much higher startup cost",
  nonLeading.startupCost > leading.startupCost * 3,
  `leading ${leading.startupCost.toFixed(0)} vs non-leading ${nonLeading.startupCost.toFixed(0)}`,
);
info("Both say 'index'. Only one of them is seeking. The startup cost is where that shows.");
info("Column order is not cosmetic: put the column you always filter on first.");

// ── 4. Selectivity decides whether an index is worth using ─────────────────
section("4. Selectivity");
await q(`CREATE INDEX plots_crop_idx ON plots (crop)`);
await q("ANALYZE plots");

const selective = await explain(SELECTIVE);
const unselective = await explain(UNSELECTIVE);
measure("crop = 'onion'   (~13% of rows)", selective.usedIndex ? `index, ${ms(selective.executionMs)}` : `seq scan, ${ms(selective.executionMs)}`);
measure("area_ha > 1.0    (~92% of rows)", unselective.usedIndex ? `index, ${ms(unselective.executionMs)}` : `seq scan, ${ms(unselective.executionMs)}`);

check("the selective filter reaches the table through the index", selective.usedBitmapScan || selective.usedIndex);
check(
  "the unselective filter is left as a sequential scan, correctly",
  unselective.usedSeqScan && !unselective.usedIndex,
  "reading most of a table in order beats jumping through an index to reach most of it",
);
info("When the planner refuses your index it is usually right, and you have learned something about your data.");

// ── 5. What you SELECT changes the plan as much as what you filter on ──────
//
// Identical WHERE clause to the selective case above. The only difference is that
// count(*) never needs a column out of the table, so the answer comes straight from
// the index and the heap is never touched at all.
section("5. The same filter, a different plan");
const countOnly = await explain(SELECTIVE_COUNT_ONLY);
measure("SELECT id, area_ha  WHERE crop = 'onion'", selective.usedBitmapScan ? "Bitmap Heap Scan, reads the table" : "index");
measure("SELECT count(*)     WHERE crop = 'onion'", countOnly.indexOnly ? "Index Only Scan, never reads the table" : "something else");
check(
  "the identical filter gets a different plan depending on what is selected",
  selective.usedBitmapScan && countOnly.indexOnly,
  "count(*) needs no column from the table, so the heap is never read",
);
info("This is why you cannot judge a query by its WHERE clause alone.");

// ── 6. Answering entirely from the index ───────────────────────────────────
section("6. Index-only scans");
const beforeCovered = (await time(() => q(COVERED))).timing;
await q(`CREATE INDEX plots_covered_idx ON plots (district) INCLUDE (crop)`);
await q("ANALYZE plots");
const covered = await explain(COVERED);
const afterCovered = (await time(() => q(COVERED))).timing;
measure("plan", covered.indexOnly ? "Index Only Scan" : covered.usedIndex ? "Index Scan" : "Seq Scan");
measure("difference", speedup(beforeCovered.medianMs, afterCovered.medianMs));
check("the query is answered without touching the table", covered.indexOnly, "the INCLUDE column is what makes this possible");

section("Checks");
const indexes = await q<{ indexname: string }>(
  `SELECT indexname FROM pg_indexes WHERE tablename = 'plots' AND indexname <> 'plots_pkey' ORDER BY indexname`,
);
check("three indexes were created", indexes.length === 3, indexes.map((i) => i.indexname).join(", "));
check(
  "statistics were refreshed after each index",
  (await q(`SELECT 1 FROM pg_stat_user_tables WHERE relname = 'plots' AND (last_analyze IS NOT NULL OR last_autoanalyze IS NOT NULL)`)).length === 1,
  "a plan read against stale statistics is not evidence of anything",
);
finish();
await close();
