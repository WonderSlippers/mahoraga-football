export function totalResult(line:number,result:{state:string;home_score:number|null;away_score:number|null}|null){
  if(!result)return{over:'待赛果',under:'待赛果'};
  if(result.state==='void')return{over:'作废',under:'作废'};
  if(result.state!=='final'||!Number.isInteger(result.home_score)||!Number.isInteger(result.away_score)||result.home_score!<0||result.away_score!<0)return{over:'待核验',under:'待核验'};
  if(!Number.isFinite(line)||line<=0||!Number.isInteger(line*4))return{over:'盘线规则待核验',under:'盘线规则待核验'};
  const goals=result.home_score!+result.away_score!,lines=Number.isInteger(line*2)?[line]:[line-.25,line+.25];
  const score=lines.reduce((s,l)=>s+Math.sign(goals-l),0)/lines.length;
  const label=(n:number)=>n===1?'赢':n===-1?'输':n===.5?'半赢':n===-.5?'半输':'走盘';
  return{over:label(score),under:label(-score)};
}
