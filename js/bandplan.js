/**
 * bandplan.js
 * Returns band plan snippets for drilldown display.
 * Data keyed by IARU region (1/2/3) × band × mode.
 */

// Inline band plan data (kHz) — IARU Region 1, 2, 3 consolidated
// Structure: PLANS[region][band] = { cw, ssb, ft8, ft4, am, digi }
const PLANS = {
  1: { // IARU Region 1 (Europe/Africa/Middle East)
    "160m": { cw: "1810–1838", ssb: "1840–1850", ft8: "1840", digi: "1838–1840" },
    "80m":  { cw: "3500–3570", ssb: "3600–3800", ft8: "3573", ft4: "3575", am: "3600–3800" },
    "60m":  { ssb: "5351.5–5366.5", ft8: "5357", note: "USB, 15 W EIRP max, channel plan varies" },
    "40m":  { cw: "7000–7040", ssb: "7060–7200", ft8: "7074", ft4: "7047.5", am: "7290" },
    "30m":  { cw: "10100–10130", digi: "10130–10150", ft8: "10136", note: "CW + digi only, no SSB/AM" },
    "20m":  { cw: "14000–14070", ssb: "14125–14350", ft8: "14074", ft4: "14080", am: "14286" },
    "17m":  { cw: "18068–18095", ssb: "18111–18168", ft8: "18100", ft4: "18104" },
    "15m":  { cw: "21000–21070", ssb: "21151–21450", ft8: "21074", ft4: "21140", am: "21339" },
    "12m":  { cw: "24890–24915", ssb: "24931–24990", ft8: "24915", ft4: "24919" },
    "10m":  { cw: "28000–28070", ssb: "28300–29700", ft8: "28074", ft4: "28180", am: "29000–29200" },
    "6m":   { cw: "50000–50100", ssb: "50100–50300", ft8: "50313", ft4: "50318", am: "50–54 MHz" },
    "2m":   { cw: "144000–144150", ssb: "144150–144400", ft8: "144174", ft4: "144170" },
  },
  2: { // IARU Region 2 (Americas)
    "160m": { cw: "1800–1830", ssb: "1840–2000", ft8: "1840", digi: "1838–1840" },
    "80m":  { cw: "3500–3600", ssb: "3800–4000", ft8: "3573", ft4: "3575", am: "3885" },
    "60m":  { ssb: "5330.5–5406.4", ft8: "5357", note: "5 channels (USB), 100 W PEP max (US)" },
    "40m":  { cw: "7000–7025", ssb: "7125–7300", ft8: "7074", ft4: "7047.5", am: "7290" },
    "30m":  { cw: "10100–10150", digi: "10130–10150", ft8: "10136", note: "CW + digi only" },
    "20m":  { cw: "14000–14025", ssb: "14150–14350", ft8: "14074", ft4: "14080", am: "14286" },
    "17m":  { cw: "18068–18095", ssb: "18110–18168", ft8: "18100", ft4: "18104" },
    "15m":  { cw: "21000–21025", ssb: "21200–21450", ft8: "21074", ft4: "21140", am: "29000–29200" },
    "12m":  { cw: "24890–24915", ssb: "24930–24990", ft8: "24915", ft4: "24919" },
    "10m":  { cw: "28000–28025", ssb: "28300–29700", ft8: "28074", ft4: "28180", am: "29000–29200" },
    "6m":   { cw: "50000–50100", ssb: "50100–50300", ft8: "50313", ft4: "50318" },
    "2m":   { cw: "144000–144100", ssb: "144200–144300", ft8: "144174", ft4: "144170" },
  },
  3: { // IARU Region 3 (Asia-Pacific)
    "160m": { cw: "1800–1830", ssb: "1843–2000", ft8: "1840", digi: "1838–1843" },
    "80m":  { cw: "3500–3535", ssb: "3600–3900", ft8: "3573", ft4: "3575", am: "3900" },
    "60m":  { ssb: "5351.5–5366.5", ft8: "5357", note: "Allocation varies by country" },
    "40m":  { cw: "7000–7025", ssb: "7100–7300", ft8: "7074", ft4: "7047.5", am: "7160" },
    "30m":  { cw: "10100–10150", digi: "10130–10150", ft8: "10136", note: "CW + digi only" },
    "20m":  { cw: "14000–14025", ssb: "14125–14350", ft8: "14074", ft4: "14080", am: "14286" },
    "17m":  { cw: "18068–18095", ssb: "18110–18168", ft8: "18100", ft4: "18104" },
    "15m":  { cw: "21000–21025", ssb: "21150–21450", ft8: "21074", ft4: "21140", am: "21339" },
    "12m":  { cw: "24890–24915", ssb: "24931–24990", ft8: "24915", ft4: "24919" },
    "10m":  { cw: "28000–28070", ssb: "28300–29700", ft8: "28074", ft4: "28180", am: "29000–29200" },
    "6m":   { cw: "50000–50100", ssb: "50100–50300", ft8: "50313", ft4: "50318" },
    "2m":   { cw: "144000–144100", ssb: "144150–144400", ft8: "144174", ft4: "144170" },
  }
};

// Map IAU region string/number to 1/2/3
function normaliseRegion(iauRegion) {
  const r = parseInt(iauRegion, 10);
  if (r === 1 || r === 2 || r === 3) return r;
  return 1; // fallback
}

/**
 * Return an array of { mode, freqStr } rows for display in the drilldown panel.
 * @param {string|number} iauRegion - 1, 2, or 3
 * @param {string} band - e.g. "20m"
 * @param {string[]} [highlightModes] - modes to mark as highlighted (e.g. ["ft8","ssb"])
 * @returns {{ mode: string, freqStr: string, note?: string, highlighted?: boolean }[]}
 */
export function getBandPlanSnippet(iauRegion, band, highlightModes = []) {
  const region = normaliseRegion(iauRegion);
  const planRegion = PLANS[region] || PLANS[1];
  const planBand = planRegion[band];

  if (!planBand) return [];

  const modeOrder = ["cw", "ssb", "ft8", "ft4", "digi", "am"];
  const rows = [];

  for (const mode of modeOrder) {
    if (planBand[mode]) {
      rows.push({
        mode: mode.toUpperCase(),
        freqStr: planBand[mode],
        highlighted: highlightModes.map(m => m.toLowerCase()).includes(mode),
      });
    }
  }

  if (planBand.note) {
    rows.push({ mode: "ℹ", freqStr: planBand.note, note: true });
  }

  return rows;
}

/**
 * Return just the nominal FT8 frequency (kHz) for a band in a given region.
 * Used by drilldown to pre-fill a QSY link.
 */
export function getFT8Freq(iauRegion, band) {
  const region = normaliseRegion(iauRegion);
  const planRegion = PLANS[region] || PLANS[1];
  return planRegion[band]?.ft8 ?? null;
}

/**
 * Return all bands that have data for a region.
 */
export function getBandsForRegion(iauRegion) {
  const region = normaliseRegion(iauRegion);
  return Object.keys(PLANS[region] || PLANS[1]);
}
