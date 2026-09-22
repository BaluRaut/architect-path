# 05 · PostGIS: geometry, geography and the spatial index

**Needs the database:** yes. **Feeds the flagship:** this is the query layer the GeoAI assistant calls.

## The two mistakes this module exists to prevent

**Mistake one: measuring distance in degrees.** `ST_Distance` on a `geometry` in SRID 4326 returns degrees. On the same two points it returns `1.478`. Cast to `geography` and it returns `163659`, which is metres, and correct. The first number is not wrong units, it is meaningless: a degree of longitude is 111 km at the equator and 0 km at the pole.

Nothing errors. Your code runs, your tests pass if you wrote them against the same wrong function, and the bug reaches production as "the radius search returns strange results."

**Mistake two: writing a filter the index cannot use.** These two return identical answers:

```sql
WHERE ST_DWithin(geom::geography, :point, 5000)
WHERE ST_Distance(geom::geography, :point) < 5000
```

On this dataset the first runs in 8 ms and the second in 148 ms, because only the first can be answered through a spatial index. The second computes a real distance for all 500,000 rows and then throws almost all of them away.

You will measure both.

## What you will do

Add a GIST index and watch a radius query go from 142 ms to 8 ms. Then write the same query the wrong way and watch the index disappear.

## Steps

1. `npm run db:up && npm run seed` if you have not.
2. Work through the `TODO`s in `exercise.ts`.
3. `npm run m -- 05`

## Done when

Every check passes, and you can explain to someone why `ST_DWithin` is not merely a convenience wrapper around `ST_Distance`.

## What to notice

- **geometry is a plane, geography is a globe.** Use `geometry` for anything inside one small area where you control the projection, and `geography` when you want metres and correctness over distance. Geography costs more per operation; correctness usually wins.
- **SRID 4326 is longitude then latitude.** `ST_MakePoint(lon, lat)`, in that order. Reversing it is the other classic bug, and it puts your farm in the Indian Ocean rather than erroring.
- **The index is on an expression here.** Because the column is `geometry` and the queries cast to `geography`, the index has to be on `(geom::geography)`. An index on `geom` alone will not be used by a `geography` query, which looks exactly like "the index is not working".
- **A bounding box is not the answer.** GIST gives you candidates by bounding box, then PostGIS rechecks each one exactly. That two-stage shape is why the plan says Bitmap Heap Scan with a Recheck condition, and why a spatial index makes a filter fast without making it wrong.
