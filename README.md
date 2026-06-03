# 📡 HF Band Scout

**Live HF propagation probability map for licensed amateur radio operators.**

> *Know where you can reach — before you key up.*

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-deployed-brightgreen)](https://on3vz.github.io/BandScout/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![No build step](https://img.shields.io/badge/build-none%20required-lightgrey)](.)
[![Languages](https://img.shields.io/badge/languages-7-informational)](data/i18n/)

HF Band Scout answers the inverse question of a propagation watch: instead of *"alert me when a specific destination opens"*, it asks *"given my station right now, show me everywhere I can reach and on which bands."*

---

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Screens & Usage](#screens--usage)
  - [Map View](#map-view)
  - [By Band View](#by-band-view)
  - [By Region View](#by-region-view)
  - [Opening Soon](#opening-soon)
  - [Settings](#settings)
- [Propagation Glossary](#propagation-glossary)
- [Propagation Model](#propagation-model)
- [Data Sources](#data-sources)
- [Languages](#languages)
- [Supported Transceivers](#supported-transceivers)
- [Installation & Deployment](#installation--deployment)
- [File Structure](#file-structure)
- [Known Limitations](#known-limitations)
- [Contributing](#contributing)
- [License](#license)

---

## Features

| Feature | Detail |
|---|---|
| **Live world map** | Every DXCC entity coloured by propagation probability, updated every 30 min |
| **All HF bands** | 160 m through 6 m (+ 2 m / 70 cm tropo), filtered by your licence class |
| **Time scrubber** | Scrub or animate through the full 24-hour UTC day in 30-minute steps |
| **Greyline overlay** | Sunrise/sunset terminator on the map with greyline-active entity highlighting |
| **NOAA live data** | Solar Flux Index (SFI), Kp index, 3-day Kp forecast, space weather alerts |
| **By Band view** | Continent-grouped list of DXCC entities with mini 24 h score bars |
| **By Region view** | Expand any continent → DXCC entity → per-band breakdown |
| **Opening Soon** | Detects band crossings above your threshold within the next 6 hours |
| **Drilldown panel** | Distance, azimuth, short/long path, per-band scores, 100 W reference, radio settings |
| **Radio settings** | Model-specific preamp / NB / NR / filter / AGC advice per band × condition |
| **Band plan** | IARU Region 1 / 2 / 3 sub-band display in every drilldown |
| **PWA** | Installable on Android / iOS / desktop; works offline after first load |
| **7 languages** | English, Dutch, French, German, Spanish, Portuguese, Italian |
| **Colour-blind mode** | Blue-amber palette replacing red-green, toggled in Settings |
| **Dark / light / system theme** | Shack-friendly dark default |
| **Tooltips & help** | Every setting has an inline hint; `[?]` buttons open a full explanation modal |

---

## Quick Start

### Online (GitHub Pages)

Open [https://on3vz.github.io/BandScout/](https://on3vz.github.io/BandScout/) in any modern browser. No installation required.

### Local development

1. **Clone the repo**
   ```bash
   git clone https://github.com/ON3VZ/BandScout.git
   cd BandScout
   ```

2. **Add the required libraries** (see [Libraries](#libraries-not-bundled)):
   ```
   lib/leaflet/leaflet.js
   lib/leaflet/leaflet.css
   lib/suncalc.js
   ```

3. **Add world map data** (see [DXCC GeoJSON](#dxcc-geojson)):
   ```
   data/dxcc.geojson
   ```

4. **Serve the folder** with any static server:
   ```bash
   npx serve .           # Node.js
   python3 -m http.server 8080   # Python
   php -S localhost:8080 # PHP
   ```

5. Open `http://localhost:8080`, enter your Maidenhead grid square in **Settings**, and tap **Save & apply**.

> **Note:** The app will not work from a `file://` URL because ES modules and the service worker require a web server.

---

## Screens & Usage

### Map View

The main screen. The world map shows every DXCC entity coloured by propagation reliability from your QTH.

**Controls:**

| Control | Action |
|---|---|
| **Band tabs** | Switch the active band (filtered by your licence class) |
| **Now button** | Snap the time slider back to the current UTC time |
| **Time slider** | Drag to show predicted propagation at any 30-minute step in the next 24 hours |
| **▶ Play** | Animate a full 24-hour loop (300 ms per step) |
| **Tap a country** | Open the drilldown panel for that DXCC entity |

**Colour scale:**

| Colour | Score | Meaning |
|---|---|---|
| Bright green | 76–99 % | Excellent — strong path likely |
| Green | 51–75 % | Good — reliable path |
| Yellow-orange | 31–50 % | Moderate — usable, QSB likely |
| Orange-red | 16–30 % | Poor — weak or unreliable |
| Dark red | 1–15 % | Marginal — above MUF, barely possible |
| Dark grey | 0 % | Closed — band not open for this path |

**Colour-blind mode** replaces red-green with blue-amber (toggle in Settings).

The **amber dashed border** on some countries indicates their greyline (sunrise or sunset) is active within the next 20 minutes — a prime DX window on 40–80 m.

---

### By Band View

Select a band at the top → see a continent-grouped, score-sorted list of all reachable DXCC entities with:
- Score bar (current time step)
- Mini 24 h bar chart showing how the score evolves through the day
- Tap any row to open the drilldown panel

---

### By Region View

Browse by continent → expand to individual DXCC entities → expand to per-band score breakdown with mini 24 h charts. Tap "Open detail" to go to the full drilldown panel.

---

### Opening Soon

Scans the pre-computed 24 h score cache and shows all band/entity combinations that:
1. Are currently below your threshold, **and**
2. Will cross the threshold within the selected time horizon (default: 6 hours)

Results are sorted by time-to-opening. Each row shows the band, entity, countdown, and the peak score it will reach.

**Tip:** Set a lower threshold (e.g. 20 %) to see marginal openings early.

---

### Settings

All settings are stored locally in the browser (`localStorage`). No account or cloud sync required.

| Setting | Description |
|---|---|
| **Callsign** | Your amateur callsign — display only, not used in calculations |
| **Grid square** | Maidenhead locator of your QTH (e.g. `JO20ev`). **Required.** Determines all propagation paths. |
| **Licence class** | Filters the band selector to bands permitted under your licence |
| **Radio model** | Enables model-specific receiver setting recommendations in the drilldown panel |
| **Mode** | Operating mode (FT8 / CW / SSB etc.) — affects the SNR margin in the score calculation |
| **Transmit power** | Your actual power in watts, corrected against a 100 W reference |
| **Antenna gain** | Gain relative to a dipole (dBd). A dipole = 0 dBd; a 3-element Yagi ≈ +5 dBd |
| **Theme** | Dark / Light / System |
| **Colour-blind mode** | Switches to a blue-amber score palette |
| **Language** | UI language (see [Languages](#languages)). Takes effect immediately without saving. |
| **Score threshold** | Minimum score (%) to count a path as "reachable" in list views and Opening Soon |
| **Opening horizon** | Look-ahead window for the Opening Soon scan |
| **IARU region** | Determines the band plan shown in drilldowns. Auto-detected from your grid square. |

The **API status** table (bottom of Settings) tests each NOAA data endpoint and shows response time. Use "Re-test all" if you suspect a data issue.

---

## Propagation Glossary

These terms appear throughout the app. Hover over `[?]` buttons for context-sensitive help.

| Term | Meaning |
|---|---|
| **MUF** | Maximum Usable Frequency — the highest frequency the ionosphere will reflect for a given path at a given time. Bands above the MUF are "closed". |
| **SFI** | Solar Flux Index (F10.7). Daily measure of solar radio emissions at 10.7 cm. Range: ~65–300. Higher SFI = more ionisation = higher MUF = better upper HF conditions. |
| **Kp** | Planetary K-index. Global geomagnetic disturbance level, 0–9. Kp ≥ 4 begins to degrade HF paths, especially on polar routes and low bands. |
| **D-layer** | Ionospheric layer at 60–90 km. Absorbs HF signals (especially < 10 MHz) when the sun is up. Disappears at night, enabling low-band DX. |
| **F2-layer** | Primary HF reflection layer at 200–400 km. Drives MUF and long-distance propagation. |
| **Greyline** | The sunrise/sunset terminator. Both endpoints simultaneously in the greyline → D-layer vanishes while F2 stays active → dramatic 40–80 m DX openings. Window is ±20 minutes around sunrise/sunset. |
| **Hops** | Each ionospheric reflection is one hop. F2 single-hop ≈ 3500 km. Longer paths need multiple hops, each adding loss. |
| **Sporadic E (Es)** | Unpredictable clouds of ionisation in the E-layer (~100 km). Opens 6 m and 10 m for paths of 1000–2500 km, mainly May–July in the Northern Hemisphere. |
| **QRP** | Transmitting with low power (≤ 5 W). Digital modes like FT8 are ideal for QRP because of their very low SNR threshold (–21 dB, vs 0 dB for SSB). |
| **Score** | Propagation reliability expressed as 0–99 %. Combines MUF margin, SFI, Kp, D-layer absorption, greyline bonus, multi-hop loss, and your power/mode correction vs. a 100 W SSB reference. |

---

## Propagation Model

The model runs entirely in the browser. No server is involved.

### Pipeline (per DXCC entity × band × time step)

```
1. Great-circle distance and azimuth (Haversine formula)
2. Solar elevation at TX and RX (SunCalc.js)
3. D-layer absorption factor (sigmoid on solar elevation)
4. Estimated MUF = (SFI × 0.12 + 2) × distanceFactor
5. Band gate: freq > MUF × 1.10 → score = 0 (closed)
             freq > MUF × 0.95 → score = 15 (marginal)
6. Base reliability from SFI
7. Kp degradation matrix (band-specific, 0–9 scale)
8. Greyline bonus (±20 min around sunrise/sunset, both endpoints)
9. F2 day-side gradient (paths > 1500 km only)
10. Multi-hop attenuation (1 hop per 3500 km)
11. Sporadic-E bonus (seasonal, 6 m / 10 m, 800–2500 km)
12. Clamp → score100W (the 100 W reference)
13. Power/mode correction (dB vs 100 W, mode SNR margin)
14. Clamp → final score (your station)
```

### Time resolution

The score cache pre-computes **48 steps × 30 min = 24 hours** for every DXCC entity × every band on load, and rebuilds every 15 minutes when fresh NOAA data arrives. Map renders read from this cache, keeping the 50 ms per-step target.

### Power and mode correction

Your power relative to a 100 W reference is expressed as a dB difference, then divided by the mode's SNR margin. FT8 has a 20 dB margin, SSB only 6 dB — so 5 W QRP hurts much less on FT8 than on SSB.

| Mode | SNR threshold | Margin vs. 100 W |
|---|---|---|
| FT8 | −21 dB | 20 dB |
| FT4 | −17 dB | 18 dB |
| JT65 | −25 dB | 22 dB |
| CW | −10 dB | 13 dB |
| SSB | 0 dB | 6 dB |
| AM | +5 dB | 4 dB |

---

## Data Sources

All APIs are public, CORS-enabled, and require no authentication.

| Source | Data | URL | Cache TTL |
|---|---|---|---|
| NOAA SWPC | Solar Flux (SFI) | `services.swpc.noaa.gov/json/f107_cm_flux.json` | 1 h |
| NOAA SWPC | Kp realtime | `services.swpc.noaa.gov/json/planetary_k_index_1m.json` | 15 min |
| NOAA SWPC | Kp 3-day forecast | `services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json` | 3 h |
| NOAA SWPC | Space weather alerts | `services.swpc.noaa.gov/products/alerts.json` | 15 min |
| SunCalc.js | Solar elevation / greyline | Client-side library (no network) | — |

If a NOAA fetch fails, the app falls back to its cached values and shows a "stale" indicator in the conditions bar. Safe defaults (SFI 120, Kp 2) are used if no cache exists at all.

---

## Languages

The interface is available in 7 languages. Select your language in **Settings → Language**; it changes immediately without saving.

| Code | Language |
|---|---|
| `en` | English (default) |
| `nl` | Nederlands (Dutch) |
| `fr` | Français (French) |
| `de` | Deutsch (German) |
| `es` | Español (Spanish) |
| `pt` | Português (Portuguese) |
| `it` | Italiano (Italian) |

All strings — including tooltips, help text, score labels, and error messages — are translated. Band names, unit symbols (`W`, `dB`, `MHz`, `km`), and callsigns are not translated (international notation).

To add a new language: copy `data/i18n/en.json`, translate all values, add the new code to the `SUPPORTED_LANGS` array in `js/i18n.js`, and submit a PR.

---

## Supported Transceivers

Select your radio in **Settings** to get model-specific receiver setting recommendations in the drilldown panel.

| Brand | Models |
|---|---|
| **Icom** | IC-7300, IC-7610, IC-705, IC-7100 |
| **Yaesu** | FT-991A, FT-891, FT-710, FTDX-10 |
| **Kenwood** | TS-890S, TS-590SG |
| **Elecraft** | K4, K3S, KX3 |
| **Xiegu** | G90, X6100 |
| **SDR** | RTL-SDR (receive only) |
| **Generic** | Generic / not listed |

Settings cover: pre-amplifier level, noise blanker (NB), noise reduction (NR), IF filter width, and AGC speed — per band × condition key (`noise_low_kp_low`, `noise_high_kp_low`, `noise_low_kp_high`, `noise_high_kp_high`).

> These are **starting points only**. Always listen and adjust to actual conditions.

To add your radio: add an entry to `data/radio-profiles.json` following the existing schema and submit a PR.

---

## Installation & Deployment

### GitHub Pages (recommended)

1. Fork or clone the repository to your GitHub account.
2. Go to **Settings → Pages** and set the source to the `main` branch root.
3. GitHub Pages will serve the app at `https://<your-username>.github.io/<repo-name>/`.
4. No build step is needed — everything is vanilla JS ES modules.

### Any static host

The app is a folder of static files. Serve it with:
- Nginx / Apache
- Netlify / Vercel (drop the folder)
- `npx serve .` locally

### PWA installation

- **Android Chrome / Edge:** tap the "Install" banner or the install icon in the address bar.
- **iOS Safari:** tap Share → "Add to Home Screen".
- **Desktop Chrome/Edge:** click the install icon in the address bar.

After installation the app works offline, serving the last-fetched NOAA data and the cached tile layer.

### Libraries (not bundled)

Due to licensing and size, the following libraries are not included in the repo. Download and place them at the exact paths below:

| File | Version | Download |
|---|---|---|
| `lib/leaflet/leaflet.js` | ≥ 1.9 | [leafletjs.com/download](https://leafletjs.com/download.html) |
| `lib/leaflet/leaflet.css` | ≥ 1.9 | same |
| `lib/suncalc.js` | ≥ 1.9 | [github.com/mourner/suncalc](https://github.com/mourner/suncalc/blob/master/suncalc.js) |

### DXCC GeoJSON

The world map requires `data/dxcc.geojson`. Each feature needs these properties:

```json
{
  "dxcc_id": "ON",
  "name":    "Belgium",
  "prefix":  "ON",
  "lat":     50.5,
  "lon":     4.5,
  "continent": "EU",
  "cq_zone": 14,
  "itu_zone": 27
}
```

A suitable free source is the [DXCC boundaries project](https://github.com/zonedoutspace/dxcc-boundaries). Simplify to < 500 KB with [mapshaper.org](https://mapshaper.org/).

### PWA icons

Create PNG icons and place at:
- `icons/icon-192.png` (192 × 192 px)
- `icons/icon-512.png` (512 × 512 px, maskable)

---

## File Structure

```
BandScout/
├── index.html              # Single-page app shell
├── manifest.json           # PWA manifest
├── sw.js                   # Service worker (cache + offline)
├── README.md               # This file
│
├── css/
│   ├── tokens.css          # Design tokens (CSS custom properties)
│   ├── base.css            # Reset, typography, tooltips, help modal
│   ├── layout.css          # Topbar, nav, screen layout
│   ├── map.css             # Leaflet container, legend, terminator, loading overlay
│   ├── timeline.css        # Time scrubber, play button
│   ├── drilldown.css       # Slide-up / sidebar drilldown panel
│   ├── listview.css        # By-Band and By-Region screens
│   ├── opening.css         # Opening Soon screen
│   └── setup.css           # Settings screen, glossary, API health table
│
├── js/
│   ├── app.js              # Entry point: boot, routing, NOAA refresh loop
│   ├── state.js            # Central mutable state object
│   ├── propagation.js      # All RF calculations (pure functions, no DOM)
│   ├── noaa.js             # NOAA API fetch + localStorage cache
│   ├── cache.js            # Score cache builder (DXCC × band × 48 steps)
│   ├── map.js              # Leaflet init, GeoJSON layer, score colours, terminator
│   ├── timeline.js         # Time scrubber, animation loop
│   ├── drilldown.js        # Drilldown panel: scores, radio settings, band plan
│   ├── listview.js         # By-Band and By-Region list views
│   ├── opening.js          # Opening Soon scan and render
│   ├── settings.js         # Settings screen + localStorage read/write
│   ├── bandplan.js         # IARU Region 1/2/3 band plan data and helpers
│   ├── i18n.js             # Translation loader, t() function, DOM applier
│   ├── tooltip.js          # Hover tooltips + [?] help modal system
│   └── utils.js            # Shared helpers (haversine, bearing, grid parse, …)
│
├── data/
│   ├── dxcc.geojson        # DXCC entity polygons + centroids (add separately)
│   ├── radio-profiles.json # Receiver settings per radio × band × condition
│   └── i18n/
│       ├── en.json         # English (default)
│       ├── nl.json         # Dutch
│       ├── fr.json         # French
│       ├── de.json         # German
│       ├── es.json         # Spanish
│       ├── pt.json         # Portuguese
│       └── it.json         # Italian
│
└── lib/                    # Local library copies (add separately — see above)
    ├── leaflet/
    │   ├── leaflet.js
    │   └── leaflet.css
    └── suncalc.js
```

---

## Known Limitations

### Propagation model

**The ionospheric model is empirical, not physics-based.** The pipeline in `propagation.js` uses SFI and Kp to *estimate* MUF and path reliability. It does not run IRI, VOACAP, or any ray-tracing engine. Treat all scores as *relative probability indicators*, not precise link-budget predictions.

**No real-time ionosonde data.** The model never reads actual ionospheric soundings (foF2, M3000F2). SFI is a solar proxy and is a poor substitute for measured electron density during disturbed conditions.

**Greyline window is ±20 minutes.** The actual DX opening width depends on path geometry, antenna direction, and local ionospheric gradients — all of which are unmodelled.

**Sporadic E is statistical.** The Es bonus on 6 m / 10 m is based on calendar season and latitude. It cannot predict actual Es events, which are sudden and uncorrelated with SFI or Kp.

**VHF/UHF is indicative only.** The 2 m score is a rough estimate of troposcatter + Es probability. EME, meteor scatter, and tropospheric ducting are not modelled.

**Antenna modelled as isotropic.** Antenna gain scales scores linearly but does not model take-off angle, directivity, or ground reflection.

**Multi-hop attenuation is approximate.** A fixed loss per additional hop (band-dependent, 2–8 dB) is applied. Actual multi-hop loss depends on ionospheric tilt, path geometry, and intermediate ground conditions.

### Data & coverage

**DXCC centroids are approximate.** Scores are computed to one lat/lon point per entity. Large entities (USA, Russia, Canada, Australia) have huge internal propagation variation.

**~340 DXCC entities, not sub-divisions.** US call areas, Russian oblasts, ITU prefixes within large countries are not separated.

**NOAA SFI latency.** The flux measurement is updated once daily (~18:00 UTC). A sudden solar event (X-flare, proton event) may not be reflected until the next update.

### Application

**Offline propagation is frozen.** The 48-step score cache is built on load and refreshes every 15 minutes. Between refreshes, scores do not reflect real-time ionospheric changes.

**No DX cluster.** Real-time spotted activity is not available due to CORS/CSP restrictions on GitHub Pages.

**No terrain model.** Path losses through mountain ranges are not modelled.

**Radio settings are starting points only.** Profiles represent typical values for a radio *family*, not calibrated measurements of individual units.

---

## Contributing

Pull requests welcome! Please open an issue first for major changes.

**To add a language:**
1. Copy `data/i18n/en.json` → `data/i18n/xx.json` (ISO 639-1 code)
2. Translate all *values* (not keys)
3. Add `{ code: 'xx', label: 'Language name' }` to `SUPPORTED_LANGS` in `js/i18n.js`
4. Add `'xx'` to the `SHELL_ASSETS` array in `sw.js`
5. Open a PR

**To add a radio profile:**
Edit `data/radio-profiles.json`. Follow the existing schema. Each entry needs at least the four condition keys (`noise_low_kp_low`, `noise_high_kp_low`, `noise_low_kp_high`, `noise_high_kp_high`) for the bands your radio supports.

**To report a propagation model bug:**
Include: your grid square, the target entity, the band, the UTC time, observed conditions (SFI / Kp), and what the model predicted vs. what you actually observed on the air.

---

## License

MIT — see [LICENSE](LICENSE).

> **73 de ON3VZ** — Hoboken, Belgium · JO20ev
