// Pumo Feed Log: history screen controller. Day groups with counts, paging, delete confirmation,
// and a focus refresh that reloads the first page and drops older pages. (architecture.md §4)
// v1.1: same pet resolution as home.js, plus the heatmap (design.md §4.1) built from the loaded
// feeds and the Download CSV button (design.md §4.2).

import { PAUSED_HINT_AFTER_FAILURES, DEFAULT_PET_SLUG, HEATMAP_WEEKS } from './constants.js';
import {
  feedDayKey,
  groupByDay,
  deleteConsequence,
  formatTime,
  buildHeatmap,
  feedsToCsv,
  petSlugFromLocation,
  pathForPet,
} from './logic.js';
import * as api from './api.js';
import {
  announce,
  onFocusRefresh,
  createFeedRow,
  renderErrorPanel,
  showBanner,
  hideBanner,
  errorBodyLines,
  COPY,
  renderHeatmap,
  renderHeatmapLegend,
  icon,
} from './ui.js';

// D6 polish: not a contract.md §7.1 constant (it governs no server behavior) — just how long
// the row's "This feed was deleted." message (design.md §3.6b) gets to sit on screen before the
// follow-up background reload is allowed to drop the row, so it's actually readable rather
// than disappearing within one GET round-trip.
const EDIT_DELETED_MESSAGE_DELAY_MS = 1200;

const backLinkEl = document.getElementById('back-link');
const csvButtonEl = document.getElementById('csv-button');
const csvErrorEl = document.getElementById('csv-error');
const heatmapCardEl = document.getElementById('heatmap-card');
// v1.2: renderHeatmap() now clears/rebuilds only this inner node, so the static
// .heatmap__header (holding the legend and the CSV button, v1.3) survives the heatmap's own
// re-renders. (architecture.md §4's "Heatmap card DOM shape" note)
const heatmapContentEl = document.getElementById('heatmap-content');
const heatmapLegendEl = document.getElementById('heatmap-legend');
// v1.3: the legend never depends on data, so — unlike heatmapContentEl above — it's rendered
// once here at module load, not on every renderHeatmapCard() call.
renderHeatmapLegend(heatmapLegendEl);
const historyBodyEl = document.getElementById('history-body');
const showOlderBtn = document.getElementById('show-older');
const olderErrorEl = document.getElementById('older-error');
const refreshBannerEl = document.getElementById('refresh-banner');

const state = {
  pet: null,
  pets: [],
  feeds: [], // all loaded live feeds for this pet, newest first
  hasMore: false,
  loadStatus: 'loading', // 'loading' | 'ready' | 'error'
  hasLoadedOnce: false,
  lastError: null,
  olderLoading: false,
  consecutiveFailures: 0,
  loadedAt: 0,
  expandedKey: null, // feedDayKey of the expanded heatmap cell, or null
  csvStatus: 'idle', // 'idle' | 'preparing' | 'failed'
};

function incrementFailure() {
  state.consecutiveFailures += 1;
}
function resetFailure() {
  state.consecutiveFailures = 0;
}

function todayCountFromFeeds(feeds, now) {
  const today = feedDayKey(now);
  return feeds.filter((f) => feedDayKey(new Date(f.created_at)) === today).length;
}

// ---- Heatmap (design.md §4.1) ------------------------------------------------------------------
// True when the oldest loaded feed's timestamp is still inside the heatmap's date window (i.e.
// on/after the window's start) — meaning we don't yet know whether there's *more* history that
// also falls inside the window, so another page is worth fetching. False once the oldest loaded
// feed already predates the window start: the window is fully covered by what's loaded, and
// fetching further (even if hasMore) would just keep paging past what the heatmap ever needs.
function oldestLoadedIsWithinHeatmapRange(now) {
  if (state.feeds.length === 0) return true; // nothing loaded at all — nothing more to fetch here
  const oldest = state.feeds[state.feeds.length - 1];
  const { start } = buildHeatmap(state.feeds, now, HEATMAP_WEEKS);
  return new Date(oldest.created_at).getTime() >= start.getTime();
}

/**
 * Ensures enough history is loaded to cover the heatmap's date range, then renders it. Per
 * contract.md §6.F.1: if more feeds might exist inside the heatmap's window, fetch one more
 * page first, exactly like any other "need more data" case (no heatmap-specific network path).
 */
async function ensureHeatmapDataAndRender() {
  const now = new Date();
  if (state.hasMore && oldestLoadedIsWithinHeatmapRange(now)) {
    // The oldest loaded feed is still inside the heatmap's window, and more feeds exist — one
    // more page may add more history still inside the window (or confirm it's now covered).
    // Guarded by hasMore/olderLoading inside loadOlder(); loadOlder's own success path re-invokes
    // render() (which calls back in here), so this keeps paging until the window is covered.
    await loadOlder({ forHeatmap: true });
    return;
  }
  renderHeatmapCard(now);
}

function renderHeatmapCard(now) {
  if (state.loadStatus !== 'ready') {
    heatmapCardEl.hidden = true;
    return;
  }
  heatmapCardEl.hidden = false;
  const heatmap = buildHeatmap(state.feeds, now, HEATMAP_WEEKS);
  let expandedFeeds = null;
  if (state.expandedKey) {
    expandedFeeds = state.feeds.filter((f) => feedDayKey(new Date(f.created_at)) === state.expandedKey);
  }
  renderHeatmap(heatmapContentEl, {
    heatmap,
    expandedKey: state.expandedKey,
    expandedFeeds,
    onCellClick: onHeatmapCellClick,
    onCollapse: () => {
      state.expandedKey = null;
      renderHeatmapCard(new Date());
    },
  });
}

function onHeatmapCellClick(cell) {
  // AC-18.5, frontend agent's call (documented in the hand-off): tapping a zero-feed in-range
  // cell does nothing — its count is already announced via the cell's own aria-label, so no
  // information is lost, and it avoids an expand state with nothing to show.
  if (cell.count === 0) return;
  state.expandedKey = state.expandedKey === cell.feedDayKey ? null : cell.feedDayKey;
  renderHeatmapCard(new Date());
}

// ---- CSV export (design.md §4.2, contract.md §6.F.2, §7.9) --------------------------------------
// v1.2: restyled from .btn--outline.btn--full to the existing (previously unused) .btn--text
// variant and moved into the heatmap card's own header. v1.3: dropped the visible "CSV" label
// entirely — icon only now, inline with the legend — so the aria-label (below) is the button's
// sole accessible name, same as it already was in practice (aria-label always won over the
// visible text content for the accessible-name computation, so this drops no information).
function renderCsvButton() {
  csvButtonEl.disabled = state.csvStatus === 'preparing';
  csvButtonEl.textContent = '';
  csvButtonEl.className = 'btn btn--text btn--icon-only';
  if (state.csvStatus === 'preparing') {
    csvButtonEl.classList.add('is-checking');
    csvButtonEl.append(icon('spinner', 'spin'));
  } else {
    csvButtonEl.append(icon('download'));
  }
  csvButtonEl.setAttribute('aria-label', `Download ${state.pet.name}'s feed history as CSV`);

  csvErrorEl.hidden = state.csvStatus !== 'failed';
  if (state.csvStatus === 'failed') {
    csvErrorEl.textContent = '';
    const text = document.createElement('span');
    text.textContent = COPY.csvFailed;
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'btn btn--warn-outline';
    retryBtn.textContent = 'Retry';
    retryBtn.addEventListener('click', onCsvTap);
    csvErrorEl.append(text, retryBtn);
  } else {
    csvErrorEl.textContent = '';
  }
}

function downloadCsv(csvText, filename) {
  const blob = new Blob([csvText], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function onCsvTap() {
  if (state.csvStatus === 'preparing') return;
  state.csvStatus = 'preparing';
  renderCsvButton();
  try {
    const feeds = await api.getAllFeedsForExport(state.pet.id);
    resetFailure();
    const csvText = feedsToCsv(feeds, state.pet);
    const filename = `pumo-feed-log-${state.pet.slug}-${feedDayKey(new Date())}.csv`;
    downloadCsv(csvText, filename);
    state.csvStatus = 'idle';
    renderCsvButton();
  } catch {
    incrementFailure();
    state.csvStatus = 'failed';
    renderCsvButton();
  }
}

// ---- Rendering --------------------------------------------------------------------------------
function renderSkeleton() {
  heatmapCardEl.hidden = true;
  historyBodyEl.setAttribute('aria-busy', 'true');
  historyBodyEl.textContent = '';
  for (let g = 0; g < 2; g++) {
    const section = document.createElement('section');
    section.className = 'day-group day-group--placeholder';
    const heading = document.createElement('div');
    heading.className = 'day-group__heading-placeholder';
    section.appendChild(heading);
    const ul = document.createElement('ul');
    ul.className = 'row-list';
    for (let i = 0; i < 3; i++) {
      const li = document.createElement('li');
      li.className = 'row row--placeholder';
      ul.appendChild(li);
    }
    section.appendChild(ul);
    historyBodyEl.appendChild(section);
  }
  showOlderBtn.hidden = true;
}

function renderEmpty() {
  // Deliberately does NOT hide the heatmap: AC-18.3 requires it to render (as all-zero-tier
  // cells) even for a pet with no feeds yet. render() below calls ensureHeatmapDataAndRender()
  // right after this, independent of whether the day-grouped list is empty.
  historyBodyEl.setAttribute('aria-busy', 'false');
  historyBodyEl.textContent = '';
  const p = document.createElement('p');
  p.className = 'history-empty';
  p.textContent = COPY.historyEmpty;
  historyBodyEl.appendChild(p);
  showOlderBtn.hidden = true;
}

function renderError() {
  heatmapCardEl.hidden = true;
  historyBodyEl.setAttribute('aria-busy', 'false');
  historyBodyEl.textContent = '';
  const showPaused = state.consecutiveFailures >= PAUSED_HINT_AFTER_FAILURES && navigator.onLine !== false;
  renderErrorPanel(historyBodyEl, {
    title: COPY.historyLoadErrorTitle,
    bodyLines: errorBodyLines(state.lastError, showPaused),
    buttonText: 'Try again',
    onButtonClick: () => loadFirstPage({ background: false }),
  });
  showOlderBtn.hidden = true;
}

function focusAfterDelete(targetIndex) {
  const deleteButtons = historyBodyEl.querySelectorAll('.row__delete');
  if (deleteButtons[targetIndex]) {
    deleteButtons[targetIndex].focus();
    return;
  }
  if (deleteButtons.length > 0) {
    deleteButtons[deleteButtons.length - 1].focus();
    return;
  }
  const h1 = document.querySelector('h1');
  if (h1) {
    h1.setAttribute('tabindex', '-1');
    h1.focus();
  }
}

function focusEditButtonAfterSave(targetIndex) {
  const editButtons = historyBodyEl.querySelectorAll('.row__edit');
  if (editButtons[targetIndex]) editButtons[targetIndex].focus();
}

async function deleteFeed(id) {
  const targetIndex = state.feeds.findIndex((f) => f.id === id);
  const result = await api.softDeleteFeed(id);
  resetFailure();
  state.feeds = state.feeds.filter((f) => f.id !== id);
  announce('Feed deleted');
  // Full render(), not just renderGroups()+renderHeatmapCard(): deleting the last feed must show
  // S10's "No feeds logged yet." empty state immediately (render() picks renderEmpty() over
  // renderGroups() when state.feeds is now empty), and render() also covers the heatmap update
  // (S16: an expanded day's last feed being deleted updates within 1 s).
  render();
  focusAfterDelete(targetIndex);
  return result;
}

/**
 * Saves a corrected time for `feed` (v1.2, contract.md §6.H). On a normal success, updates
 * state.feeds and calls the exact same full render() path deleteFeed() already uses (AC-21.3) —
 * day-grouping, counts and the heatmap are all pure/live off state.feeds, so re-sorting the
 * updated array and calling render() is enough, no new partial-render logic. On
 * `alreadyDeleted`, deliberately does NOT touch state.feeds or call render() synchronously (so
 * the row's own "This feed was deleted." message, design.md §3.6b, is actually visible for a
 * moment) — instead it reloads the first page in the background, the same reload
 * onFocusRefresh already triggers elsewhere in this file, which will drop the row once it lands.
 * @param {{id: string, created_at: string}} feed - the feed as it was *before* this edit
 * @param {string} newIso
 */
async function editFeedTime(feed, newIso) {
  const result = await api.updateFeedTime(feed.id, newIso);
  resetFailure();
  if (result.alreadyDeleted) {
    announce('This feed was deleted');
    // Delayed on purpose (D6) — give the row's own message a real reading window before the
    // background reload (which would otherwise land within one GET round-trip) drops the row.
    setTimeout(() => {
      loadFirstPage({ background: true }).catch(() => {});
    }, EDIT_DELETED_MESSAGE_DELAY_MS);
    return result;
  }
  state.feeds = state.feeds
    .map((f) => (f.id === feed.id ? result : f))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  announce('Feed time updated');
  render();
  // The re-sort above may have moved the edited feed to a different day group, so focus its
  // NEW flattened position, not wherever it used to sit in the (now stale) pre-edit order.
  focusEditButtonAfterSave(state.feeds.findIndex((f) => f.id === result.id));
  return result;
}

function renderGroups(now) {
  historyBodyEl.setAttribute('aria-busy', 'false');
  historyBodyEl.textContent = '';
  const groups = groupByDay(state.feeds, now);

  for (const group of groups) {
    const section = document.createElement('section');
    section.className = 'day-group';

    const headingRow = document.createElement('div');
    headingRow.className = 'day-group__heading-row';
    const h2 = document.createElement('h2');
    h2.textContent = group.heading;
    const count = document.createElement('span');
    count.className = 'day-group__count';
    count.textContent = `${group.feeds.length} feed${group.feeds.length === 1 ? '' : 's'}`;
    headingRow.append(h2, count);
    section.appendChild(headingRow);

    const ul = document.createElement('ul');
    ul.className = 'row-list';
    for (const feed of group.feeds) {
      const { element } = createFeedRow({
        feed,
        now,
        timeOnly: true,
        getConsequence: () => deleteConsequence(feed, state.feeds, todayCountFromFeeds(state.feeds, new Date()), new Date()),
        onConfirmDelete: (id) => deleteFeed(id),
        onConfirmEdit: (id, newIso) => editFeedTime(feed, newIso),
      });
      ul.appendChild(element);
    }
    section.appendChild(ul);
    historyBodyEl.appendChild(section);
  }

  showOlderBtn.hidden = !state.hasMore;
}

function render() {
  if (state.loadStatus === 'error' && !state.hasLoadedOnce) {
    renderError();
    return;
  }
  if (state.loadStatus === 'loading' && !state.hasLoadedOnce) {
    renderSkeleton();
    return;
  }
  // The heatmap renders unconditionally (AC-18.3), independent of whether the day-grouped list
  // below it is empty — a zero-feed pet still gets an all-zero-tier heatmap, not a hidden card.
  if (state.feeds.length === 0) {
    renderEmpty();
  } else {
    renderGroups(new Date());
  }
  ensureHeatmapDataAndRender().catch(() => {
    // Heatmap couldn't fetch the extra page it wanted; render with what's loaded rather than
    // block the (already-successful) day-list render on it.
    renderHeatmapCard(new Date());
  });
}

function renderOlderError() {
  olderErrorEl.hidden = false;
  olderErrorEl.textContent = '';
  const text = document.createElement('span');
  text.textContent = COPY.olderPageError;
  const retryBtn = document.createElement('button');
  retryBtn.type = 'button';
  retryBtn.className = 'btn btn--warn-outline';
  retryBtn.textContent = 'Retry';
  retryBtn.addEventListener('click', () => loadOlder());
  olderErrorEl.append(text, retryBtn);
}

// ---- Loading ------------------------------------------------------------------------------------
async function loadFirstPage({ background }) {
  if (!background) {
    state.loadStatus = 'loading';
    render();
  }
  try {
    const { feeds, hasMore } = await api.getHistoryPage({ petId: state.pet.id });
    resetFailure();
    state.feeds = feeds;
    state.hasMore = hasMore;
    state.loadStatus = 'ready';
    state.hasLoadedOnce = true;
    state.lastError = null;
    state.loadedAt = Date.now();
    hideBanner(refreshBannerEl);
    // D6: an unrelated background reload (focus refresh, or another row's own action) must not
    // yank away a row's open Edit or Delete flow mid-interaction. State above is still kept
    // fresh; only the visible rebuild is skipped, and the next reload picks it up once every
    // row is back to normal.
    if (background && historyBodyEl.querySelector('[data-row-open]')) {
      return true;
    }
    render();
    return true;
  } catch (err) {
    incrementFailure();
    state.lastError = err;
    if (!state.hasLoadedOnce) {
      state.loadStatus = 'error';
      render();
    } else {
      showBanner(
        refreshBannerEl,
        `${COPY.refreshBannerPrefix}${formatTime(new Date(state.loadedAt))}.`,
        () => loadFirstPage({ background: false })
      );
    }
    return false;
  }
}

async function loadOlder({ forHeatmap = false } = {}) {
  if (state.olderLoading || state.feeds.length === 0) return;
  const oldest = state.feeds[state.feeds.length - 1];
  state.olderLoading = true;
  if (!forHeatmap) {
    showOlderBtn.disabled = true;
    showOlderBtn.textContent = 'Loading…';
    olderErrorEl.hidden = true;
  }
  try {
    const { feeds, hasMore } = await api.getHistoryPage({ petId: state.pet.id, before: oldest.created_at });
    resetFailure();
    state.feeds = [...state.feeds, ...feeds];
    state.hasMore = hasMore;
    state.olderLoading = false;
    if (!forHeatmap) {
      showOlderBtn.disabled = false;
      showOlderBtn.textContent = 'Show older feeds';
    }
    // Always the full render(), even after a heatmap-driven page load: it keeps the visible
    // "Show older feeds" list in sync with what's now loaded (not just the heatmap card), and
    // it re-invokes ensureHeatmapDataAndRender() itself, so if the heatmap's window still isn't
    // fully covered, the next page gets fetched from there rather than from an awaited call here.
    render();
  } catch (err) {
    incrementFailure();
    state.olderLoading = false;
    if (forHeatmap) {
      throw err;
    }
    showOlderBtn.disabled = false;
    showOlderBtn.textContent = 'Show older feeds';
    renderOlderError();
  }
}

// ---- Pet resolution (v1.1, contract.md §7.10) --------------------------------------------------
function renderPetLoadError() {
  historyBodyEl.setAttribute('aria-busy', 'false');
  historyBodyEl.textContent = '';
  renderErrorPanel(historyBodyEl, {
    title: COPY.historyLoadErrorTitle,
    bodyLines: errorBodyLines(null, false),
    buttonText: 'Try again',
    onButtonClick: () => initPet(),
  });
  heatmapCardEl.hidden = true; // the CSV button, nested inside, is hidden along with it
  showOlderBtn.hidden = true;
}

async function initPet() {
  try {
    const pets = await api.getPets();
    state.pets = pets;
    const slug = petSlugFromLocation(location.search, pets);
    state.pet =
      pets.find((p) => p.slug === slug) || pets.find((p) => p.slug === DEFAULT_PET_SLUG) || pets[0];

    backLinkEl.href = pathForPet(state.pet.slug);
    backLinkEl.querySelector('.back-link__label').textContent = state.pet.name;
    // v1.2: the CSV button's hidden state now follows #heatmap-card's own hidden toggling
    // (it's nested inside the card) instead of being set independently — it no longer appears
    // before the first page of data has loaded (architecture.md §4's DOM-shape note).
    csvButtonEl.addEventListener('click', onCsvTap);
    renderCsvButton();

    showOlderBtn.addEventListener('click', () => loadOlder());
    onFocusRefresh(() => loadFirstPage({ background: true }));
    loadFirstPage({ background: false });
  } catch {
    renderPetLoadError();
  }
}

// ---- Init -----------------------------------------------------------------------------------
initPet();
