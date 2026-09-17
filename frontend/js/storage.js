// Pumo Feed Log: localStorage name helpers. Every access wrapped in try/catch — private
// browsing modes and disabled storage must never crash the app. (contract.md §9, AC-14.6)

import { STORAGE_KEYS } from './constants.js';
import { sanitizeName } from './logic.js';

/**
 * @returns {string|null} the saved display name, or null if none/unavailable
 */
export function getName() {
  try {
    return window.localStorage.getItem(STORAGE_KEYS.loggerName);
  } catch {
    return null;
  }
}

/**
 * Sanitizes and saves the name. Returns the sanitized value that was (attempted to be) stored.
 * @param {string} name
 * @returns {string|null}
 */
export function setName(name) {
  const clean = sanitizeName(name);
  try {
    if (clean == null) {
      window.localStorage.removeItem(STORAGE_KEYS.loggerName);
    } else {
      window.localStorage.setItem(STORAGE_KEYS.loggerName, clean);
    }
  } catch {
    // Storage unavailable: nothing persists, but the app keeps working.
  }
  return clean;
}

/**
 * @returns {boolean} whether the name card has already been shown-and-resolved on this phone
 */
export function isNamePromptDone() {
  try {
    return window.localStorage.getItem(STORAGE_KEYS.namePromptDone) === '1';
  } catch {
    return false;
  }
}

export function setNamePromptDone() {
  try {
    window.localStorage.setItem(STORAGE_KEYS.namePromptDone, '1');
  } catch {
    // Storage unavailable: the card may show again next visit. Not an error state.
  }
}
