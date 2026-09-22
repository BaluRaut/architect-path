/**
 * The queries this module measures.
 *
 * Note what each one SELECTS, not only what it filters on. That turns out to
 * change the plan as much as the filter does, which is the point of step 5.
 */

/** Narrow: one crop, one district, one date. Roughly 0.1% of the table. */
export const NARROW = `
  SELECT id, area_ha, sown_on
  FROM plots
  WHERE district = 'Latur' AND crop = 'tur' AND sown_on = DATE '2026-06-20'
`;

/** Filters on the LEADING column of the composite index. */
export const LEADING_COLUMN = `
  SELECT id, area_ha FROM plots WHERE district = 'Latur'
`;

/** Filters on a NON-LEADING column of the composite index. Same shape, different cost. */
export const NON_LEADING_COLUMN = `
  SELECT id, area_ha FROM plots WHERE crop = 'bajra'
`;

/** Selective: about an eighth of the table, and the heap must be read. */
export const SELECTIVE = `
  SELECT id, area_ha FROM plots WHERE crop = 'onion'
`;

/** Unselective: about 92% of the table, and the heap must be read. */
export const UNSELECTIVE = `
  SELECT id, crop FROM plots WHERE area_ha > 1.0
`;

/**
 * The same filter as SELECTIVE, but answerable without reading the table at all.
 * The contrast only works against a column that has an index, which crop does.
 */
export const SELECTIVE_COUNT_ONLY = `
  SELECT count(*) FROM plots WHERE crop = 'onion'
`;

/** Reads only columns a covering index can satisfy. */
export const COVERED = `
  SELECT district, crop FROM plots WHERE district = 'Akola'
`;
