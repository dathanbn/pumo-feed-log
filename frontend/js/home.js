// Pumo Feed Log: home screen controller. Owns the button state machine, the 30 s tick, the
// undo notice, and the name card/footer. (architecture.md §4, design.md §3, spec.md F2-F11,14)
// v1.1: resolves the pet from the URL before the first render, renders the pet picker, and
// scopes every api.js call to that pet's id (spec.md F17).

import {
  TICK_MS,
  ARM_TIMEOUT_MS,
  LOGGED_FLASH_MS,
  UNDO_WINDOW_MS,
  REMOVED_NOTICE_MS,
  STALE_AFTER_MS,
  DAILY_FEED_TARGET,
  RECENT_LIST_SIZE,
  PAUSED_HINT_AFTER_FAILURES,
  DEFAULT_PET_SLUG,
} from './constants.js';
import {
  guardState,
  armedLabel,
  armedAnnouncement,
  formatRelative,
  formatTime,
  feedDayKey,
  deleteConsequence,
  newFeedId,
  petSlugFromLocation,
} from './logic.js';
import * as api from './api.js';
import * as storage from './storage.js';
import {
  announce,
  onFocusRefresh,
  createFeedRow,
  renderErrorPanel,
  showBanner,
  hideBanner,
  errorBodyLines,
  icon,
  COPY,
  renderPetPicker,
} from './ui.js';

// D6 polish: not a contract.md §7.1 constant (it governs no server behavior) — just how long
// the row's "This feed was deleted." message (design.md §3.6b) gets to sit on screen before the
// follow-up background refresh is allowed to drop the row, so it's actually readable rather
// than disappearing within one GET round-trip.
const EDIT_DELETED_MESSAGE_DELAY_MS = 1200;

// ---- DOM references -------------------------------------------------------------------------
const petPickerEl = document.getElementById('pet-picker');
const petNameEl = document.getElementById('pet-name');
const taglineEl = document.getElementById('tagline');
const dataBlockEl = document.getElementById('data-block');
const errorBlockEl = document.getElementById('error-block');
const headlineLabelEl = document.getElementById('headline-label');
const headlineValueEl = document.getElementById('headline-value');
const counterEl = document.getElementById('counter');
const recentSectionEl = document.getElementById('recent-section');
const recentListEl = document.getElementById('recent-list');
const recentEmptyEl = document.getElementById('recent-empty');
const logButtonEl = document.getElementById('log-button');
const undoNoticeEl = document.getElementById('undo-notice');
const refreshBannerEl = document.getElementById('refresh-banner');
const nameCardEl = document.getElementById('name-card');
const nameCardTitleEl = document.getElementById('name-card-title-text');
const nameInputEl = document.getElementById('name-input');
const nameSaveEl = document.getElementById('name-save');
const nameSkipEl = document.getElementById('name-skip');
const footerEl = document.getElementById('footer');

// ---- In-memory state (architecture.md §4) ----------------------------------------------------
const state = {
  pet: null, // resolved once per page load from the URL + getPets()
  pets: [],
  recent: [],
  todayCount: 0,
  loadedAt: 0,
  loadedDayKey: '', // a *feed-day* key (v1.1, contract.md §7.6)
  loadStatus: 'loading', // 'loading' | 'ready' | 'error'
  hasLoadedOnce: false,
  lastError: null,
  button: 'loading',
  checkingStyle: 'ready',
  currentGuard: null,
  pendingLog: null,
  armTimer: null,
  undo: null, // { feed, status: 'shown'|'undoing'|'removed'|'failed', timer }
  consecutiveFailures: 0,
};

function incrementFailure() {
  state.consecutiveFailures += 1;
}
function resetFailure() {
  state.consecutiveFailures = 0;
}

function textNode(t) {
  return document.createTextNode(t);
}

function isFeedToday(feed, now) {
  return feedDayKey(new Date(feed.created_at)) === feedDayKey(now);
}

// ---- Headline / counter / recent list ---------------------------------------------------------
function renderHeadline(now) {
  const last = state.recent[0];
  if (!last) {
    headlineLabelEl.hidden = true;
    headlineValueEl.classList.add('value--empty');
    headlineValueEl.classList.remove('value--placeholder');
    headlineValueEl.textContent = 'No feeds logged yet';
    return;
  }
  headlineLabelEl.hidden = false;
  headlineValueEl.classList.remove('value--empty', 'value--placeholder');
  const elapsed = Math.max(0, now.getTime() - Date.parse(last.created_at));
  headlineValueEl.textContent = formatRelative(elapsed);
}

function renderCounter() {
  const n = state.todayCount;
  const warn = n >= DAILY_FEED_TARGET;
  counterEl.classList.remove('counter--loading');
  counterEl.classList.toggle('counter--warn', warn);
  counterEl.textContent = '';
  if (warn) counterEl.appendChild(icon('warning'));
  counterEl.appendChild(textNode(`${n} of ${DAILY_FEED_TARGET} today`));
  if (warn) {
    const sr = document.createElement('span');
    sr.className = 'visually-hidden';
    sr.textContent = ', daily limit reached';
    counterEl.appendChild(sr);
  }
}

function renderPlaceholderRows() {
  recentListEl.textContent = '';
  recentEmptyEl.hidden = true;
  for (let i = 0; i < RECENT_LIST_SIZE; i++) {
    const li = document.createElement('li');
    li.className = 'row row--placeholder';
    recentListEl.appendChild(li);
  }
}

function focusAfterDelete(targetIndex) {
  const deleteButtons = recentListEl.querySelectorAll('.row__delete');
  if (deleteButtons[targetIndex]) {
    deleteButtons[targetIndex].focus();
    return;
  }
  if (deleteButtons.length > 0) {
    deleteButtons[deleteButtons.length - 1].focus();
    return;
  }
  const heading = document.getElementById('recent-heading');
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    heading.focus();
  }
}

function focusEditButtonAfterSave(targetIndex) {
  const editButtons = recentListEl.querySelectorAll('.row__edit');
  if (editButtons[targetIndex]) editButtons[targetIndex].focus();
}

/**
 * Removes `feed` from local state (recent list + today's count) and re-renders immediately,
 * without waiting on a server refetch. A successful soft-delete/undo must not depend on the
 * follow-up GET also succeeding — if that GET fails, the feed must not linger on screen, the
 * headline/counter must already reflect the removal, and a recent-feed guard from that exact
 * feed must already be gone (AC-10.3, AC-9.2, AC-7.8). Mirrors history.js's delete pattern.
 * @param {{id: string, created_at: string}} feed
 * @param {Date} now
 */
function applyLocalRemoval(feed, now) {
  state.recent = state.recent.filter((f) => f.id !== feed.id);
  if (isFeedToday(feed, now)) {
    state.todayCount = Math.max(0, state.todayCount - 1);
  }
  if (['loading', 'ready', 'guarded', 'load-failed'].includes(state.button)) {
    state.button = idleButtonFromGuard(now);
    state.currentGuard = null;
  }
  renderDataBlock(now);
  renderButtonLabel(now);
}

async function deleteFeed(id) {
  const targetIndex = state.recent.findIndex((f) => f.id === id);
  const removedFeed = state.recent[targetIndex];
  const result = await api.softDeleteFeed(id);
  resetFailure();
  if (removedFeed) applyLocalRemoval(removedFeed, new Date());
  announce('Feed deleted');
  focusAfterDelete(targetIndex);
  // Background sync only — the visible removal above already happened locally, so a failed
  // refetch here just shows the refresh banner (S4) rather than leaving a stale feed on screen.
  refresh({ background: true }).catch(() => {});
  return result;
}

/**
 * Saves a corrected time for `feed` (v1.2, contract.md §6.H). On a normal success, applies the
 * update locally and re-renders through the exact same renderDataBlock()/renderButtonLabel()
 * path already used after a delete (AC-21.3) — no new partial-render logic. On `alreadyDeleted`,
 * deliberately does NOT touch state or re-render synchronously (so the row's own "This feed was
 * deleted." message, design.md §3.6b, is actually visible for a moment) and instead only kicks
 * the same background refresh a delete already triggers, which will drop the row once it lands.
 * @param {{id: string, created_at: string}} feed - the feed as it was *before* this edit
 * @param {string} newIso
 */
async function editFeedTime(feed, newIso) {
  const result = await api.updateFeedTime(feed.id, newIso);
  resetFailure();
  if (result.alreadyDeleted) {
    announce('This feed was deleted');
    // Delayed on purpose (D6) — give the row's own message a real reading window before the
    // background refresh (which would otherwise land within one GET round-trip) drops the row.
    setTimeout(() => {
      refresh({ background: true }).catch(() => {});
    }, EDIT_DELETED_MESSAGE_DELAY_MS);
    return result;
  }
  const now = new Date();
  const wasToday = isFeedToday(feed, now);
  const isNowToday = isFeedToday(result, now);
  state.recent = state.recent
    .map((f) => (f.id === result.id ? result : f))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  if (wasToday && !isNowToday) state.todayCount = Math.max(0, state.todayCount - 1);
  else if (!wasToday && isNowToday) state.todayCount += 1;
  if (['loading', 'ready', 'guarded', 'load-failed'].includes(state.button)) {
    state.button = idleButtonFromGuard(now);
    state.currentGuard = null;
  }
  renderDataBlock(now);
  renderButtonLabel(now);
  announce('Feed time updated');
  // The re-sort above may have moved the edited feed, so focus its NEW position, not wherever
  // it used to sit in the (now stale) pre-edit order.
  focusEditButtonAfterSave(state.recent.findIndex((f) => f.id === result.id));
  // Background sync only — see deleteFeed's own note above; the same reconciliation pattern.
  refresh({ background: true }).catch(() => {});
  return result;
}

function renderRecentList(now) {
  recentListEl.textContent = '';
  if (state.recent.length === 0) {
    recentEmptyEl.hidden = false;
    recentEmptyEl.textContent = `When ${state.pet.name} gets fed, tap the button below.`;
    return;
  }
  recentEmptyEl.hidden = true;
  for (const feed of state.recent) {
    const { element } = createFeedRow({
      feed,
      now,
      timeOnly: false,
      getConsequence: () => deleteConsequence(feed, state.recent, state.todayCount, new Date()),
      onConfirmDelete: (id) => deleteFeed(id),
      onConfirmEdit: (id, newIso) => editFeedTime(feed, newIso),
    });
    recentListEl.appendChild(element);
  }
}

function renderDataBlock(now) {
  if (state.loadStatus === 'loading' && !state.hasLoadedOnce) {
    headlineLabelEl.hidden = true;
    headlineValueEl.classList.add('value--placeholder');
    headlineValueEl.textContent = '';
    counterEl.classList.add('counter--loading');
    counterEl.classList.remove('counter--warn');
    counterEl.textContent = `– of ${DAILY_FEED_TARGET} today`;
    recentSectionEl.setAttribute('aria-busy', 'true');
    renderPlaceholderRows();
    return;
  }
  recentSectionEl.setAttribute('aria-busy', state.loadStatus === 'loading' ? 'true' : 'false');
  renderHeadline(now);
  renderCounter();
  renderRecentList(now);
}

// ---- Error block (S3) and refresh banner (S4) --------------------------------------------------
function renderErrorBlock() {
  dataBlockEl.hidden = true;
  errorBlockEl.hidden = false;
  const showPaused = state.consecutiveFailures >= PAUSED_HINT_AFTER_FAILURES && navigator.onLine !== false;
  renderErrorPanel(errorBlockEl, {
    title: COPY.loadErrorTitle,
    bodyLines: errorBodyLines(state.lastError, showPaused),
  });
}

// ---- Log button -----------------------------------------------------------------------------
function idleButtonFromGuard(now) {
  const g = guardState(now, state.recent[0], state.todayCount);
  return g.guarded ? 'guarded' : 'ready';
}

function renderButtonLabel(now) {
  const btn = logButtonEl;
  const s = state.button;
  const visualStyle = s === 'checking' ? state.checkingStyle : s;
  btn.className = `log-button log-button--${visualStyle}${s === 'checking' ? ' is-checking' : ''}`;
  btn.disabled = s === 'loading' || s === 'checking' || s === 'saving' || s === 'logged';
  btn.textContent = '';

  switch (s) {
    case 'loading':
      btn.textContent = 'Loading…';
      break;
    case 'ready':
    case 'guarded':
      btn.textContent = 'Log a feed';
      break;
    case 'checking':
      btn.append(icon('spinner', 'spin'), textNode(' Checking…'));
      break;
    case 'armed': {
      const g = state.currentGuard || guardState(now, state.recent[0], state.todayCount);
      btn.append(textNode(armedLabel(g, state.todayCount)));
      const bar = document.createElement('span');
      bar.className = 'log-button__bar';
      btn.appendChild(bar);
      break;
    }
    case 'saving':
      btn.append(icon('spinner', 'spin'), textNode(' Saving…'));
      break;
    case 'logged':
      btn.append(icon('check'), textNode(' Logged'));
      break;
    case 'not-saved':
      btn.textContent = 'Not saved, tap to retry';
      break;
    case 'load-failed':
      btn.textContent = 'Try again';
      break;
    default:
      break;
  }
}

function clearArmTimer() {
  if (state.armTimer) {
    clearTimeout(state.armTimer);
    state.armTimer = null;
  }
}

function startArmTimer() {
  clearArmTimer();
  state.armTimer = setTimeout(() => {
    state.armTimer = null;
    const now = new Date();
    state.button = idleButtonFromGuard(now);
    state.currentGuard = null;
    renderButtonLabel(now);
  }, ARM_TIMEOUT_MS);
}

function newAttempt() {
  return { id: newFeedId(), petId: state.pet.id, logged_by: storage.getName() };
}

async function save(attempt) {
  state.pendingLog = attempt;
  state.button = 'saving';
  renderButtonLabel(new Date());
  announce('Saving');
  try {
    const row = await api.logFeed(attempt);
    resetFailure();
    state.pendingLog = null;
    state.recent = [row, ...state.recent.filter((f) => f.id !== row.id)].slice(0, RECENT_LIST_SIZE);
    if (isFeedToday(row, new Date())) state.todayCount += 1;
    state.button = 'logged';
    state.currentGuard = null;
    const now = new Date();
    renderDataBlock(now);
    renderButtonLabel(now);
    showUndoNotice(row);
    announce(`Logged at ${formatTime(new Date(row.created_at))}. Undo available for ${UNDO_WINDOW_MS / 1000} seconds.`);
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(30);
    }
    setTimeout(() => {
      if (state.button === 'logged') {
        const later = new Date();
        state.button = idleButtonFromGuard(later);
        renderButtonLabel(later);
      }
    }, LOGGED_FLASH_MS);
    refresh({ background: true }).catch(() => {});
  } catch (err) {
    incrementFailure();
    state.button = 'not-saved';
    renderButtonLabel(new Date());
    announce('Not saved. Tap to retry.');
  }
}

async function onLogTap() {
  const b = state.button;
  if (b === 'loading' || b === 'checking' || b === 'saving' || b === 'logged') return;
  if (b === 'load-failed') {
    refresh({ background: false });
    return;
  }
  if (b === 'armed') {
    clearArmTimer();
    await save(newAttempt());
    return;
  }
  if (b === 'not-saved' && state.pendingLog) {
    await save(state.pendingLog);
    return;
  }
  // 'ready', 'guarded', or 'not-saved' caused by a failed freshness check (pendingLog is null):
  if (Date.now() - state.loadedAt > STALE_AFTER_MS) {
    state.checkingStyle = b === 'not-saved' ? 'not-saved' : b;
    state.button = 'checking';
    renderButtonLabel(new Date());
    const ok = await refresh({ background: false });
    if (!ok) {
      state.button = 'not-saved';
      state.pendingLog = null;
      renderButtonLabel(new Date());
      announce('Not saved. Tap to retry.');
      return;
    }
  }
  const now = new Date();
  const g = guardState(now, state.recent[0], state.todayCount);
  if (g.guarded) {
    state.button = 'armed';
    state.currentGuard = g;
    startArmTimer();
    renderButtonLabel(now);
    announce(armedAnnouncement(g, state.todayCount, state.pet.name));
    return;
  }
  await save(newAttempt());
}

function onVisibilityChange() {
  if (document.visibilityState === 'hidden' && state.button === 'armed') {
    clearArmTimer();
    const now = new Date();
    state.button = idleButtonFromGuard(now);
    state.currentGuard = null;
    renderButtonLabel(now);
  }
}

// ---- Undo notice (design.md §3.5) ------------------------------------------------------------
function clearUndoTimer() {
  if (state.undo && state.undo.timer) {
    clearTimeout(state.undo.timer);
    state.undo.timer = null;
  }
}

function renderUndoNotice() {
  undoNoticeEl.textContent = '';
  if (!state.undo) {
    undoNoticeEl.hidden = true;
    return;
  }
  undoNoticeEl.hidden = false;
  const { feed, status } = state.undo;

  if (status === 'shown') {
    const text = document.createElement('span');
    text.className = 'undo-notice__text';
    text.textContent = `Logged ${formatTime(new Date(feed.created_at))}`;
    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'undo-notice__action';
    undoBtn.textContent = 'Undo';
    undoBtn.addEventListener('click', onUndoTap);
    const bar = document.createElement('span');
    bar.className = 'undo-notice__bar';
    undoNoticeEl.append(text, undoBtn, bar);
    return;
  }
  if (status === 'undoing') {
    undoNoticeEl.textContent = 'Undoing…';
    return;
  }
  if (status === 'removed') {
    undoNoticeEl.textContent = 'Feed removed';
    return;
  }
  if (status === 'failed') {
    const text = document.createElement('span');
    text.className = 'undo-notice__text undo-notice__text--warn';
    text.textContent = "Couldn't undo";
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'btn btn--warn-outline';
    retryBtn.textContent = 'Retry';
    retryBtn.addEventListener('click', onUndoTap);
    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'undo-notice__dismiss';
    dismissBtn.setAttribute('aria-label', 'Dismiss');
    dismissBtn.textContent = '✕';
    dismissBtn.addEventListener('click', () => hideUndoNotice());
    undoNoticeEl.append(text, retryBtn, dismissBtn);
  }
}

function hideUndoNotice() {
  clearUndoTimer();
  state.undo = null;
  renderUndoNotice();
}

function showUndoNotice(feed) {
  clearUndoTimer();
  state.undo = { feed, status: 'shown', timer: null };
  renderUndoNotice();
  state.undo.timer = setTimeout(hideUndoNotice, UNDO_WINDOW_MS);
}

async function onUndoTap() {
  if (!state.undo) return;
  clearUndoTimer();
  const { feed } = state.undo;
  state.undo.status = 'undoing';
  renderUndoNotice();
  try {
    await api.softDeleteFeed(feed.id);
    resetFailure();
    state.undo.status = 'removed';
    renderUndoNotice();
    applyLocalRemoval(feed, new Date());
    announce('Feed removed');
    setTimeout(() => {
      if (state.undo && state.undo.status === 'removed') hideUndoNotice();
    }, REMOVED_NOTICE_MS);
    // Background sync only — see applyLocalRemoval's note on deleteFeed.
    refresh({ background: true }).catch(() => {});
  } catch {
    incrementFailure();
    if (state.undo) {
      state.undo.status = 'failed';
      renderUndoNotice();
    }
  }
}

// ---- Name card and footer (design.md §3.7) ----------------------------------------------------
function updateSaveDisabled() {
  nameSaveEl.disabled = nameInputEl.value.trim().length === 0;
}

function openNameCard() {
  nameInputEl.value = storage.getName() || '';
  updateSaveDisabled();
  nameCardEl.hidden = false;
  nameInputEl.focus();
}

function closeNameCard() {
  nameCardEl.hidden = true;
}

function renderFooter() {
  footerEl.textContent = '';
  const name = storage.getName();
  const label = document.createElement('span');
  label.textContent = name ? `Logging as ${name}` : 'No name on this phone';
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'footer__link';
  link.textContent = name ? 'Change' : 'Set name';
  link.addEventListener('click', openNameCard);
  footerEl.append(label, textNode(' · '), link);
}

function initNameCard() {
  if (nameCardTitleEl) nameCardTitleEl.textContent = `Who's feeding ${state.pet.name}?`;
  nameInputEl.value = storage.getName() || '';
  updateSaveDisabled();
  nameCardEl.hidden = storage.isNamePromptDone();
  nameInputEl.addEventListener('input', updateSaveDisabled);
  nameInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !nameSaveEl.disabled) {
      e.preventDefault();
      nameSaveEl.click();
    }
  });
  nameSaveEl.addEventListener('click', () => {
    storage.setName(nameInputEl.value);
    storage.setNamePromptDone();
    closeNameCard();
    renderFooter();
  });
  nameSkipEl.addEventListener('click', () => {
    storage.setNamePromptDone();
    closeNameCard();
    renderFooter();
  });
  renderFooter();
}

// ---- Full render / refresh --------------------------------------------------------------------
function renderAll(now) {
  if (state.loadStatus === 'error' && !state.hasLoadedOnce) {
    renderErrorBlock();
  } else {
    dataBlockEl.hidden = false;
    errorBlockEl.hidden = true;
    errorBlockEl.textContent = '';
    renderDataBlock(now);
  }
  renderButtonLabel(now);
}

async function refresh({ background }) {
  if (!background) {
    state.loadStatus = 'loading';
    if (!state.hasLoadedOnce) state.button = 'loading';
    renderAll(new Date());
  }
  try {
    const data = await api.getHomeData(new Date(), state.pet.id);
    resetFailure();
    state.recent = data.recent;
    state.todayCount = data.todayCount;
    state.loadedAt = data.loadedAt;
    state.loadedDayKey = feedDayKey(new Date());
    state.loadStatus = 'ready';
    state.hasLoadedOnce = true;
    state.lastError = null;
    hideBanner(refreshBannerEl);
    const now = new Date();
    // Only recompute the button from a truly idle state. A background refresh (from focus,
    // the 3 AM tick, or an unrelated undo/delete) must never clobber 'armed' (an open
    // confirmation), 'not-saved' (a pending retry that still owns an id — losing this would
    // risk a duplicate feed if the retry then used a fresh id), 'saving', 'checking' or 'logged'.
    if (['loading', 'ready', 'guarded', 'load-failed'].includes(state.button)) {
      state.button = idleButtonFromGuard(now);
      state.currentGuard = null;
    }
    // D6: an unrelated background refresh (tick/focus/another row's own action) must not yank
    // away a row's open Edit or Delete flow mid-interaction. State above is still kept fresh;
    // only the visible rebuild is skipped, and the next refresh (there's always another one
    // along shortly) picks it up once every row is back to normal.
    if (background && recentListEl.querySelector('[data-row-open]')) {
      return true;
    }
    renderAll(now);
    return true;
  } catch (err) {
    incrementFailure();
    state.lastError = err;
    if (!state.hasLoadedOnce) {
      state.loadStatus = 'error';
      state.button = 'load-failed';
      renderAll(new Date());
    } else {
      showBanner(
        refreshBannerEl,
        `${COPY.refreshBannerPrefix}${formatTime(new Date(state.loadedAt))}.`,
        () => refresh({ background: false })
      );
    }
    return false;
  }
}

// ---- 30 s tick (architecture.md §4) -------------------------------------------------------------
function tick() {
  const now = new Date();
  if (state.button === 'ready' || state.button === 'guarded') {
    state.button = idleButtonFromGuard(now);
  }
  if (state.hasLoadedOnce) renderHeadline(now);
  renderButtonLabel(now);
  if (state.hasLoadedOnce && feedDayKey(now) !== state.loadedDayKey) {
    refresh({ background: false });
  }
}

// ---- Pet resolution (v1.1, contract.md §7.10) --------------------------------------------------
function renderPetLoadError(err) {
  dataBlockEl.hidden = true;
  errorBlockEl.hidden = false;
  // No buttonText/onButtonClick here — the Log button (below) is the only retry control, same
  // as renderErrorBlock()'s pre-v1.1 pattern. Passing a panel button too would show two live
  // "Try again" buttons at once.
  renderErrorPanel(errorBlockEl, {
    title: COPY.loadErrorTitle,
    bodyLines: errorBodyLines(err, false),
  });
  logButtonEl.textContent = 'Try again';
  logButtonEl.className = 'log-button log-button--load-failed';
  logButtonEl.disabled = false;
  logButtonEl.onclick = () => initPet();
}

async function initPet() {
  try {
    const pets = await api.getPets();
    state.pets = pets;
    const slug = petSlugFromLocation(location.search, pets);
    state.pet =
      pets.find((p) => p.slug === slug) || pets.find((p) => p.slug === DEFAULT_PET_SLUG) || pets[0];

    renderPetPicker(petPickerEl, { pets, selectedSlug: state.pet.slug });
    petNameEl.textContent = state.pet.name;
    // design.md §1's "Don't trust the meows." is cat-specific copy — a dog (e.g. Banh Mi)
    // gets a species-appropriate variant of the same joke instead of the literal cat line.
    if (taglineEl) {
      taglineEl.textContent =
        state.pet.species === 'dog' ? "Don't trust the puppy-dog eyes." : "Don't trust the meows.";
    }
    logButtonEl.onclick = null;

    initNameCard();
    logButtonEl.addEventListener('click', onLogTap);
    document.addEventListener('visibilitychange', onVisibilityChange);
    onFocusRefresh(() => refresh({ background: true }));
    refresh({ background: false });
    setInterval(tick, TICK_MS);
  } catch (err) {
    renderPetLoadError(err);
  }
}

// ---- Init -----------------------------------------------------------------------------------
initPet();
