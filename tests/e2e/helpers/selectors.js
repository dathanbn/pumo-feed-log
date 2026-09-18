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
// v1.1: per-pet copy (frontend/js/home.js: `When ${state.pet.name} gets fed, tap the button
// below.`) — defaults to 'Pumo' so every pre-v1.1 call site keeps working unchanged, same
// pattern as historyBackLink/csvDownloadButton below.
function recentEmptyMessage(page, petName = 'Pumo') {
  return page.getByText(`When ${petName} gets fed, tap the button below.`);
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

// ---------------------------------------------------------------------------------------------
// v1.2: Row inline time editor (design.md §3.6b, contract.md §6.H/§7.11, spec.md F21)
// ---------------------------------------------------------------------------------------------

// Row Edit (icon) button: design.md §7 exact aria-label pattern (same shape as Delete's own)
// `Edit feed from {day and time}, by {name or Someone}` (frontend/js/logic.js editAriaLabel).
function rowEditButton(page) {
  return page.getByRole('button', { name: /^Edit feed from .+, by .+$/ });
}
function rowEditButtonFor(page, dayAndTime, byWhom) {
  const escaped = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.getByRole('button', {
    name: new RegExp(`^Edit feed from ${escaped(dayAndTime)}, by ${escaped(byWhom)}$`),
  });
}
// The <label>"Edit time"</label> + native <input type="time"> the editor opens (design.md
// §3.6b). Scope to a specific row/container when more than one row could be open (there
// shouldn't be, since AC-21.2/AC-10.5 share the single "one open row at a time" rule, but a
// scoped call is still the safer default for a test that already has a row locator in hand).
function editTimeInput(scope) {
  return scope.getByLabel('Edit time');
}
function editSaveButton(scope) {
  return scope.getByRole('button', { name: 'Save', exact: true });
}
function editCancelButton(scope) {
  return scope.getByRole('button', { name: 'Cancel', exact: true });
}
function editFutureRejectedText(scope) {
  return scope.getByText("Can't set a future time.");
}
function editFailedText(scope) {
  return scope.getByText("Couldn't save.");
}
function editRetryButton(scope) {
  return scope.getByRole('button', { name: 'Retry', exact: true });
}
function editDeletedText(scope) {
  return scope.getByText('This feed was deleted.');
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
// v1.1: per-pet copy (frontend/js/home.js: `Who's feeding ${state.pet.name}?`) — defaults to
// 'Pumo' so every pre-v1.1 call site keeps working unchanged. `.` still stands in for the
// apostrophe (straight vs curly tolerance, see the note above) and petName is regex-escaped
// since 'Banh Mi' contains a space that must match literally.
function nameCardHeading(page, petName = 'Pumo') {
  const escaped = petName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.getByRole('heading', { name: new RegExp(`Who.s feeding ${escaped}\\?`) });
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
// design.md §4: "‹ Pumo", pet-scoped (§3.0/§4.0) — generalized so it works for any pet, not
// just the default. Defaults to /Pumo/ to keep every pre-v1.1 call site working unchanged.
function historyBackLink(page, petName = 'Pumo') {
  const escaped = petName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.getByRole('link', { name: new RegExp(escaped) });
}

// ---------------------------------------------------------------------------------------------
// v1.1: Pet picker (design.md §3.0, contract.md §6.G/§7.10, spec.md F17)
// ---------------------------------------------------------------------------------------------

// design.md §3.0: "Each avatar is a real <a href='...'>, aria-current='true' on the selected
// one, and aria-label='{pet name}'". The copy table (design.md §5) confirms the accessible
// name pattern is just the bare pet name, so getByRole('link', {name: petName}) is exact —
// but a pet's real photo also carries alt="Pumo" (design.md §7 "Avatar"), so scope to the
// picker's own container where one is identifiable, and otherwise accept either a link or an
// img-with-alt match. Kept deliberately loose (two `.or()` fallbacks) since the exact DOM
// shape doesn't exist yet to verify against — narrow this once real markup exists.
function petPickerAvatarLink(page, petName) {
  const escaped = petName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.getByRole('link', { name: new RegExp(`^${escaped}$`) });
}
// All picker avatar links, in DOM order — used to assert sort_order (AC-17.3: "in sort_order").
function petPickerAvatarLinks(page) {
  // Heuristic: every pet-name-only link on the page. index.html's only other links are "Full
  // history" and the name-card's Change/Set-name (which render as buttons per design.md §3.7,
  // not links), so this should be exactly the picker's links — revisit if that changes.
  return page.getByRole('link').filter({ hasNotText: /Full history/ });
}
function selectedPetAvatarLink(page) {
  return page.locator('a[aria-current="true"]');
}

// ---------------------------------------------------------------------------------------------
// v1.1: Feeding heatmap (design.md §4.1, contract.md §7.8, spec.md F18)
// ---------------------------------------------------------------------------------------------

// design.md §4.1: "Every cell is a real <button> (even the non-interactive padding ones,
// disabled), with aria-label stating the full date and count, e.g.
// aria-label='Tuesday, September 15: 3 feeds'". design.md §5's copy pattern confirms the
// "{Weekday}, {Month} {day}: {n} feed(s) / no feeds" shape.
function heatmapGrid(page) {
  // No documented role/landmark for the card itself; scope by containing at least one heatmap
  // cell button (matched by its aria-label shape below), which IS documented.
  return page.locator(':has(button[aria-label*=": "])').first();
}
function heatmapCells(page) {
  return page.getByRole('button', { name: /^[A-Za-z]+, [A-Za-z]+ \d{1,2}(, \d{4})?: (\d+ feeds?|no feeds)$/i });
}
/** A specific cell by its exact accessible name, e.g. "Tuesday, September 15: 3 feeds". */
function heatmapCellByLabel(page, label) {
  return page.getByRole('button', { name: label, exact: true });
}
function heatmapTodayCell(page) {
  // Resolved against real markup (frontend/js/ui.js renderHeatmap): the today cell carries
  // `data-today="true"` in addition to its visual outline, exactly matching the DOM hook the
  // frontend hand-off promised. `.and()` keeps this scoped to an actual heatmap cell button
  // (role + accessible-name shape), not just any element that happened to carry the attribute.
  return heatmapCells(page).and(page.locator('[data-today="true"]'));
}
function heatmapLegend(page) {
  // design.md §5: "Heatmap legend | 0 · 1 · 2 · 3 · 4+"
  return page.getByText('0 · 1 · 2 · 3 · 4+');
}
// design.md §4.1: tapping a count>0 cell "expands an inline panel directly below the grid ...
// with a small close affordance". Resolved against real markup (frontend/js/ui.js
// renderHeatmap): `data-heatmap-expanded="true"`, exactly the DOM hook the frontend hand-off
// promised. `.heatmap__expanded` kept as a fallback only in case a future build renames the
// attribute but keeps a similarly-named class.
function heatmapExpandedPanel(page) {
  return page.locator('[data-heatmap-expanded="true"]').or(page.locator('.heatmap__expanded'));
}
// The close (✕) affordance inside the expanded panel (frontend/js/ui.js: aria-label="Close").
function heatmapExpandedPanelCloseButton(page) {
  return heatmapExpandedPanel(page).getByRole('button', { name: 'Close', exact: true });
}

// ---------------------------------------------------------------------------------------------
// v1.1: CSV export (design.md §4.2, contract.md §7.9, spec.md F19)
// ---------------------------------------------------------------------------------------------

// design.md §4.2: visible label "Download CSV"; aria-label "Download {pet name}'s feed
// history as CSV" (AC-19.5). Match on the accessible name (covers both, since an aria-label
// overrides the visible text as the accessible name) so this also works mid-flight when the
// visible text is "Preparing…" but the aria-label presumably still names the pet — falls back
// to the plain visible-text match if aria-label isn't set that way.
function csvDownloadButton(page, petName) {
  if (petName) {
    const escaped = petName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return page
      .getByRole('button', { name: new RegExp(`Download ${escaped}.s feed history as CSV`) })
      .or(page.getByRole('button', { name: /Download CSV|Preparing…/ }));
  }
  return page.getByRole('button', { name: /Download CSV|Preparing…/ });
}
function csvExportFailedText(page) {
  return page.getByText("Couldn't prepare the download.");
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
  // v1.1
  petPickerAvatarLink,
  petPickerAvatarLinks,
  selectedPetAvatarLink,
  heatmapGrid,
  heatmapCells,
  heatmapCellByLabel,
  heatmapTodayCell,
  heatmapLegend,
  heatmapExpandedPanel,
  heatmapExpandedPanelCloseButton,
  csvDownloadButton,
  csvExportFailedText,
  // v1.2
  rowEditButton,
  rowEditButtonFor,
  editTimeInput,
  editSaveButton,
  editCancelButton,
  editFutureRejectedText,
  editFailedText,
  editRetryButton,
  editDeletedText,
};
