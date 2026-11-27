KitStak brand export
====================

Everything here has a transparent background and works on light or dark.

icons/svg      Static icons, vector. Use these first.
icons/png      Same icons as transparent PNG at 512 and 1024 pixels.
loaders        Animated loading icons, one looping SVG per app.
logos/svg      Lettered logos, vector, text converted to outlines.
logos/png      Lettered logos, transparent PNG, 2400 pixels wide.
fonts          Logo font files and license.

Colors
  Red    #C8102E
  Pink   #D65A6E
  Navy   #0A1628  (text on light)
  Cream  #F5F1E8  (text on dark)

Logo font
  Bebas Neue (SIL Open Font License, free for commercial use).
  Files: fonts/BebasNeue-Regular.ttf and .woff2, license in OFL-LICENSE.txt.
  Logo lettering uses +0.0485em letter spacing and no kerning.
  Lettered logos come as on-light (navy text) and on-dark (cream text).

Names
  The file names use placeholder labels (warehouse, crm, projects, people,
  portal, pulse). Rename them when the product names are final.

Using the loaders
  Use an <img> tag or a CSS background image:
    <img src="kitstak-loader-warehouse.svg" width="64" height="64" alt="Loading">
  They loop forever and stop animating for people who prefer reduced motion.

In this app (KitStak Pulse)
  kitstak-icon-pulse.svg            The Pulse mark, the official file. Do not redraw or edit it.
                                    Red bar 40,62 120x30. Pink track 40,108 120x30 at 35 percent.
                                    Pink fill 40,108 84x30.
  kitstak-icon-pulse-512.png        Rendered from the SVG above (transparent).
  kitstak-icon-pulse-1024.png       Rendered from the SVG above (transparent).
  kitstak-loader-pulse.svg          The Pulse loader, the official file. Use it for page loads
                                    and long actions (import check, sync, month close).
  kitstak-loader-kitstak.svg        The company loader. Use it for sign in and app to app handoff.
  kitstak-icon-{portal,crm,wms,projects}.svg   Sibling marks, for links to the other apps.
  kitstak-wordtype.png              The lettered logo.

  The same mark is drawn inline as PulseMark (src/features/shell/logo.tsx), as the "pulse" icon
  in @kitstak/ui (app switcher) and as the favicon (src/app/icon.svg, icon.png, apple-icon.png).
  To render the PNGs again: sharp(svg, { density: 72 * size / 200 }).resize(size, size).png().
