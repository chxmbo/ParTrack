# ParTrack

A private, installable golf handicap tracker powered by Supabase auth and synced user data.

## What is included

- Static PWA: `index.html`, `styles.css`, `app.js`, `public/manifest.webmanifest`, and `sw.js`
- Supabase email/password auth with private synced profiles and rounds
- Supabase-backed course database for approved, unverified, and private draft courses
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

After the first successful visit, the PWA shell is available offline on that device. Profile, course, and round data requires a signed-in Supabase session and syncs to the database.

## Supabase setup

ParTrack is still a GitHub Pages-hosted static PWA. Supabase provides auth, database storage, row-level security, and cross-device sync. There is no custom backend server.

1. Create or open a Supabase project.
2. In Supabase SQL Editor, run [`supabase/schema.sql`](supabase/schema.sql).
3. In Authentication -> Providers, enable Email.
4. In Authentication -> URL Configuration, set the Site URL to your GitHub Pages app URL, for example `https://USERNAME.github.io/ParTrack/`.
5. In the same URL Configuration screen, add redirect URLs for the hosted app and local testing:

```text
https://USERNAME.github.io/ParTrack/
http://localhost:4173/
```

You can also add wildcard versions such as `https://USERNAME.github.io/ParTrack/**` if you later introduce deeper routes.
6. In GitHub repo Settings -> Secrets and variables -> Actions, add:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
```

7. Push to `main` or run the Pages workflow manually.

The build writes these values into `dist/env-config.js`. The anon key is public by design; data privacy depends on the RLS policies in `supabase/schema.sql`, not on hiding this key.

For local development with Supabase, export the same env vars before building:

```bash
export VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
export VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
npm run build
python3 -m http.server 4173 --directory dist
```

If you open `index.html` directly without Supabase env values, the app shows the sign-in screen but cannot load account data. Use the production build or GitHub Pages URL with configured env vars.

## Auth and data model

Signed-out users see an email/password login screen. Signed-in users see the tracker and their data syncs to Supabase.

Supabase tables:

- `profiles`: one row per auth user
- `courses`: course parent records with `approved`, `pending`, or `rejected` status
- `tees`: tee set details, including hole-by-hole scorecard JSON
- `rounds`: private user rounds, hole scores, differential, and course/tee references

RLS policy intent:

- Users can read/update only their own profile.
- Users can read/write/delete only their own rounds.
- Everyone can read approved courses.
- Creators can immediately use their own pending courses.
- Pending courses can be visible to everyone when `is_public_unverified = true`.
- Regular users can create only `pending` courses.
- Admin users can verify pending courses from the app, which changes the course to `approved` and immediately makes it visible to everyone.

To make your login an admin, set that auth user's app metadata in Supabase to include:

```json
{ "role": "admin" }
```

This must be done from the Supabase dashboard or a trusted admin script, not from the public app.

## Crowdsourced courses

Users can add a missing course with tee name, par, rating, slope, yardage, and hole data. New courses are immediately usable by the creator. If “Share as unverified course” is enabled, other users can see and use the pending course with an Unverified badge.

Course badges:

- Approved: reviewed shared course
- Unverified: community-submitted and visible, but not reviewed
- Private Draft: pending course visible only to its creator

Offline sync queueing is not implemented yet. The PWA shell still works offline, but account data is intentionally sourced from Supabase rather than a separate browser-only tracker state. A follow-up can queue offline course and round submissions locally and sync them when the device comes back online.
