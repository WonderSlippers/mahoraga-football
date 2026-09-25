// A coherent close-field quote is evidence of a past reference price, never
// evidence that a complete current 1X2 market is available.
export function quoteCoverage(match) {
  const values=Array.isArray(match?.odds)?match.odds:[];
  const valid=values.filter(value=>Number.isFinite(Number(value))&&Number(value)>1).length;
  if(valid===3)return match.oddsPhase==='current'?'current-complete':'reference-complete';
  if(valid>0)return 'partial';
  if(/未开盘|market not open|not yet offered/i.test(String(match?.oddsReason||'')))return 'unopened';
  return 'source-missing';
}

export function summarizeQuoteCoverage(matches,capturedAt=Date.now()) {
  const future=matches.filter(match=>match.status==='soon'&&match.date>capturedAt);
  const execution=future.filter(match=>match.date-capturedAt>=10*60000&&match.date-capturedAt<=24*3600000);
  const research=future.filter(match=>match.date-capturedAt<=48*3600000);
  const count=rows=>{
    const result={currentComplete:0,referenceComplete:0,partial:0,unopened:0,sourceMissing:0};
    for(const row of rows){const kind=quoteCoverage(row);if(kind==='current-complete')result.currentComplete++;else if(kind==='reference-complete')result.referenceComplete++;else if(kind==='partial')result.partial++;else if(kind==='unopened')result.unopened++;else result.sourceMissing++;}
    return result;
  };
  const all=count(future),executionCounts=count(execution),researchCounts=count(research);
  return {
    future:future.length,complete:all.currentComplete,partial:all.partial,missing:all.unopened+all.sourceMissing,
    referenceComplete:all.referenceComplete,unopened:all.unopened,sourceMissing:all.sourceMissing,
    executionFuture:execution.length,executionComplete:executionCounts.currentComplete,executionPartial:executionCounts.partial,
    executionMissing:executionCounts.unopened+executionCounts.sourceMissing,executionReferenceComplete:executionCounts.referenceComplete,
    executionUnopened:executionCounts.unopened,executionSourceMissing:executionCounts.sourceMissing,
    researchFuture:research.length,researchComplete:researchCounts.currentComplete,
    researchMissing:researchCounts.unopened+researchCounts.sourceMissing,researchReferenceComplete:researchCounts.referenceComplete,
    researchPartial:researchCounts.partial,researchUnopened:researchCounts.unopened,researchSourceMissing:researchCounts.sourceMissing,
    capturedAt
  };
}
