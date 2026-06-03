# HF Band Scout — GitHub Pages Deployment

## Eerste keer deployen

```bash
# 1. Clone jouw fork
git clone https://github.com/ON3VZ/BandScout.git
cd BandScout

# 2. Kopieer alle gegenereerde bestanden hierin
#    (overschrijf de lege README)

# 3. Commit en push
git add -A
git commit -m "feat: initial HF Band Scout v1.0"
git push origin main
```

## GitHub Pages activeren

1. Ga naar je repo → **Settings** → **Pages**
2. Source: **Deploy from a branch**
3. Branch: **main** / **(root)**
4. Klik **Save**

Na ~60 seconden is de app live op:
`https://on3vz.github.io/BandScout/`

## Bijwerken na wijzigingen

```bash
git add -A
git commit -m "fix: beschrijving van wijziging"
git push origin main
```

GitHub Pages herdeployt automatisch.

## Service Worker cache resetten

Bij elke deployment de versiestring in `sw.js` ophogen:
```js
const APP_VERSION = 'v1.0.1';  // ← verhoog bij elke release
```

Dit dwingt bestaande gebruikers de nieuwe bestanden op te halen.
