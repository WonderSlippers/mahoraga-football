// Read-only arithmetic audit, not an independent confirmation of sporting results.
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const cents=value=>Math.round(value*100)/100;

export function auditSettlementArithmetic(tickets){
  const checked=[],skipped=[],errors=[];
  for(const {key,ticket:t} of tickets){
    if(!['win','loss','void'].includes(t.status)){skipped.push({key,reason:'unsettled'});continue;}
    if(!finite(t.stake)||t.stake<=0||!finite(t.pnl)){errors.push({key,reason:'invalid-money'});continue;}
    if(t.status==='void'){
      if(t.pnl!==0)errors.push({key,reason:'void-pnl-not-zero',actual:t.pnl});
      checked.push({key,basis:'void',expectedPnl:0,actualPnl:t.pnl});continue;
    }
    const factors=(t.legs||[]).map(l=>l.returnFactor);
    const factorsComplete=factors.length>0&&factors.every(x=>finite(x)&&x>=0);
    const hasSettledOdds=finite(t.settledOdds)&&t.settledOdds>=0;
    if(!factorsComplete&&!hasSettledOdds){skipped.push({key,reason:'missing-frozen-return-factor'});continue;}
    const factor=factorsComplete?factors.reduce((a,b)=>a*b,1):t.settledOdds;
    if(!Number.isFinite(factor)){errors.push({key,reason:'non-finite-return-factor'});continue;}
    if(factorsComplete&&hasSettledOdds&&Math.abs(factor-t.settledOdds)>1e-8)
      errors.push({key,reason:'settled-odds-differ-from-leg-factors',expected:factor,actual:t.settledOdds});
    const expectedPnl=cents(t.stake*(factor-1));
    if(!Number.isFinite(expectedPnl)){errors.push({key,reason:'non-finite-payout'});continue;}
    if(Math.abs(expectedPnl-t.pnl)>0.005)
      errors.push({key,reason:'pnl-arithmetic-mismatch',expected:expectedPnl,actual:t.pnl});
    checked.push({key,basis:factorsComplete?'saved-leg-return-factors':'saved-settled-odds',factor,expectedPnl,actualPnl:t.pnl});
  }
  return {ok:errors.length===0,checked,skipped,errors};
}
