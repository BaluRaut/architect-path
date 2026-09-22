/**
 * Builds the dataset every database module runs against.
 *
 * Two design decisions worth knowing, because both affect what the modules can teach.
 *
 * **It is synthetic.** No licensing question, no large file in the repository, and
 * the size is exactly what the lessons need. District centres are real coordinates;
 * everything hanging off them is generated.
 *
 * **Points are clustered, not uniform.** Uniform random points make every index look
 * heroic and hide the thing that actually decides spatial query performance, which is
 * how well the data clusters. Real land does not scatter evenly, so neither does this.
 */
import { close, pool, q, scalar } from "../src/lib/db.js";

const ROWS = Number(process.env.SEED_ROWS ?? 500_000);

/** Real district centres in Maharashtra. Everything else is generated around them. */
const DISTRICTS: Array<{ name: string; lon: number; lat: number; spreadKm: number; weight: number }> = [
  { name: "Nashik", lon: 73.7898, lat: 19.9975, spreadKm: 45, weight: 0.22 },
  { name: "Pune", lon: 73.8567, lat: 18.5204, spreadKm: 50, weight: 0.2 },
  { name: "Ahmednagar", lon: 74.7496, lat: 19.0952, spreadKm: 55, weight: 0.14 },
  { name: "Aurangabad", lon: 75.3433, lat: 19.8762, spreadKm: 50, weight: 0.12 },
  { name: "Solapur", lon: 75.9064, lat: 17.6599, spreadKm: 55, weight: 0.1 },
  { name: "Latur", lon: 76.5604, lat: 18.4088, spreadKm: 40, weight: 0.09 },
  { name: "Akola", lon: 77.0082, lat: 20.7002, spreadKm: 45, weight: 0.07 },
  { name: "Jalgaon", lon: 75.5626, lat: 21.0077, spreadKm: 45, weight: 0.06 },
];

const CROPS = ["soybean", "cotton", "onion", "tur", "bajra", "sugarcane", "wheat", "gram"];

async function main(): Promise<void> {
  console.log(`Seeding ${ROWS.toLocaleString()} plots across ${DISTRICTS.length} districts.\n`);
  const started = Date.now();

  await q("CREATE EXTENSION IF NOT EXISTS postgis");

  // Dropped and rebuilt every time, so a reset is always a clean slate.
  await q("DROP TABLE IF EXISTS plots, districts CASCADE");

  await q(`
    CREATE TABLE districts (
      id        serial PRIMARY KEY,
      name      text NOT NULL UNIQUE,
      centre    geometry(Point, 4326) NOT NULL,
      boundary  geometry(Polygon, 4326) NOT NULL
    )
  `);

  // Deliberately created with NO indexes beyond the primary key.
  // Module 04 adds the ordinary ones and module 05 adds the spatial one, and both
  // measure the difference. Handing you a fully indexed table would remove the lesson.
  await q(`
    CREATE TABLE plots (
      id         bigserial PRIMARY KEY,
      district   text NOT NULL,
      crop       text NOT NULL,
      area_ha    numeric(6,2) NOT NULL,
      sown_on    date NOT NULL,
      geom       geometry(Point, 4326) NOT NULL
    )
  `);

  // District boundaries: a circle around each centre, good enough for spatial joins
  // and honest about being generated.
  for (const d of DISTRICTS) {
    await q(
      `INSERT INTO districts (name, centre, boundary)
       VALUES (
         $1,
         ST_SetSRID(ST_MakePoint($2, $3), 4326),
         ST_Buffer(ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4)::geometry
       )`,
      [d.name, d.lon, d.lat, d.spreadKm * 1600],
    );
  }
  console.log(`  districts: ${DISTRICTS.length}`);

  // Generated in the database rather than in Node. Half a million rows over the wire
  // one at a time would take minutes; generate_series takes seconds, and the SQL is
  // worth reading once.
  //
  // gaussian spread: Box-Muller from two uniforms, scaled to degrees. One degree of
  // latitude is about 111 km; longitude shrinks by cos(latitude).
  let inserted = 0;
  for (const d of DISTRICTS) {
    const rows = Math.round(ROWS * d.weight);
    await q(
      `
      INSERT INTO plots (district, crop, area_ha, sown_on, geom)
      SELECT
        $1,
        (ARRAY[${CROPS.map((_, i) => `$${i + 6}`).join(",")}])[1 + floor(random() * ${CROPS.length})::int],
        round((0.4 + random() * 7.5)::numeric, 2),
        DATE '2026-06-10' + (floor(random() * 40))::int,
        ST_SetSRID(
          ST_MakePoint(
            $2 + (sqrt(-2 * ln(random())) * cos(2 * pi() * random())) * ($4 / 111.0) / cos(radians($3)),
            $3 + (sqrt(-2 * ln(random())) * cos(2 * pi() * random())) * ($4 / 111.0)
          ),
          4326
        )
      FROM generate_series(1, $5)
      `,
      [d.name, d.lon, d.lat, d.spreadKm / 2, rows, ...CROPS],
    );
    inserted += rows;
    process.stdout.write(`\r  plots: ${inserted.toLocaleString()} / ${ROWS.toLocaleString()}`);
  }
  console.log();

  // ANALYZE matters more than people expect. Without current statistics the planner
  // guesses row counts, and every plan you read in module 04 would be a plan for a
  // table Postgres thinks is empty.
  await q("ANALYZE plots");
  await q("ANALYZE districts");

  const count = await scalar<string>("SELECT count(*) FROM plots");
  const size = await scalar<string>("SELECT pg_size_pretty(pg_total_relation_size('plots'))");
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`
Done in ${seconds}s.
  rows:    ${Number(count).toLocaleString()}
  size:    ${size}
  indexes: primary key only, on purpose

The modules add the indexes and measure what changes. Start with:
  npm run m -- 04
`);
}

main()
  .catch((error) => {
    console.error("\nSeeding failed:", error instanceof Error ? error.message : error);
    console.error("Is the database up? Try: npm run db:up");
    process.exitCode = 1;
  })
  .finally(() => close().catch(() => pool.end().catch(() => {})));
