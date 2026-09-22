import { check, finish, info, measure, section } from "../../src/lib/check.js";
import { close, explain, one, q, ready } from "../../src/lib/db.js";
import { ms, speedup, time } from "../../src/lib/timing.js";
import {
  DISTANCE_GEOGRAPHY,
  DISTANCE_GEOMETRY,
  NASHIK,
  NEAREST,
  RADIUS_DISTANCE,
  RADIUS_DWITHIN,
  SPATIAL_JOIN,
} from "./queries.js";

const state = await ready();
if (!state.ok) {
  console.error(`\nThe database is not reachable: ${state.detail}`);
  console.error("Run: npm run db:up && npm run seed");
  process.exit(1);
}

section("05 · PostGIS: geometry, geography and the spatial index (solution)");
info(state.detail);

await q(`DROP INDEX IF EXISTS plots_geog_gist, plots_geom_gist`);
await q("ANALYZE plots");

const PUNE = { lon: 73.8567, lat: 18.5204 };
const RADIUS_M = 5000;

// ── 1. The units trap ──────────────────────────────────────────────────────
section("1. geometry returns degrees, geography returns metres");
const asGeometry = await one<{ d: string }>(DISTANCE_GEOMETRY, [NASHIK.lon, NASHIK.lat, PUNE.lon, PUNE.lat]);
const asGeography = await one<{ d: string }>(DISTANCE_GEOGRAPHY, [NASHIK.lon, NASHIK.lat, PUNE.lon, PUNE.lat]);

measure("ST_Distance on geometry", `${Number(asGeometry.d).toFixed(4)}  (degrees)`);
measure("ST_Distance on geography", `${(Number(asGeography.d) / 1000).toFixed(1)} km`);

check("the geometry answer is a small number of degrees", Number(asGeometry.d) < 10);
check(
  "the geography answer is Nashik to Pune in metres, about 164 km",
  Math.abs(Number(asGeography.d) - 163_000) < 5_000,
  `got ${Number(asGeography.d).toFixed(0)} m`,
);
info("Neither errors. The first is not wrong units, it is meaningless: a degree of longitude");
info("is 111 km at the equator and 0 km at the pole.");

// ── 2. A radius query with no spatial index ────────────────────────────────
section("2. A radius query, unindexed");
const noIndexPlan = await explain(RADIUS_DWITHIN, [NASHIK.lon, NASHIK.lat, RADIUS_M]);
const noIndexTiming = (await time(() => q(RADIUS_DWITHIN, [NASHIK.lon, NASHIK.lat, RADIUS_M]))).timing;
measure("plan", noIndexPlan.usedSeqScan ? "Seq Scan over 500,000 rows" : "something else");
measure("execution time (median of 5)", ms(noIndexTiming.medianMs));
check("without a spatial index this is a sequential scan", noIndexPlan.usedSeqScan);

// ── 3. The index, and why it is on an expression ───────────────────────────
//
// The column is geometry; the query casts to geography. An index on `geom` alone
// would not be used here, and it would look exactly like a broken index. The index
// has to match the expression the query uses.
section("3. A GIST index on the expression the query uses");
await q(`CREATE INDEX plots_geog_gist ON plots USING GIST ((geom::geography))`);
await q("ANALYZE plots");

const indexedPlan = await explain(RADIUS_DWITHIN, [NASHIK.lon, NASHIK.lat, RADIUS_M]);
const indexedTiming = (await time(() => q(RADIUS_DWITHIN, [NASHIK.lon, NASHIK.lat, RADIUS_M]))).timing;
measure("plan", indexedPlan.usedIndex ? `index: ${indexedPlan.indexes.join(", ")}` : "still a scan");
measure("execution time (median of 5)", ms(indexedTiming.medianMs));
measure("difference", speedup(noIndexTiming.medianMs, indexedTiming.medianMs));

check("the radius query now uses the spatial index", indexedPlan.indexes.includes("plots_geog_gist"));
check(
  "it is at least five times faster",
  noIndexTiming.medianMs / indexedTiming.medianMs > 5,
  `before ${ms(noIndexTiming.medianMs)}, after ${ms(indexedTiming.medianMs)}`,
);
// The two-stage shape is visible in the numbers: the index hands over candidates by
// bounding box, then the exact predicate throws some of them away.
const candidates = /Bitmap Index Scan[^\n]*\n[^\n]*?rows=(\d+)/.exec(indexedPlan.text);
const removed = /Rows Removed by Filter:\s*(\d+)/.exec(indexedPlan.text);
if (candidates || removed) {
  measure("candidates from the index, then filtered", `${candidates?.[1] ?? "?"} offered, ${removed?.[1] ?? "0"} removed`);
}
check(
  "the index offers candidates and the exact predicate removes some",
  indexedPlan.usedBitmapScan && removed !== null && Number(removed[1]) > 0,
  "GIST returns candidates by bounding box; PostGIS then checks each one properly",
);
info("That two-stage shape is why a spatial index makes the filter fast without making it wrong.");
info("A bounding box alone would return the corners of the square as well as the circle.");

// ── 4. The same answer, written so the index cannot be used ────────────────
section("4. The same answer, the wrong way round");
const badPlan = await explain(RADIUS_DISTANCE, [NASHIK.lon, NASHIK.lat, RADIUS_M]);
const badTiming = (await time(() => q(RADIUS_DISTANCE, [NASHIK.lon, NASHIK.lat, RADIUS_M]))).timing;

const dwithinCount = Number((await one<{ count: string }>(RADIUS_DWITHIN, [NASHIK.lon, NASHIK.lat, RADIUS_M])).count);
const distanceCount = Number((await one<{ count: string }>(RADIUS_DISTANCE, [NASHIK.lon, NASHIK.lat, RADIUS_M])).count);

measure("ST_DWithin(...)", `${ms(indexedTiming.medianMs)}  ${indexedPlan.usedIndex ? "index" : "scan"}`);
measure("ST_Distance(...) < radius", `${ms(badTiming.medianMs)}  ${badPlan.usedIndex ? "index" : "scan"}`);
measure("rows returned by each", `${dwithinCount} and ${distanceCount}`);

check("both forms return the same answer", dwithinCount === distanceCount);
check("only ST_DWithin can use the index", indexedPlan.usedIndex && !badPlan.usedIndex);
check(
  "the unindexable form is several times slower",
  badTiming.medianMs / indexedTiming.medianMs > 3,
  `${ms(indexedTiming.medianMs)} vs ${ms(badTiming.medianMs)}`,
);
info("Identical results, one plan. This is a real bug people ship, and nothing warns you.");

// ── 5. Two indexes on one column, and why ──────────────────────────────────
//
// The nearest-neighbour query orders by `geom <-> point`, which is geometry. The
// index built in step 3 is on `(geom::geography)`. Same column, different expression,
// so that index cannot serve this query at all. Watch what it costs, then fix it.
section("5. Nearest neighbours, and the expression rule again");
const knnBefore = await explain(NEAREST, [NASHIK.lon, NASHIK.lat]);
const knnBeforeTiming = (await time(() => q(NEAREST, [NASHIK.lon, NASHIK.lat]))).timing;
measure("with only the geography index", `${ms(knnBeforeTiming.medianMs)}  ${/Sort/.test(knnBefore.text) ? "sorts 500,000 rows" : "no sort"}`);

await q(`CREATE INDEX plots_geom_gist ON plots USING GIST (geom)`);
await q("ANALYZE plots");

const knnAfter = await explain(NEAREST, [NASHIK.lon, NASHIK.lat]);
const knnAfterTiming = (await time(() => q(NEAREST, [NASHIK.lon, NASHIK.lat]))).timing;
const nearest = await q<{ id: string; crop: string; metres: string }>(NEAREST, [NASHIK.lon, NASHIK.lat]);

measure("with a matching geometry index", `${ms(knnAfterTiming.medianMs)}  ${/Order By:/.test(knnAfter.text) ? "index returns rows in order" : "still sorting"}`);
measure("difference", speedup(knnBeforeTiming.medianMs, knnAfterTiming.medianMs));
measure("closest plot", `${Number(nearest[0]!.metres).toFixed(0)} m, ${nearest[0]!.crop}`);

check("ten nearest plots came back", nearest.length === 10);
check(
  "they are ordered by increasing distance",
  nearest.every((r, i) => i === 0 || Number(r.metres) >= Number(nearest[i - 1]!.metres)),
);
check(
  "the geography index could not serve a geometry ordering",
  /Sort/.test(knnBefore.text),
  "same column, different expression, so the index in step 3 was no help here",
);
check(
  "the matching index removes the sort entirely",
  /Order By:/.test(knnAfter.text) && !/\bSort\b/.test(knnAfter.text),
  "the <-> operator lets GIST return rows already in distance order",
);
check(
  "and it is dramatically faster",
  knnBeforeTiming.medianMs / knnAfterTiming.medianMs > 10,
  `${ms(knnBeforeTiming.medianMs)} to ${ms(knnAfterTiming.medianMs)}`,
);
info("Two indexes on one column is not waste here. Each serves an expression the other cannot.");

// ── 6. A spatial join ──────────────────────────────────────────────────────
section("6. Joining points to polygons");
const joined = await q<{ name: string; plots: string }>(SPATIAL_JOIN);
for (const row of joined.slice(0, 3)) measure(row.name, `${Number(row.plots).toLocaleString()} plots`);
check("every district matched some plots", joined.length >= 8 && joined.every((r) => Number(r.plots) > 0));

section("Checks");
check("both spatial indexes exist", (await q(`SELECT 1 FROM pg_indexes WHERE indexname IN ('plots_geog_gist', 'plots_geom_gist')`)).length === 2);
finish();
await close();
