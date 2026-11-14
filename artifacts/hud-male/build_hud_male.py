"""Prepare a static blue CC0 male HUD mesh from Blender Studio's realistic base."""
import bpy
import json
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'source' / 'human_base_meshes_bundle.blend'

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
names = [
    'GEO-body_male_realistic',
    'GEO-body_male_realistic.eye.L',
    'GEO-body_male_realistic.eye.R',
]
with bpy.data.libraries.load(str(SOURCE), link=False) as (available, requested):
    assert all(name in available.objects for name in names)
    requested.objects = names
meshes = list(requested.objects)
for obj in meshes:
    bpy.context.scene.collection.objects.link(obj)
    obj.hide_viewport = False
    obj.hide_render = False
    obj.hide_set(False)
bpy.context.view_layer.update()
world_matrices = {obj.name: obj.matrix_world.copy() for obj in meshes}
for obj in meshes:
    obj.parent = None
    obj.matrix_world = world_matrices[obj.name]

body = next(obj for obj in meshes if obj.name == 'GEO-body_male_realistic')
positions = [body.matrix_world @ v.co for v in body.data.vertices]
lo = Vector(tuple(min(p[i] for p in positions) for i in range(3)))
hi = Vector(tuple(max(p[i] for p in positions) for i in range(3)))
height = hi.z - lo.z
center = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
scale = 1.8 / height
transform = Matrix.Diagonal((scale, scale, scale, 1)) @ Matrix.Translation(-center)
for obj in meshes:
    obj.matrix_world = transform @ obj.matrix_world

material = bpy.data.materials.new('HUD Blue')
material.use_nodes = True
material.diffuse_color = (0.018, 0.21, 0.62, 1)
shader = material.node_tree.nodes.get('Principled BSDF')
shader.inputs['Base Color'].default_value = (0.018, 0.21, 0.62, 1)
shader.inputs['Metallic'].default_value = 0.2
shader.inputs['Roughness'].default_value = 0.34
shader.inputs['Emission Color'].default_value = (0.008, 0.055, 0.16, 1)
shader.inputs['Emission Strength'].default_value = 0.16
for obj in meshes:
    obj.data.materials.clear()
    obj.data.materials.append(material)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.select_set(False)
    # Retain a modest level of the original sculpt for smooth joints and face.
    for mod in list(obj.modifiers):
        if mod.type == 'MULTIRES':
            mod.levels = min(1, mod.total_levels)
            mod.sculpt_levels = mod.levels
            mod.render_levels = mod.levels
        else:
            obj.modifiers.remove(mod)

body.name = 'HUD_Male_Body'
for obj in meshes:
    if obj != body:
        obj.name = 'HUD_Male_Eye_L' if obj.name.endswith('.L') else 'HUD_Male_Eye_R'

scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
scene['asset_license'] = 'CC0-1.0'
scene['source_url'] = 'https://www.blender.org/download/demo-files/'
scene['source_asset'] = 'Human Base Meshes v1.4.1 / Body Male - Realistic'
scene['preparation'] = 'Original realistic proportions preserved; uniformly scaled to 1.80 m; blue material; static mesh.'
bpy.ops.object.select_all(action='DESELECT')
for obj in meshes:
    obj.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'hud_male_blue.blend'))
bpy.ops.export_scene.gltf(
    filepath=str(ROOT / 'hud_male_blue.glb'),
    export_format='GLB',
    use_selection=True,
    export_apply=True,
    export_animations=False,
    export_cameras=False,
    export_lights=False,
    export_extras=True,
    export_copyright='CC0-1.0. Based on Blender Studio and community Human Base Meshes v1.4.1, Body Male - Realistic.',
)

depsgraph = bpy.context.evaluated_depsgraph_get()
mesh_info = []
for obj in meshes:
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    mesh.calc_loop_triangles()
    mesh_info.append({'name': obj.name, 'vertices': len(mesh.vertices), 'triangles': len(mesh.loop_triangles)})
    evaluated.to_mesh_clear()
(ROOT / 'asset_info.json').write_text(json.dumps({
    'source': scene['source_url'],
    'source_asset': scene['source_asset'],
    'license': 'CC0-1.0',
    'height_m': 1.8,
    'proportions': 'Original realistic base proportions; no independent head or limb scaling',
    'rigged': False,
    'meshes': mesh_info,
    'total_triangles': sum(info['triangles'] for info in mesh_info),
}, indent=2), encoding='utf-8')

# Preview equipment is created only after saving/exporting the clean mesh assets.
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 24
scene.cycles.use_denoising = True
scene.render.resolution_x = 900
scene.render.resolution_y = 1200
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.film_transparent = False
scene.view_settings.view_transform = 'AgX'
scene.world = bpy.data.worlds.new('Preview Background')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.012, 0.018, 0.035, 1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.45

def area(name, location, power, color, size):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = power
    data.color = color
    data.shape = 'DISK'
    data.size = size
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (Vector((0, 0, 1.0)) - obj.location).to_track_quat('-Z', 'Y').to_euler()

area('Preview Key', (-2.5, -3.2, 3.2), 400, (0.76, 0.88, 1.0), 3)
area('Preview Fill', (2.8, -1.8, 1.9), 210, (0.25, 0.62, 1.0), 2.5)
area('Preview Rim', (0.4, 2.0, 2.7), 550, (0.12, 0.65, 1.0), 2)
camera_data = bpy.data.cameras.new('Preview Camera')
camera_data.type = 'ORTHO'
camera_data.ortho_scale = 2.02
camera = bpy.data.objects.new('Preview Camera', camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
for name, position in [
    ('preview_front.png', (0, -5.0, 0.91)),
    ('preview_three_quarter.png', (3.0, -6.0, 1.65)),
]:
    camera.location = position
    camera.rotation_euler = (Vector((0, 0, 0.91)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = str(ROOT / name)
    bpy.ops.render.render(write_still=True)
print('HUD_ASSET_COMPLETE', json.dumps(mesh_info))
