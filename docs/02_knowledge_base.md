# HF Band Scout — Knowledge Base
## Formulas, APIs, Physics, and Reference Data

*Based on the validated propagation engine from Propagation Watch (ON3VZ/JO20ev)*
*Version 1.6 — gesynchroniseerd met de geïmplementeerde code (app v1.6.x, juni 2026)*

> **Changelog t.o.v. v1.0:** MUF-model herschreven (foF2 dag/nacht + obliciteit,
> geëvalueerd op pad-controlepunten); harde MUF-gates vervangen door continue
> taper (FOT/MUF/HPF); D-laagcoëfficiënten herijkt en geëvalueerd op het
> sterkst belichte padpunt; greyline-bonus toegepast ná multihop; multihop
> fractioneel (geen trapfunctie); Es met dagfactor en toegepast óók boven de
> MUF; powerFactor-marges en -grenzen herijkt (25W-anker behouden);
> Kp-forecast-parser aangepast aan het echte NOAA-formaat met synoptische
> UTC-alignment; Kp realtime via `estimated_kp`.

---

## 1. Ionospheric Layer Model

### 1.1 Layer Structure Used in Calculations

| Layer | Altitude | Day behaviour | Night behaviour | Role in app |
|-------|----------|---------------|-----------------|-------------|
| D-layer | 60–90 km | Active (absorbs HF) | Disappears | Absorption factor on low bands |
| E-layer | 90–130 km | Enhanced | Weakens | Sporadic-E source |
| F1-layer | 150–200 km | Present | Merges with F2 | Ignored separately |
| F2-layer | 200–400 km | Peak ionisation | Weakened but present | Primary MUF driver |

### 1.2 Solar Elevation and D-Layer

D-layer absorption is proportional to UV flux at the path endpoints. Solar elevation is a good proxy.

```javascript
// Solar elevation at a point — via SunCalc.js
const pos = SunCalc.getPosition(date, lat, lon);
const elevationDeg = pos.altitude * (180 / Math.PI);

// D-layer absorption factor (0 = no absorption, 1 = full absorption)
// Sigmoid curve centred at elevation 0°, width ~20°
function dLayerFactor(elevationDeg) {
  // Returns 0 at night, 1 at solar noon
  return Math.max(0, Math.min(1, 1 / (1 + Math.exp(-0.15 * elevationDeg))));
}
```

D-layer absorption effect per band (multiplied by dLayerFactor):

| Band | Absorption coefficient (k) | Notes |
|------|---------------------------|-------|
| 160m | 0.90 | Near-total absorption when sun up |
| 80m  | 0.70 | Strong daytime absorption (herijkt van 0.85) |
| 40m  | 0.50 | Moderate (herijkt van 0.65 — 40m overdag niet meer donkerrood) |
| 30m  | 0.35 | Partial |
| 20m  | 0.15 | Low — mostly usable daytime |
| 17m  | 0.05 | Negligible |
| 15m–6m | 0.04–0.005 | Negligible |

```javascript
function bandAbsorptionPenalty(band, elevTx, elevRx) {
  const k = { '160m':0.90,'80m':0.70,'40m':0.50,'30m':0.35,'20m':0.15,'17m':0.05,
              '15m':0.04,'12m':0.03,'10m':0.01,'6m':0.005 };
  const coeff = k[band] ?? 0.02;
  return 1 - coeff * Math.max(dLayerFactor(elevTx), dLayerFactor(elevRx));
}
```

**Belangrijk (v1.6):** in de pipeline wordt deze functie aangeroepen met de
*maximale zonshoogte over alle pad-controlepunten* (niet alleen de eindpunten).
Een 40m-pad dat over een daglicht-middenpunt loopt, absorbeert dus correct —
ook als beide eindpunten in het donker liggen.

---

## 2. MUF Model

### 2.1 Formula

**v1.6-model.** De oude formule `(SFI×0.12+2) × min(1, dist/4000)` gaf voor
korte paden MUF ≈ 0 (heel Europa "boven MUF" = grijs) en kende geen dag/nacht.
Het huidige model: kritische frequentie foF2 (SFI-afhankelijk, geschaald op
zonshoogte) × obliciteitsfactor.

```javascript
function estimateMUF(sfi, distanceKm, solarElevDeg = 90) {
  const foF2base = 2 + sfi * 0.08;          // ~13.5 MHz @ SFI 144 (dagpiek)
  const dayScale = 0.5 + 0.5 * Math.max(0, Math.min(1, solarElevDeg / 40));
  const foF2     = foF2base * dayScale;     // nacht ~0.5×, zon hoog = vol
  const obliquity = 1 + 2.4 * Math.min(1, distanceKm / 3000); // 1 → 3.4
  return foF2 * obliquity;
}
```

**Pad-controlepunten (v1.6).** `solarElevDeg` is de **minimale** zonshoogte
over de controlepunten van het pad: de eindpunten, plus voor paden ≥ 2000 km
punten op ~1500 km van elk eind en het padmidden (great-circle-interpolatie).
Het zwakste segment gate-t de F2-reflectie — een pad naar Japan om 00:00 UTC
krijgt dus nacht-MUF (pad over donker Siberië), ook al staat de zon in Tokio op.

### 2.2 Band Gating

**v1.6: continue taper i.p.v. harde gates.** De binaire overgangen
(open → vaste 15% → 0%) gaven harde kleur-cliffs tussen buurlanden. Nu een
kansfactor verankerd op de klassieke definities — FOT (≈ 0.85×MUF) ≈ 100%,
de MUF zelf = 50% (per definitie de mediaanfrequentie), uitlopend naar 0 bij
ratio 1.30:

```javascript
function mufFactor(bandFreqMHz, muf) {
  const ratio = bandFreqMHz / muf;
  if (ratio <= 0.85) return 1.0;
  if (ratio >= 1.30) return 0.0;
  if (ratio < 1.0)   return 0.75 + 0.25 * Math.cos(Math.PI * (ratio - 0.85) / 0.15);
  return                    0.25 + 0.25 * Math.cos(Math.PI * (ratio - 1.0)  / 0.30);
}

// bandStatus levert alleen nog het label (closed pas bij ratio > 1.30):
function bandStatus(bandFreqMHz, muf) {
  const ratio = bandFreqMHz / muf;
  if (ratio > 1.30) return { status: 'closed' };
  if (ratio > 0.95) return { status: 'marginal' };
  if (ratio > 0.80) return { status: 'good' };
  return               { status: 'suboptimal' };
}
```

Bij `closed` geldt nog een **skip-zone-vloer** van 8% voor paden < 1200 km
(backscatter/grondgolf/NVIS) en wordt de **Es-bonus alsnog toegepast** —
Sporadic-E is immers precies het mechanisme dat 10m/6m opent als de F2-MUF
te laag is.

Band centre frequencies (MHz):

| Band | Freq MHz | Band | Freq MHz |
|------|----------|------|----------|
| 160m | 1.850 | 17m | 18.118 |
| 80m  | 3.700 | 15m | 21.200 |
| 40m  | 7.100 | 12m | 24.940 |
| 30m  | 10.125 | 10m | 28.500 |
| 20m  | 14.175 | 6m  | 51.000 |

---

## 3. Base Reliability from SFI

```javascript
// SFI → base reliability (0–1)
// SFI 70 = floor (solar minimum), SFI 200+ = excellent
function sfiBaseReliability(sfi) {
  return Math.min(1, Math.max(0.05, sfi / 150));
}
```

| SFI | Base reliability |
|-----|-----------------|
| 70  | 0.47 |
| 100 | 0.67 |
| 130 | 0.87 |
| 150 | 1.00 |
| 180 | 1.00 (capped) |

---

## 4. Kp Degradation Matrix

A geomagnetic storm degrades the ionosphere differently per band. Low bands are hit harder (polar path dependency). Values are fractional multipliers on the base reliability.

```javascript
// kpMatrix[band][kp_integer]
const kpMatrix = {
  '160m': [1.00,0.90,0.75,0.50,0.25,0.10,0.00,0.00,0.00,0.00],
  '80m':  [1.00,0.90,0.80,0.60,0.35,0.15,0.05,0.00,0.00,0.00],
  '40m':  [1.00,0.95,0.85,0.70,0.50,0.25,0.10,0.05,0.00,0.00],
  '30m':  [1.00,0.98,0.90,0.80,0.60,0.35,0.15,0.05,0.00,0.00],
  '20m':  [1.00,1.00,0.95,0.85,0.65,0.40,0.20,0.05,0.00,0.00],
  '17m':  [1.00,1.00,0.97,0.88,0.70,0.45,0.25,0.10,0.02,0.00],
  '15m':  [1.00,1.00,0.98,0.90,0.75,0.50,0.30,0.12,0.03,0.00],
  '12m':  [1.00,1.00,0.99,0.92,0.78,0.55,0.33,0.15,0.05,0.00],
  '10m':  [1.00,1.00,1.00,0.95,0.82,0.60,0.38,0.18,0.06,0.01],
  '6m':   [1.00,1.00,1.00,0.97,0.88,0.70,0.50,0.30,0.12,0.04],
};

function kpFactor(band, kp) {
  const row = kpMatrix[band] ?? kpMatrix['20m'];
  const idx = Math.min(9, Math.max(0, Math.floor(kp)));
  return row[idx];
}
```

*Sources to validate: NOAA Space Weather Scales, RSGB Propagation Studies Committee, IPS Radio and Space Services (Australia).*

---

## 5. Greyline Detection and Bonus

### 5.1 What Is the Greyline

The greyline (terminator) is the sunrise/sunset zone. When both endpoints of a path are simultaneously in the greyline:
- D-layer absorption is minimal on both ends
- F-layer is still (or just became) fully ionised
- Low bands (40m, 80m, 30m) open for DX that is otherwise blocked

### 5.2 Detection Algorithm

```javascript
// Greyline window: ±20 minutes around sunrise or sunset
const GREYLINE_WINDOW_MIN = 20;

function isInGreyline(date, lat, lon) {
  const times = SunCalc.getTimes(date, lat, lon);
  const now = date.getTime();
  const windows = [
    [times.sunrise.getTime(), 'sunrise'],
    [times.sunset.getTime(),  'sunset']
  ];
  for (const [t] of windows) {
    if (Math.abs(now - t) <= GREYLINE_WINDOW_MIN * 60 * 1000) return true;
  }
  return false;
}

// Greyline bonus: apply only to bands that benefit
// 40m, 80m, 30m get the biggest boost when both ends in greyline
const greylineBonusBands = {
  '80m': 0.30, '40m': 0.25, '30m': 0.20,
  '20m': 0.10, '160m': 0.15,
  // Higher bands: negligible greyline effect
};

function greylineBonus(band, isTxGL, isRxGL) {
  if (!isTxGL && !isRxGL) return 0;
  const maxBonus = greylineBonusBands[band] ?? 0.05;
  if (isTxGL && isRxGL) return maxBonus;        // both in greyline: full bonus
  return maxBonus * 0.4;                          // one end: partial bonus
}
```

**Volgorde (v1.6):** de bonus wordt opgeteld **ná** de multihop-attenuatie.
Voorheen werd hij ervóór opgeteld en daardoor op lange paden (bv. 80m naar VK,
multihop-factor ~0.06) weggevermenigvuldigd — exact het scenario waarvoor
greyline-DX bestaat.

---

## 6. Power Correction (Mode-Aware)

### 6.1 Link Budget Principle

```
SNR_received = EIRP_tx + Ant_gain_rx - PathLoss - NoiseFloor
Halving power = −3 dB SNR
```

The power factor expresses how much of the available SNR margin is consumed by the power deficit.

### 6.2 Mode SNR Margins (at 100W, good path)

| Mode | SNR threshold (dB) | Marge in model (dB) | Tolerance to QRP |
|------|--------------------|---------------------|-----------------|
| FT8  | −21 | 44 | Excellent |
| FT4  | −17 | 40 | Very good |
| JT65 | −25 | 48 | Excellent |
| CW   | −10 | 36 | Good |
| SSB  |   0 | 30 | Poor (most sensitive) |
| AM   |   5 | 22 | Very poor |
| MSK144| −10 | 36 | Good (meteor scatter) |
| default | — | 32 | — |

*De marges zijn in de praktijk herijkt (groter dan de pure SNR-marges) zodat
25W realistische scores geeft; zie het 25W-anker hieronder.*

### 6.3 Power Factor Calculation

```javascript
const REFERENCE_POWER_W = 100;

const MODE_MARGINS = {
  'FT8': 44, 'FT4': 40, 'JT65': 48, 'CW': 36,
  'SSB': 30, 'AM': 22, 'MSK144': 36, 'default': 32,
};

function powerFactor(txPowerW, mode) {
  const dBdiff = 10 * Math.log10(txPowerW / REFERENCE_POWER_W);
  // Mode-normalisatie: settings slaat lowercase op ('ssb')
  const margin = MODE_MARGINS[String(mode ?? '').toUpperCase()] ?? MODE_MARGINS['default'];
  return Math.max(0.25, Math.min(1.25, 1 + (dBdiff / margin)));
}
```

Gerealiseerde factoren (v1.6, floor 0.25 / cap 1.25):

| Power | FT8 | CW | SSB |
|-------|-----|-----|-----|
| 1 W    | 0.55 | 0.44 | 0.33 |
| 5 W    | 0.70 | 0.64 | 0.57 |
| **25 W (anker)** | **0.86** | **0.83** | **0.80** |
| 100 W  | 1.00 | 1.00 | 1.00 |
| 1500 W | 1.25 | 1.25 | 1.25 |

*25W SSB werkt in de praktijk — vandaar factor 0.80 als kalibratie-anker.
QRP-SSB is terecht zwaar (1W → 0.33); QRP-digitaal blijft bruikbaar.*

---

## 7. Distance and Multi-Hop Attenuation

### 7.1 Great-Circle Distance

```javascript
// Haversine formula
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
            Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
            Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
```

### 7.2 Multi-Hop Attenuation

Each additional ionospheric reflection introduces additional loss. Approximate model:

```javascript
// Number of hops (alleen nog voor weergave in de drill-down)
function numHops(distanceKm) {
  return Math.ceil(distanceKm / 3500);
}

// Loss per hop (dB) — approximate
const HOP_LOSS_DB = {
  '160m': 8, '80m': 6, '40m': 5, '30m': 4,
  '20m': 3, '17m': 3, '15m': 2.5, '12m': 2, '10m': 2, '6m': 2,
};

// v1.6: FRACTIONELE hops — de oude ceil()-trapfunctie gaf harde sprongen op
// hopgrenzen (3400 km factor 1.00 → 3600 km factor 0.71) die op de kaart als
// concentrische kleurringen zichtbaar waren.
function multiHopFactor(band, distanceKm) {
  const hopsF = distanceKm / 3500;
  if (hopsF <= 1) return 1.0;
  const lossPerHop = HOP_LOSS_DB[band] ?? 3;
  return Math.pow(10, -(lossPerHop * (hopsF - 1)) / 20);
}
```

### 7.3 F2 Gradient (Short Path Gate)

F2 gradient only applies to paths > 1500 km. For shorter paths, skip F2 factors entirely to avoid inverting day/night preferences.

```javascript
const F2_GRADIENT_MIN_KM = 1500;

function applyF2Gradient(reliability, distanceKm, sfi, solarElevTx) {
  if (distanceKm < F2_GRADIENT_MIN_KM) return reliability; // no-op for short paths
  // F2 slightly better on dayside for long paths
  const dayBonus = Math.max(0, solarElevTx / 90) * 0.08;
  return Math.min(0.99, reliability + dayBonus);
}
```

---

## 8. Sporadic-E (Es) Model

Sporadic-E is a probabilistic phenomenon — unpredictable but statistically elevated in summer at mid-latitudes, especially for 10m and 6m.

```javascript
// Sporadic-E probability estimate
// Peak: May–August in NH, Nov–Feb in SH
// Most common: 10m, 6m. Possible: 12m, 15m
// Paths: typically 1000–2500 km (single-hop Es)

function esBonus(band, month, distanceKm, lat, localHour = 15) {
  const esBands = { '6m': 0.4, '10m': 0.25, '12m': 0.10, '15m': 0.05 };
  const basePct = esBands[band];
  if (!basePct) return 0;

  // Distance gate: Es paths are 800–2500 km typically
  if (distanceKm < 800 || distanceKm > 2600) return 0;

  const isNHPeak = lat >= 0 && [5,6,7].includes(month);   // mei–juli (NH)
  const isSHPeak = lat <  0 && [11,12,1].includes(month); // nov–jan (SH)
  const seasonFactor = (isNHPeak || isSHPeak) ? 1.0 : 0.2;

  // v1.6: dagfactor — Es piekt rond late ochtend/vroege avond, zeldzaam
  // 's nachts. localHour = lokale zonnetijd op het PADMIDDEN.
  const diurnal = 0.3 + 0.7 * Math.max(0, Math.cos((localHour - 15) * Math.PI / 12));

  return basePct * seasonFactor * diurnal;
}
```

**v1.6:** de Es-bonus wordt óók toegepast wanneer de band boven de F2-MUF zit
(in de `closed`-tak van de pipeline) — Es is juist dán het relevante mechanisme.

---

## 9. Full Reliability Pipeline

De werkelijke implementatie staat in `js/propagation.js` (single source of
truth). Pipeline-volgorde in v1.6:

```
 1. Afstand (haversine) + pad-controlepunten (great-circle, §2.1)
 2. Zonshoogtes op eindpunten + controlepunten
    → minPathElev (gate-t MUF), maxPathElev (drijft D-laag)
 3. MUF = estimateMUF(sfi, dist, minPathElev); status = bandStatus(...)
    → status 'closed' (ratio > 1.30): skip-zone-vloer 8% (< 1200 km),
      Es-bonus alsnog toegepast (status 'sporadic-e'), power-correctie, klaar.
 4. Basis = sfiBaseReliability(sfi) × mufFactor(bandFreq, muf)   [taper §2.2]
 5. × kpFactor(band, kp)                                          [matrix §4]
 6. × bandAbsorptionPenalty(band, maxPathElev, maxPathElev)       [D-laag §1.2]
 7. Greyline-detectie op TX/RX (±20 min rond zonsop/-ondergang)
 8. F2-gradient (alleen paden ≥ 1500 km — NOOIT korter)
 9. × multiHopFactor(band, dist)                                  [fractioneel §7.2]
10. + greylineBonus (additief, NÁ multihop — zie §5.2)
11. + esBonus (met dagfactor op padmidden-zonnetijd — zie §8)
12. score100W = clamp(rel × 100, 0–99)
13. score     = clamp(rel × powerFactor(txPowerW, mode) × 100, 0–99)
```

Retourneert `{ score, score100W, details: { distKm, muf, elevTx, elevRx,
isTxGL, isRxGL, status, hops } }`.

---

## 10. VHF/UHF Scoring (2m, 70cm)

VHF/UHF propagation is fundamentally different from HF. For Class C operators who have 2m and 70cm:

- **Default:** line-of-sight / troposcatter model (distance-based)
- **No ionospheric model** for these bands
- **Tropo range** estimate:

```javascript
// Radio horizon (simplified, no terrain)
function radioHorizonKm(txHeightM = 10, rxHeightM = 10) {
  // d = 4.12 × (√htx + √hrx) in km, for heights in metres
  return 4.12 * (Math.sqrt(txHeightM) + Math.sqrt(rxHeightM));
}

// Score drops off steeply beyond radio horizon
function vhfTropoScore(distKm, txHeightM = 10) {
  const horizon = radioHorizonKm(txHeightM);
  if (distKm <= horizon) return 90;        // near-certain in LoS
  if (distKm <= horizon * 2) return 50;    // tropo scatter likely
  if (distKm <= horizon * 4) return 15;    // possible tropo ducting
  return 0;                                 // beyond range
}
```

*Note: Tropo ducting, EME, and meteor scatter are not modelled — documented as known limitation.*

---

## 11. External APIs

### 11.1 NOAA SWPC — Solar Flux (SFI)

```
URL: https://services.swpc.noaa.gov/json/f107_cm_flux.json
Method: GET
CORS: ✅ (public API, Access-Control-Allow-Origin: *)
Auth: None
Rate limit: Reasonable use (no hard limit documented)
Update frequency: Daily (flux measurement at 2000 UTC)
Cache TTL recommended: 1 hour
```

Response structure:
```json
[
  { "time_tag": "2024-05-01T20:00:00", "flux": 142.3, "observed_flux": 140.1 }
]
```
Use `flux` field (adjusted). Take the most recent entry.

### 11.2 NOAA SWPC — Kp Index (real-time, 1-minute)

```
URL: https://services.swpc.noaa.gov/json/planetary_k_index_1m.json
Method: GET
CORS: ✅
Cache TTL: 15 minutes
```

Response: array van `{ time_tag, kp_index, estimated_kp, … }`. Neem de meest
recente entry en gebruik **`estimated_kp`** (real-time decimaal) met fallback
op `kp_index` (afgerond geheel getal).

### 11.3 NOAA SWPC — 3-Day Kp Forecast

```
URL: https://services.swpc.noaa.gov/text/3-day-geomag-forecast.txt
Method: GET
CORS: ✅
Cache TTL: 3 hours
```

Plain text. **Let op het werkelijke formaat (v1.6):** rijen = 3-uurs
UT-slots, kolommen = dagen — *niet* het oude "Month DD n n n…"-formaat:

```
NOAA Kp index forecast 10 Jun - 12 Jun
             Jun 10    Jun 11    Jun 12
00-03UT        3.67      2.00      3.67
03-06UT        2.67      2.00      4.00
…
```

De parser leest de kolomheader (datums, incl. jaarovergang) en de slot-rijen,
en levert `{ values: number[24] chronologisch, startMs: middernacht UTC van
dag 1 }`. `getKpAtStep(step)` rekent het absolute UTC-tijdstip van de stap om
naar de juiste synoptische slot-index vanaf `startMs`; binnen het huidige
3-uurs slot wint de real-time meting van de forecast. Gebruikt voor de
tijdlijn-cache en "opening soon".

### 11.4 NOAA SWPC — Space Weather Alerts

```
URL: https://services.swpc.noaa.gov/products/alerts.json
Method: GET
CORS: ✅
Cache TTL: 15 minutes
```

Returns active alerts. Filter for `product_id` containing "WATCH", "WARNING", "ALERT". Show relevant alerts in the UI (storm warnings, flare alerts).

### 11.5 SunCalc.js (client-side, no API)

```
Library: suncalc.js (standalone, no dependencies)
Source: https://github.com/mourner/suncalc
License: BSD 2-Clause
Size: ~4KB minified
```

Functions used:
- `SunCalc.getPosition(date, lat, lon)` → `{ altitude, azimuth }` (radians)
- `SunCalc.getTimes(date, lat, lon)` → `{ sunrise, sunset, goldenHour, ... }`

---

## 12. DXCC Entity Reference Data

### 12.1 GeoJSON Structure

Each feature in `dxcc.geojson`:
```json
{
  "type": "Feature",
  "properties": {
    "dxcc_id": 206,
    "name": "Belgium",
    "prefix": "ON",
    "continent": "EU",
    "itu_zone": 14,
    "cq_zone": 14,
    "lat": 50.5,
    "lon": 4.5,
    "deleted": false
  },
  "geometry": { "type": "MultiPolygon", "coordinates": [...] }
}
```

`lat/lon` in `properties` is the centroid used for propagation calculations. `geometry` is for display only.

### 12.2 CQ Zones (relevant for band plan context)

| Zone | Region |
|------|--------|
| 14 | Western Europe (Belgium = CQ14) |
| 5 | Canada (Maritime) |
| 8 | Scandinavia |
| 3 | Alaska |
| 26 | Japan |
| 38 | South Africa |

### 12.3 ITU Regions for Band Plans

| Region | Coverage |
|--------|----------|
| 1 | Europe, Africa, Middle East, North Asia |
| 2 | Americas |
| 3 | Asia-Pacific |

Default: derived from user's grid square. ITU Region 1 for JO20ev (Belgium).

---

## 13. Licence Band Access

### 13.1 Belgian/CEPT Novice (Class C)

```javascript
const BAND_ACCESS = {
  'A': ['160m','80m','60m','40m','30m','20m','17m','15m','12m','10m','6m','4m','2m','70cm','23cm'],
  'B': ['80m','40m','30m','20m','17m','15m','12m','10m','6m','2m','70cm'],  // typical
  'C': ['80m','40m','30m','20m','15m','10m','2m','70cm']
};
```

*Source to validate: BIPT (Belgium), CEPT Recommendation T/R 61-02 for Novice.*

### 13.2 Power Limits

```javascript
const POWER_LIMITS = { 'C': 25, 'B': 100, 'A': 1500 };
const POWER_DEFAULTS = { 'C': 25, 'B': 75,  'A': 100 };
const POWER_MINS = { 'C': 1, 'B': 1, 'A': 1 };
```

---

## 14. Radio Settings Profiles

### 14.1 Profile Structure

File: `data/radio-profiles.json`

```json
{
  "icom-7300-mk2": {
    "name": "Icom IC-7300 MkII",
    "brand": "Icom",
    "family": "ic-7300",
    "bands": {
      "40m": {
        "noise_low_kp_low": {
          "preamp": "P1",
          "nb": "off",
          "filter": "2.4 kHz",
          "agc": "fast",
          "squelch": "off",
          "note": "Good conditions — open filter, fast AGC to catch weak signals."
        },
        "noise_high_kp_low": {
          "preamp": "off",
          "nb": "NB1 low",
          "filter": "1.8 kHz",
          "agc": "slow",
          "squelch": "off",
          "note": "High noise floor (thunderstorm season) — tighten filter, reduce gain."
        },
        "kp_high": {
          "preamp": "P1",
          "nb": "NB1 med",
          "filter": "500 Hz",
          "agc": "slow",
          "squelch": "off",
          "note": "Disturbed conditions — narrow filter, patient AGC."
        }
      }
    }
  }
}
```

### 14.2 Condition Mapping

```javascript
function getConditionKey(band, kp, sfi, noiseLevel) {
  if (kp >= 4) return 'kp_high';
  if (noiseLevel === 'high') return 'noise_high_kp_low';
  return 'noise_low_kp_low';
}
```

Noise level is estimated: summer months in EU → higher static noise on low bands.

### 14.3 Supported Radio Families

| Family key | Models |
|-----------|--------|
| `icom-ic7300` | IC-7300, IC-7300 MkII |
| `icom-ic705` | IC-705 |
| `icom-ic7610` | IC-7610 |
| `yaesu-ft891` | FT-891 |
| `yaesu-ft991a` | FT-991A |
| `yaesu-ft710` | FT-710, FTDX10 |
| `kenwood-ts890s` | TS-890S |
| `kenwood-ts590sg` | TS-590SG |
| `kenwood-ts990s` | TS-990S |
| `elecraft-k4` | K4 |
| `elecraft-k3s` | K3S |
| `elecraft-kx` | KX2, KX3 |
| `flexradio-6400` | Flex-6400 |
| `flexradio-6600` | Flex-6600, Flex-6700 |
| `xiegu-g90` | G90 |
| `xiegu-x6100` | X6100 |
| `xiegu-g106` | G106 |

---

## 15. Band Plan Reference Data

### 15.1 IARU Region 1 — Key Sub-Bands (simplified)

File: `data/band-plans.json` — partial example:

```json
{
  "region1": {
    "40m": {
      "cw_only": [7000, 7040],
      "digi_weak_signal": [7040, 7060],
      "ft8": 7074,
      "phone_ssb": [7060, 7200],
      "dx_window_ssb": [7175, 7200]
    },
    "20m": {
      "cw_only": [14000, 14070],
      "ft8": 14074,
      "phone_ssb": [14100, 14350],
      "dx_window_ssb": [14190, 14350]
    }
  }
}
```

### 15.2 Region Auto-Detection from Grid Square

```javascript
function iauRegionFromGrid(grid) {
  // Grid prefix → approximate longitude → ITU region
  // A-R columns, each 20° wide, starting at -180°
  const col = grid.charCodeAt(0) - 65; // 0-17
  const lon = col * 20 - 180 + 10;     // centre of column
  if (lon >= -170 && lon <= -30) return 2; // Americas
  if (lon >= 100 && lon <= 180) return 3;  // Asia-Pacific
  return 1; // Europe/Africa/Middle East default
}
```

---

## 16. Score Colour Scale

Map colours for DXCC entity fill:

| Score | Colour | Hex | Description |
|-------|--------|-----|-------------|
| 0% | Dark grey | #2A2A2A | Closed / unreachable |
| 1–15% | Dark red | #6B1A1A | Marginal (above MUF) |
| 16–30% | Red-orange | #8B3A00 | Poor |
| 31–50% | Orange | #EF9F27 | Moderate |
| 51–70% | Yellow-green | #8BB530 | Good |
| 71–85% | Green | #1D9E75 | Very good |
| 86–99% | Bright green | #00C896 | Excellent |

Greyline active border: `#BA7517` (amber), 2px stroke.

---

## 17. localStorage Schema

```javascript
// Key: 'hfbs_v1'
{
  "configured": true,
  "language": "en",
  "theme": "dark",
  "location": {
    "callsign": "ON3VZ",
    "grid": "JO20ev",
    "lat": 51.18,
    "lon": 4.35,
    "label": "Hoboken, Belgium"
  },
  "station": {
    "licenseClass": "C",     // "A" | "B" | "C"
    "txPowerW": 25,
    "qrpMode": false,
    "mode": "FT8",            // default operating mode
    "radio": "icom-7300-mk2", // key from radio-profiles.json
    "iauRegion": 1
  },
  "ui": {
    "defaultBand": "20m",
    "thresholdPct": 40,
    "colorBlindMode": false,
    "openingSoonHours": 2
  }
}

// Key: 'hfbs_noaa_cache'
{
  "kp": 1.7,
  "sfi": 142,
  "kpForecast": [...],
  "alerts": [...],
  "fetchedAt": 1716001234567
}
```

---

## 18. Known Limitations and Honest Documentation

These must be documented in the app's README and shown as a tooltip/info panel:

1. **MUF model is empirical** — formula `(SFI×0.12+2)×distFactor` is a simplified approximation. VOACAP would be more accurate but requires a server. This app trades accuracy for speed and zero backend.

2. **Kp matrix is a starting approximation** — values derived from NOAA Space Weather Scales and published literature, not measured data. Behaviour near the poles (lat > 55°) is less accurate.

3. **No terrain model** — path losses through mountains are not modelled.

4. **VHF/UHF is LoS/tropo only** — no EME, meteor scatter, or auroral reflection modelling for 2m/70cm.

5. **Sporadic-E is probabilistic** — the model gives seasonal probability with a diurnal factor (v1.6), not real-time detection. Actual Es openings are sudden and unpredictable.

6. **DXCC centroids** — scoring uses one point per entity. Large entities (USA, Russia, Canada) have wide variation in actual propagation.

7. **Radio settings are generic** — profiles represent typical starting points for a radio family, not calibrated per individual unit.

8. **No DX cluster** — real-time spotted activity not available due to CORS/CSP restrictions on GitHub Pages.

---

## 19. References and Validation Sources

- **NOAA Space Weather Scales** — https://www.swpc.noaa.gov/noaa-scales-explanation
- **RSGB Propagation Studies Committee** — https://www.rsgb.org/main/communications/propagation/
- **VOACAP Online** — https://www.voacap.com (reference for MUF model validation)
- **IPS Radio and Space Services (Australia)** — https://www.ips.gov.au/HF_Systems
- **IARU Region 1 Band Plan** — https://www.iaru-r1.org/reference/band-plans/
- **BIPT (Belgian Institute for Postal Services and Telecommunications)** — https://www.bipt.be
- **CEPT Recommendation T/R 61-02** — Novice licence band access
- **SunCalc.js** — https://github.com/mourner/suncalc
- **Leaflet.js** — https://leafletjs.com
- **Natural Earth GeoJSON** (DXCC polygon source) — https://www.naturalearthdata.com
