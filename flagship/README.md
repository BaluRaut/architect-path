# The flagship: GeoAI Enterprise Assistant

One project for the year. Someone asks a question in words, the model calls a controlled tool, the tool queries spatial data, and the answer comes back with a map and an explanation.

**Not started yet.** Q1 begins once modules 04, 05 and 06 are done, because everything in Q1 is built on them.

## The rule it is built around

**The database is the source of truth for every spatial calculation.** The model decides which question to ask. It never computes a distance, an area or an overlap itself, and it never states one that did not come from a tool.

That single rule is what separates a geospatial assistant from a confident liar with a map.

## By quarter

**Q1 — foundations, deliberately with no AI.** API over the plots data, PostGIS queries from module 05, H3 aggregation from module 06, infrastructure as code, CI, traces. If this quarter is not solid, the AI on top of it is a demo.

**Q2 — the AI layer.** Natural-language question to structured tool call, using the patterns from [ai-engineer-exercises](https://github.com/BaluRaut/ai-engineer-exercises). An eval set of spatial questions with known answers, because "it looked right" is not a test.

**Q3 — MCP and the map.** An MCP server exposing the spatial tools, read-only first. Map frontend with H3 layers chosen per zoom level.

**Q4 — hardening.** Threat model, cost model, load test, the ADR set, and a write-up someone who was not there can follow.

## What "finished" means

Not that it works. That someone else can read the ADRs, understand why each piece is the way it is, run it, and change it without asking you.
