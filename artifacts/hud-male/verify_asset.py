import bpy
import json
import math
import struct
from pathlib import Path
from mathutils import Vector

root = Path(__file__).resolve().parent
path = root / 'hud_male_blue.glb'
data = path.read_bytes()
magic, version, size = struct.unpack_from('<4sII', data, 0)
assert (magic, version, size) == (b'glTF', 2, len(data))
chunk_size, chunk_type = struct.unpack_from('<I4s', data, 12)
assert chunk_type == b'JSON'
gltf = json.loads(data[20:20 + chunk_size])
assert len(gltf['meshes']) == 3
assert not gltf.get('skins')
assert not gltf.get('cameras')
assert not gltf.get('animations')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(path))
bpy.context.view_layer.update()
objects = list(bpy.context.scene.objects)
assert len(objects) == 3 and all(obj.type == 'MESH' for obj in objects)
points = [obj.matrix_world @ v.co for obj in objects for v in obj.data.vertices]
assert all(math.isfinite(component) for point in points for component in point)
lo = Vector(tuple(min(point[i] for point in points) for i in range(3)))
hi = Vector(tuple(max(point[i] for point in points) for i in range(3)))
triangles = 0
for obj in objects:
    obj.data.calc_loop_triangles()
    triangles += len(obj.data.loop_triangles)
assert triangles == 86856
assert abs((hi - lo).z - 1.8) < 0.01
report = {
    'glb_round_trip_import': 'passed',
    'file_bytes': len(data),
    'mesh_objects': len(objects),
    'triangles': triangles,
    'dimensions_m': list(hi - lo),
    'bounding_min_m': list(lo),
    'bounding_max_m': list(hi),
    'finite_geometry': True,
    'rigged': False,
    'camera_or_light_in_asset': False,
}
(root / 'verification.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
