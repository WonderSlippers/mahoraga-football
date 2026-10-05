"""Read-only archive inventory; never import or execute archived code."""
import sys,zipfile,hashlib,json,re,stat
from pathlib import Path,PurePosixPath
def inspect(filename):
    source=Path(filename)
    with zipfile.ZipFile(source) as archive:
        infos=archive.infolist()
        if len(infos)>20000 or sum(x.file_size for x in infos)>1024**3: raise ValueError('ZIP_LIMIT')
        entries=[]
        for item in infos:
            name=item.filename.replace('\\','/')
            if name.startswith('/') or '..' in PurePosixPath(name).parts or re.match(r'^[A-Za-z]:',name) or stat.S_ISLNK(item.external_attr>>16):raise ValueError('ZIP_PATH_REJECTED')
            if item.file_size>128*1024**2 or item.file_size/max(item.compress_size,1)>500:raise ValueError('ZIP_LIMIT')
            if item.is_dir():continue
            data=archive.read(item)
            entries.append({'name':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'loadPolicy':'DENY_SERIALIZED_CODE' if name.endswith(('.pkl','.pickle','.joblib')) else 'INVENTORY_ONLY'})
    return {'archive':source.name,'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'expandedBytes':sum(x['bytes'] for x in entries),'executed':False,'entries':entries}
if __name__=='__main__':print(json.dumps([inspect(x) for x in sys.argv[1:]],ensure_ascii=False,indent=2))
