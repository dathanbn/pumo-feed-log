// Pumo Feed Log: history screen controller. Day groups with counts, paging, delete confirmation,
// and a focus refresh that reloads the first page and drops older pages. (architecture.md §4)

import { PAUSED_HINT_AFTER_FAILURES } from './constants.js';
import { dayKey, groupByDay, deleteConsequence, formatTime } from './logic.js';
import * as api from './api.js';
import { announce, onFocusRefresh, createFeedRow, renderErrorPanel, showBanner, hideBanner, errorBodyLines, COPY } from './ui.js';

const historyBodyEl = document.getElementById('history-body');
const showOlderBtn = document.getElementById('show-older');
const olderErrorEl = document.getElementById('older-error');
const refreshBannerEl = document.getElementById('refresh-banner');

const state = {
  feeds: [], // all loaded live feeds, newest first
  hasMore: false,
  loadStatus: 'loading', // 'loading' | 'ready' | 'error'
  hasLoadedOnce: false,
  lastError: null,
  olderLoading: false,
  consecutiveFailures: 0,
  loadedAt: 0,
};

function incrementFailure() {
  state.consecutiveFailures += 1;
}
function resetFailure() {
  state.consecutiveFailures = 0;
}

function todayCountFromFeeds(feeds, now) {
  const today = dayKey(now);
  return feeds.filter((f) => dayKey(new Date(f.created_at)) === today).length;
}

// ---- Rendering --------------------------------------------------------------------------------
function renderSkeleton() {
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
  historyBodyEl.setAttribute('aria-busy', 'false');
  historyBodyEl.textContent = '';
  const p = document.createElement('p');
  p.className = 'history-empty';
  p.textContent = COPY.historyEmpty;
  historyBodyEl.appendChild(p);
  showOlderBtn.hidden = true;
}

function renderError() {
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

async function deleteFeed(id) {
  const targetIndex = state.feeds.findIndex((f) => f.id === id);
  const result = await api.softDeleteFeed(id);
  resetFailure();
  state.feeds = state.feeds.filter((f) => f.id !== id);
  announce('Feed deleted');
  renderGroups(new Date());
  focusAfterDelete(targetIndex);
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
  if (state.feeds.length === 0) {
    renderEmpty();
    return;
  }
  renderGroups(new Date());
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
  retryBtn.addEventListener('click', loadOlder);
  olderErrorEl.append(text, retryBtn);
}

// ---- Loading ------------------------------------------------------------------------------------
async function loadFirstPage({ background }) {
  if (!background) {
    state.loadStatus = 'loading';
    render();
  }
  try {
    const { feeds, hasMore } = await api.getHistoryPage({});
    resetFailure();
    state.feeds = feeds;
    state.hasMore = hasMore;
    state.loadStatus = 'ready';
    state.hasLoadedOnce = true;
    state.lastError = null;
    state.loadedAt = Date.now();
    hideBanner(refreshBannerEl);
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

async function loadOlder() {
  if (state.olderLoading || state.feeds.length === 0) return;
  const oldest = state.feeds[state.feeds.length - 1];
  state.olderLoading = true;
  showOlderBtn.disabled = true;
  showOlderBtn.textContent = 'Loading…';
  olderErrorEl.hidden = true;
  try {
    const { feeds, hasMore } = await api.getHistoryPage({ before: oldest.created_at });
    resetFailure();
    state.feeds = [...state.feeds, ...feeds];
    state.hasMore = hasMore;
    state.olderLoading = false;
    showOlderBtn.disabled = false;
    showOlderBtn.textContent = 'Show older feeds';
    render();
  } catch {
    incrementFailure();
    state.olderLoading = false;
    showOlderBtn.disabled = false;
    showOlderBtn.textContent = 'Show older feeds';
    renderOlderError();
  }
}

// ---- Init -----------------------------------------------------------------------------------
function init() {
  showOlderBtn.addEventListener('click', loadOlder);
  onFocusRefresh(() => loadFirstPage({ background: true }));
  loadFirstPage({ background: false });
}

init();
