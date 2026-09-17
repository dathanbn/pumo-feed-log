// tests/e2e/helpers/screenshot.js
// Screenshot naming per tasks.md §2 "Screenshots (tests/screenshots/)":
//   {NN}-{screen}-{state}-{before|after}-{light|dark}.png
//   before/after = before/after the action under test; omit when the state is static.
//   Append -after-fix when re-testing a fixed defect.

'use strict';

const path = require('path');
const fs = require('fs');

const SCREENSHOTS_DIR = path.resolve(__dirname, '..', '..', 'screenshots');

function ensureDir() {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

/**
 * Builds the filename and takes the screenshot.
 *   n: number|string   sequence number, e.g. 1 or '01'
 *   screen: string      'home' | 'history'
 *   state: string        e.g. 'empty', 'guarded-resting', 'armed'
 *   scheme: 'light'|'dark'
 *   phase: 'before'|'after'|null   omit for static states
 *   afterFix: boolean   appends '-after-fix' for defect re-tests
 */
async function shot(page, { n, screen, state, scheme, phase = null, afterFix = false, fullPage = false }) {
  ensureDir();
  const nn = String(n).padStart(2, '0');
  const parts = [nn, screen, state];
  if (phase) parts.push(phase);
  parts.push(scheme);
  let filename = parts.join('-');
  if (afterFix) filename += '-after-fix';
  filename += '.png';
  const filePath = path.join(SCREENSHOTS_DIR, filename);
  await page.screenshot({ path: filePath, fullPage });
  return filePath;
}

module.exports = { shot, SCREENSHOTS_DIR };
