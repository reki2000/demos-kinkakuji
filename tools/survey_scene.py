import bpy, json, os, collections
from mathutils import Vector
OUT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s = bpy.context.scene
counts = collections.Counter((o.type, o.users_collection[0].name if o.users_collection else '') for o in bpy.data.objects)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
materials = []
for m in bpy.data.materials:
    p = m.node_tree.nodes.get('Principled BSDF') if m.use_nodes else None
    if p:
        materials.append({'name':m.name,'color':list(p.inputs['Base Color'].default_value), 'roughness':p.inputs['Roughness'].default_value,'metallic':p.inputs['Metallic'].default_value, 'linked_color':p.inputs['Base Color'].is_linked})
props = bpy.ops.export_scene.gltf.get_rna_type().properties
report = {'counts':[[str(k),v] for k,v in counts.items()], 'mesh_count':len(meshes),'unique_meshes':len({o.data.as_pointer() for o in meshes}),'vertices_sum':sum(len(o.data.vertices) for o in meshes),'materials':materials,
 'gltf_settings':{p.identifier:(str(p.default) if hasattr(p,'default') else '') for p in props},
 'cameras':[{'name':o.name,'position':list(o.location),'rotation':list(o.rotation_euler),'lens':o.data.lens} for o in bpy.data.objects if o.type=='CAMERA'],
 'instances':[{'name':o.name,'collection':o.instance_collection.name,'location':list(o.location)} for o in bpy.data.objects if o.instance_type=='COLLECTION'],
 'collections':[{'name':c.name,'direct':len(c.objects),'all':len(c.all_objects)} for c in bpy.data.collections]}
open(OUT+'/scene_survey.json','w').write(json.dumps(report,ensure_ascii=False,indent=2))
print('SCENE_SURVEY',json.dumps({k:report[k] for k in ['mesh_count','unique_meshes','vertices_sum','counts']}),flush=True)
