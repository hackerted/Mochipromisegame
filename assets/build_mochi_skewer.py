import math

import bpy


def _material(name, color, roughness=0.84):
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    nodes = material.node_tree.nodes
    principled = next(node for node in nodes if node.type == "BSDF_PRINCIPLED")
    principled.inputs["Base Color"].default_value = (*color, 1.0)
    principled.inputs["Roughness"].default_value = roughness
    principled.inputs["Sheen Weight"].default_value = 0.06
    material.diffuse_color = (*color, 1.0)
    return material


def _ball_mesh(name, radius, height, segments=32):
    profile = [(0.48, 0.001), (0.76, 0.003), (0.94, 0.008), (1.0, 0.015),
               (0.96, 0.024), (0.80, 0.034), (0.55, 0.041), (0.28, 0.045)]
    verts = [(0.0, 0.0, 0.0)]
    rings = []
    for ring_radius, z in profile:
        ring = []
        for j in range(segments):
            theta = 2.0 * math.pi * j / segments
            handmade = 1.0 + 0.012 * math.sin(3.0 * theta + 0.4) + 0.005 * math.sin(5.0 * theta)
            r = radius * ring_radius * handmade
            ring.append(len(verts))
            verts.append((r * math.cos(theta), r * math.sin(theta), z * height / 0.045))
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
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    for face in mesh.polygons:
        face.use_smooth = True
    uv = mesh.uv_layers.new(name="UVMap")
    top_cap_start = len(faces) - segments
    for polygon in mesh.polygons:
        corners = [(loop_index, verts[mesh.loops[loop_index].vertex_index]) for loop_index in polygon.loop_indices]
        if polygon.index < segments or polygon.index >= top_cap_start:
            center_v = 0.91 if polygon.index >= top_cap_start else 0.09
            for loop_index, (x, y, z) in corners:
                uv.data[loop_index].uv = (0.5 + 0.065 * x / radius, center_v + 0.065 * y / radius)
        else:
            us = [(math.atan2(y, x) / (2.0 * math.pi)) % 1.0 for _, (x, y, _) in corners]
            if max(us) - min(us) > 0.5:
                us = [u + 1.0 if u < 0.5 else u for u in us]
            for (loop_index, (_, _, z)), u in zip(corners, us):
                uv.data[loop_index].uv = (u, 0.20 + 0.60 * z / height)
    return mesh


def _stick_mesh(name, sides=12):
    verts = [(0.0, 0.0, 0.0)]
    bottom = []
    for z, radius in ((0.0, 0.0018), (0.175, 0.0024)):
        ring = []
        for j in range(sides):
            theta = 2.0 * math.pi * j / sides
            ring.append(len(verts))
            verts.append((radius * math.cos(theta), radius * math.sin(theta), z))
        if z == 0.0:
            bottom = ring
        else:
            top_ring = ring
    top_center = len(verts)
    verts.append((0.0, 0.0, 0.175))
    faces = []
    for j in range(sides):
        k = (j + 1) % sides
        faces.append((0, bottom[k], bottom[j]))
    for j in range(sides):
        k = (j + 1) % sides
        faces.append((bottom[j], bottom[k], top_ring[k], top_ring[j]))
    for j in range(sides):
        k = (j + 1) % sides
        faces.append((top_ring[j], top_ring[k], top_center))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    uv = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        corners = [(loop_index, verts[mesh.loops[loop_index].vertex_index]) for loop_index in polygon.loop_indices]
        if polygon.index < sides or polygon.index >= sides * 2:
            is_top = polygon.index >= sides * 2
            center_v = 0.9 if is_top else 0.1
            for loop_index, (x, y, z) in corners:
                uv.data[loop_index].uv = (0.5 + 0.07 * x / 0.0024, center_v + 0.07 * y / 0.0024)
        else:
            us = [(math.atan2(y, x) / (2.0 * math.pi)) % 1.0 for _, (x, y, _) in corners]
            if max(us) - min(us) > 0.5:
                us = [u + 1.0 if u < 0.5 else u for u in us]
            for (loop_index, (_, _, z)), u in zip(corners, us):
                uv.data[loop_index].uv = (u, 0.25 + 0.50 * z / 0.175)
    return mesh


def build_mochi_skewer():
    old_root = bpy.data.objects.get("MochiSkewer")
    if old_root:
        for child in list(old_root.children_recursive):
            bpy.data.objects.remove(child, do_unlink=True)
        bpy.data.objects.remove(old_root, do_unlink=True)

    collection = bpy.data.collections.get("MochiSkewerAsset")
    if collection is None:
        collection = bpy.data.collections.new("MochiSkewerAsset")
        bpy.context.scene.collection.children.link(collection)

    root = bpy.data.objects.new("MochiSkewer", None)
    collection.objects.link(root)
    root.empty_display_type = "PLAIN_AXES"
    root.empty_display_size = 0.02
    root["grip_pivot"] = "Bottom of the wooden skewer; local +Z runs through the dango."

    stick_mat = _material("M_MochiSkewerWood", (0.35, 0.19, 0.09), 0.7)
    stick = bpy.data.objects.new("DangoStick", _stick_mesh("DangoStickMesh"))
    collection.objects.link(stick)
    stick.parent = root
    stick.data.materials.append(stick_mat)

    colors = (
        ("MochiBall_0", (0.93, 0.78, 0.52)),
        ("MochiBall_1", (0.65, 0.82, 0.60)),
        ("MochiBall_2", (0.91, 0.62, 0.73)),
    )
    ball_materials = (
        _material("M_MochiYuzu", colors[0][1]),
        _material("M_MochiMatcha", colors[1][1]),
        _material("M_MochiStrawberry", colors[2][1]),
    )
    for index, (name, _) in enumerate(colors):
        ball = bpy.data.objects.new(name, _ball_mesh(f"{name}Mesh", 0.0255, 0.045))
        collection.objects.link(ball)
        ball.parent = root
        ball.location = (0.0, 0.0, 0.047 + index * 0.043)
        ball.data.materials.append(ball_materials[index])

    bpy.context.view_layer.update()
    return root
