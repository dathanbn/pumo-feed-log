// tests/e2e/helpers/color.js
// Minimal OKLCH color math for automated verification of AC-18.3's heatmap-ramp contrast rule,
// per the dataviz skill's method (design.md §4.1 / spec.md AC-18.3: "checked per the dataviz
// skill's method ... not picked by eye"). Deliberately a small, self-contained re-derivation of
// the same math the skill's own scripts/validate_palette.js uses (sRGB -> linear -> OKLab ->
// OKLCH, and the WCAG relative-luminance contrast ratio) — this file has no dependency on that
// skill's bundle path (which isn't guaranteed to exist at test-run time), so this check is a
// permanent, repeatable part of the QA suite rather than a one-off manual calculation.

'use strict';

/** "rgb(r, g, b)" (getComputedStyle's format) -> [r, g, b] each 0-1. */
function parseRgb(rgbString) {
  const m = String(rgbString).match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (!m) throw new Error(`color.js: could not parse rgb string ${JSON.stringify(rgbString)}`);
  return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255];
}

const s2lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function oklabFromLin([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, // L
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, // a
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s, // b
  ];
}

/** rgb() string -> [L, C, H(deg)] in OKLCH. */
function oklch(rgbString) {
  const [L, a, b] = oklabFromLin(parseRgb(rgbString).map(s2lin));
  const C = Math.hypot(a, b);
  const H = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return { L, C, H };
}

/** WCAG 2.1 contrast ratio between two rgb() strings. */
function contrast(rgbA, rgbB) {
  const relLum = (rgbString) => {
    const [r, g, b] = parseRgb(rgbString).map(s2lin);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [relLum(rgbA), relLum(rgbB)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

module.exports = { parseRgb, oklch, contrast };
