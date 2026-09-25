// Source eligibility and parsing rules shared by research and regression tests.
// A same-named men's club is NOT a valid source for its women's team.
export const womensCompetition=(league:string)=>/(?:^|\.)w(?:\.|$)|wchampions|nwsl|women/i.test(String(league||''));

export function newsInScope(text:string,published:string,teams:string[],league:string,kickoffAt:number,now=Date.now()):boolean {
  const at=Date.parse(published),body=String(text||'').toLowerCase();
  if(!Number.isFinite(at)||!Number.isFinite(kickoffAt)||at>now+5*60_000||now-at>14*86400000||Math.abs(kickoffAt-at)>14*86400000)return false;
  if(!teams.some(name=>name.length>3&&body.includes(name.toLowerCase())))return false;
  // Generic Barcelona/Real Madrid headlines in a women's match often refer
  // to the men's team. Require an explicit gender cue before linking them.
  if(womensCompetition(league)&&!/(women|women's|womens|female|ladies|femenin|féminin|女足|女子)/i.test(text))return false;
  return true;
}

type InjuryEntry={athlete?:{displayName?:string;shortDisplayName?:string;position?:{abbreviation?:string;displayName?:string}};status?:string;type?:{description?:string};details?:{type?:string;detail?:string};shortComment?:string;longComment?:string};
type FormEvent={gameDate?:string;opponent?:{displayName?:string};gameResult?:string;score?:string;leagueName?:string;competitionName?:string};
type FormRow={team?:{id?:string|number;displayName?:string};form?:string;events?:FormEvent[]};
type OrderedForm={team:string;form:string;games:{date:string;opponent:string;result:string;score:string;competition:string}[]};

export function classifyInjuryPayload(payload:unknown):{status:'named'|'empty'|'unsupported';entries:InjuryEntry[]}{
  const source=payload as {injuries?:unknown;items?:unknown}|null;
  const entries=Array.isArray(source?.injuries)?source.injuries:Array.isArray(source?.items)?source.items:null;
  if(!entries)return {status:'unsupported',entries:[]};
  return {status:entries.length?'named':'empty',entries:entries as InjuryEntry[]};
}

export function orderLastFive(raw:FormRow[],teams:{id:string;name:string}[]):OrderedForm[]{
  return teams.map(team=>{
    const row=raw.find(entry=>String(entry?.team?.id||'')===team.id)
      ||raw.find(entry=>String(entry?.team?.displayName||'').toLowerCase()===team.name.toLowerCase());
    return {team:team.name,form:String(row?.form||''),games:(Array.isArray(row?.events)?row.events:[]).slice(0,5).map(event=>({date:String(event.gameDate||''),opponent:String(event.opponent?.displayName||''),result:String(event.gameResult||''),score:String(event.score||''),competition:String(event.leagueName||event.competitionName||'')}))};
  });
}

export function verifiedAbsenceCount(reports:{reportStatus?:string;list?:{player?:string;status?:string}[]}[]):number {
  return reports.flatMap(report=>report.reportStatus==='named'?report.list||[]:[])
    .filter(row=>!!row.player&&/(?:^|\b)(?:out|suspended|suspension|ruled out|unavailable)(?:\b|$)|缺阵|停赛|无缘/i.test(String(row.status||''))).length;
}
