// Color conversions for StudioColor. Pure + unit-tested (hex ↔ rgb ↔ hsv ↔ oklch).
// The math lives in ~/lib/color/convert so it can be shared with the harmony
// engine without a components→components dependency; re-exported here to keep
// StudioColor's `./color` import stable.
export * from '~/lib/color/convert'
