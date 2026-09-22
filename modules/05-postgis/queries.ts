/** Nashik, used as the centre of every radius query here. */
export const NASHIK = { lon: 73.7898, lat: 19.9975 };

/** The right way: the index can answer this. */
export const RADIUS_DWITHIN = `
  SELECT count(*) FROM plots
  WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
`;

/** The wrong way: identical answer, and the index cannot help. */
export const RADIUS_DISTANCE = `
  SELECT count(*) FROM plots
  WHERE ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) < $3
`;

/** Distance in degrees. Runs without error and means nothing. */
export const DISTANCE_GEOMETRY = `
  SELECT ST_Distance(
    ST_SetSRID(ST_MakePoint($1, $2), 4326),
    ST_SetSRID(ST_MakePoint($3, $4), 4326)
  ) AS d
`;

/** Distance in metres. */
export const DISTANCE_GEOGRAPHY = `
  SELECT ST_Distance(
    ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
    ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography
  ) AS d
`;

/** Nearest plots to a point, using the KNN operator. */
export const NEAREST = `
  SELECT id, crop, ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS metres
  FROM plots
  ORDER BY geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
  LIMIT 10
`;

/** A spatial join: which plots fall inside a district boundary. */
export const SPATIAL_JOIN = `
  SELECT d.name, count(*) AS plots
  FROM plots p
  JOIN districts d ON ST_Intersects(d.boundary, p.geom)
  GROUP BY d.name
  ORDER BY plots DESC
`;
