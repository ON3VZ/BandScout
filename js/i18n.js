/**
 * HF Band Scout — i18n (Internationalisation)
 *
 * Loads language strings from data/i18n/{lang}.json.
 * Exposes t(key) for all UI string lookups.
 * Applies data-i18n attributes across the DOM after load.
 *
 * Supported languages: English, Dutch, French, German, Spanish, Portuguese, Italian
 * Band names, unit symbols (W, dB, MHz, km), and callsigns are never translated.
 */

import { state } from './state.js';

export const SUPPORTED_LANGS = [
  { code: 'en', label: 'English' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
  { code: 'it', label: 'Italiano' },
];

const LANG_CODES = SUPPORTED_LANGS.map(l => l.code);

let strings = {};

/**
 * Load i18n strings for a language.
 * Falls back to 'en' if unsupported or fetch fails.
 */
export async function load(lang) {
  const l = LANG_CODES.includes(lang) ? lang : 'en';
  try {
    const res = await fetch(`data/i18n/${l}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    strings = await res.json();
  } catch (err) {
    console.warn(`[i18n] Failed to load "${l}", falling back to "en"`, err);
    if (l !== 'en') {
      try {
        const res = await fetch('data/i18n/en.json');
        strings = await res.json();
      } catch {
        strings = {};
      }
    }
  }
  state.i18n = strings;
  setDocumentLang(l);
}

/**
 * Detect browser language and return a supported code, defaulting to 'en'.
 */
export function detectBrowserLang() {
  const nav = navigator.language ?? navigator.userLanguage ?? 'en';
  const code = nav.slice(0, 2).toLowerCase();
  return LANG_CODES.includes(code) ? code : 'en';
}

/**
 * Translate a key. Returns the key itself if not found.
 * Supports simple interpolation: t('opening.in', { min: 47 })
 * where the string contains "{min}".
 */
export function t(key, vars = {}) {
  let str = strings[key] ?? key;
  for (const [k, v] of Object.entries(vars)) {
    str = str.replaceAll(`{${k}}`, v);
  }
  return str;
}

/**
 * Apply translations to DOM elements with data-i18n attributes.
 *   data-i18n="key"             → element.textContent
 *   data-i18n-placeholder="key" → element.placeholder
 *   data-i18n-title="key"       → element.title (native tooltip)
 *   data-i18n-aria="key"        → element.ariaLabel
 *
 * Call after load() and after any dynamic DOM insertion.
 */
export function applyToDOM() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const tr = t(key);
    if (tr !== key || strings[key]) el.textContent = tr;
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });

  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });

  document.querySelectorAll('[data-i18n-aria]').forEach(el => {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
  });
}

/** Update the document <html lang> attribute. */
export function setDocumentLang(lang) {
  document.documentElement.lang = lang;
}
