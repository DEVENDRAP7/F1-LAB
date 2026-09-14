# Disclaimer

This is an unofficial, non-commercial, educational project. It is not
associated with, endorsed by, or affiliated with Formula 1, Formula One
World Championship Limited, the FIA, any competing team, driver, or
rights holder.

All data is sourced from public timing feeds and public results archives
(see `docs/SPEC.md` for the full list of sources) and is used here for
non-commercial analysis and visualization only, consistent with the
stated non-commercial use terms of the FastF1 library
(https://github.com/theOehrly/Fast-F1).

No team liveries, logos, or broadcast graphics are reproduced anywhere in
this project. All colors, typography, and layout are original.

The 3D car in the Aero Rig is worth being specific about, because it is
the one asset that did not start out that way. Its geometry comes from a
CC-BY concept model, credited beside the viewport, and that model ships
painted in a team's colours — a red body with a yellow onboard camera.
None of those materials are used: every one of the thirteen is discarded
on load and replaced by colours defined in this project's own
`src/theme/tokens.css`, which encode what the project knows about each
part (measured, schematic, or refused) rather than who might run it. The
shape is borrowed, with credit. The colour is not.

"Formula 1", "F1", "FIA", and related marks are trademarks of their
respective owners.
