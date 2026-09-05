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

  frontFlap  The donor does not separate the movable elements from the
             fixed mainplane, so the flap is taken as the upper-rear
             band of the front wing. It is close, not exact.

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
        # The movable flap is the UPPER ELEMENT of the stack, and it is
        # found by height and span together.
        #
        # The first rule was "above 250 mm and inboard of the endplates",
        # which sounds like the upper element and is not: the nose cone
        # runs the whole length of this region and is far taller than the
        # wing, so that rule handed the nose's entire underside to the
        # flap. In X-mode the nose then swung up and out of the car.
        #
        # Profiling the region separates them cleanly. Everything wide
        # (|z| > 320) is wing: 22k vertices at 100-150 mm is the fixed
        # mainplane, then a GAP at 200-250 mm — the slot — then 13k more
        # at 250-300 mm, which is the element above the slot. Everything
        # narrow (|z| < 220) at that height is nose. So the flap is a
        # band in height AND a span wide enough not to be the nose,
        # inboard of endplates that reach |z| 913.
        if 240 <= y <= 360 and 240 < az < 830:
            return "frontFlap"
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
        # The FLAP is only the element spanning BETWEEN the endplates.
        # Taking everything above y 720 put the top of each endplate in
        # it as well, and rotating that for X-mode tore the endplates in
        # half: their upper corners swung away with the flap and left a
        # hole where the wing had been. The rear wing reaches |z| 575 at
        # its tips, so 470 keeps the endplates out of the moving part.
        if y > 700 and az < 470:
            return "rearFlap"
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
