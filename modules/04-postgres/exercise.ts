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

section("04 · Postgres: indexes and the plan");
info(state.detail);

// Start from a genuinely known state.
//
// VACUUM, not just ANALYZE, and the difference matters here. ANALYZE refreshes the
// statistics the planner uses to estimate row counts. VACUUM also updates the
// visibility map, which records which pages contain only rows every transaction can
// see. Index-only scans need that map: without it Postgres cannot trust the index
// alone and must visit the table anyway.
//
// If another module has just rewritten this table, step 5 and step 6 below will
// quietly fall back to ordinary index scans until a vacuum catches up. That is not a
// bug in your index; it is the visibility map doing its job.
await q(`DROP INDEX IF EXISTS plots_crop_idx, plots_district_crop_sown_idx, plots_covered_idx`);
await q("VACUUM ANALYZE plots");

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
// TODO 1 — create the composite index, then refresh statistics.
//   CREATE INDEX plots_district_crop_sown_idx ON plots (district, crop, sown_on)
//   ANALYZE plots
// The column order is the lesson. NARROW filters on all three; put the column you
// always filter on first. Then run this file and read what the plan says.

const after = await explain(NARROW);
const afterTiming = (await time(() => q(NARROW))).timing;
measure("plan", after.usedIndex ? `index: ${after.indexes.join(", ")}` : "still a scan");
measure("execution time (median of 5)", ms(afterTiming.medianMs));
measure("difference", speedup(beforeTiming.medianMs, afterTiming.medianMs));
check("the narrow query now uses the composite index", after.indexes.includes("plots_district_crop_sown_idx"), "TODO 1");
check("it is no longer a sequential scan", !after.usedSeqScan);
check(
  "it is at least five times faster",
  beforeTiming.medianMs / afterTiming.medianMs > 5,
  `before ${ms(beforeTiming.medianMs)}, after ${ms(afterTiming.medianMs)}`,
);

// ── 3. Leading column versus non-leading column ────────────────────────────
//
// Before you run this: most articles say an index on (a, b) "cannot" serve a filter
// on b. Predict what you will see, then look at the two startup costs. The answer is
// more interesting than the claim.
//
section("3. Leading column versus non-leading column");
const leading = await explain(LEADING_COLUMN);
const nonLeading = await explain(NON_LEADING_COLUMN);

measure("district = 'Latur'   (leading column)", `startup cost ${leading.startupCost.toFixed(0)}, ${ms(leading.executionMs)}`);
measure("crop = 'bajra'       (second column)", `startup cost ${nonLeading.startupCost.toFixed(0)}, ${ms(nonLeading.executionMs)}`);

check("the leading-column filter uses the composite index", leading.usedIndex, "TODO 1");

// The non-leading filter is worse, and there are two ways that shows up depending on
// how big the table is. On a large table Postgres still uses the index but has to scan
// all of it, so the startup cost jumps. On a small one it gives up and scans the table.
// Both prove the same point, so accept either.
const nonLeadingIsWorse = nonLeading.usedIndex
  ? nonLeading.startupCost > leading.startupCost * 3
  : nonLeading.usedSeqScan;
check(
  "the non-leading filter is measurably worse, one way or the other",
  nonLeadingIsWorse,
  nonLeading.usedIndex
    ? `startup cost ${leading.startupCost.toFixed(0)} vs ${nonLeading.startupCost.toFixed(0)}`
    : "it fell back to a sequential scan",
);
info(
  nonLeading.usedIndex
    ? "Both say 'index'. Only one of them is seeking. The startup cost is where that shows."
    : "On this table size the planner gave up on the index entirely for the second column.",
);
info("Which of those two you see depends on how many rows you seeded, and both are correct.");
info("Column order is not cosmetic: put the column you always filter on first.");

// ── 4. Selectivity decides whether an index is worth using ─────────────────
section("4. Selectivity");
// TODO 2 — create a dedicated index on crop alone, and ANALYZE again.
//   CREATE INDEX plots_crop_idx ON plots (crop)
// Then predict, before you run it: which of the two queries below will use it?
// One matches 13% of the table and one matches 92%.

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
// Identical WHERE clause to the selective case above. Only the SELECT list differs.
// Predict whether that changes the plan.
//
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
// TODO 3 — create a covering index so COVERED never touches the table.
//   CREATE INDEX plots_covered_idx ON plots (district) INCLUDE (crop)
//   VACUUM ANALYZE plots
// COVERED selects district and crop. An index on district alone would still need
// the table for crop. INCLUDE puts crop in the index without sorting by it.
// VACUUM rather than ANALYZE: an index-only scan needs the visibility map, and only
// a vacuum maintains it.
const covered = await explain(COVERED);
const afterCovered = (await time(() => q(COVERED))).timing;
measure("plan", covered.indexOnly ? "Index Only Scan" : covered.usedIndex ? "Index Scan" : "Seq Scan");
measure("difference", speedup(beforeCovered.medianMs, afterCovered.medianMs));
check("the query is answered without touching the table", covered.indexOnly, "the INCLUDE column is what makes this possible");

section("Checks");
// Only this module's own indexes. Other modules add their own to the same table,
// and a check that counts all of them fails depending on what you ran last.
const OWNED = ["plots_district_crop_sown_idx", "plots_crop_idx", "plots_covered_idx"];
const indexes = await q<{ indexname: string }>(
  `SELECT indexname FROM pg_indexes WHERE tablename = 'plots' AND indexname = ANY($1) ORDER BY indexname`,
  [OWNED],
);
check("three indexes were created", indexes.length === 3, `found ${indexes.length}: ${indexes.map((i) => i.indexname).join(", ") || "none"}`);
check(
  "statistics and the visibility map were refreshed",
  (await q(`SELECT 1 FROM pg_stat_user_tables WHERE relname = 'plots' AND (last_analyze IS NOT NULL OR last_autoanalyze IS NOT NULL)`)).length === 1,
  "a plan read against stale statistics is not evidence of anything",
);
finish();
await close();
