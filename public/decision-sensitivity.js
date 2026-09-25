// Explicit what-if arithmetic for a single, binary 1X2 direction.
// This is not a confidence interval or a claim that a worse price can be filled.
export function oneXTwoSensitivity(probability,odds,probabilityDrop=.03,priceHaircut=.02){
  if(![probability,odds,probabilityDrop,priceHaircut].every(Number.isFinite)||probability<=0||probability>=1||odds<=1||odds>1000||probabilityDrop<0||probabilityDrop>=1||priceHaircut<0||priceHaircut>=1)return null;
  const lowerProbability=Math.max(0,probability-probabilityDrop);
  const worseOdds=Math.max(1.01,odds*(1-priceHaircut));
  return {referenceEdge:probability*odds-1,lowerProbability,worseOdds,
    probabilityStressEdge:lowerProbability*odds-1,
    priceStressEdge:probability*worseOdds-1,
    combinedStressEdge:lowerProbability*worseOdds-1,
    breakEvenProbability:1/odds,breakEvenOdds:1/probability};
}
