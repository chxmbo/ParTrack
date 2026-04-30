# ParTrack Design Handoff

This chat is the design source of truth for the published ParTrack UI. The technical implementation chat should treat the current Field Ledger mockups in `design-options.html#new-iterations` as the target design direction.

## Current Direction

- Home should use the Field Ledger direction: compact, dark-first, understated, with the most recent round visible on the home page.
- Round cards should stay compact until opened; do not overemphasize tees.
- Mid-round scoring should use the Score Slip direction and hide totals, to-par, differential, and stats until the round is complete.
- Courses should say "courses", not "tracks"; course catalog and add-course flows should be simple, compact pages.
- Settings should be minimal: Theme set to Device, Sync status showing whether data is synced, and a small Sync now action. No export, handicap-rules setting, scoring-mode setting, or "Private" page title.
- Bottom navigation labels are Rounds, Courses, Home, Stats, Settings. Rounds uses a circled 3 birdie icon; Stats uses a minimal bar chart icon.
- Buttons in the Field Ledger pages should be compact so the design has room to breathe.

## Implementation Notes

- Use the design board as the product/design contract, then map it into the real app views.
- Keep light/dark mode device-driven through `prefers-color-scheme`.
- Use the ParTrack mark consistently without stretching or distortion.
- Preserve existing handicap/data logic while changing presentation.
