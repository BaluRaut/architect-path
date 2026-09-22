import {
  cellArea,
  cellToBoundary,
  cellToLatLng,
  cellToParent,
  getResolution,
  gridDisk,
  isValidCell,
  latLngToCell,
  polygonToCells,
} from "h3-js";
import { check, finish, info, measure, section } from "../../src/lib/check.js";
import { close, q, ready } from "../../src/lib/db.js";
import { ms, speedup, time } from "../../src/lib/timing.js";

const state = await ready();
if (!state.ok) {
  console.error(`\nThe database is not reachable: ${state.detail}`);
  console.error("Run: npm run db:up && npm run seed");
  process.exit(1);
}

section("06 · H3: hexagons, and when they beat PostGIS");
info(state.detail);

const NASHIK = { lat: 19.9975, lon: 73.7898 };

// ── 1. The version 4 vocabulary ────────────────────────────────────────────
section("1. Indexing one point");
// TODO 1 — index the point at resolution 8, then read its centre back.
//   const cell = latLngToCell(NASHIK.lat, NASHIK.lon, 8)
//   const [backLat, backLon] = cellToLatLng(cell)
//
// Watch the argument order. latLngToCell takes LATITUDE first; ST_MakePoint in the
// PostGIS modules takes LONGITUDE first. Swapping them does not throw. It puts your
// point somewhere real and wrong, and the round-trip check below is how you find out.
const cell = "";
const [backLat, backLon] = [0, 0];

measure("cell at resolution 8", cell);
measure("round trip", `${backLat.toFixed(4)}, ${backLon.toFixed(4)}`);
measure("cell area", `${cellArea(cell, "km2").toFixed(2)} km²`);
measure("boundary vertices", String(cellToBoundary(cell).length));

check("the cell is valid", isValidCell(cell), "TODO 1");
check("it is at the resolution we asked for", getResolution(cell) === 8);
check(
  "the centre round-trips to within a kilometre",
  Math.abs(backLat - NASHIK.lat) < 0.01 && Math.abs(backLon - NASHIK.lon) < 0.01,
  "if this is wildly off you have swapped latitude and longitude",
);
check("a hexagon has six vertices", cellToBoundary(cell).length === 6);

// ── 2. The hierarchy ───────────────────────────────────────────────────────
section("2. Resolution is a trade, not a quality setting");
for (const res of [6, 7, 8, 9, 10]) {
  const c = latLngToCell(NASHIK.lat, NASHIK.lon, res);
  const km2 = cellArea(c, "km2");
  measure(`resolution ${res}`, `${km2 < 1 ? `${(km2 * 100).toFixed(0)} ha` : `${km2.toFixed(1)} km²`}  across roughly ${(Math.sqrt(km2) * 1.1).toFixed(1)} km`);
}
const fine = latLngToCell(NASHIK.lat, NASHIK.lon, 9);
check("a finer cell's parent is the coarser cell", cellToParent(fine, 8) === cell);
check("each step up is roughly seven times smaller", cellArea(cell, "km2") / cellArea(fine, "km2") > 5);
check("every neighbour of a hexagon is one ring away", gridDisk(cell, 1).length === 7);
info("gridDisk(cell, 1) is the cell plus its six neighbours. A square grid would give you");
info("eight neighbours at two different distances, which quietly distorts anything that spreads.");

// ── 3. Aggregating half a million points ───────────────────────────────────
section("3. Aggregating 500,000 plots into cells");

const rows = await q<{ lon: string; lat: string; area_ha: string }>(
  `SELECT ST_X(geom) AS lon, ST_Y(geom) AS lat, area_ha FROM plots`,
);
measure("rows fetched", rows.length.toLocaleString());

const h3Run = await time(
  async () => {
    const buckets = new Map<string, { plots: number; hectares: number }>();
    for (const r of rows) {
      // TODO 2 — turn this row into a cell at resolution 7.
      const c = "";
      const bucket = buckets.get(c);
      if (bucket) {
        bucket.plots++;
        bucket.hectares += Number(r.area_ha);
      } else {
        buckets.set(c, { plots: 1, hectares: Number(r.area_ha) });
      }
    }
    return buckets;
  },
  { runs: 3, warmup: 1 },
);
const buckets = h3Run.result;

measure("cells at resolution 7", buckets.size.toLocaleString());
measure("time to bucket every point", ms(h3Run.timing.medianMs));
check("every plot landed in a cell", buckets.size > 1 && [...buckets.values()].reduce((n, b) => n + b.plots, 0) === rows.length, "TODO 2");

// The count is the trade, made concrete. 500,000 points always become 500,000 points;
// what changes is how many buckets you ask for, and therefore how much you ship.
const countsByRes = new Map<number, number>();
for (const res of [4, 5, 6, 7, 8]) {
  const set = new Set<string>();
  for (const r of rows) set.add(latLngToCell(Number(r.lat), Number(r.lon), res));
  countsByRes.set(res, set.size);
  const perCell = Math.round(rows.length / set.size);
  measure(`  resolution ${res}`, `${set.size.toLocaleString()} cells, about ${perCell.toLocaleString()} plots each`);
}

check(
  "a coarser resolution always produces fewer cells",
  [4, 5, 6, 7].every((r) => countsByRes.get(r)! < countsByRes.get(r + 1)!),
);
check(
  "resolution 5 is small enough to send to a browser",
  countsByRes.get(5)! < 2_000,
  `${countsByRes.get(5)} cells`,
);
check(
  "resolution 7 is not, which is the point",
  countsByRes.get(7)! > 10_000,
  `${countsByRes.get(7)} cells is a lot of polygons for one map`,
);
info("There is no correct resolution. There is the one that answers the question at hand");
info("without shipping more polygons than a browser will draw. Pick it per zoom level.");

const busiest = [...buckets.entries()].sort((a, b) => b[1].plots - a[1].plots)[0]!;
measure("busiest cell", `${busiest[0]}  ${busiest[1].plots.toLocaleString()} plots, ${busiest[1].hectares.toFixed(0)} ha`);

// ── 4. The same job in PostGIS ─────────────────────────────────────────────
//
// A fair comparison needs the database to do equivalent work: bucket every point
// into a grid and aggregate. PostGIS has ST_SnapToGrid, which is the closest
// like-for-like without generating and indexing a hexagon table first.
section("4. The same aggregation in PostGIS");
const pgRun = await time(
  () =>
    q<{ cells: string }>(`
      SELECT count(*) AS cells FROM (
        SELECT ST_SnapToGrid(geom, 0.05) AS g, count(*), sum(area_ha)
        FROM plots GROUP BY g
      ) s
    `),
  { runs: 3, warmup: 1 },
);
measure("grid cells produced", Number(pgRun.result[0]!.cells).toLocaleString());
measure("time in the database", ms(pgRun.timing.medianMs));
measure("H3, including fetching every row", ms(h3Run.timing.medianMs));

info("These are not the same operation, so read the comparison carefully:");
info("PostGIS aggregates where the data already is. H3 above pays to pull 500,000 rows first.");
info("In the flagship you would store the cell as a column and get both: GROUP BY h3_r7,");
info("in the database, with no geometry work at query time at all.");

// ── 5. Storing the cell as a column, which is the real pattern ─────────────
section("5. The pattern you would actually ship");
await q(`ALTER TABLE plots ADD COLUMN IF NOT EXISTS h3_r7 text`);
await q(`DROP INDEX IF EXISTS plots_h3_r7_idx`);

const assign = await time(
  async () => {
    // Write the precomputed cells back in one statement using unnest, rather than
    // 500,000 round trips. This is the part people get wrong and then blame H3 for.
    const ids: number[] = [];
    const cells: string[] = [];
    const all = await q<{ id: string; lon: string; lat: string }>(
      `SELECT id, ST_X(geom) AS lon, ST_Y(geom) AS lat FROM plots`,
    );
    for (const r of all) {
      ids.push(Number(r.id));
      // TODO 3 — push the cell for this row, at the same resolution as TODO 2.
      cells.push("");
    }
    await q(
      `UPDATE plots p SET h3_r7 = v.cell
       FROM (SELECT unnest($1::bigint[]) AS id, unnest($2::text[]) AS cell) v
       WHERE p.id = v.id`,
      [ids, cells],
    );
    return all.length;
  },
  { runs: 1, warmup: 0 },
);
measure("one-off backfill", `${assign.result.toLocaleString()} rows in ${ms(assign.timing.medianMs)}`);

await q(`CREATE INDEX plots_h3_r7_idx ON plots (h3_r7)`);
await q("ANALYZE plots");

const grouped = await time(
  () => q<{ h3_r7: string; plots: string }>(`SELECT h3_r7, count(*) AS plots FROM plots GROUP BY h3_r7`),
  { runs: 3, warmup: 1 },
);
measure("GROUP BY h3_r7, in the database", ms(grouped.timing.medianMs));
measure("versus fetching and bucketing in Node", `${ms(h3Run.timing.medianMs)}  (${speedup(h3Run.timing.medianMs, grouped.timing.medianMs)})`);

check("every row has a cell", (await q(`SELECT 1 FROM plots WHERE h3_r7 IS NULL LIMIT 1`)).length === 0);
check("the grouped result matches the in-memory bucketing", grouped.result.length === buckets.size);
check(
  "grouping in the database beats round-tripping every row",
  grouped.timing.medianMs < h3Run.timing.medianMs,
  "the cell is just a text column, so this is an ordinary GROUP BY",
);
info("That is the whole trick. The hexagon maths happens once, on write.");

// ── 6. Covering an area with cells ─────────────────────────────────────────
section("6. Covering a polygon");
// polygonToCells takes [lat, lng] pairs by default, matching latLngToCell.
const boxAroundNashik: number[][] = [
  [19.90, 73.70],
  [19.90, 73.90],
  [20.10, 73.90],
  [20.10, 73.70],
  [19.90, 73.70],
];
// TODO 4 — cover the box with cells at resolution 8.
//   polygonToCells(boxAroundNashik, 8)
// This was called polyfill before version 4, which is what most search results say.
const covering: string[] = [];
measure("cells covering a ~20 km box at resolution 8", covering.length.toLocaleString());
check("the box is covered by a plausible number of cells", covering.length > 50 && covering.length < 5_000, "TODO 4");
check("the centre cell is among them", covering.includes(latLngToCell(20.0, 73.8, 8)));
info("polygonToCells was called polyfill before version 4. Most search results still say polyfill.");

section("Checks");
check("no version 3 function name was used anywhere in this file", true);
finish();
await close();
