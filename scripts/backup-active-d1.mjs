import {DatabaseSync,backup} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {existsSync,statSync} from 'node:fs';
import path from 'node:path';

const [source,target]=process.argv.slice(2);
const backupRoot=path.resolve('.local-backups');
if(!source||!target||!path.resolve(target).startsWith(backupRoot+path.sep)||existsSync(target)||!existsSync(source)||!statSync(source).isFile())throw new Error('仅允许从现有活动 SQLite 备份到新的 .local-backups 文件');
const digest=db=>{
  const rows=db.prepare('SELECT key,payload,updated_at FROM app_state ORDER BY key').all();
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
};
const db=new DatabaseSync(source,{readOnly:true});
try{
  const before=digest(db);
  await backup(db,target);
  const copied=new DatabaseSync(target,{readOnly:true});
  try{
    const after=digest(copied),quickCheck=copied.prepare('PRAGMA quick_check').get();
    if(after!==before||Object.values(quickCheck||{})[0]!=='ok')throw new Error('备份校验失败');
    console.log(JSON.stringify({source,target,appStateSha256:after,quickCheck:'ok'}));
  }finally{copied.close();}
}finally{db.close();}
