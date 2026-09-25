// A saved model candidate is actionable only while both its scan and the
// selected league's current observation remain recent and healthy.
export function decisionEvidenceFresh({scanAt,feedStatus,lastSuccessAt,quoteStale,now=Date.now()}){
  const scan=Number(scanAt),feed=Number(lastSuccessAt);
  return Number.isFinite(scan)&&scan>0&&scan<=now+1000&&now-scan<=5*60000
    &&feedStatus==='ok'&&Number.isFinite(feed)&&feed>0&&feed<=now+1000&&now-feed<=5*60000
    &&quoteStale!==true;
}

export function candidateQuoteMatches(leg,match,now=Date.now()){
  const capturedAt=Number(leg?.priceCapturedAt),provider=String(leg?.provider||'');
  if(leg?.phase!=='current'||!provider||!Number.isFinite(capturedAt)||capturedAt<=0||capturedAt>now+1000||now-capturedAt>5*60000)return false;
  const same=(a,b)=>Number(a)>1&&Number(b)>1&&Math.abs(Number(a)-Number(b))<.001;
  if(!leg.market||leg.market==='1x2'){
    const pick=Number(leg.pick);
    return Number.isInteger(pick)&&pick>=0&&pick<=2&&match?.odds?.quotePhase==='current'
      &&provider===String(match.odds.provider||'')&&same(leg.odds,match.odds.decimals?.[pick]);
  }
  return (match?.odds?.offers||[]).some(offer=>{
    if(provider!==String(offer.provider||''))return false;
    if(leg.market==='total')return offer.total?.phase==='current'&&Number(offer.total.line)===Number(leg.line)
      &&same(leg.odds,leg.side==='over'?offer.total.overOdds:leg.side==='under'?offer.total.underOdds:null);
    if(leg.market==='spread')return offer.spread?.phase==='current'&&Number(offer.spread[leg.side==='home'?'homeLine':'awayLine'])===Number(leg.line)
      &&same(leg.odds,leg.side==='home'?offer.spread.homeOdds:leg.side==='away'?offer.spread.awayOdds:null);
    return false;
  });
}
