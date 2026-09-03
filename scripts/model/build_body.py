"""Build the car's body shell in Blender and export it as glTF.

    node scripts/model/dump_sections.mjs
    python3 scripts/model/build_body.py

Requires the `bpy` wheel (Blender as a library, no GUI):

    pip install bpy==5.0.1        # CPython 3.11 only

-- why Blender at all --------------------------------------------------
The Three.js scene lofts these same sections by hand, and hand-lofting
has a ceiling. Three things it cannot do that this can:

  SUBDIVISION.  A loft is faceted between stations. Catmull-Clark
  interpolates a smooth surface through them, so the tub does not read
  as fourteen rings with flats between.

  BOOLEANS.  Real holes, and real joins. The airbox mouth was fought for
  three separate times in the JS scene, because a closed loft has no
  hole in it and anything modelled inside is sealed invisibly in the
  solid. Here it is a shape subtracted from the cover. More importantly
  the sidepods are UNIONED into the shell rather than laid alongside it.

  BEVELS.  Every edge on a real car has a radius, and a radius is what
  catches a highlight. A lofted edge is infinitely sharp.

The sections come from src/lib/carSections.js via dump_sections.mjs, so
this is not a second model of the car -- it is the same numbers, lofted
by something that can do more with them.
"""
import json
import math
import os
import sys

import bpy
import bmesh

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SECTIONS = json.load(open(os.path.join(HERE, "sections.json")))
OUT_DIR = os.path.join(ROOT, "public", "models", "2026")


def ring(half_width, half_height, centre_y, squareness=2.4, segments=26):
    """A superellipse in the (y, z) plane. Ported from carSections.js.

    Held to agreement with the JS by scripts/model/parity_check.mjs: a
    body built from a slightly different section would drift away from
    the wings and wheels the JS scene still draws around it.
    """
    pts = []
    for i in range(segments):
        t = (i / segments) * math.pi * 2
        ct, st = math.cos(t), math.sin(t)
        p = 2 / squareness
        pts.append((
            centre_y + half_height * math.copysign(abs(st) ** p, st),
            half_width * math.copysign(abs(ct) ** p, ct),
        ))
    return pts


def cockpit_ring(w, h, cy, q, mouth, floor_y, segments):
    out = []
    for y, z in ring(w, h, cy, q, segments):
        if y <= floor_y:
            out.append((y, z))
            continue
        t = min(1.0, abs(z) / mouth)
        blend = t * t * (3 - 2 * t)
        out.append((floor_y + (y - floor_y) * blend, z))
    return out


def catmull_rom(p0, p1, p2, p3, t):
    """One interpolating spline segment. Passes THROUGH p1 and p2."""
    return 0.5 * (
        2 * p1
        + (-p0 + p2) * t
        + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
        + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t
    )


def resample(stations, step=0.035):
    """Put a station every `step` metres along the body.

    This is the difference between a subdivision surface that looks like
    a car and one that looks like a dart. Catmull-Clark pulls a surface
    TOWARD the average of its control points, and with fourteen stations
    spread over five metres it cut every corner: the first build came
    out with a needle for a nose and a spindle for a tub.

    Densifying first fixes it at the source -- the control hull is
    already within millimetres of the intended surface, so there is
    nothing left for the subdivision to shrink. Catmull-Rom rather than
    a Bezier because it passes through its control points, so the
    resampled body still hits every station in the table exactly.

    Interpolating the RING POINTS rather than the section parameters
    carries the cockpit trough through the resample without the trough
    needing to know it is happening.
    """
    xs = [x for x, _ in stations]
    rings = [pts for _, pts in stations]
    last = len(stations) - 1
    span = xs[-1] - xs[0]
    steps = max(2, int(round(span / step)))
    out = []
    for k in range(steps + 1):
        x = xs[0] + span * k / steps
        i = 0
        while i < last - 1 and xs[i + 1] < x:
            i += 1
        t = 0.0 if xs[i + 1] == xs[i] else (x - xs[i]) / (xs[i + 1] - xs[i])
        t = min(1.0, max(0.0, t))
        r0, r1 = rings[max(0, i - 1)], rings[i]
        r2, r3 = rings[min(last, i + 1)], rings[min(last, i + 2)]
        out.append((x, [
            (catmull_rom(r0[j][0], r1[j][0], r2[j][0], r3[j][0], t),
             catmull_rom(r0[j][1], r1[j][1], r2[j][1], r3[j][1], t))
            for j in range(len(r1))
        ]))
    return out


def loft(name, stations, cap_front=True, cap_back=True):
    """Skin a tube through a list of (x, [(y, z), ...]) stations."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rings = []
    for x, pts in stations:
        # Blender is Z-UP. The section tables are written in the scene's
        # own Y-up frame (x along the car, y up, z across), so the axes
        # are swapped HERE rather than compensated for in the viewer:
        # build in Blender's convention and let the exporter's yup
        # conversion do the rest. Getting this wrong the first time
        # exported a car lying on its side.
        rings.append([bm.verts.new((x, z, y)) for y, z in pts])
    bm.verts.ensure_lookup_table()

    seg = len(rings[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap_front:
        bm.faces.new(tuple(reversed(rings[0])))
    if cap_back:
        bm.faces.new(tuple(rings[-1]))

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def smooth(obj, levels=1, bevel=0.004, angle=math.radians(48)):
    """Bevel then subdivide: the two things a hand loft cannot do."""
    if bevel:
        b = obj.modifiers.new("bevel", "BEVEL")
        b.width = bevel
        b.segments = 2
        b.limit_method = "ANGLE"
        b.angle_limit = angle
    if levels:
        s = obj.modifiers.new("subsurf", "SUBSURF")
        s.levels = levels
        s.render_levels = levels
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


def material(name, rgba, roughness, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def shell_half_width(x):
    """The tub's half-width at x, linearly between stations."""
    xs = [s["x"] for s in SECTIONS["tub"]]
    ws = [s["w"] for s in SECTIONS["tub"]]
    if x <= xs[0]:
        return ws[0]
    if x >= xs[-1]:
        return ws[-1]
    for i in range(len(xs) - 1):
        if xs[i] <= x <= xs[i + 1]:
            t = (x - xs[i]) / (xs[i + 1] - xs[i])
            return ws[i] + (ws[i + 1] - ws[i]) * t
    return ws[-1]


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    body = material("body", (0.62, 0.05, 0.05, 1.0), 0.28, 0.15)
    dark = material("dark", (0.045, 0.05, 0.062, 1.0), 0.42)

    seg = SECTIONS["tubSeg"]
    hidden = []

    # -- nose and tub, lofted as ONE surface -----------------------
    # In the JS scene these are two lofts meeting at x -1.06/-1.18,
    # leaving a seam you can find in any render. Skinned together and
    # subdivided, the join is continuous, which is what it is on the car.
    stations = []
    for s in SECTIONS["nose"]:
        stations.append((s["x"], ring(s["w"], s["h"], s["cy"], s["q"], seg)))
    for s in SECTIONS["tub"]:
        if "mouth" in s:
            pts = cockpit_ring(s["w"], s["h"], s["cy"], s["q"], s["mouth"], s["floor"], seg)
        else:
            pts = ring(s["w"], s["h"], s["cy"], s["q"], seg)
        stations.append((s["x"], pts))
    shell = loft("shell", resample(stations))
    smooth(shell, levels=1)
    shell.data.materials.append(body)

    # -- engine cover, joined on, with the airbox mouth cut through --
    cover = loft("cover", resample([
        (s["x"], ring(s["w"], s["h"], s["cy"], s["q"], 30)) for s in SECTIONS["cover"]
    ]))
    smooth(cover, levels=1)
    hidden.append(cover)

    # -- sidepods, mirrored, and JOINED to the shell ----------------
    #
    # This is the part hand-lofting cannot do, and the reason the build
    # step earns its place.
    #
    # The section tables put the pods 5 to 20 cm CLEAR of the tub: the
    # tub is 0.296 half-wide at its widest and the pods sit between 0.35
    # and 0.66. In the Three.js scene they are three separate closed
    # tubes lying next to each other, and no amount of shading fixes an
    # air gap -- from a three-quarter angle they read as torpedoes
    # beside a spindle rather than as one body.
    #
    # Each pod is pulled inboard until its inner half is buried in the
    # shell, then unioned into it. What comes out is one watertight
    # surface with the pod growing out of the tub, which is what a
    # sidepod does on a car.
    for side in (1, -1):
        pod_stations = []
        for s in SECTIONS["pod"]:
            # Real overlap, not a tangent touch: a tangent union produces
            # degenerate faces and the solver drops them.
            z = min(s["z"], shell_half_width(s["x"]) + s["w"] * 0.55)
            pod_stations.append((s["x"], [
                (y, zz + side * z)
                for y, zz in ring(s["w"], s["h"], s["cy"], SECTIONS["podQ"], 28)
            ]))
        pod = loft("sidepod%s" % ("L" if side > 0 else "R"), resample(pod_stations))
        smooth(pod, levels=1)
        hidden.append(pod)

    # The mouth cutter: a tapering duct running back into the cover,
    # subtracted rather than modelled inside it, so there is a real hole.
    mouth = loft("mouth_cutter", [
        (0.02, ring(0.072, 0.072, 0.812, 2.4, 24)),
        (0.30, ring(0.048, 0.044, 0.780, 2.4, 24)),
        (0.62, ring(0.014, 0.015, 0.700, 2.4, 24)),
    ])
    hidden.append(mouth)

    # Union everything into the shell, THEN cut the mouth. Order matters:
    # subtracting first and unioning after would fill the hole back in.
    for solid in hidden[:-1]:
        u = shell.modifiers.new("join", "BOOLEAN")
        u.operation = "UNION"
        u.object = solid
        u.solver = "EXACT"
    cut = shell.modifiers.new("mouth", "BOOLEAN")
    cut.operation = "DIFFERENCE"
    cut.object = mouth
    cut.solver = "EXACT"

    # -- floor, left separate: it is a different material ------------
    floor = loft("floor", resample([
        (s["x"], ring(s["w"], s["h"], s["cy"], 6, 34)) for s in SECTIONS["floor"]
    ], step=0.06))
    smooth(floor, levels=0, bevel=0.006)
    floor.data.materials.append(dark)

    parts = [shell, floor]
    # Cutters and pod solids stay in the file, hidden: a boolean modifier
    # holds a reference to its operand, and pointing one at a freed
    # object crashes Blender.
    for obj in hidden:
        obj.hide_render = True
        obj.hide_viewport = True

    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, "car-body.glb")
    for obj in bpy.context.scene.objects:
        obj.select_set(obj in parts)
    bpy.context.view_layer.objects.active = shell
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        use_selection=True,
        export_apply=True,          # bake the modifiers into the mesh
        export_yup=True,
    )
    depsgraph = bpy.context.evaluated_depsgraph_get()
    tris = 0
    for obj in parts:
        evaluated = obj.evaluated_get(depsgraph).to_mesh()
        evaluated.calc_loop_triangles()
        tris += len(evaluated.loop_triangles)
        obj.evaluated_get(depsgraph).to_mesh_clear()
    print("wrote %s  %.0f KB  %d triangles" % (out, os.path.getsize(out) / 1024, tris))
    return 0


if __name__ == "__main__":
    sys.exit(main())
