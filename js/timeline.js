/**
 * HF Band Scout — Timeline Module
 *
 * Time scrubber slider (0–47 × 30-min steps = 0–23.5h).
 * Play/pause animation loop at 300ms per frame.
 * "Now" button snaps to step 0.
 * Updates state.activeTimeOffset and triggers map re-render.
 */

import { state } from './state.js';
import { formatUTC } from './utils.js';

import { update as updateListview } from './listview.js';

const PLAY_INTERVAL_MS = 300;
const TOTAL_STEPS = 48; // 0..47

let _startTime = null; // Date when app loaded, used as "now" anchor

// ─────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────

export function init() {
  _startTime = new Date();

  const slider   = document.getElementById('time-slider');
  const btnNow   = document.getElementById('btn-now');
  const btnPlay  = document.getElementById('btn-play');
  const condToggle = document.getElementById('conditions-toggle');

  if (!slider) return;

  slider.max = TOTAL_STEPS - 1;
  slider.value = 0;

  // Slider input
  slider.addEventListener('input', () => {
    const step = parseInt(slider.value, 10);
    setStep(step, false);
  });

  // Now button
  if (btnNow) {
    btnNow.addEventListener('click', () => {
      _startTime = new Date(); // re-anchor to real now
      setStep(0, true);
      stopAnimation();
    });
  }

  // Play/Pause
  if (btnPlay) {
    btnPlay.addEventListener('click', () => {
      if (state.isPlaying) stopAnimation();
      else startAnimation();
    });
  }

  // Conditions bar toggle
  if (condToggle) {
    condToggle.addEventListener('click', () => {
      const expanded = condToggle.getAttribute('aria-expanded') === 'true';
      condToggle.setAttribute('aria-expanded', String(!expanded));
    });
  }

  updateDisplay(0);
}

// ─────────────────────────────────────────────
// Step control
// ─────────────────────────────────────────────

/**
 * Set the active time step and update all dependent UI.
 *
 * @param {number}  step      - 0–47
 * @param {boolean} fromCode  - true if called programmatically (sync slider)
 */
export function setStep(step, fromCode = false) {
  const clamped = Math.max(0, Math.min(TOTAL_STEPS - 1, step));
  state.activeTimeOffset = clamped;

  if (fromCode) {
    const slider = document.getElementById('time-slider');
    if (slider) slider.value = clamped;
  }

  updateDisplay(clamped);

  if (state.scoreCacheBuilt) {
    window.__hfbs?.renderScores?.();

    // If a list screen is visible, update it too
    const byBand = document.getElementById('screen-by-band');
    if (byBand && !byBand.hidden) window.__hfbs?.updateListview?.();
  }

  updateSliderFill(clamped);
}

function updateDisplay(step) {
  const display = document.getElementById('time-display');
  const btnNow  = document.getElementById('btn-now');

  const date = stepToDate(step);
  const label = step === 0 ? formatUTC(date) : `+${step / 2}h · ${formatUTC(date)}`;

  if (display) {
    display.textContent = formatUTC(date);
    display.className   = 'tl-time' + (step > 0 ? ' offset' : '');
  }

  if (btnNow) {
    btnNow.classList.toggle('live', step === 0);
    btnNow.setAttribute('aria-label', step === 0 ? 'Current time (live)' : 'Jump to current time');
  }

  // Update slider aria-valuetext
  const slider = document.getElementById('time-slider');
  if (slider) {
    slider.setAttribute('aria-valuetext', step === 0 ? 'Now' : label);
  }
}

function updateSliderFill(step) {
  const slider = document.getElementById('time-slider');
  if (!slider) return;
  const pct = (step / (TOTAL_STEPS - 1)) * 100;
  slider.classList.add('has-fill');
  slider.style.setProperty('--fill-pct', `${pct.toFixed(1)}%`);
}

/**
 * Convert a step index to a UTC Date object.
 * Uses _startTime as the "now" anchor.
 */
export function stepToDate(step) {
  const base = _startTime ?? new Date();
  return new Date(base.getTime() + step * 30 * 60 * 1000);
}

/**
 * Get the Date for the current active step.
 */
export function activeDate() {
  return stepToDate(state.activeTimeOffset);
}

// ─────────────────────────────────────────────
// Animation
// ─────────────────────────────────────────────

export function startAnimation() {
  if (state.isPlaying) return;
  state.isPlaying = true;

  const btn = document.getElementById('btn-play');
  if (btn) {
    btn.setAttribute('aria-pressed', 'true');
    btn.setAttribute('aria-label', 'Pause animation');
  }

  state.playInterval = setInterval(() => {
    const nextStep = (state.activeTimeOffset + 1) % TOTAL_STEPS;
    setStep(nextStep, true);
  }, PLAY_INTERVAL_MS);
}

export function stopAnimation() {
  if (!state.isPlaying) return;
  state.isPlaying = false;

  if (state.playInterval) {
    clearInterval(state.playInterval);
    state.playInterval = null;
  }

  const btn = document.getElementById('btn-play');
  if (btn) {
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', 'Play animation');
  }
}
