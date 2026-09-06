# Which wing elements move — marked by the project owner

The five images here are the renders from `scripts/model/wingviews.mjs`
with the movable elements marked in red by hand. They are the spec for
the active-aero fix, and they exist in the repo because the container
this session runs in is ephemeral and the markup is not reproducible.

Read off them:

  FRONT WING   the upper TWO of the three stacked elements move.
               The lowest element — the mainplane, the one furthest
               forward and closest to the ground — does not.

  REAR WING    BOTH aerofoil elements move. This model carries two with
               one slot between them; the beam wing below is separate
               and is not marked.

What the current code does instead, and why it is wrong, is recorded in
the commit that added `flaps.mjs` and `wingviews.mjs`: the front
"movable flap" is a 240-360 mm height slice through the nose and
endplate fairing rather than a wing element at all, and the rear element
detaches from its endplate as it rotates.

Still outstanding before this is implemented:

  - Reference for a real 2026 active-aero change, to be supplied.
  - A primary regulations source. Search results attributing to the FIA
    give the front wing three elements with a two-element active flap
    and the rear wing three elements with the beam wing removed — which
    the markup agrees with at the front, and which this model cannot
    match at the rear because it only has two. fia.com and api.fia.com
    are both blocked by this environment's egress proxy, which is the
    same reason config/regulations_2026.json still reads
    "verified": false.

The renders these were drawn on are of a third party's CC-BY-4.0 concept
model; see docs/SOURCES.md for the credit.
