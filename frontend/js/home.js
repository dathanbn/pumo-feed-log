// Pumo Feed Log: home screen controller. Owns the button state machine, the 30 s tick, the
// undo notice, and the name card/footer. (architecture.md §4, design.md §3, spec.md F2-F11,14)

import { PUMO_PHOTO_URL } from './config.js';
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
} from './constants.js';
import { guardState, armedLabel, armedAnnouncement, formatRelative, formatTime, dayKey, deleteConsequence, newFeedId } from './logic.js';
import * as api from './api.js';
import * as storage from './storage.js';
import { announce, onFocusRefresh, createFeedRow, renderErrorPanel, showBanner, hideBanner, errorBodyLines, icon, COPY } from './ui.js';

// ---- DOM references -------------------------------------------------------------------------
const avatarEl = document.getElementById('avatar');
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
const nameInputEl = document.getElementById('name-input');
const nameSaveEl = document.getElementById('name-save');
const nameSkipEl = document.getElementById('name-skip');
const footerEl = document.getElementById('footer');

// ---- In-memory state (architecture.md §4) ----------------------------------------------------
const state = {
  recent: [],
  todayCount: 0,
  loadedAt: 0,
  loadedDayKey: '',
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
  return dayKey(new Date(feed.created_at)) === dayKey(now);
}

// ---- Avatar -----------------------------------------------------------------------------------
function setAvatar() {
  avatarEl.textContent = '';
  const img = document.createElement('img');
  img.className = 'avatar__img';
  if (PUMO_PHOTO_URL) {
    img.src = PUMO_PHOTO_URL;
    img.alt = 'Pumo';
  } else {
    img.src = 'assets/icon.svg';
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
  }
  avatarEl.appendChild(img);
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

async function deleteFeed(id) {
  const targetIndex = state.recent.findIndex((f) => f.id === id);
  const result = await api.softDeleteFeed(id);
  resetFailure();
  announce('Feed deleted');
  await refresh({ background: false });
  focusAfterDelete(targetIndex);
  return result;
}

function renderRecentList(now) {
  recentListEl.textContent = '';
  if (state.recent.length === 0) {
    recentEmptyEl.hidden = false;
    recentEmptyEl.textContent = COPY.recentEmpty;
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
  return { id: newFeedId(), logged_by: storage.getName() };
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
    announce(armedAnnouncement(g, state.todayCount));
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
    announce('Feed removed');
    setTimeout(() => {
      if (state.undo && state.undo.status === 'removed') hideUndoNotice();
    }, REMOVED_NOTICE_MS);
    await refresh({ background: false });
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
    const data = await api.getHomeData(new Date());
    resetFailure();
    state.recent = data.recent;
    state.todayCount = data.todayCount;
    state.loadedAt = data.loadedAt;
    state.loadedDayKey = dayKey(new Date());
    state.loadStatus = 'ready';
    state.hasLoadedOnce = true;
    state.lastError = null;
    hideBanner(refreshBannerEl);
    const now = new Date();
    // Only recompute the button from a truly idle state. A background refresh (from focus,
    // the midnight tick, or an unrelated undo/delete) must never clobber 'armed' (an open
    // confirmation), 'not-saved' (a pending retry that still owns an id — losing this would
    // risk a duplicate feed if the retry then used a fresh id), 'saving', 'checking' or 'logged'.
    if (['loading', 'ready', 'guarded', 'load-failed'].includes(state.button)) {
      state.button = idleButtonFromGuard(now);
      state.currentGuard = null;
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
  if (state.hasLoadedOnce && dayKey(now) !== state.loadedDayKey) {
    refresh({ background: false });
  }
}

// ---- Init -----------------------------------------------------------------------------------
function init() {
  setAvatar();
  initNameCard();
  logButtonEl.addEventListener('click', onLogTap);
  document.addEventListener('visibilitychange', onVisibilityChange);
  onFocusRefresh(() => refresh({ background: true }));
  refresh({ background: false });
  setInterval(tick, TICK_MS);
}

init();
