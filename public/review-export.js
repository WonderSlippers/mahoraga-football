// One row per leg keeps parlays auditable without silently dropping legs.
// Text from external feeds is quoted and guarded against spreadsheet formulas.
const header=['账本范围','策略 ID','策略名称','票据 ID','票据状态','创建时间（北京时间）','结算时间（北京时间）','整单投入（元）','整单赔率','整单已实现盈亏（元）','腿序号','腿数','联赛代码','赛事 ID','主队','客队','玩法','方向','盘口','该腿赔率','提供方','报价阶段','报价抓取时间（北京时间）','腿状态','完场比分'];
const numericColumns=new Set([7,8,9,10,11,18,19]);
const timestamp=value=>{const n=Number(value);return Number.isFinite(n)&&n>0?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(n)):'';};
const textCell=value=>{let s=String(value??'');if(/^\s*[=+\-@]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
const numberCell=value=>{if(value===null||value===undefined||value==='')return '';const n=Number(value);return Number.isFinite(n)?String(n):'';};

export function exportReviewCsv(portfolios){
  const lines=[header.map(textCell).join(',')];
  for(const portfolio of portfolios||[])for(const ticket of portfolio.tickets||[]){
    const legs=ticket.legs?.length?ticket.legs:[null];
    for(let index=0;index<legs.length;index++){
      const leg=legs[index],row=[
        '十策略模拟账本',portfolio.id,portfolio.name,ticket.id,ticket.status,
        timestamp(ticket.createdAt),timestamp(ticket.settledAt),ticket.stake,ticket.odds,['win','loss','void'].includes(ticket.status)?ticket.pnl:null,
        leg?index+1:null,ticket.legs?.length||0,leg?.leagueCode,leg?.matchId,leg?.home,leg?.away,
        leg?.market||'1x2',leg?.side??(leg?['主胜','平局','客胜'][Number(leg.pick)]||'':null),leg?.line,leg?.odds,
        leg?.provider,leg?.phase,timestamp(leg?.priceCapturedAt),leg?.status,leg?.finalScore
      ];
      lines.push(row.map((value,column)=>numericColumns.has(column)?numberCell(value):textCell(value)).join(','));
    }
  }
  return '\uFEFF'+lines.join('\r\n')+'\r\n';
}
