"""Export the finished model without modifying the source .blend.

Static parts are merged by material; foliage placement uses GPU instances.
Blender procedural surfaces are given explicit PBR values and projected UVs.
"""
import bpy, bmesh, numpy as np, json, math, struct, os, time
from mathutils import Matrix, Vector
from collections import defaultdict

OUT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = OUT + '/assets'
os.makedirs(ASSETS, exist_ok=True)
s = bpy.context.scene
vl = s.view_layers.new('WebGL export evaluation')
for window in bpy.context.window_manager.windows:
    window.view_layer = vl
deps = bpy.context.evaluated_depsgraph_get()
groups = defaultdict(lambda: {'p': [], 'n': [], 'uv': [], 'i': [], 'count': 0})
foliage = defaultdict(list)
stats = defaultdict(int)
rotation = Matrix.Rotation(-math.pi / 2, 4, 'X')
mat_ids, materials = {}, []

def color_of(m, p):
    name = m.name
    fixed = {
        'Eave | closely laid gold leaf and fine overlaps': [.78, .46, .08],
        'Wind bell | gently aged gilded bronze': [.62, .39, .11],
        'Ground floor | aged gold-paper fusuma': [.63, .29, .052],
        'Ground floor | weathered vertical cedar grain': [.105, .049, .020],
    }
    if name in fixed:
        return fixed[name]
    if p.inputs['Base Color'].is_linked:
        nodes = m.node_tree.nodes
        bricks = [n for n in nodes if n.type == 'TEX_BRICK']
        if bricks:
            return [(bricks[0].inputs['Color1'].default_value[i] + bricks[0].inputs['Color2'].default_value[i]) / 2 for i in range(3)]
        ramps = [n for n in nodes if n.type == 'VALTORGB']
        if ramps:
            values = ramps[0].color_ramp.elements
            return [(values[0].color[i] + values[-1].color[i]) * .5 for i in range(3)]
    return list(p.inputs['Base Color'].default_value[:3])

def material_id(m):
    if m.name in mat_ids:
        return mat_ids[m.name]
    p = m.node_tree.nodes.get('Principled BSDF') if m.use_nodes else None
    name = m.name.lower()
    surface = ('gold' if any(t in name for t in ['gold', 'gilt', 'gilded', 'phoenix', 'wind bell']) else
               'roof' if 'shingle' in name else
               'wood' if any(t in name for t in ['cedar', 'timber']) else
               'stone' if any(t in name for t in ['stone', 'granite']) else
               'moss' if 'moss' in name else 'plain')
    color = color_of(m, p) if p else list(m.diffuse_color[:3])
    entry = {'name': m.name, 'doubleSided': True,
             'pbrMetallicRoughness': {'baseColorFactor': color + [1],
                'metallicFactor': float(p.inputs['Metallic'].default_value) if p else 0,
                'roughnessFactor': float(p.inputs['Roughness'].default_value) if p else .7},
             'extras': {'surface': surface}}
    idx = len(materials)
    mat_ids[m.name] = idx
    materials.append(entry)
    return idx

def add_object(o, category, transform=None):
    if o.type not in ['MESH', 'CURVE']:
        return
    mw = transform @ o.matrix_world if transform is not None else o.matrix_world.copy()
    mats = list(o.data.materials)
    if not mats:
        return
    if o.type == 'MESH' and mats[0] and mats[0].name.startswith('Pine needles'):
        # Keep the original clump's exact placement, orientation and extents.
        bbox = np.asarray(o.bound_box)
        lo, hi = bbox.min(axis=0), bbox.max(axis=0)
        center, half = (lo + hi) * .5, (hi - lo) * .5
        shape = Matrix.Translation(Vector(center)) @ Matrix.Diagonal(Vector((*half, 1)))
        matrix = rotation @ mw @ shape
        foliage[(category, mats[0].name)].append([float(matrix[row][col]) for col in range(4) for row in range(4)])
        stats['foliage_instances'] += 1
        return
    eo = o.evaluated_get(deps)
    me = eo.to_mesh()
    if not me or not len(me.polygons):
        eo.to_mesh_clear()
        return
    # Many original box meshes were authored with inward winding. Cycles hides
    # that difference; correct it for WebGL culling and physical reflections.
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(me)
    bm.free()
    me.update()
    me.calc_loop_triangles()
    v = np.empty(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get('co', v)
    v = v.reshape(-1, 3)
    affine = np.asarray(mw, dtype=np.float32)
    world = v @ affine[:3, :3].T + affine[:3, 3]
    loop_vi = np.empty(len(me.loops), dtype=np.int32)
    me.loops.foreach_get('vertex_index', loop_vi)
    ln = np.empty(len(me.corner_normals) * 3, dtype=np.float32)
    me.corner_normals.foreach_get('vector', ln)
    norm = ln.reshape(-1, 3) @ np.linalg.inv(affine[:3, :3])
    norm /= np.maximum(np.linalg.norm(norm, axis=1, keepdims=True), 1e-12)
    pos = world[loop_vi]
    dominant = np.argmax(np.abs(norm), axis=1)
    uv = np.empty((len(pos), 2), dtype=np.float32)
    for axis, pair in [(0, (1, 2)), (1, (0, 2)), (2, (0, 1))]:
        mask = dominant == axis
        uv[mask] = pos[mask][:, pair]
    tris = np.empty(len(me.loop_triangles) * 3, dtype=np.int32)
    me.loop_triangles.foreach_get('loops', tris)
    tris = tris.reshape(-1, 3)
    mi = np.empty(len(me.loop_triangles), dtype=np.int32)
    me.loop_triangles.foreach_get('material_index', mi)
    if mw.determinant() < 0:
        tris = tris[:, ::-1]
    for slot in np.unique(mi):
        m = me.materials[int(slot)] if len(me.materials) > int(slot) else mats[0]
        if not m:
            continue
        mid = material_id(m)
        surface = materials[mid]['extras']['surface']
        coords = uv.copy()
        if surface == 'gold':
            coords /= 1.68
        elif surface == 'wood':
            extent = world.max(axis=0) - world.min(axis=0)
            long_axis = int(np.argmax(extent))
            for axis in [0, 1, 2]:
                mask = dominant == axis
                if long_axis != axis:
                    short_axis = next(i for i in range(3) if i != axis and i != long_axis)
                    coords[mask, 0] = pos[mask, short_axis] * 1.6
                    coords[mask, 1] = pos[mask, long_axis] * .24
        take = tris[mi == slot].reshape(-1)
        packed = np.column_stack((pos[take], norm[take], coords[take])).astype(np.float32)
        unique, inverse = np.unique(packed, axis=0, return_inverse=True)
        g = groups[(category, mid)]
        g['p'].append(unique[:, :3].copy())
        g['n'].append(unique[:, 3:6].copy())
        g['uv'].append(unique[:, 6:8].copy())
        g['i'].append((inverse + g['count']).astype(np.uint32))
        g['count'] += len(unique)
        stats['triangles'] += len(take) // 3
    eo.to_mesh_clear()
    stats['source_objects'] += 1

def export_collection(name, category):
    objects = list(bpy.data.collections[name].all_objects)
    for i, o in enumerate(objects):
        if o.instance_type == 'COLLECTION' and o.instance_collection:
            matrix = o.matrix_world @ Matrix.Translation(-o.instance_collection.instance_offset)
            for part in o.instance_collection.all_objects:
                add_object(part, category, matrix)
            stats['collection_instances'] += 1
        else:
            add_object(o, category)
        if i % 300 == 0:
            print('EXPORT_PROGRESS', category, i, '/', len(objects), 'triangles', stats['triangles'], flush=True)

for name, category in [
    ('01 | Pavilion architecture', 'pavilion'),
    ('03 | Wood shingle roofs', 'pavilion'),
    ('04 | Garden and shoreline', 'garden'),
    ('05 | Pines and woodland', 'garden'),
    ('10 | Rear inspection planting and light', 'rearGarden'),
]:
    export_collection(name, category)
# Ornaments' inspection rigs are separate child collections, not architecture.
for o in bpy.data.collections['02 | Joinery and ornaments'].objects:
    add_object(o, 'pavilion')

buffer = bytearray()
gltf = {'asset': {'version': '2.0', 'generator': 'Kinkakuji Blender-to-WebGL material batching'},
        'scene': 0, 'scenes': [{'nodes': [0]}],
        'nodes': [{'name':'Blender Z-up conversion', 'rotation': [-math.sqrt(.5),0,0,math.sqrt(.5)], 'children': []}],
        'meshes': [], 'materials': materials, 'buffers': [], 'bufferViews': [], 'accessors': []}
category_nodes = {}
for category in ['pavilion', 'garden', 'rearGarden']:
    idx = len(gltf['nodes'])
    gltf['nodes'].append({'name': category, 'children': []})
    category_nodes[category] = idx
    gltf['nodes'][0]['children'].append(idx)

def accessor(a, dtype, typ, target):
    while len(buffer) % 4:
        buffer.append(0)
    offset = len(buffer)
    buffer.extend(a.tobytes())
    view = len(gltf['bufferViews'])
    gltf['bufferViews'].append({'buffer':0, 'byteOffset':offset, 'byteLength':a.nbytes, 'target':target})
    entry = {'bufferView': view, 'componentType':dtype, 'count':len(a), 'type':typ}
    if typ == 'VEC3':
        entry['min'] = [float(x) for x in a.min(axis=0)]
        entry['max'] = [float(x) for x in a.max(axis=0)]
    gltf['accessors'].append(entry)
    return len(gltf['accessors']) - 1

for (category, mid), g in groups.items():
    p, n, uv, indices = [np.concatenate(g[k], axis=0) for k in ['p', 'n', 'uv', 'i']]
    prim = {'attributes': {'POSITION':accessor(p,5126,'VEC3',34962),
                           'NORMAL':accessor(n,5126,'VEC3',34962),
                           'TEXCOORD_0':accessor(uv,5126,'VEC2',34962)},
            'indices':accessor(indices,5125,'SCALAR',34963), 'material': mid}
    mesh_id = len(gltf['meshes'])
    label = category + ' | ' + materials[mid]['name']
    gltf['meshes'].append({'name':label, 'primitives':[prim]})
    node_id = len(gltf['nodes'])
    gltf['nodes'].append({'name':label, 'mesh':mesh_id})
    gltf['nodes'][category_nodes[category]]['children'].append(node_id)
gltf['buffers'] = [{'byteLength':len(buffer)}]
encoded = json.dumps(gltf,separators=(',',':'),ensure_ascii=False).encode()
encoded += b' ' * ((-len(encoded)) % 4)
buffer += b'\0' * ((-len(buffer)) % 4)
with open(ASSETS+'/kinkakuji-source.glb','wb') as f:
    f.write(struct.pack('<III',0x46546c67,2,12+8+len(encoded)+8+len(buffer)))
    f.write(struct.pack('<II',len(encoded),0x4e4f534a));f.write(encoded)
    f.write(struct.pack('<II',len(buffer),0x004e4942));f.write(buffer)

def convert(v):
    return [float(v.x), float(v.z), float(-v.y)]
camera_config = []
presets = [
    ('01', '正面', 90, 854/1280, 'garden'),
    ('14', '裏側', 58, 1200/900, 'rearGarden'),
    ('12', '1階', 46, 1200/800, 'garden'),
    ('16', '軒先', 1.72, 1200/900, 'none'),
    ('17', '風鐸', .81, 1000/1100, 'none'),
    ('10', '鳳凰', 3.66, 1200/900, 'none'),
]
for prefix,label,distance,aspect,landscape in presets:
    cam = next(o for o in bpy.data.objects if o.type == 'CAMERA' and o.name.startswith(prefix+' |'))
    direction = cam.rotation_euler.to_matrix() @ Vector((0,0,-1))
    vfov = math.degrees(2*math.atan(cam.data.sensor_width/(2*cam.data.lens)/aspect))
    camera_config.append({'id':prefix,'label':label,'position':convert(cam.location),
        'target':convert(cam.location+direction*distance),'fov':vfov, 'landscape':landscape})
sun = next(o for o in bpy.data.objects if o.type == 'LIGHT' and o.data.type == 'SUN')
sun_direction = sun.rotation_euler.to_matrix() @ Vector((0,0,1))
pond = next(o for o in bpy.data.collections['06 | Water, cameras and lighting'].objects if o.type=='MESH')
pond_z = sum((pond.matrix_world@Vector(v)).z for v in pond.bound_box)/8
foliage_config = []
for (category, name), matrices in foliage.items():
    m = bpy.data.materials[name]
    p = m.node_tree.nodes.get('Principled BSDF')
    foliage_config.append({'category':category,'name':name,'color':color_of(m,p),'matrices':matrices})
config = {'cameras':camera_config,'sun':{'direction':convert(sun_direction),'energy':sun.data.energy},
          'pondHeight':pond_z,'foliage':foliage_config,
          'stats':dict(stats), 'draw_batches':len(groups),
          'source':'Kinkakuji_eaves_refined.blend',
          'limits':['Foliage is represented by instanced needle cards at the original clump placements.',
                    'Blender procedural materials are represented by PBR textures; lighting is reimplemented.',
                    'Browser path tracing approaches Cycles but is not pixel-identical.']}
open(ASSETS+'/scene.json','w').write(json.dumps(config,separators=(',',':'),ensure_ascii=False))
print('WEBGL_GEOMETRY_EXPORTED',json.dumps({'stats':dict(stats),'batches':len(groups),'glb_bytes':len(buffer)}),flush=True)

# Preserve the original Nishita sky as a floating-point radiance environment.
sky_scene = bpy.data.scenes.new('WebGL radiance environment')
sky_scene.world = s.world.copy()
sky_scene.render.engine = 'CYCLES'
sky_scene.cycles.samples = 1
sky_scene.cycles.use_denoising = False
sky_scene.render.resolution_x = 1024
sky_scene.render.resolution_y = 512
sky_scene.render.resolution_percentage = 100
sky_scene.render.image_settings.file_format = 'HDR'
sky_scene.render.image_settings.color_mode = 'RGB'
sky_scene.render.filepath = ASSETS+'/sky.hdr'
cam_data = bpy.data.cameras.new('Radiance panorama')
cam_data.type = 'PANO'
cam_data.panorama_type = 'EQUIRECTANGULAR'
cam = bpy.data.objects.new('Radiance panorama',cam_data)
sky_scene.collection.objects.link(cam)
sky_scene.camera = cam
cam.rotation_euler = (math.pi/2,0,0)
bpy.ops.render.render(write_still=True,scene=sky_scene.name)
print('WEBGL_EXPORT_FINISHED',flush=True)
