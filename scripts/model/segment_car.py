"""Cut the donor car model into the Aero Rig's named parts, and export glTF.

    python3 scripts/model/segment_car.py [--debug]

Requires the `bpy` wheel (Blender as a library) and the donor model at
scripts/model/donor/scene.gltf.

-- the problem this solves ---------------------------------------------
The donor arrives as eleven meshes named Object_0..Object_10, and they
are NOT components: each is roughly 115k triangles of whatever fitted in
one vertex buffer, so every one of them spans the entire car. Rendering
Object_0 alone gives scattered fragments of front wing, floor, a wheel
and rear wing at once.

That matters because the Aero Rig's whole point is clicking a part and
being told what this project can honestly say about it -- measured,
schematic, or refused. Loaded as delivered, every click would return the
same meaningless fragment collection.

So the model is joined back into one mesh and re-cut by WHERE each
polygon is, into the thirteen parts src/lib/aeroRigParts.js knows about.
The regions below are measured off the donor rather than guessed: a
profile of height and half-width every 200 mm along the car puts the
airbox apex at x 1900 (y 1068, the highest point), the front axle near
x -100 and the rear near x 3200 (both where half-width peaks at the
930 mm track), and the front wing assembly ending at x -420.

-- what this cannot recover -------------------------------------------
Two parts are approximations and are marked as such in the page copy:

  frontFlap  The donor does not label its elements, so they are found
             by surface: see split_movable_elements(). What moves is the
             upper two of the three the model carries. Which elements a
             real 2026 car moves is a regulation fact this project has
             no primary source for — see config/regulations_2026.json.

  suspension Wishbones share their space with wheels and bodywork, so
             what is captured is the members in the gap between the tub
             side and the wheel at each axle station. Pushrod and
             steering-arm ends buried inside either are not recoverable.
"""
import json
import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
DONOR = os.path.join(HERE, "donor", "scene.gltf")
OUT_DIR = os.path.join(ROOT, "public", "models", "2026")
DEBUG = "--debug" in sys.argv

# Decimation ratio. The donor is 1.16 million triangles and 40 MB, which
# is not a web payload; 0.16 holds the silhouette and the wing sections
# while bringing it to something a page can load.
RATIO = 0.16

# How far to move the donor so it sits where the scene expects a car:
# centred on the origin along its length, and resting on the ground.
X_SHIFT = -1.398
Y_SHIFT = 0.031

# Shipping materials, one per part: base colour, roughness, metallic.
# Bodywork is the scene's red; everything structural is carbon.
CARBON = ((0.045, 0.050, 0.062), 0.42, 0.0)
BODY = ((0.620, 0.050, 0.050), 0.28, 0.15)
RUBBER = ((0.028, 0.030, 0.036), 0.88, 0.0)
MATERIALS = {
    "nose": BODY, "airbox": BODY, "sidepod": BODY,
    "frontWing": BODY, "rearWing": BODY,
    "frontFlap": CARBON, "rearFlap": CARBON, "floor": CARBON,
    "diffuser": CARBON, "halo": CARBON, "suspension": CARBON,
    "wheel": RUBBER,
    "camera": ((0.85, 0.78, 0.10), 0.35, 0.0),
}

# Distinct colours per part, used only by --debug to check the cut.
DEBUG_COLOURS = {
    "frontWing": (0.90, 0.20, 0.15), "frontFlap": (1.00, 0.55, 0.10),
    "nose": (0.95, 0.85, 0.20), "floor": (0.20, 0.55, 0.95),
    "sidepod": (0.20, 0.80, 0.45), "halo": (0.55, 0.25, 0.85),
    "camera": (1.00, 0.95, 0.90), "airbox": (0.95, 0.40, 0.75),
    "rearWing": (0.15, 0.75, 0.85), "rearFlap": (0.10, 0.45, 0.55),
    "diffuser": (0.45, 0.35, 0.25), "wheel": (0.10, 0.10, 0.12),
    "suspension": (0.65, 0.65, 0.70),
}


def part_of(x, y, z):
    """Which part a polygon at this point belongs to.

    Coordinates are the DONOR's own millimetres with y pointing up:
    x runs -1299 (nose tip) to 4095 (tail), z is +/-941 across.
    """
    az = abs(z)

    # Wheels first: they are the only things at the full 930 mm track,
    # and they sit in two bands at the axles. Testing them before the
    # wings stops a front tyre being eaten by the front wing region.
    if az > 560 and y < 830 and (-520 <= x <= 340 or 2860 <= x <= 3560):
        return "wheel"

    # Front wing assembly, which the donor ends at x -420.
    if x < -420:
        # The movable elements are NOT separated here. Two attempts
        # tried to find them by height band and both cut through the
        # bodywork instead: the elements rise as they sweep outboard, so
        # a horizontal band stripes across all three at once — rendered,
        # it is unmistakable. split_movable_elements() below does it by
        # surface, after this coarse split.
        # The nose cone runs the full length of this region on the
        # centreline, above the wing's elements. Calling it "front wing"
        # was harmless to look at and wrong to click.
        if az < 230 and y > 190:
            return "nose"
        return "frontWing"

    # Rear wing assembly. The endplate reaches a long way DOWN, so the
    # floor of this region is 330 and not 470: at 470 the bottom half of
    # each endplate was being handed to the diffuser, which showed up in
    # the colour check as a tan panel standing vertically behind the
    # rear wheel.
    if x > 3460 and y > 330:
        # As with the front, the movable elements are separated by
        # surface rather than by height — see split_movable_elements().
        return "rearWing"

    # Diffuser and rear crash structure: everything low behind the axle.
    if x > 3150 and y < 470:
        return "diffuser"

    # Floor: the whole underbody plane.
    if y < 185:
        return "floor"

    # The camera pod sits on the roll hoop crest, above the airbox.
    if 1450 <= x <= 1980 and y > 990:
        return "camera"

    # Airbox and engine cover: the volume behind the driver's head.
    if x > 1500 and y > 600:
        return "airbox"

    # Halo: a hoop over the cockpit, above the tub sides.
    if 480 <= x <= 1520 and y > 620:
        return "halo"

    # Suspension: wishbones and pushrods, in the gap between the body
    # side and the wheel, at the TWO AXLE STATIONS and nowhere else.
    #
    # This used to be a fall-through — "anything outboard of 300 that
    # nothing else claimed" — and it caught three things that are not
    # suspension. Rendered on its own the bucket held the front and rear
    # wishbones plus a barge board, a turning vane and a deflector
    # halfway down the car.
    #
    # They came from a 30 mm sliver. The sidepod rule claimed |z| > 330
    # and this one caught |z| > 300, so a three-centimetre band ran the
    # entire length of the car with nothing else able to take it: 4 660
    # vertices of it at x 800-1100 alone, which is sidepod flank. The
    # sliver is closed below by moving the sidepod threshold to 300, and
    # this rule is positive rather than a catch-all.
    #
    # Bounds measured off the donor: the wheels take |z| > 560, the tub
    # side is around 260, and the members run y 150-560 at both axles.
    if 250 < az < 580 and 150 < y < 560 and (-560 <= x <= 460 or 2700 <= x <= 3620):
        return "suspension"

    # Sidepods: bodywork outboard of the survival cell. Tested AFTER
    # suspension, because the rear wishbones sit inside this x range.
    if az > 300 and 420 <= x <= 3150:
        return "sidepod"

    # Everything left on the centreline. Ahead of the firewall that is
    # the nose and survival cell; behind it, it is the engine bay, and
    # calling that "nose" is what put a yellow band down the flank
    # between the sidepod and the rear wheel in the colour check.
    return "nose" if x < 1500 else "airbox"


# ---------- finding the movable elements ----------
#
# Both wings' movable elements are separated by SURFACE, not by a box.
#
# A box cannot do it. The elements rise as they sweep outboard, so any
# height band stripes across all of them at once — render the wing
# coloured by height band and every element is striped through every
# colour. Two versions of this file tried a band anyway; the front one
# was not on a wing element at all, it was a slice through the nose and
# endplate fairing, and in X-mode it swung up out of the bodywork and
# left a hole.
#
# What does work: each element is a smooth surface, and the gaps between
# them are gaps in space rather than creases, but the elements only touch
# each other THROUGH the endplate. Drop the endplate and grow regions
# across smooth edges, and the elements fall apart on their own.
#
# Measured on the donor: the split is identical at 25, 35 and 45 degrees,
# which is what says it is finding real geometry rather than a threshold.
CREASE_DEG = 35.0

# Where the endplate starts, per end. Growing across it bridges every
# element into one region — with the endplate in, the front returned a
# single region per side covering the whole wing.
ENDPLATE_Z = {"front": 630, "rear": 470}

# A region has to be big enough to be an element, wide enough to be a
# span element rather than a footplate (the front carries a strake only
# 61 mm across), and long and thick enough to be an aerofoil rather than
# a trailing-edge strip (the rear's is 13 mm of chord and 3 mm deep, and
# it is 7 400 faces, so face count alone does not catch it).
MIN_FACES = 400
MIN_SPAN = 250
MIN_CHORD = 60
MIN_THICK = 20

# An aerofoil's upper and lower skins meet at its leading and trailing
# edges, and those are creases too — so each element arrives as two or
# three regions rather than one, and ranking them by height picks two
# skins of the SAME element. Regions whose extents overlap this much on
# all three axes are the same element and are merged before ranking.
# All three axes matter: the front's two flap elements overlap 71% in
# chord and would merge on x alone, but only 43% in height.
SAME_ELEMENT = 0.6


def split_movable_elements(mesh, poly_ids, end):
    """The two movable elements at one end, as polygon indices.

    Returns (movable, fixed). Ranking is by mean height among candidate
    regions, which picks the upper two at both ends — the front's two
    flap elements above the mainplane, and the rear's two above the
    fixed structure.
    """
    cos_max = math.cos(math.radians(CREASE_DEG))
    zmax = ENDPLATE_Z[end]

    def coords(i):
        poly = mesh.polygons[i]
        n = len(poly.vertices)
        cx = cy = cz = 0.0
        for vi in poly.vertices:
            co = mesh.vertices[vi].co
            cx += co.x; cy += co.y; cz += co.z
        return cx / n, -cy / n, cz / n

    grow = [i for i in poly_ids if abs(coords(i)[2]) < zmax]
    parent = {i: i for i in grow}

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    edges = {}
    for i in grow:
        for ek in mesh.polygons[i].edge_keys:
            edges.setdefault(ek, []).append(i)
    for shared in edges.values():
        if len(shared) != 2:
            continue
        a, b = shared
        if mesh.polygons[a].normal.dot(mesh.polygons[b].normal) >= cos_max:
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[ra] = rb

    regions = {}
    for i in grow:
        regions.setdefault(find(i), []).append(i)

    def extent(faces):
        pts = [coords(i) for i in faces]
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        zs = [abs(p[2]) for p in pts]
        return ((min(xs), max(xs)), (min(ys), max(ys)), (min(zs), max(zs)),
                sum(ys) / len(ys))

    cands = []
    for faces in regions.values():
        if len(faces) < MIN_FACES:
            continue
        bx, by, bz, mean_y = extent(faces)
        if bz[1] - bz[0] < MIN_SPAN or bx[1] - bx[0] < MIN_CHORD or by[1] - by[0] < MIN_THICK:
            continue
        cands.append([list(faces), bx, by, bz, mean_y])

    def overlaps(a, b):
        # Measured against the LARGER extent, not the smaller. Against
        # the smaller, the front's upper element and the element below it
        # overlap 81% in height and merge, because the smaller box is
        # nested inside the bigger one — which is true of a skin and of a
        # neighbour alike, so it cannot tell them apart.
        for i in (1, 2, 3):
            lo = max(a[i][0], b[i][0])
            hi = min(a[i][1], b[i][1])
            bigger = max(a[i][1] - a[i][0], b[i][1] - b[i][0]) or 1.0
            if (hi - lo) / bigger < SAME_ELEMENT:
                return False
        return True

    # Union-find on the ORIGINAL boxes. Growing a box as it absorbs
    # regions let it reach the next element and chain: the front came out
    # as one element covering the whole wing.
    link = list(range(len(cands)))

    def root(a):
        while link[a] != a:
            link[a] = link[link[a]]
            a = link[a]
        return a

    for i in range(len(cands)):
        for j in range(i + 1, len(cands)):
            if overlaps(cands[i], cands[j]):
                ri, rj = root(i), root(j)
                if ri != rj:
                    link[ri] = rj

    clusters = {}
    for i, c in enumerate(cands):
        clusters.setdefault(root(i), []).extend(c[0])
    merged = []
    for faces in clusters.values():
        bx, by, bz, mean_y = extent(faces)
        merged.append([faces, bx, by, bz, mean_y])

    ranked = [(m[4], m[0]) for m in merged]
    ranked.sort(key=lambda r: -r[0])

    print("  %s: %d regions, %d candidates, %d elements after merge"
          % (end, len(regions), len(cands), len(ranked)))
    for mean_y, faces in ranked[:6]:
        pts = [coords(i) for i in faces]
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        zs = [abs(p[2]) for p in pts]
        print("    mean y %5.0f  %6d faces  x %6.0f..%6.0f  y %5.0f..%5.0f  |z| %4.0f..%4.0f"
              % (mean_y, len(faces), min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)))

    movable = set()
    for _, faces in ranked[:2]:
        movable.update(faces)
    return movable, [i for i in poly_ids if i not in movable]


def main():
    if not os.path.exists(DONOR):
        print("donor model not found at %s" % DONOR)
        return 1

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=DONOR)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    car = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # The importer leaves the car with y pointing DOWN, so every test
    # below flips it. Discovered by measuring, not assumed: the airbox
    # apex came out at the most negative y.
    mesh = car.data
    verts = mesh.vertices

    buckets = {}
    for poly in mesh.polygons:
        cx = cy = cz = 0.0
        for vi in poly.vertices:
            co = verts[vi].co
            cx += co.x
            cy += co.y
            cz += co.z
        n = len(poly.vertices)
        key = part_of(cx / n, -cy / n, cz / n)
        buckets.setdefault(key, []).append(poly.index)

    # Refine each wing into its fixed structure and its movable
    # elements. This runs on the joined mesh, before the split into
    # objects, because face adjacency is what it needs.
    print("finding movable elements by surface:")
    for end, source, flap in (("front", "frontWing", "frontFlap"),
                              ("rear", "rearWing", "rearFlap")):
        if source not in buckets:
            continue
        movable, fixed = split_movable_elements(mesh, buckets[source], end)
        if movable:
            buckets[flap] = sorted(movable)
            buckets[source] = fixed

    print("polygons per part:")
    for key in sorted(buckets, key=lambda k: -len(buckets[k])):
        print("  %-12s %8d" % (key, len(buckets[key])))
    missing = set(DEBUG_COLOURS) - set(buckets)
    if missing:
        print("EMPTY PARTS: %s" % ", ".join(sorted(missing)))

    # Split by assigning a material per part and separating on material:
    # the only bulk split bpy exposes without per-face operator calls.
    mesh.materials.clear()
    order = sorted(buckets)
    for key in order:
        mat = bpy.data.materials.new(key)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes["Principled BSDF"]
        if DEBUG:
            rgb, rough, metal = DEBUG_COLOURS.get(key, (0.7, 0.7, 0.7)), 0.42, 0.0
        else:
            rgb, rough, metal = MATERIALS.get(key, CARBON)
        bsdf.inputs["Base Color"].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = metal
        mesh.materials.append(mat)
    slot = {key: i for i, key in enumerate(order)}
    for key, indices in buckets.items():
        for i in indices:
            mesh.polygons[i].material_index = slot[key]

    bpy.ops.object.select_all(action="DESELECT")
    car.select_set(True)
    bpy.context.view_layer.objects.active = car
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="MATERIAL")
    bpy.ops.object.mode_set(mode="OBJECT")

    parts = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    for obj in parts:
        # Name each object after the part whose material it carries, so
        # the loader can read userData.part straight off the node name.
        obj.name = obj.data.materials[0].name
        obj.data.name = obj.name
        for poly in obj.data.polygons:
            poly.use_smooth = True
        dec = obj.modifiers.new("decimate", "DECIMATE")
        dec.ratio = RATIO
        # Into metres, centred along its length, resting on the ground.
        obj.scale = (0.001, 0.001, 0.001)
        obj.rotation_euler = (math.pi / 2, 0, 0)
        obj.location = (X_SHIFT, 0, Y_SHIFT)

    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, "car%s.glb" % ("-debug" if DEBUG else ""))
    bpy.ops.object.select_all(action="DESELECT")
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    # Draco: the uncompressed export is about 6 MB, which is a lot to
    # ask of a page even lazily. Draco takes it to roughly a quarter of
    # that for a decoder the viewer already ships.
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", use_selection=True,
        export_apply=True, export_yup=True,
        export_draco_mesh_compression_enable=not DEBUG,
        export_draco_mesh_compression_level=6,
    )

    dg = bpy.context.evaluated_depsgraph_get()
    tris = 0
    for obj in parts:
        ev = obj.evaluated_get(dg).to_mesh()
        ev.calc_loop_triangles()
        tris += len(ev.loop_triangles)
        obj.evaluated_get(dg).to_mesh_clear()
    print("wrote %s  %.1f MB  %d triangles  %d parts"
          % (out, os.path.getsize(out) / 1048576, tris, len(parts)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
