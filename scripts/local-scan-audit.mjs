const finite=value=>typeof value==='number'&&Number.isFinite(value);
const frozenLeg=leg=>JSON.stringify([leg?.matchId,leg?.market,leg?.pick,leg?.side,leg?.line,leg?.odds]);

export function openDuplicateDirections(lab){
  const duplicates=[];
  for(const portfolio of lab?.portfolios||[]){
    const seen=new Map();
    for(const ticket of portfolio.tickets||[]){
      if(ticket.status!=="open"||ticket.legs?.length!==1)continue;
      const leg=ticket.legs[0];
      const key=JSON.stringify([leg.matchId,leg.market||"1x2",leg.pick,leg.side,leg.line]);
      const prior=seen.get(key);
      if(prior)duplicates.push(`${portfolio.id}:${prior}+${ticket.id}`);
      else seen.set(key,ticket.id);
    }
  }
  return duplicates;
}

// Read-only invariants after a virtual scan; never repairs history silently.
export function auditLabTransition(before,after,legacyBefore,legacyAfter){
  const errors=[];
  for(const duplicate of openDuplicateDirections(after))errors.push(`同策略开放票方向重复 ${duplicate}`);
  const oldPortfolios=before?.portfolios,newPortfolios=after?.portfolios;
  if(!Array.isArray(oldPortfolios)||!Array.isArray(newPortfolios)||oldPortfolios.length!==10||newPortfolios.length!==10)errors.push('策略组合数量不是既有的 10');
  const afterById=new Map((newPortfolios||[]).map(portfolio=>[portfolio.id,portfolio]));
  let oldTickets=0,newTickets=0;
  for(const oldPortfolio of oldPortfolios||[]){
    const portfolio=afterById.get(oldPortfolio.id);
    if(!portfolio){errors.push(`组合消失 ${oldPortfolio.id}`);continue;}
    if(oldPortfolio.initialBalance!==portfolio.initialBalance)errors.push(`组合初始额变化 ${oldPortfolio.id}`);
    if(Number(portfolio.stake)!==20)errors.push(`组合新单金额非 ¥20 ${oldPortfolio.id}`);
    if(!Array.isArray(oldPortfolio.tickets)||!Array.isArray(portfolio.tickets)){errors.push(`票据结构异常 ${oldPortfolio.id}`);continue;}
    const afterByTicket=new Map(portfolio.tickets.map(ticket=>[ticket.id,ticket]));
    if(afterByTicket.size!==portfolio.tickets.length)errors.push(`票据编号重复 ${oldPortfolio.id}`);
    oldTickets+=oldPortfolio.tickets.length;newTickets+=portfolio.tickets.length;
    for(const oldTicket of oldPortfolio.tickets){
      const ticket=afterByTicket.get(oldTicket.id);
      if(!ticket){errors.push(`历史票消失 ${oldPortfolio.id}:${oldTicket.id}`);continue;}
      if(oldTicket.stake!==ticket.stake||oldTicket.odds!==ticket.odds||JSON.stringify((oldTicket.legs||[]).map(frozenLeg))!==JSON.stringify((ticket.legs||[]).map(frozenLeg)))errors.push(`历史金额/报价变化 ${oldPortfolio.id}:${oldTicket.id}`);
    }
    const oldIds=new Set(oldPortfolio.tickets.map(ticket=>ticket.id));
    for(const ticket of portfolio.tickets){
      if(!oldIds.has(ticket.id)&&Number(ticket.stake)!==20)errors.push(`新票金额非 ¥20 ${oldPortfolio.id}:${ticket.id}`);
      if(!finite(ticket.pnl)||ticket.status==='void'&&ticket.pnl!==0||ticket.status==='loss'&&ticket.pnl>0||ticket.status==='win'&&ticket.pnl<0)errors.push(`票据结算符号异常 ${oldPortfolio.id}:${ticket.id}`);
    }
  }
  const prior=legacyBefore?.state,next=legacyAfter?.state;
  if(!prior||!next||!Array.isArray(prior.records)||!Array.isArray(next.records))errors.push('旧账本结构不可核对');
  else{
    if(prior.initialBalance!==next.initialBalance)errors.push('旧账本初始额变化');
    const currentById=new Map(next.records.map(record=>[record.id,record]));
    for(const record of prior.records){const found=currentById.get(record.id);if(!found)errors.push(`旧账本票消失 ${record.id}`);else if(record.stake!==found.stake||record.odds!==found.odds)errors.push(`旧账本原票金额/赔率变化 ${record.id}`);}
  }
  if(Number(legacyAfter?.settings?.autoStake)!==20)errors.push('旧账本自动金额非 ¥20');
  return {ok:errors.length===0,errors:errors.slice(0,20),oldTickets,newTickets,added:Math.max(0,newTickets-oldTickets)};
}
