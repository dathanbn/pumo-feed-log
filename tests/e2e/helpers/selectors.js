// tests/e2e/helpers/selectors.js
// Locators built from spec.md / design.md / architecture.md's *documented* copy, roles and
// markup — not from any private knowledge of the frontend's implementation (we don't own
// frontend/ and it may not exist yet). Each locator cites the doc line that justifies it.
// If a locator doesn't find anything on the real app, that's itself worth checking: either
// the frontend deviated from the documented contract (a defect) or our assumption was wrong
// (fix here, not in frontend/).

'use strict';

// Log button: design.md §3.4 lists every possible label. Matching the union of all of them
// finds "the" log button regardless of its current state.
const LOG_BUTTON_NAME_RE =
  /^(Loading…|Log a feed|Checking…|Fed .+ ago(, \d+ of 4 today)? — log another\?|\d+ of 4 today — log another\?|Saving…|✓?\s?Logged|Not saved, tap to retry|Try again)$/;

function logButton(page) {
  return page.getByRole('button', { name: LOG_BUTTON_NAME_RE });
}

// Headline: design.md §3.2 — "<span class="label">Last fed</span> <span class="value">…</span>".
function headlineValue(page) {
  return page.locator('.label', { hasText: 'Last fed' }).locator('xpath=following-sibling::*[1]');
}
// Fallback / simpler alternative some pages may prefer: any element carrying class "value"
// inside the paragraph that also contains the "Last fed" label, or (S1) the no-feeds copy.
function headline(page) {
  return page.locator('p', { has: page.locator('text=Last fed') }).first()
    .or(page.locator('p', { hasText: 'No feeds logged yet' }).first());
}

// Counter pill: contract.md §7.2 / design.md §5 — "{n} of 4 today". Not end-anchored: the
// warning state (design.md §3.3) appends a visually-hidden ", daily limit reached" inside
// the same element, which is part of the element's textContent even though only the visible
// prefix is what a sighted user reads.
function counterPill(page) {
  return page.getByText(/^\d+ of 4 today\b/);
}

// Recent list: design.md §3.1 "RECENT" label + <ul> of rows (architecture.md §7 "Lists use <ul>/<li>").
function recentList(page) {
  return page.getByRole('list').filter({ has: page.getByText(/^RECENT$/i) }).first()
    .or(page.locator('ul', { has: page.locator('li') }).first());
}
function recentRows(page) {
  return page.getByRole('listitem').filter({ hasNot: page.getByText(/^RECENT$/i) });
}
function recentEmptyMessage(page) {
  return page.getByText('When Pumo gets fed, tap the button below.');
}

// Row delete (icon) button: design.md §7 exact aria-label pattern
// `Delete feed from {day and time}, by {name or Someone}`.
function rowDeleteButton(page) {
  return page.getByRole('button', { name: /^Delete feed from .+, by .+$/ });
}
function rowDeleteButtonFor(page, dayAndTime, byWhom) {
  const escaped = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.getByRole('button', {
    name: new RegExp(`^Delete feed from ${escaped(dayAndTime)}, by ${escaped(byWhom)}$`),
  });
}

// Delete confirmation (design.md §3.6): Cancel / Delete buttons, scoped to a row/container.
// exact: true matters here — without it, name: 'Delete' also substring-matches the row's
// icon-only delete button, whose aria-label is "Delete feed from {time}, by {name}" (it
// contains "Delete"). Confirmed by direct repro: a page with both an aria-label="Delete feed
// from 2:30 PM, by Sam" button and a plain "Delete" button matches count=2 without `exact`,
// count=1 with it. Without this, confirmDeleteButton() spuriously matches other rows' icon
// buttons whenever more than one feed row is present, or matches the row's own icon button
// again once a confirmation is correctly cancelled/reverted to normal state.
function confirmCancelButton(scope) {
  return scope.getByRole('button', { name: 'Cancel', exact: true });
}
function confirmDeleteButton(scope) {
  return scope.getByRole('button', { name: 'Delete', exact: true });
}
function confirmFailedText(scope) {
  return scope.getByText("Couldn't delete.");
}
function confirmRetryButton(scope) {
  return scope.getByRole('button', { name: 'Retry', exact: true });
}

// Undo notice (design.md §3.5): a role="status" card. The page also has a SEPARATE role="status"
// region for live announcements (design.md §7), explicitly documented as "visually hidden" —
// and, critically, its announced text can be byte-identical to the undo notice card's own text
// at the same moment (both say exactly "Feed removed" on a successful undo; both start with
// "Logged " right after logging). Matching on hasText alone is therefore ambiguous and hits a
// Playwright strict-mode violation ("resolved to 2 elements") for any of these states. Scope to
// the one that is NOT the documented-hidden announcer instead — a distinction the docs make
// explicitly, unlike any assumption about markup/classes.
function undoNoticeRegion(page) {
  return page.locator('[role="status"]:not(.visually-hidden)');
}
function undoNotice(page) {
  return undoNoticeRegion(page).filter({ hasText: /^Logged / });
}
function undoButton(page) {
  return undoNoticeRegion(page).getByRole('button', { name: 'Undo' });
}
function undoFailedNotice(page) {
  return undoNoticeRegion(page).filter({ hasText: "Couldn't undo" });
}
function undoDismissButton(page) {
  return undoFailedNotice(page).getByRole('button', { name: 'Dismiss' });
}
function undoRetryButton(page) {
  return undoFailedNotice(page).getByRole('button', { name: 'Retry' });
}
function removedNotice(page) {
  return undoNoticeRegion(page).filter({ hasText: 'Feed removed' });
}

// Full-history link (design.md §3.1 "Full history ›").
function fullHistoryLink(page) {
  return page.getByRole('link', { name: /Full history/ });
}

// Name card (design.md §3.7).
// getByRole('heading', ...) with a RegExp name is both apostrophe-tolerant (the app's copy
// changed from a curly to a straight apostrophe partway through QA; `.` matches either) and,
// critically, respects the accessibility tree the same way a string name does: a heading
// hidden via the `hidden` attribute (display: none) correctly does NOT match. An earlier
// version of this locator OR'd in a getByText(...) fallback for the apostrophe-tolerance,
// but getByText matches DOM text regardless of visibility/hidden state, which silently
// defeated every toHaveCount(0)-after-hide assertion (AC-14.2, AC-14.3) even once the app
// correctly hid the card — confirmed by direct repro: getByRole alone -> 0 after hide,
// getByRole.or(getByText(regex)) -> 1 after hide (the getByText half still matching the
// hidden DOM node). Do not reintroduce a getByText-based fallback here.
function nameCardHeading(page) {
  return page.getByRole('heading', { name: /Who.s feeding Pumo\?/ });
}
function nameInput(page) {
  return page.getByLabel('Your name');
}
function nameSaveButton(page) {
  return page.getByRole('button', { name: 'Save' });
}
function nameSkipButton(page) {
  return page.getByRole('button', { name: 'Skip' });
}

// Footer (design.md §3.1 / §5): "Logging as {name} · Change" or "No name on this phone · Set name".
function footerChangeLink(page) {
  return page.getByRole('button', { name: 'Change' }).or(page.getByRole('link', { name: 'Change' }));
}
function footerSetNameLink(page) {
  return page
    .getByRole('button', { name: 'Set name' })
    .or(page.getByRole('link', { name: 'Set name' }));
}
function footerText(page) {
  return page.getByText(/Logging as .+ · Change|No name on this phone · Set name/);
}

// Error / status panels (design.md §6).
function loadErrorPanel(page) {
  return page.getByText("Can't load feeds");
}
function historyLoadErrorPanel(page) {
  return page.getByText("Can't load history.");
}
function refreshBanner(page) {
  return page.getByText(/^Couldn't refresh\. Showing feeds as of /);
}
function pausedHint(page) {
  return page.getByText(/Still can.t connect\. If nobody has opened the app for a week/);
}
function olderPageError(page) {
  return page.getByText("Couldn't load older feeds.");
}

// Live announcer (architecture.md / design.md §7): one hidden role="status" aria-live="polite"
// per page used purely for announcements (distinct from the undo-notice status card).
function liveAnnouncer(page) {
  return page.getByRole('status').filter({ hasNotText: /^Logged |Couldn.t undo|Feed removed/ });
}

// History screen.
function showOlderFeedsButton(page) {
  return page.getByRole('button', { name: 'Show older feeds' });
}
function dayHeading(page, name) {
  return page.getByRole('heading', { level: 2, name });
}
function historyEmptyMessage(page) {
  return page.getByText('No feeds logged yet.');
}
function historyBackLink(page) {
  return page.getByRole('link', { name: /Pumo/ });
}

module.exports = {
  LOG_BUTTON_NAME_RE,
  logButton,
  undoNoticeRegion,
  headline,
  headlineValue,
  counterPill,
  recentList,
  recentRows,
  recentEmptyMessage,
  rowDeleteButton,
  rowDeleteButtonFor,
  confirmCancelButton,
  confirmDeleteButton,
  confirmFailedText,
  confirmRetryButton,
  undoNotice,
  undoButton,
  undoFailedNotice,
  undoDismissButton,
  undoRetryButton,
  removedNotice,
  fullHistoryLink,
  nameCardHeading,
  nameInput,
  nameSaveButton,
  nameSkipButton,
  footerChangeLink,
  footerSetNameLink,
  footerText,
  loadErrorPanel,
  historyLoadErrorPanel,
  refreshBanner,
  pausedHint,
  olderPageError,
  liveAnnouncer,
  showOlderFeedsButton,
  dayHeading,
  historyEmptyMessage,
  historyBackLink,
};
