// tests/e2e/helpers/a11y.js
// axe-core scan wrapper and tap-target size checks, per tasks.md §2 "Accessibility (AC-16.6)".

'use strict';

const AxeBuilder = require('@axe-core/playwright').default;

/** Runs an axe scan and returns { violations, serious, critical } where serious/critical
 *  are the subsets of violations at those impact levels (what AC-16.6 cares about). */
async function scanForSeriousViolations(page) {
  const results = await new AxeBuilder({ page }).analyze();
  const violations = results.violations || [];
  const serious = violations.filter((v) => v.impact === 'serious');
  const critical = violations.filter((v) => v.impact === 'critical');
  return { all: violations, serious, critical, passes: serious.length === 0 && critical.length === 0 };
}

function summarizeViolations(violations) {
  return violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')),
  }));
}

/** Asserts a locator's box is at least minW x minH CSS px. Returns the box for logging. */
async function assertTapTarget(locator, { minW = 44, minH = 44 } = {}) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('assertTapTarget: element has no box (not visible / not rendered)');
  }
  if (box.width < minW - 0.5 || box.height < minH - 0.5) {
    throw new Error(
      `Tap target too small: ${box.width.toFixed(1)}x${box.height.toFixed(1)} (need >= ${minW}x${minH})`
    );
  }
  return box;
}

module.exports = { scanForSeriousViolations, summarizeViolations, assertTapTarget };
