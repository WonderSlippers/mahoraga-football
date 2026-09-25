// Decimal return per unit stake, including returned stake. Shared by ledger and model.
export function validLine(line) { return typeof line === 'number' && Number.isFinite(line) && Number.isInteger(line * 4); }
export function asianFactor(market, side, line, odds, home, away) {
  if (!validLine(line) || !Number.isFinite(odds) || odds <= 1 || ![home,away].every(n=>Number.isInteger(n)&&n>=0)) return null;
  if (!(market === 'spread' ? ['home','away'] : market === 'total' ? ['over','under'] : []).includes(side)) return null;
  const lines = Number.isInteger(line * 2) ? [line] : [Math.floor(line * 2)/2, Math.ceil(line * 2)/2];
  return lines.reduce((s,l)=>{
    const margin = market === 'spread' ? (side === 'home' ? home-away : away-home)+l : (home+away-l)*(side === 'over'?1:-1);
    return s+(margin>0?odds:margin===0?1:0);
  },0)/lines.length;
}
export function marketExpectation(grid, market, side, line, odds) {
  let expectedReturn=0, profitProbability=0, pushProbability=0, lossProbability=0;
  for(let h=0;h<grid.length;h++)for(let a=0;a<grid[h].length;a++){
    const factor=asianFactor(market,side,line,odds,h,a);if(factor===null)return null;
    const p=grid[h][a];expectedReturn+=p*factor;
    if(factor>1)profitProbability+=p;else if(factor===1)pushProbability+=p;else lossProbability+=p;
  }
  return {expectedReturn,profitProbability,pushProbability,lossProbability};
}
