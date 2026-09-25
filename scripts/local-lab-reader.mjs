import {LAB_READ_SQL,restoreLabRows} from '../lib/lab-shards.js';

export function readLocalLab(db){
  const stored=restoreLabRows(db.prepare(LAB_READ_SQL).all());
  if(!stored||!Array.isArray(stored.lab?.portfolios))throw new Error('多策略账本缺失或格式错误');
  return stored;
}
