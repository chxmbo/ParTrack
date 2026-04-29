# ParTrack

A private, offline-capable golf handicap tracker inspired by the utility of apps like 18Birdies without the social feed.

## What is included

- Static PWA: `index.html`, `styles.css`, `app.js`, `public/manifest.webmanifest`, and `sw.js`
- Local-only storage for courses, hole-by-hole tee data, and rounds
- Course tee sets include an 18-hole card with par, yardage, and per-hole handicap index
- Estimated WHS handicap index calculation from completed hole scores, course rating, slope, and PCC
- GitHub Pages workflow in `.github/workflows/deploy-pages.yml`

This is a personal/local handicap tracker. It is not an official GHIN, USGA, R&A, or WHS handicap service, and it does not submit scores to any official handicap authority.

## Handicap calculation notes

The handicap calculation formula follows USGA guidance:

```text
(113 / Slope Rating) * (Adjusted Gross Score - Course Rating - PCC)
```

The index calculation uses the current WHS fewer-than-20 table and best 8 of the latest 20 handicap values. It does not yet implement exceptional score reduction, soft cap, hard cap, 9-hole round handling, or hole-by-hole net double bogey adjustment.

References:

- USGA: https://www.usga.org/handicapping/roh/Content/rules/5%202a%20For%20Fewer%20Than%2020%20Scores.htm
- USGA FAQ: https://www.usga.org/content/usga/home-page/handicapping/world-handicap-system/world-handicap-system-usga-golf-faqs/faqs---what-is-a-score-differential.html

## Run locally

Service workers need a web server.

```bash
npm run build
python3 -m http.server 4173
```

Then open http://localhost:4173.

To preview the production build:

```bash
npm run build
python3 -m http.server 4173 --directory dist
```

## Deploy with GitHub Pages

1. Push this repository to GitHub.
2. In the repo, go to Settings -> Pages.
3. Set Source to GitHub Actions.
4. Push to `main`; `.github/workflows/deploy-pages.yml` runs `npm run build` and publishes `dist`.

The app uses relative asset, manifest, and service worker paths, so it works from a repository path such as `https://USERNAME.github.io/REPOSITORY/` without a Vite `base` setting.

## Install on a phone

On iPhone Safari:

1. Open the GitHub Pages URL in Safari.
2. Tap Share.
3. Tap Add to Home Screen.
4. Open ParTrack from the home screen once while online so the offline cache is populated.

On Android Chrome:

1. Open the GitHub Pages URL in Chrome.
2. Tap the install prompt, or open the menu and tap Add to Home screen or Install app.
3. Open ParTrack once while online so the offline cache is populated.

After the first successful visit, the PWA shell is available offline on that device.
Courses and rounds are stored in the browser's local storage on that device. There is no backend or remote database.
