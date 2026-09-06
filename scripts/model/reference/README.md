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

Implemented. split_movable_elements() in segment_car.py finds the
elements by surface — grow regions across smooth edges, stop at creases,
and drop the endplate first so the elements stop being bridged through
it. The two highest-mean regions at each end are the movable ones, which
lands on exactly what is marked here.

A reference for a real active-aero change was supplied and is NOT stored
here: it is a photograph of a car in team livery, and SPEC.md rule 5 and
DISCLAIMER.md keep liveries and logos out of this repo. What it settled:
the element rotates about a spanwise axis at its forward attachment, the
trailing edge lifts, the slot below it opens, and the travel is modest —
the element stays inside its endplate throughout. The mode angles came
down from 0.36/0.34 rad to 0.24/0.28 because of it.

Still outstanding:

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
