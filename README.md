# architect-path

Tech Lead to AI and Geospatial Architect. Runnable modules and one flagship project, built over twelve months.

**The rule this repository follows:** every claim it makes about performance is measured on your machine, against half a million real rows, and printed. Nothing here says "indexes make queries faster" and leaves it there.

## Three repositories, not one

Two parts of the roadmap are already built, so this one does not repeat them.

| For | Go to |
|---|---|
| LLM engineering: tokens, structured output, RAG, tool calling, evaluation, memory | [ai-engineer-exercises](https://github.com/BaluRaut/ai-engineer-exercises) |
| AI governance: injection, tool abuse, audit trails, guardrails on four platforms | [ai-agent-governance](https://github.com/BaluRaut/ai-agent-governance) |
| Architecture, cloud, data, geospatial, and the flagship that combines them | **here** |

That split removes roughly four months of duplicate work from a twelve-month plan.

## Start here

You need Docker and Node 20 or newer. Nothing else, and no cloud account.

```bash
git clone https://github.com/BaluRaut/architect-path.git
cd architect-path
npm install
npm run db:up      # PostGIS in Docker, waits until it answers
npm run seed       # 500,000 plots across eight Maharashtra districts
npm run m -- 04    # your first module
```

Four commands and you have a spatial database with real query plans to read.

```
npm run list                 what exists and what is planned
npm run m -- 05              run your version of module 05
npm run m -- 05 --solution   run the finished version
npm run db:reset             wipe and reseed
npm run typecheck            compile everything
```

## The modules

Bold ones are where the distinctive skill is. The generic material gets one sharp exercise; the spatial material gets depth.

| # | Module | Status |
|---|---|---|
| 01 | System design and ADRs | planned, rubric-graded |
| 02 | TypeScript: contracts and the validation boundary | planned |
| 03 | Node internals: event loop, streams, backpressure | planned |
| 04 | [Postgres: indexes and the plan](modules/04-postgres) | **ready** |
| 05 | **[PostGIS: geometry, geography, the spatial index](modules/05-postgis)** | **ready** |
| 06 | **[H3: hexagons, and when they beat PostGIS](modules/06-h3)** | **ready** |
| 07 | **Vector tiles and large data delivery** | planned |
| 08 | AWS reference architecture | planned |
| 09 | Kubernetes: the subset that matters | planned |
| 10 | **MCP server: building one, not governing one** | planned |
| 11 | **GeoAI: language to tool to PostGIS to map** | planned |
| 12 | Observability and the testing pyramid | planned |

## What the ready modules actually teach

Not summaries. These are the measured results from the code in this repository, on 500,000 rows.

**04 · Postgres.** A composite index takes a narrow query from 9.8 ms to 0.55 ms. Then the part most articles get wrong: an index on `(district, crop, sown_on)` *is* used for a filter on `crop` alone, but its startup cost is ten times higher because it scans the index instead of seeking into it. "Is an index used" turns out to be the wrong question.

**05 · PostGIS.** `ST_Distance` on a geometry returns `1.4786`. On the same two points as geography it returns `163659`. Neither errors. Then: `ST_DWithin(...)` runs in 10 ms and `ST_Distance(...) < 5000` runs in 139 ms, returning the identical 2,579 rows, because only one of them can use the index.

**06 · H3.** The same 500,000 points become 145 cells at resolution 4 and 120,311 at resolution 8. There is no correct resolution, only the one that answers your question without shipping more polygons than a browser will draw.

## The flagship

One project for the year: a **GeoAI Enterprise Assistant**. Someone asks a question in words, the model calls a controlled tool, the tool queries spatial data, and the answer comes back with a map and an explanation.

- **Q1** API, Postgres and PostGIS, infrastructure as code, CI, observability. Deliberately no AI yet.
- **Q2** The AI layer, reusing patterns from the exercises repository.
- **Q3** MCP server, spatial tools, H3 aggregation, map frontend.
- **Q4** Threat model, cost model, load test, the ADR set, the write-up.

The architectural rule it is built around: **the database is the source of truth for every spatial calculation.** The model chooses which question to ask. It never invents a distance.

## How to work through a module

| Time | Step |
|---|---|
| 5 min | Read the README, including "what to notice" at the end |
| 25 min | Do the `TODO`s with the solution closed |
| 2 min | Run it. Read the measurements, not just the ticks |
| 10 min | Open the solution and find what differs from yours |
| 3 min | Write one sentence about what surprised you |

## Honest limits

- **Three of twelve modules are written.** The rest are scaffolded and listed, and `npm run list` tells you which.
- **The data is synthetic.** District centres are real coordinates; the plots around them are generated. That keeps the repository small, avoids licensing questions, and makes the size exactly what the lessons need.
- **Timings are from one laptop.** Yours will differ. The ratios are the point, not the milliseconds.

## License

MIT
