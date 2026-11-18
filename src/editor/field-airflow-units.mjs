// Field schedules display m³/h; saved design and site evidence remain canonical L/s.
export const lpsToM3h = value => Number.isFinite(value) ? value * 3.6 : null;
export const m3hToLps = value => Number.isFinite(value) ? value / 3.6 : null;
