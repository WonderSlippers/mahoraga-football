import type {GoalEvidence} from './goal-model';

// A research response can update a future decision only when its team order,
// collection time and source-backed goal evidence match that exact fixture.
// Missing or ambiguous evidence stays missing; it is never inferred from names.
export function linkedResearchGoalEvidence(data:unknown, homeId:string|undefined, awayId:string|undefined, now=Date.now()):GoalEvidence|null {
  const response=data as {ok?:boolean;degraded?:boolean;teams?:{id?:unknown}[];capturedAt?:unknown;goalEvidence?:Record<string,unknown>}|null;
  if(!homeId||!awayId||!response?.ok||response.degraded||!Array.isArray(response.teams)||response.teams.length!==2)return null;
  if(String(response.teams[0]?.id)!==String(homeId)||String(response.teams[1]?.id)!==String(awayId))return null;
  const captured=Number(response.capturedAt),g=response.goalEvidence;
  if(!Number.isFinite(captured)||captured>now+60_000||now-captured>30*60_000||!g)return null;
  if(!Number.isFinite(Number(g.capturedAt))||Number(g.capturedAt)>now+60_000||now-Number(g.capturedAt)>2*60*60_000)return null;
  if(!Number.isFinite(Number(g.expectedHome))||Number(g.expectedHome)<=0||!Number.isFinite(Number(g.expectedAway))||Number(g.expectedAway)<=0)return null;
  if(!Number.isFinite(Number(g.uncertaintyMargin))||Number(g.uncertaintyMargin)<0||Number(g.uncertaintyMargin)>.14)return null;
  if(!Array.isArray(g.sourceUrls)||!g.sourceUrls.length||!g.sourceUrls.every((url:unknown)=>{
    try { const u=new URL(String(url));return u.protocol==='https:'&&u.hostname==='site.web.api.espn.com'; } catch { return false; }
  }))return null;
  return g as GoalEvidence;
}
