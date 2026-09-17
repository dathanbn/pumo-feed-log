// Pumo Feed Log: shared DOM helpers. Owns the status region, focus-refresh wiring, the shared
// feed-row component with inline delete confirmation, and error panels/banners.
// Never assigns feed or name data through innerHTML — always textContent. (architecture.md §4)

import { FOCUS_REFRESH_DEBOUNCE_MS } from './constants.js';
import { formatTime, formatFeedLabel, deleteAriaLabel } from './logic.js';

// ---- Icons -----------------------------------------------------------------
// Static, trusted, hand-written SVG markup only. Never combined with feed or user data.
const ICONS = {
  trash:
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>',
  warning:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 22 20H2L12 3.5Z"/><path d="M12 10v4"/><path d="M12 17.2v.01"/></svg>',
  check:
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5.5 5.5L20 6"/></svg>',
  chevron:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  spinner:
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><circle cx="12" cy="12" r="9" opacity="0.25"/><path d="M21 12a9 9 0 0 0-9-9"/></svg>',
};

/**
 * A static, trusted icon wrapped in an aria-hidden span. `name` must be a key of ICONS —
 * this never receives feed or user-supplied text.
 * @param {'trash'|'warning'|'check'|'chevron'|'spinner'} name
 * @param {string} [extraClass]
 * @returns {HTMLElement}
 */
export function icon(name, extraClass) {
  const span = document.createElement('span');
  span.className = extraClass ? `icon icon--${name} ${extraClass}` : `icon icon--${name}`;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = ICONS[name] || '';
  return span;
}

// ---- Copy (design.md §5), centralized so home.js and history.js share one source -----------
export const COPY = {
  offlineBody: "You're offline. Connect to Wi-Fi or data, then try again.",
  unreachableBody: "Can't reach the feed log right now.",
  pausedHint:
    "Still can't connect. If nobody has opened the app for a week, the database may be paused. It can be unpaused from the Supabase dashboard, and no feeds are lost.",
  loadErrorTitle: "Can't load feeds",
  historyLoadErrorTitle: "Can't load history.",
  historyEmpty: 'No feeds logged yet.',
  olderPageError: "Couldn't load older feeds.",
  recentEmpty: 'When Pumo gets fed, tap the button below.',
  refreshBannerPrefix: "Couldn't refresh. Showing feeds as of ",
};

/**
 * The body-text lines for an error panel (S3/S11), given the failure and whether the
 * "database may be paused" hint should show (>= PAUSED_HINT_AFTER_FAILURES, while online).
 * @param {{kind?: string}} err
 * @param {boolean} showPausedHint
 * @returns {string[]}
 */
export function errorBodyLines(err, showPausedHint) {
  const lines = [err && err.kind === 'offline' ? COPY.offlineBody : COPY.unreachableBody];
  if (showPausedHint) lines.push(COPY.pausedHint);
  return lines;
}

// ---- Status region (one visually-hidden role="status" per page) ----------------------------

/**
 * Announces `text` in the page's aria-live status region. The region must already exist in the
 * page's HTML at load (design.md §7: "one region per page") — creating it here on first use, in
 * the same task as the announcement, is what some screen readers drop. `announce()` only ever
 * reuses that existing node.
 * @param {string} text
 */
export function announce(text) {
  const el = document.getElementById('status-region');
  if (!el) return;
  // Clear-then-set so identical consecutive messages still get announced.
  el.textContent = '';
  void el.offsetHeight;
  el.textContent = text;
}

// ---- Focus / visibility refresh -------------------------------------------------------------

/**
 * Calls `cb` on visibilitychange→visible, window focus, and pageshow, debounced by
 * FOCUS_REFRESH_DEBOUNCE_MS and skipped while a previous call is still in flight.
 * @param {() => Promise<any>|any} cb
 */
export function onFocusRefresh(cb) {
  let inFlight = false;
  // Start the debounce window now, not at 0: the caller (home.js/history.js init) makes its own
  // initial load call right around when this registers, and `pageshow` fires on every page load
  // (not just a back-forward-cache restore) — with lastCall at 0, that first pageshow would
  // always look "stale enough" and fire a second, redundant fetch a moment after the real one.
  let lastCall = Date.now();

  const trigger = () => {
    if (inFlight) return;
    const now = Date.now();
    if (now - lastCall < FOCUS_REFRESH_DEBOUNCE_MS) return;
    lastCall = now;
    inFlight = true;
    Promise.resolve()
      .then(cb)
      .catch(() => {})
      .finally(() => {
        inFlight = false;
      });
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') trigger();
  });
  window.addEventListener('focus', trigger);
  // A plain (non-bfcache) page load also fires pageshow — that one is always redundant with the
  // caller's own initial load, so only a genuine back-forward-cache restore should trigger here.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) trigger();
  });
}

// ---- Shared feed row, with inline delete confirmation (design.md §3.6) ---------------------

/** Tracks the single row allowed to be confirming at a time (AC-10.5). */
let openRowController = null;

/**
 * Builds a <li> feed row with an inline Delete control and confirmation flow.
 * @param {object} opts
 * @param {{id: string, created_at: string, logged_by: string|null}} opts.feed
 * @param {Date} opts.now - for label formatting
 * @param {boolean} opts.timeOnly - true on history (day is in the section heading already)
 * @param {() => string} opts.getConsequence - computes the delete-confirmation sentence on open
 * @param {(id: string) => Promise<{alreadyDeleted: boolean}>} opts.onConfirmDelete - performs the
 *   soft delete (and, on success, the caller's own refresh — this component doesn't refresh itself)
 * @param {() => void} [opts.onFocusFallback] - called after a successful delete to move focus
 *   somewhere sane, when the caller doesn't handle it via its own refresh-driven re-render
 * @returns {{ element: HTMLLIElement, closeConfirm: () => void }}
 */
export function createFeedRow({ feed, now, timeOnly, getConsequence, onConfirmDelete }) {
  const li = document.createElement('li');
  li.className = 'row';

  /** @type {'normal'|'confirming'|'deleting'|'failed'} */
  let state = 'normal';

  const controller = {
    close() {
      if (state !== 'normal') {
        state = 'normal';
        render();
      }
    },
  };

  function open() {
    if (openRowController && openRowController !== controller) {
      openRowController.close();
    }
    openRowController = controller;
    state = 'confirming';
    render();
  }

  function cancel() {
    state = 'normal';
    if (openRowController === controller) openRowController = null;
    render();
    const btn = li.querySelector('.row__delete');
    if (btn) btn.focus();
  }

  async function confirm() {
    state = 'deleting';
    render();
    try {
      await onConfirmDelete(feed.id);
      // Success: the caller's refresh() rebuilds the list. Nothing further to do here.
    } catch {
      state = 'failed';
      render();
    }
  }

  function onKeydown(e) {
    if (e.key === 'Escape' && (state === 'confirming' || state === 'failed')) {
      e.preventDefault();
      cancel();
    }
  }

  function render() {
    li.textContent = '';
    li.classList.toggle('row--confirm', state !== 'normal');

    if (state === 'normal') {
      const info = document.createElement('div');
      info.className = 'row__info';

      const line1 = document.createElement('p');
      line1.className = 'row__line1';
      const timeEl = document.createElement('time');
      timeEl.dateTime = feed.created_at;
      timeEl.textContent = timeOnly ? formatTime(new Date(feed.created_at)) : formatFeedLabel(feed, now);
      line1.appendChild(timeEl);

      const line2 = document.createElement('p');
      line2.className = 'row__line2';
      line2.textContent = `by ${feed.logged_by || 'Someone'}`;

      info.append(line1, line2);

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'row__delete';
      deleteBtn.setAttribute('aria-label', deleteAriaLabel(feed, now));
      deleteBtn.appendChild(icon('trash'));
      deleteBtn.addEventListener('click', open);

      li.append(info, deleteBtn);
      return;
    }

    const text = document.createElement('p');
    text.className = 'row__confirm-text';
    if (state === 'failed') {
      text.classList.add('row__confirm-text--warn');
      text.textContent = "Couldn't delete.";
    } else {
      text.textContent = getConsequence();
    }
    li.appendChild(text);

    if (state === 'deleting') {
      const status = document.createElement('p');
      status.className = 'row__deleting';
      status.textContent = 'Deleting…';
      li.appendChild(status);
      return;
    }

    const buttons = document.createElement('div');
    buttons.className = 'row__confirm-buttons';

    if (state === 'confirming') {
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn--outline';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', cancel);

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn btn--warn';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', confirm);

      buttons.append(cancelBtn, deleteBtn);
      li.appendChild(buttons);
      cancelBtn.focus();
    } else if (state === 'failed') {
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'btn btn--warn-outline';
      retryBtn.textContent = 'Retry';
      retryBtn.addEventListener('click', confirm);

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn--outline';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', cancel);

      buttons.append(retryBtn, cancelBtn);
      li.appendChild(buttons);
    }
  }

  li.addEventListener('keydown', onKeydown);
  render();

  return {
    element: li,
    closeConfirm: () => {
      if (openRowController === controller) openRowController = null;
      controller.close();
    },
  };
}

// ---- Error panel and refresh banner ---------------------------------------------------------

/**
 * Renders a --warn-soft error panel (S3/S11 style) into `container`, replacing its contents.
 * @param {HTMLElement} container
 * @param {{title: string, bodyLines: string[], buttonText?: string, onButtonClick?: () => void}} opts
 */
export function renderErrorPanel(container, { title, bodyLines, buttonText, onButtonClick }) {
  container.textContent = '';
  const panel = document.createElement('div');
  panel.className = 'panel panel--warn';

  const h = document.createElement('p');
  h.className = 'panel__title';
  h.textContent = title;
  panel.appendChild(h);

  for (const line of bodyLines) {
    const p = document.createElement('p');
    p.className = 'panel__body';
    p.textContent = line;
    panel.appendChild(p);
  }

  if (buttonText) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--accent';
    btn.textContent = buttonText;
    btn.addEventListener('click', onButtonClick);
    panel.appendChild(btn);
  }

  container.appendChild(panel);
  return panel;
}

/**
 * Shows the top "Couldn't refresh…" banner (S4) with a Retry action.
 * @param {HTMLElement} el
 * @param {string} message
 * @param {() => void} onRetry
 */
export function showBanner(el, message, onRetry) {
  el.textContent = '';
  el.hidden = false;
  const span = document.createElement('span');
  span.textContent = message;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'banner__retry';
  btn.textContent = 'Retry';
  btn.addEventListener('click', onRetry);
  el.append(span, btn);
}

/**
 * Hides and clears the refresh banner.
 * @param {HTMLElement} el
 */
export function hideBanner(el) {
  el.hidden = true;
  el.textContent = '';
}
