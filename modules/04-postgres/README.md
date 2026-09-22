# 04 · Postgres: indexes and the plan

**Needs the database:** yes. `npm run db:up && npm run seed` first.
**Feeds the flagship:** every spatial query in the GeoAI assistant runs through this.

## Why this module is first among the database ones

You can read about indexes for a week and still not know whether one is being used. The plan tells you. `EXPLAIN ANALYZE` is not a debugging tool you reach for when something is slow, it is the thing you read **before** you claim anything about performance.

This module is built on 500,000 rows because the lessons do not appear at a thousand. At a thousand rows Postgres scans the table and finishes before you notice, and every index looks pointless. At half a million the difference is the difference between a product and a complaint.

## What you will actually do

You will run a query, read its plan, add an index, and measure what changed. Then you will hit the case that surprises people: **an index that Postgres refuses to use, correctly.** That one is worth more than the other five.

## Steps

1. `npm run db:up && npm run seed` if you have not already.
2. Open `exercise.ts` and work through the `TODO`s.
3. `npm run m -- 04`

## Done when

Every check passes, and you can say out loud why the planner ignored the index on `district` for one query and used it for another.

## What to notice

- **The plan is evidence; your stopwatch is an anecdote.** Execution time in the plan comes from Postgres, after planning, excluding the round trip. That is the number to compare.
- **Never report a single run.** The first run pays for a cold cache. The helper in `src/lib/timing.ts` takes a median after a warm-up because that is the minimum honest measurement.
- **Selectivity decides everything.** An index helps when it eliminates most of the table. Filtering to 80 percent of the rows with an index is slower than reading the table in order, and Postgres knows this. When the planner "ignores" your index it is usually right and you have learned something about your data.
- **Column order in a composite index is not cosmetic.** An index on `(a, b)` serves a filter on `a`, and on `a` with `b`, but not on `b` alone. Getting this wrong is the most common index mistake in production.
- **`ANALYZE` is not optional.** Without current statistics the planner guesses, and a plan built on a guess is not evidence of anything. The seed script runs it, and so should your migrations.
