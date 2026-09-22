# 06 · H3: hexagons, and when they beat PostGIS

**Needs the database:** yes, for the comparison. **Feeds the flagship:** every aggregated map layer.

## Why hexagons at all

You have PostGIS and a spatial index. Module 05 made a radius query run in 10 ms. So why add another spatial system?

Because the two answer different questions. PostGIS answers **where is this thing**. H3 answers **how much of this is here**, quickly, at a resolution you choose, with a key you can group by, cache, and join like any other column.

Aggregating half a million points into map-ready buckets is the case. Doing it in PostGIS means a spatial join against a grid you have to generate and index. Doing it with H3 means `GROUP BY h3_cell`, because the cell is just text.

## The one thing that trips everyone

**The library changed its whole vocabulary in version 4.** Every tutorial, answer and blog post written before 2022 uses names that no longer exist:

| Version 3, gone | Version 4, current |
|---|---|
| `geoToH3` | `latLngToCell` |
| `h3ToGeo` | `cellToLatLng` |
| `h3ToGeoBoundary` | `cellToBoundary` |
| `polyfill` | `polygonToCells` |
| `kRing` | `gridDisk` |
| `h3GetResolution` | `getResolution` |
| `h3IsValid` | `isValidCell` |

They do not warn you. They are simply undefined, and you get "not a function" against a library that is installed and working.

Also: **`latLngToCell` takes latitude first, longitude second.** PostGIS `ST_MakePoint` takes longitude first. They are opposite, in the same codebase, and nothing errors when you swap them. Your point lands somewhere real and wrong.

## What you will do

Index half a million plots into H3 cells, aggregate by cell, and compare the cost of that against the equivalent grid aggregation in PostGIS. Then walk the resolution hierarchy and see what you trade.

## Steps

1. `npm run db:up && npm run seed` if you have not.
2. Work through the `TODO`s in `exercise.ts`.
3. `npm run m -- 06`

## Done when

Every check passes, and you can say which of the two systems you would reach for given a question, rather than defaulting to the one you learned first.

## What to notice

- **Resolution is a real trade, not a quality setting.** Each step up divides a cell into roughly seven. Resolution 7 is about 5 km across, 8 about 2 km, 9 about 0.7 km. Too coarse and your map says nothing; too fine and you ship a hundred thousand cells to a browser.
- **A cell is a string, so everything downstream gets simpler.** Group by it, cache by it, use it as a primary key, send it to a client, join it to business data. That is most of the value, and it has nothing to do with hexagons.
- **Hexagons have one neighbour distance; squares have two.** Every neighbour of a hexagon shares an edge and sits at the same distance. A square grid has edge neighbours and corner neighbours at different distances, which quietly distorts anything that spreads or flows.
- **Twelve cells on Earth are pentagons.** They fall in the ocean by design, and they are why `cellArea` is not a constant per resolution. It will not bite you over Maharashtra, but it will bite an assertion that every cell at a resolution has the same area.
