type Statements=D1PreparedStatement[];
type ScanWriteSet={
  lab:Statements;
  forecasts:Statements;
  outcomes:Statements;
  quotes:Statements;
  results:Statements;
  odds:Statements;
  sampling:D1PreparedStatement;
  finalize:Statements;
};

// Leave room for route reads in a single Worker invocation. An oversized scan
// must fail before publishing anything; it cannot be split into smaller commits.
export const MAX_ATOMIC_SCAN_STATEMENTS=700;

export async function commitAtomicScan(db:D1Database,set:ScanWriteSet){
  if(set.lab.length<2||set.finalize.length<3)throw new Error('扫描写集缺少账本或完成守卫');
  const statements:Statements=[];
  const append=(rows:Statements)=>{const start=statements.length;statements.push(...rows);return {start,length:rows.length};};
  // Both CAS/lease checks execute before the first mutation in one D1 batch.
  append([set.finalize[0],set.lab[0]]);
  append(set.lab.slice(1));
  const forecast=append(set.forecasts),outcome=append(set.outcomes);
  const quotes=append(set.quotes),results=append(set.results),odds=append(set.odds);
  const sampling=append([set.sampling]);
  const finish=append(set.finalize.slice(1));
  if(statements.length>MAX_ATOMIC_SCAN_STATEMENTS)throw new Error(`扫描写集 ${statements.length} 条超过单事务安全上限 ${MAX_ATOMIC_SCAN_STATEMENTS}`);
  const response=await db.batch(statements);
  const changes=(group:{start:number;length:number})=>response.slice(group.start,group.start+group.length).reduce((sum,row)=>sum+Number(row.meta.changes||0),0);
  if(changes({start:finish.start,length:2})!==2)throw new Error('扫描完成标记或个人账本 CAS 意外未写入，请核对批次');
  return {
    forecastInserted:changes(forecast),outcomeInserted:changes(outcome),
    quotesInserted:changes(quotes),resultsInserted:changes(results),oddsInserted:changes(odds),
    samplingRecorded:changes(sampling)===1,statementCount:statements.length,
  };
}
