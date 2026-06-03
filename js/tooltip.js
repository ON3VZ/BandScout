/**
 * tooltip.js
 * Lightweight tooltip and inline help system for HF Band Scout.
 *
 * Two mechanisms:
 * 1. Hover/focus tooltips: attach to any element with data-tooltip="i18n.key"
 *    A floating <div class="tt-bubble"> appears near the element.
 *
 * 2. Help buttons: createHelpBtn('i18n.key') returns a <button class="help-btn">?</button>
 *    Clicking it opens a modal with the full help text from the i18n 'help.*' namespace.
 *
 * Both read strings via t() so they work in all 7 languages automatically.
 */

import { t } from './i18n.js';

// ─── Tooltip bubble (hover/focus) ─────────────────────────────────────────────

let bubble = null;
let hideTimer = null;

function ensureBubble() {
  if (bubble) return bubble;
  bubble = document.createElement('div');
  bubble.className = 'tt-bubble';
  bubble.setAttribute('role', 'tooltip');
  bubble.id = 'tt-global';
  document.body.appendChild(bubble);
  return bubble;
}

function showBubble(text, anchor) {
  clearTimeout(hideTimer);
  const b = ensureBubble();
  b.textContent = text;
  b.classList.add('is-visible');

  // Position below the anchor, centred
  const r = anchor.getBoundingClientRect();
  const bw = b.offsetWidth || 220;
  const left = Math.max(8, Math.min(window.innerWidth - bw - 8,
    r.left + r.width / 2 - bw / 2));
  b.style.left = `${left}px`;
  b.style.top  = `${r.bottom + window.scrollY + 8}px`;
}

function hideBubble() {
  hideTimer = setTimeout(() => {
    bubble?.classList.remove('is-visible');
  }, 120);
}

/**
 * Init: scan DOM for [data-tooltip] and attach hover/focus listeners.
 * Call once after DOM is ready, and again after dynamic renders.
 */
export function initTooltips(root = document) {
  root.querySelectorAll('[data-tooltip]').forEach(el => {
    if (el._ttBound) return;
    el._ttBound = true;

    const getText = () => {
      const key = el.getAttribute('data-tooltip');
      return t(key);
    };

    el.addEventListener('mouseenter', () => showBubble(getText(), el));
    el.addEventListener('focus',      () => showBubble(getText(), el));
    el.addEventListener('mouseleave', hideBubble);
    el.addEventListener('blur',       hideBubble);
  });
}

// ─── Help modal ───────────────────────────────────────────────────────────────

let modal = null;

function ensureModal() {
  if (modal) return modal;

  modal = document.createElement('div');
  modal.className = 'help-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.innerHTML = `
    <div class="help-modal-box">
      <button class="help-modal-close" aria-label="Close">✕</button>
      <h2 class="help-modal-title"></h2>
      <div class="help-modal-body"></div>
    </div>`;

  modal.querySelector('.help-modal-close').addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.classList.contains('is-open')) closeModal();
  });

  document.body.appendChild(modal);
  return modal;
}

function openModal(titleKey, bodyKey) {
  const m = ensureModal();
  m.querySelector('.help-modal-title').textContent = t(titleKey);
  m.querySelector('.help-modal-body').textContent  = t(bodyKey);
  m.classList.add('is-open');
  m.querySelector('.help-modal-close').focus();
}

function closeModal() {
  modal?.classList.remove('is-open');
}

/**
 * Create a [?] help button that opens the help modal.
 *
 * @param {string} helpKey  - key in the 'help.*' namespace, e.g. 'help.muf'
 * @param {string} [titleKey] - optional separate title key; defaults to helpKey
 * @returns {HTMLButtonElement}
 */
export function createHelpBtn(helpKey, titleKey) {
  const btn = document.createElement('button');
  btn.className = 'help-btn';
  btn.setAttribute('type', 'button');
  btn.setAttribute('aria-label', t('ui.help'));
  btn.textContent = '?';
  btn.addEventListener('click', e => {
    e.stopPropagation();
    openModal(titleKey ?? helpKey, helpKey);
  });
  return btn;
}

/**
 * Convenience: insert a help button immediately after el.
 * @param {HTMLElement} el
 * @param {string} helpKey
 */
export function attachHelpBtn(el, helpKey) {
  const btn = createHelpBtn(helpKey);
  el.insertAdjacentElement('afterend', btn);
  return btn;
}

/**
 * Scan DOM for [data-help] attributes and attach help buttons.
 * <label data-help="help.muf">MUF</label> → appends [?] after label.
 */
export function initHelpBtns(root = document) {
  root.querySelectorAll('[data-help]').forEach(el => {
    if (el._helpBound) return;
    el._helpBound = true;
    const key = el.getAttribute('data-help');
    attachHelpBtn(el, key);
  });
}

/**
 * Call both initTooltips and initHelpBtns in one shot.
 */
export function initAll(root = document) {
  initTooltips(root);
  initHelpBtns(root);
}
