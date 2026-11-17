import math
from array import array

import bpy


def build_mochi_held():
    old = bpy.data.objects.get("MochiHeld")
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    for datablocks, name in (
        (bpy.data.meshes, "MochiHeldMesh"),
        (bpy.data.materials, "M_MochiHeld"),
        (bpy.data.images, "T_MochiHeld_BaseColor"),
    ):
        old_data = datablocks.get(name)
        if old_data:
            datablocks.remove(old_data, do_unlink=True)

    collection = bpy.data.collections.get("MochiHeldAsset")
    if collection is None:
        collection = bpy.data.collections.new("MochiHeldAsset")
        bpy.context.scene.collection.children.link(collection)

    segments = 48
    height = 0.060
    radius = 0.038
    profile = [
        (0.00, 0.001), (0.48, 0.001), (0.76, 0.003), (0.94, 0.009),
        (1.00, 0.018), (0.96, 0.030), (0.80, 0.043), (0.55, 0.053),
        (0.28, 0.059), (0.00, height),
    ]
    verts = [(0.0, 0.0, 0.001)]
    rings = []
    for ring_radius, z in profile[1:-1]:
        ring = []
        for j in range(segments):
            theta = 2.0 * math.pi * j / segments
            handmade = 1.0 + 0.014 * math.sin(3.0 * theta + 0.4) + 0.006 * math.sin(5.0 * theta - 0.7)
            r = radius * ring_radius * handmade
            ring.append(len(verts))
            verts.append((r * math.cos(theta), r * math.sin(theta), z))
        rings.append(ring)
    top = len(verts)
    verts.append((0.0, 0.0, height))

    faces = []
    for j in range(segments):
        k = (j + 1) % segments
        faces.append((0, rings[0][k], rings[0][j]))
    for lower, upper in zip(rings, rings[1:]):
        for j in range(segments):
            k = (j + 1) % segments
            faces.append((lower[j], lower[k], upper[k], upper[j]))
    for j in range(segments):
        k = (j + 1) % segments
        faces.append((rings[-1][j], rings[-1][k], top))

    mesh = bpy.data.meshes.new("MochiHeldMesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    uv = mesh.uv_layers.new(name="UVMap")
    top_cap_start = len(faces) - segments
    for polygon in mesh.polygons:
        corners = [(loop_index, verts[mesh.loops[loop_index].vertex_index]) for loop_index in polygon.loop_indices]
        if polygon.index < segments or polygon.index >= top_cap_start:
            is_top = polygon.index >= top_cap_start
            center_v = 0.91 if is_top else 0.09
            for loop_index, (x, y, z) in corners:
                uv.data[loop_index].uv = (0.5 + 0.065 * x / radius, center_v + 0.065 * y / radius)
        else:
            us = [(math.atan2(y, x) / (2.0 * math.pi)) % 1.0 for _, (x, y, _) in corners]
            if max(us) - min(us) > 0.5:
                us = [u + 1.0 if u < 0.5 else u for u in us]
            for (loop_index, (_, _, z)), u in zip(corners, us):
                uv.data[loop_index].uv = (u, 0.20 + 0.60 * z / height)

    image_size = 256
    pixels = array("f")
    for y in range(image_size):
        v = y / (image_size - 1)
        for x in range(image_size):
            u = x / (image_size - 1)
            grain = 0.010 * math.sin(2.0 * math.pi * (u * 23.0 + v * 7.0))
            grain += 0.006 * math.sin(2.0 * math.pi * (u * 61.0 - v * 37.0))
            seed = math.sin(x * 127.1 + y * 311.7) * 43758.5453
            speckle = 0.045 if seed - math.floor(seed) > 0.992 else 0.0
            pixels.extend((
                min(1.0, 0.925 + grain + speckle),
                min(1.0, 0.790 + grain + speckle),
                min(1.0, 0.845 + grain + speckle),
                1.0,
            ))
    image = bpy.data.images.new("T_MochiHeld_BaseColor", width=image_size, height=image_size, alpha=True)
    image.colorspace_settings.name = "sRGB"
    image.pixels.foreach_set(pixels)
    image.pack()

    material = bpy.data.materials.new("M_MochiHeld")
    nodes = material.node_tree.nodes
    principled = next(node for node in nodes if node.type == "BSDF_PRINCIPLED")
    principled.inputs["Roughness"].default_value = 0.88
    principled.inputs["Sheen Weight"].default_value = 0.08
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    material.node_tree.links.new(texture.outputs["Color"], principled.inputs["Base Color"])
    mesh.materials.append(material)

    obj = bpy.data.objects.new("MochiHeld", mesh)
    collection.objects.link(obj)
    obj.location = (0.0, 0.0, 0.0)
    obj["asset_note"] = "Single strawberry daifuku piece; no skewer; grip pivot at the flat base."
    bpy.context.view_layer.update()

    assert len(mesh.polygons) < 2000
    assert abs(obj.dimensions.x - 0.076) < 0.004
    assert abs(obj.dimensions.y - 0.076) < 0.004
    assert abs(obj.dimensions.z - height) < 0.003
    return obj
