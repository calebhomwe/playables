#!/usr/bin/env python3
"""Build a deterministic local-file inventory; missing critical refs fail closed.
Each repository owns its worker and package map. No network is used by this build.
"""
from pathlib import Path
from urllib.parse import urlsplit, unquote
import hashlib, json, re, sys

ROOT=Path(__file__).resolve().parents[1]
SPEC=json.loads((ROOT/'offline-games.json').read_text())
SKIP={'node_modules','.git','qa','docs','tools','tests','shots','screenshots','verify','proof','audit','_loop','__pycache__'}
EXT={'.html','.js','.mjs','.css','.json','.png','.jpg','.jpeg','.webp','.svg','.woff','.woff2','.ttf','.mp3','.ogg','.wav','.glb','.gltf','.bin','.wasm','.pck','.data','.mp4'}
TEXT={'.html','.js','.mjs','.css','.json','.gltf'}
def physical(url):
    parsed=urlsplit(url)
    if parsed.scheme or parsed.netloc: raise ValueError('External runtime URL: '+url)
    p=(ROOT/unquote(parsed.path)).resolve()
    if not p.is_relative_to(ROOT): raise ValueError('Dependency outside repository: '+url)
    return p
def eligible(p):
    rel=p.relative_to(ROOT)
    return p.is_file() and p.suffix.lower() in EXT and not any(v in SKIP for v in rel.parts) and not re.search(r'(^|/)(shot[-_.]|screenshot|repro_|test[-_.])',str(rel),re.I)
def directory(p): return [f.relative_to(ROOT).as_posix() for f in p.rglob('*') if eligible(f)]

def dependencies(entry, whole_folder=True):
    files=set([entry]);entry_path=physical(entry)
    if whole_folder and entry_path.parent!=ROOT and entry_path.parent.name!='games':files.update(f for f in directory(entry_path.parent) if not f.endswith('.html') or f==entry)
    # Document-relative dynamic image/audio helpers in the shared game kits.
    if entry.startswith('games/') and (ROOT/'games/assets').is_dir():
        files.update(directory(ROOT/'games/assets'))
        if (ROOT/'games/audio').is_dir():files.update(directory(ROOT/'games/audio'))
    if (ROOT/'assets/offline-sdk').is_dir():files.update(directory(ROOT/'assets/offline-sdk'))
    if whole_folder and (ROOT/'assets/arcade-sdk.js').is_file():
        files.add('assets/arcade-sdk.js')
        if (ROOT/'assets/sfx').is_dir():files.update(directory(ROOT/'assets/sfx'))
    queue=list(files);seen=set()
    imports={}
    for body in re.findall(r'<script[^>]*type=[\"\x27]importmap[\"\x27][^>]*>([\s\S]*?)</script>',entry_path.read_text(errors='replace')):
        imports.update(json.loads(body).get('imports',{}))
    while queue:
        url=queue.pop()
        if url in seen:continue
        seen.add(url);p=physical(url)
        if not p.is_file():raise FileNotFoundError(str(p.relative_to(ROOT)))
        if p.suffix.lower() not in TEXT or p.name in {'game-meta.json','offline-catalog.json','offline-games.json'}:continue
        for common in ['lib3d','games/kit3d']:
            if url.startswith(common+'/'):
                for extra in directory(ROOT/common):
                    if extra not in files:files.add(extra);queue.append(extra)
        text=p.read_text(errors='replace')
        text=re.sub(r'/\*[\s\S]*?\*/|<!--[\s\S]*?-->', '', text)
        text=re.sub(r'(?m)^\s*//.*$', '', text)
        # These are executable dependencies, so unresolved or remote ones are errors.
        critical=re.findall(r'<script\b[^>]*\bsrc=["\x27]([^"\x27]+)',text,re.I)
        critical+=re.findall(r'<link\b(?=[^>]*rel=["\x27]stylesheet["\x27])[^>]*href=["\x27]([^"\x27]+)',text,re.I)
        critical+=re.findall(r'(?:\bfrom\s*|\bimport\s*\()["\x27]([^"\x27]+)',text)
        refs=[(v,True) for v in critical]
        refs += [(m[1],False) for m in re.finditer(r'''["\x27]([^"\x27\n<>]{1,240}\.(?:js|mjs|css|json|png|jpe?g|webp|svg|glb|gltf|bin|wasm|pck|mp3|wav|ogg|woff2?|ttf)(?:\?[^"\x27\s]*)?)["\x27]''',text,re.I)]
        # JS image URL strings often resolve against the document rather than script.
        for value,required in refs:
            if value.startswith(('data:','blob:','#')) or any(c in value for c in ['+','{','}']):continue
            mapped=False
            for name in sorted(imports,key=len,reverse=True):
                if value==name or (name.endswith('/') and value.startswith(name)):
                    value=imports[name]+value[len(name):];mapped=True;break
            u=urlsplit(value)
            if u.scheme or u.netloc:
                if required:raise ValueError('External critical dependency: '+value)
                continue
            if not ('/' in value or '.' in value):continue
            candidates=[entry_path.parent/unquote(u.path)] if mapped else [p.parent/unquote(u.path),entry_path.parent/unquote(u.path)]
            candidate=next((f.resolve() for f in candidates if f.is_file() and f.resolve().is_relative_to(ROOT)),None)
            if candidate is None:
                if required:raise FileNotFoundError(url+' -> '+value)
                continue
            if candidate.name=='offline-manifest.js':continue  # Worker imports persist separately; avoid self-referential hashes.
            key=candidate.relative_to(ROOT).as_posix()+(('?'+u.query) if u.query else '')
            if key not in files:files.add(key);queue.append(key)
    return sorted(files)

assets={}
def inventory(files):
    for f in files:
        if f not in assets:
            b=physical(f).read_bytes();assets[f]={'sha256':hashlib.sha256(b).hexdigest(),'size':len(b)}
    return hashlib.sha256(json.dumps({k:assets[k] for k in files},sort_keys=True).encode()).hexdigest()[:16]
groups={};failures=[]
for g in SPEC['games']:
    try:
        files=dependencies(g['entry']);rev=inventory(files)
        total=sum(assets[f]['size'] for f in files)
        if total>64*1024*1024:raise ValueError('Package exceeds the 64 MB mobile download budget')
        groups[g['id']]={'entry':g['entry'],'title':g['title'],'revision':rev,'bytes':total,'files':files}
    except (ValueError,FileNotFoundError) as error:failures.append(g['id']+': '+str(error))
if failures:raise SystemExit('Offline packages not safe to publish:\n'+'\n'.join(failures))
shell=set(SPEC['shell'])
for page in ['index.html']:
    shell.update(dependencies(page,False))
shell=sorted(shell);inventory(shell)
revision=hashlib.sha256(json.dumps({'shell':{k:assets[k] for k in shell},'groups':groups,'legacyCaches':SPEC.get('legacyCaches',[])},sort_keys=True).encode()).hexdigest()[:16]
config={'namespace':SPEC['namespace'],'revision':revision,'index':'index.html','legacyCaches':SPEC.get('legacyCaches',[]),'assets':dict(sorted(assets.items())),'shell':shell,'groups':groups}
output='// Generated by tools/build-mobile-offline.py. Do not edit.\nself.OFFLINE_CONFIG = '+json.dumps(config,ensure_ascii=False,separators=(',',':'))+';\n'
target=ROOT/'offline-manifest.js'
if '--check' in sys.argv:
    if not target.exists() or target.read_text()!=output:raise SystemExit('Offline manifest is stale: python3 tools/build-mobile-offline.py')
else:target.write_text(output)
print(SPEC['namespace']+': '+str(len(groups))+' packages, '+str(len(assets))+' unique assets, '+revision)
