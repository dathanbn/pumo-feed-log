// Pumo Feed Log: shared DOM helpers. Owns the status region, focus-refresh wiring, the shared
// feed-row component with inline delete confirmation, and error panels/banners.
// Never assigns feed or name data through innerHTML — always textContent. (architecture.md §4)

import { FOCUS_REFRESH_DEBOUNCE_MS } from './constants.js';
import { formatTime, formatFeedLabel, deleteAriaLabel, editAriaLabel, pathForPet, computeEditedTimestamp } from './logic.js';

// ---- Icons -----------------------------------------------------------------
// Static, trusted, hand-written SVG markup only. Never combined with feed or user data.
const ICONS = {
  trash:
    '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/></svg>',
  // v1.2: the row's Edit control, next to trash — same viewBox/stroke conventions as trash above.
  pencil:
    '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l1-4.5L15.5 5l3.5 3.5L8.5 19 4 20z"/><path d="M13.5 6.5l3.5 3.5"/></svg>',
  // v1.2: the restyled CSV button's download-arrow icon (design.md §4.2) — same viewBox/stroke
  // conventions as trash above, sized down to sit inline with the button's short "CSV" label.
  download:
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="M7.5 11l4.5 4.5 4.5-4.5"/><path d="M5 20h14"/></svg>',
  warning:
    '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2.5L18 17H2z"/><path d="M10 8v4"/><circle cx="10" cy="14.3" r="0.6" fill="currentColor" stroke="none"/></svg>',
  check:
    '<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10.5l4 4 8-9"/></svg>',
  chevron:
    '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4l6 6-6 6"/></svg>',
  spinner:
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><circle cx="12" cy="12" r="9" opacity="0.25"/><path d="M21 12a9 9 0 0 0-9-9"/></svg>',
  // Decorative only (the design system's paw doodle) — never a control, never doubles as a
  // functional icon. Used once near "Last fed" and once on the name-prompt card.
  paw:
    '<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor"><ellipse cx="4.2" cy="7.8" rx="2.4" ry="3.1" transform="rotate(-16 4.2 7.8)"/><ellipse cx="8.1" cy="4.4" rx="2.6" ry="3.6" transform="rotate(-8 8.1 4.4)"/><ellipse cx="12.3" cy="4.4" rx="2.6" ry="3.6" transform="rotate(8 12.3 4.4)"/><ellipse cx="16.2" cy="7.8" rx="2.4" ry="3.1" transform="rotate(16 16.2 7.8)"/><path d="M10.2 9.4 C13.6 9.4 16.8 11.6 17 14.4 C17.2 16.6 15.8 18.2 13.6 18.6 C12.8 18.8 12 18.4 11.6 17.7 C11.4 18.4 11 18.8 10.2 18.8 C9.4 18.8 9 18.4 8.8 17.7 C8.4 18.4 7.6 18.8 6.8 18.6 C4.6 18.2 3.2 16.6 3.4 14.4 C3.6 11.6 6.8 9.4 10.2 9.4 Z"/></svg>',
};

/**
 * A static, trusted icon wrapped in an aria-hidden span. `name` must be a key of ICONS —
 * this never receives feed or user-supplied text.
 * @param {'trash'|'pencil'|'download'|'warning'|'check'|'chevron'|'spinner'|'paw'} name
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
  refreshBannerPrefix: "Couldn't refresh. Showing feeds as of ",
  // v1.3: csvButtonLabel/csvPreparing removed — the button dropped its visible text entirely
  // (icon only, design.md §4.2); the aria-label (set directly in history.js) is now its sole
  // accessible name, same string it always was.
  csvFailed: "Couldn't prepare the download.",
  heatmapLegend: ['0', '1', '2', '3', '4+'],
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

/** Tracks the single row allowed to be confirming/editing at a time (AC-10.5, AC-21.2). */
let openRowController = null;

/**
 * Local time, as an `<input type="time">` element's `.value` ("HH:MM", 24-hour, zero-padded).
 * @param {Date} date
 * @returns {string}
 */
function timeInputValue(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * Builds a <li> feed row with inline Edit and Delete controls, each with their own inline
 * confirmation/editor flow (design.md §3.6, §3.6b) sharing the single "one open row at a time"
 * controller (AC-10.5, AC-21.2).
 * @param {object} opts
 * @param {{id: string, created_at: string, logged_by: string|null}} opts.feed
 * @param {Date} opts.now - for label formatting
 * @param {boolean} opts.timeOnly - true on history (day is in the section heading already)
 * @param {() => string} opts.getConsequence - computes the delete-confirmation sentence on open
 * @param {(id: string) => Promise<{alreadyDeleted: boolean}>} opts.onConfirmDelete - performs the
 *   soft delete (and, on success, the caller's own refresh — this component doesn't refresh itself)
 * @param {(id: string, newIso: string) => Promise<object|{alreadyDeleted: true}>} opts.onConfirmEdit
 *   - performs the time PATCH (contract.md §6.H). On a normal success the caller re-renders the
 *   whole list itself (the same full render() path already used after a delete), so this
 *   component doesn't need to do anything further; on `{alreadyDeleted: true}` the caller does
 *   NOT re-render synchronously (so the row's own "This feed was deleted." message is actually
 *   visible for a beat) and this component shows that message locally instead.
 * @returns {{ element: HTMLLIElement, closeConfirm: () => void }}
 */
export function createFeedRow({ feed, now, timeOnly, getConsequence, onConfirmDelete, onConfirmEdit }) {
  const li = document.createElement('li');
  li.className = 'row';

  /** @type {'normal'|'confirming'|'deleting'|'failed'|'editing'|'saving-edit'|'edit-failed'|'edit-deleted'} */
  let state = 'normal';
  let editValue = ''; // the time input's current value, set fresh on open and kept across re-renders
  let editFutureRejected = false; // whether to show "Can't set a future time." above the buttons
  let pendingIso = null; // the last validated candidate iso, resent by Retry after a save failure

  const controller = {
    close() {
      if (state !== 'normal') {
        state = 'normal';
        render();
      }
    },
  };

  // ---- Delete flow (design.md §3.6) -----------------------------------------------------------
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

  // ---- Edit-time flow (design.md §3.6b, v1.2) -------------------------------------------------
  function openEdit() {
    if (openRowController && openRowController !== controller) {
      openRowController.close();
    }
    openRowController = controller;
    state = 'editing';
    editValue = timeInputValue(new Date(feed.created_at));
    editFutureRejected = false;
    pendingIso = null;
    render();
  }

  function cancelEdit() {
    state = 'normal';
    if (openRowController === controller) openRowController = null;
    render();
    const btn = li.querySelector('.row__edit');
    if (btn) btn.focus();
  }

  async function trySaveEdit() {
    state = 'saving-edit';
    render();
    try {
      const outcome = await onConfirmEdit(feed.id, pendingIso);
      if (outcome && outcome.alreadyDeleted) {
        // Deliberately no caller-side re-render here (see this function's own doc comment) —
        // show the message locally; the caller's own follow-up refresh drops this row shortly.
        state = 'edit-deleted';
        render();
      }
      // Otherwise: the caller already re-rendered the whole list with the corrected feed (the
      // same full render() path already used after a delete) — this row instance is discarded.
    } catch {
      state = 'edit-failed';
      render();
    }
  }

  function confirmEdit() {
    const input = li.querySelector('.row__edit-input');
    const timeValue = input ? input.value : editValue;
    editValue = timeValue;
    // Minute-granularity no-op guard, ahead of computeEditedTimestamp: a real `created_at`
    // always carries seconds/microseconds, so that function's own (correct, ms-exact)
    // `unchanged` check can practically never match an <input type="time"> value (which only
    // ever carries HH:MM) — left uncaught, tapping Save with no real change would still PATCH
    // and silently rewind the feed to :00 seconds. Comparing at the same HH:MM granularity the
    // input itself uses is what actually makes a true no-op Save skip the network call.
    if (timeValue === timeInputValue(new Date(feed.created_at))) {
      cancelEdit();
      return;
    }
    const result = computeEditedTimestamp(feed.created_at, timeValue, new Date());
    if (!result.ok) {
      // 'invalid' should be unreachable in normal use (the browser's own time input validates
      // this) — treat it like any other blocked Save: stay open, no network call, no message.
      if (result.reason === 'future') {
        editFutureRejected = true;
        render();
      }
      return;
    }
    if (result.unchanged) {
      // Kept as a defensive fallback (contract.md §7.11's own ms-exact check) — the guard above
      // is what actually catches this in practice, but this still closes cleanly if it's ever hit.
      cancelEdit();
      return;
    }
    editFutureRejected = false;
    pendingIso = result.iso;
    trySaveEdit();
  }

  function onKeydown(e) {
    if (e.key !== 'Escape') return;
    if (state === 'confirming' || state === 'failed') {
      e.preventDefault();
      cancel();
    } else if (state === 'editing' || state === 'edit-failed') {
      e.preventDefault();
      cancelEdit();
    }
  }

  function render() {
    li.textContent = '';
    li.classList.remove('row--confirm', 'row--edit-open');
    // D6: marks this row as "actively open" so a caller's background refresh (home.js/
    // history.js) can tell not to rebuild the list out from under an in-progress interaction.
    // Deliberately excludes 'edit-deleted' — that terminal message is meant to be safely
    // replaced by the next refresh, not to block one indefinitely.
    if (state === 'normal' || state === 'edit-deleted') {
      li.removeAttribute('data-row-open');
    } else {
      li.setAttribute('data-row-open', 'true');
    }

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

      const actions = document.createElement('div');
      actions.className = 'row__actions';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'row__edit';
      editBtn.setAttribute('aria-label', editAriaLabel(feed, now));
      editBtn.appendChild(icon('pencil'));
      editBtn.addEventListener('click', openEdit);

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'row__delete';
      deleteBtn.setAttribute('aria-label', deleteAriaLabel(feed, now));
      deleteBtn.appendChild(icon('trash'));
      deleteBtn.addEventListener('click', open);

      actions.append(editBtn, deleteBtn);
      li.append(info, actions);
      return;
    }

    if (state === 'editing' || state === 'saving-edit') {
      li.classList.add('row--edit-open');

      const label = document.createElement('label');
      label.className = 'row__edit-label';
      label.textContent = 'Edit time';
      const inputId = `edit-time-${feed.id}`;
      label.setAttribute('for', inputId);
      li.appendChild(label);

      const input = document.createElement('input');
      input.type = 'time';
      input.id = inputId;
      input.className = 'row__edit-input';
      input.value = editValue;
      input.disabled = state === 'saving-edit';
      li.appendChild(input);

      if (editFutureRejected) {
        const err = document.createElement('p');
        err.className = 'row__confirm-text row__confirm-text--warn';
        err.textContent = "Can't set a future time.";
        li.appendChild(err);
      }

      if (state === 'saving-edit') {
        const status = document.createElement('p');
        status.className = 'row__deleting';
        status.textContent = 'Saving…';
        li.appendChild(status);
        return;
      }

      const buttons = document.createElement('div');
      buttons.className = 'row__confirm-buttons';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn--outline';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', cancelEdit);

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'btn btn--accent';
      saveBtn.textContent = 'Save';
      saveBtn.addEventListener('click', confirmEdit);

      buttons.append(cancelBtn, saveBtn);
      li.appendChild(buttons);
      input.focus();
      return;
    }

    if (state === 'edit-failed' || state === 'edit-deleted') {
      li.classList.add('row--confirm');

      const text = document.createElement('p');
      text.className = 'row__confirm-text row__confirm-text--warn';
      text.textContent = state === 'edit-deleted' ? 'This feed was deleted.' : "Couldn't save.";
      li.appendChild(text);

      if (state === 'edit-deleted') return; // terminal message, no buttons

      const buttons = document.createElement('div');
      buttons.className = 'row__confirm-buttons';

      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'btn btn--warn-outline';
      retryBtn.textContent = 'Retry';
      retryBtn.addEventListener('click', trySaveEdit);

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn--outline';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', cancelEdit);

      buttons.append(retryBtn, cancelBtn);
      li.appendChild(buttons);
      return;
    }

    // Delete flow: 'confirming' | 'deleting' | 'failed'.
    li.classList.add('row--confirm');

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

// ---- Pet avatar (photo or placeholder), shared by the picker (design.md §3.0) ---------------

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * A pet's avatar: its photo when `pets.photo_url` is set, otherwise a placeholder — a filled
 * circle in a per-species tint with the pet's first initial, cats getting a pair of small ear
 * shapes so cats and dogs are distinguishable by shape, not color alone (design.md §3.0/§8).
 * The avatar is clipped to a circle exactly inscribed in its own box (`.pet-avatar`'s
 * `overflow:hidden; border-radius:999px`) — radius 20 about (20,20) in this viewBox, with no
 * slack near the corners the way a square icon (frontend/assets/icon.svg) has. A cat's head
 * circle is therefore drawn smaller (r=15) than a dog's (r=20, filling the clip edge to edge)
 * specifically so the ear tips — positioned to stay just inside the r=20 clip, but outside the
 * r=15 head — have room to actually render instead of being clipped away or painted over.
 * Always decorative (aria-hidden): the caller supplies the accessible name (the picker's link
 * already carries `aria-label="{pet name}"`, so this never duplicates it via `alt`/label text).
 * @param {{name: string, species: 'cat'|'dog', photo_url: string|null}} pet
 * @returns {HTMLElement}
 */
export function buildPetAvatar(pet) {
  const wrap = document.createElement('span');
  wrap.className = 'pet-avatar';
  wrap.setAttribute('aria-hidden', 'true');

  if (pet.photo_url) {
    const img = document.createElement('img');
    img.className = 'pet-avatar__img';
    img.src = pet.photo_url;
    img.alt = '';
    wrap.appendChild(img);
    return wrap;
  }

  const isCat = pet.species !== 'dog';
  wrap.classList.add('pet-avatar--placeholder', `pet-avatar--${isCat ? 'cat' : 'dog'}`);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 40 40');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');

  if (isCat) {
    // A pair of small ear triangles, drawn *behind* the fill circle (added first) so only their
    // pointed tips show above it — the species-shape cue design.md §3.0/§8 asks for. Each base
    // point sits inside the r=15 head circle (so the head covers/hides it); each tip sits
    // outside the head but inside the r=20 avatar clip (so it's the only part that shows).
    for (const [baseL, tip, baseR] of [
      [[9, 13], [13, 4], [17, 13]],
      [[23, 13], [27, 4], [31, 13]],
    ]) {
      const ear = document.createElementNS(SVG_NS, 'polygon');
      ear.setAttribute('points', `${baseL.join(',')} ${tip.join(',')} ${baseR.join(',')}`);
      ear.setAttribute('class', 'pet-avatar__ear');
      svg.appendChild(ear);
    }
  }

  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx', '20');
  circle.setAttribute('cy', '20');
  circle.setAttribute('r', isCat ? '15' : '20');
  circle.setAttribute('class', 'pet-avatar__fill');
  svg.appendChild(circle);

  const text = document.createElementNS(SVG_NS, 'text');
  text.setAttribute('x', '20');
  text.setAttribute('y', '21');
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('dominant-baseline', 'middle');
  text.setAttribute('class', 'pet-avatar__initial');
  text.textContent = (pet.name || '?').trim().charAt(0).toUpperCase();
  svg.appendChild(text);

  wrap.appendChild(svg);
  return wrap;
}

// ---- Pet picker (design.md §3.0) -------------------------------------------------------------

/**
 * Renders the row of pet-picker avatars into `container`, replacing its contents. The selected
 * pet's avatar is visually larger and ringed (`.pet-picker__item--selected`); every avatar is a
 * real `<a href="{pathForPet(slug)}">` with `aria-label="{pet name}"`, and the selected one also
 * gets `aria-current="true"`. Navigation is a normal link (not a client-side swap), so the URL
 * bar always reflects the pet on screen. (design.md §3.0, contract.md §7.10)
 * @param {HTMLElement} container
 * @param {{pets: Array, selectedSlug: string}} opts
 */
export function renderPetPicker(container, { pets, selectedSlug }) {
  container.textContent = '';
  for (const pet of pets) {
    const selected = pet.slug === selectedSlug;
    const a = document.createElement('a');
    a.className = 'pet-picker__item' + (selected ? ' pet-picker__item--selected' : '');
    a.href = pathForPet(pet.slug);
    a.setAttribute('aria-label', pet.name);
    if (selected) a.setAttribute('aria-current', 'true');
    a.appendChild(buildPetAvatar(pet));
    container.appendChild(a);
  }
}

// ---- Heatmap (design.md §4.1, contract.md §7.8) -----------------------------------------------

const HEATMAP_WEEKDAY_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

function feedCountWords(n) {
  if (n === 0) return 'no feeds';
  return `${n} feed${n === 1 ? '' : 's'}`;
}

/**
 * The accessible name for one heatmap cell, e.g. "Tuesday, September 15: 3 feeds" or
 * "Tuesday, September 15: no feeds" — color is never the only signal (AC-18.6).
 * @param {{date: Date, count: number}} cell
 * @returns {string}
 */
function heatmapCellLabel(cell) {
  return `${HEATMAP_WEEKDAY_FORMAT.format(cell.date)}: ${feedCountWords(cell.count)}`;
}

/**
 * Renders the heatmap's color legend (design.md §4.1/§4.2). v1.3: split out of renderHeatmap()
 * below and moved into the heatmap card's static `.heatmap__header`, inline with the CSV
 * button, since the legend never depends on data — unlike the grid, it has no reason to live
 * inside the node renderHeatmap() clears and rebuilds. Stateless and idempotent: safe to call
 * more than once, each call just replaces `container`'s previous contents.
 * @param {HTMLElement} container
 */
export function renderHeatmapLegend(container) {
  container.textContent = '';
  // design.md's copy table (§5) gives the legend's text as the single literal string
  // "0 · 1 · 2 · 3 · 4+"; its §4.1 prose separately describes per-tier color swatches paired
  // with their number. Both are honored here: each tier still gets its own colored swatch
  // (aria-hidden, decorative) immediately next to its number, and a " · " separator between
  // tiers means the legend's overall text content reads exactly the copy table's string.
  COPY.heatmapLegend.forEach((label, tier) => {
    if (tier > 0) {
      const sep = document.createElement('span');
      sep.className = 'heatmap__legend-sep';
      sep.textContent = ' · ';
      container.appendChild(sep);
    }
    const item = document.createElement('span');
    item.className = 'heatmap__legend-item';
    const swatch = document.createElement('span');
    swatch.className = `heatmap__legend-swatch heat-cell--tier-${tier}`;
    swatch.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = label;
    item.append(swatch, text);
    container.appendChild(item);
  });
}

/**
 * Renders the heatmap card's data-dependent portion (Sun–Sat header, weeks grid, and the
 * expanded-day panel when one is open) into `container`, replacing its contents. The legend
 * (design.md §4.1) is no longer built here as of v1.3 — see renderHeatmapLegend() above.
 * Stateless/presentational — the caller owns which cell (if any) is expanded and supplies that
 * day's feeds to show. (design.md §4.1)
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {{weeks: Array<Array<object>>}} opts.heatmap - buildHeatmap() result
 * @param {string|null} opts.expandedKey - feedDayKey of the expanded cell, or null
 * @param {Array|null} opts.expandedFeeds - that day's live feeds (time + name rows), or null
 * @param {(cell: object) => void} opts.onCellClick
 * @param {() => void} opts.onCollapse
 */
export function renderHeatmap(container, { heatmap, expandedKey, expandedFeeds, onCellClick, onCollapse }) {
  container.textContent = '';
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', 'Feeding heatmap, last five weeks');

  const weekdayHeader = document.createElement('div');
  weekdayHeader.className = 'heatmap__weekdays';
  weekdayHeader.setAttribute('aria-hidden', 'true');
  for (const label of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) {
    const cell = document.createElement('span');
    cell.textContent = label;
    weekdayHeader.appendChild(cell);
  }
  container.appendChild(weekdayHeader);

  const grid = document.createElement('div');
  grid.className = 'heatmap__grid';
  for (const week of heatmap.weeks) {
    for (const cell of week) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `heat-cell heat-cell--tier-${cell.intensity}`;
      if (!cell.inRange) btn.classList.add('heat-cell--out');
      if (cell.isToday) {
        btn.classList.add('heat-cell--today');
        btn.setAttribute('data-today', 'true');
      }
      if (cell.inRange && cell.feedDayKey === expandedKey) btn.classList.add('heat-cell--expanded');
      btn.disabled = !cell.inRange;
      btn.setAttribute('aria-label', heatmapCellLabel(cell));
      const num = document.createElement('span');
      num.className = 'heat-cell__num';
      num.textContent = String(cell.date.getDate());
      num.setAttribute('aria-hidden', 'true');
      btn.appendChild(num);
      if (cell.inRange) {
        btn.addEventListener('click', () => onCellClick(cell));
      }
      grid.appendChild(btn);
    }
  }
  container.appendChild(grid);

  if (expandedKey && expandedFeeds) {
    const panel = document.createElement('div');
    panel.className = 'heatmap__panel';
    panel.setAttribute('data-heatmap-expanded', 'true');

    const panelHeader = document.createElement('div');
    panelHeader.className = 'heatmap__panel-header';
    const title = document.createElement('span');
    title.className = 'heatmap__panel-title';
    title.textContent = `${expandedFeeds.length} feed${expandedFeeds.length === 1 ? '' : 's'}`;
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'heatmap__panel-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', onCollapse);
    panelHeader.append(title, closeBtn);
    panel.appendChild(panelHeader);

    if (expandedFeeds.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'heatmap__panel-empty';
      empty.textContent = 'No feeds that day.';
      panel.appendChild(empty);
    } else {
      const ul = document.createElement('ul');
      ul.className = 'row-list';
      for (const feed of expandedFeeds) {
        const li = document.createElement('li');
        li.className = 'row row--static';
        const info = document.createElement('div');
        info.className = 'row__info';
        const line1 = document.createElement('p');
        line1.className = 'row__line1';
        const timeEl = document.createElement('time');
        timeEl.dateTime = feed.created_at;
        timeEl.textContent = formatTime(new Date(feed.created_at));
        line1.appendChild(timeEl);
        const line2 = document.createElement('p');
        line2.className = 'row__line2';
        line2.textContent = `by ${feed.logged_by || 'Someone'}`;
        info.append(line1, line2);
        li.appendChild(info);
        ul.appendChild(li);
      }
      panel.appendChild(ul);
    }

    container.appendChild(panel);
  }
}
