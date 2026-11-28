KitStak brand export
====================

Everything here has a transparent background and works on light or dark.

Colors
  Red    #C8102E
  Pink   #D65A6E
  Navy   #0A1628  (text on light)
  Cream  #F5F1E8  (text on dark)

Logo font
  Bebas Neue (SIL Open Font License, free for commercial use), shipped by @kitstak/ui.
  The wordmark reads KITSTAK CREW.

Using the loaders
  Use an <img> tag or a CSS background image:
    <img src="/brand/kitstak-loader-crew.svg" width="64" height="64" alt="Loading">
  They loop forever and stop animating for people who prefer reduced motion.

In this app (KitStak Crew)
  kitstak-icon-crew.svg             The Crew mark (the brand pack's People mark: a pink head over
                                    red shoulders), the official file. Do not redraw or edit it.
  kitstak-icon-crew-512.png         Rendered from the SVG above (transparent).
  kitstak-icon-crew-1024.png        Rendered from the SVG above (transparent).
  kitstak-loader-crew.svg           The Crew loader, the official file. The head pops in as the
                                    shoulders rise. Use it for page loads and long actions
                                    (import check, approve the week, export).
  kitstak-loader-kitstak.svg        The company loader. Use it for sign in and app to app handoff.
  kitstak-icon-{portal,crm,wms,projects,pulse,ledger}.svg   Sibling marks, for links to the other apps.
  kitstak-wordtype.png              The lettered logo.

  The same mark is drawn inline as CrewMark (src/features/shell/logo.tsx), as the "crew" icon
  in @kitstak/ui (AppIcon app="crew") and as the favicon (src/app/icon.svg, icon.png, apple-icon.png).
  Source files: apps/web/public/brand/apps and apps/web/public/brand/loaders.
  To render the PNGs again: sharp(svg, { density: 72 * size / 200 }).resize(size, size).png().
