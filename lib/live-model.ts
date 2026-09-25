import { dcScoreGrid } from "./goal-model";
// In-play fair-price model (PAPER MODE ONLY — no live bets are placed;
// charter forbids live betting without independent in-play odds).
// Remaining-time Poisson: pre-match lambdas are scaled by the fraction
// of the match left, plus a modest game-state adjustment (trailing
// teams push, leading teams sit) that stays conservative.
export function inPlayLambdas(preHome:number,preAway:number,minute:number,homeScore:number,awayScore:number):{home:number;away:number}{
  const remaining=Math.max(5,105-Math.min(105,Math.max(0,minute)))/105;
  let lh=preHome*remaining*1.08,la=preAway*remaining*1.08;
  const diff=homeScore-awayScore;
  if(diff<0){lh*=1.15;la*=0.9;}        // home trails: pushes up
  else if(diff>0){lh*=0.88;la*=1.1;}   // home leads: game state slows
  return {home:Math.max(.05,lh),away:Math.max(.05,la)};
}
export function inPlayProbabilities(preHome:number,preAway:number,minute:number,homeScore:number,awayScore:number){
  const {home,away}=inPlayLambdas(preHome,preAway,minute,homeScore,awayScore);
  const grid=dcScoreGrid(home,away);
  let pHome=0,pDraw=0,pAway=0,pOver15=0,pUnder15=0;
  for(let i=0;i<grid.length;i++)for(let j=0;j<grid[i].length;j++){
    const p=grid[i][j],th=i+homeScore,ta=j+awayScore;
    if(th>ta)pHome+=p;else if(th===ta)pDraw+=p;else pAway+=p;
    if(th+ta>=2)pOver15+=p;else pUnder15+=p;   // >=2 total goals ≈ O1.5 from now incl. current
  }
  return {home:pHome,draw:pDraw,away:pAway,over15:pOver15,under15:pUnder15,homeLambda:home,awayLambda:away};
}
export function fairOdds(p:number){return p>0.001?Math.min(50,1/p):50;}
