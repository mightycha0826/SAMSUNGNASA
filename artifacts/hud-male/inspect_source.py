import bpy
import json
from pathlib import Path

root = Path(__file__).resolve().parent
source = next((root / 'source').glob('*.blend'))
with bpy.data.libraries.load(str(source), link=False) as (available, selected):
    names = [name for name in available.objects if 'body_male_realistic' in name.lower()]
    selected.objects = names
for obj in selected.objects:
    if obj is not None:
        bpy.context.scene.collection.objects.link(obj)
        print(json.dumps({
            'name': obj.name,
            'type': obj.type,
            'location': list(obj.location),
            'rotation': list(obj.rotation_euler),
            'scale': list(obj.scale),
            'dimensions': list(obj.dimensions),
            'vertices': len(obj.data.vertices) if obj.type == 'MESH' else None,
            'polygons': len(obj.data.polygons) if obj.type == 'MESH' else None,
            'groups': [g.name for g in obj.vertex_groups] if obj.type == 'MESH' else None,
            'modifiers': [{'name': m.name, 'type': m.type} for m in obj.modifiers],
        }))
print('MATCHED_OBJECTS', names)
