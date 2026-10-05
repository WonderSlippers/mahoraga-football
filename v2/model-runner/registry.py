"""Register reviewed immutable research manifests; never promote after parity."""
import json
from pathlib import Path
from research_adapters import digest,canonical,LEAGUES
ROOT=Path(__file__).resolve().parents[1]
pins=json.loads((ROOT/'model-runner/research-assets.json').read_text())
assets=ROOT/'.models-local/research'
adapter_hash=digest((ROOT/'model-runner/research_adapters.py').read_bytes())
lock_hash=digest((ROOT/'model-runner/requirements-research.txt').read_bytes())
report=json.loads((ROOT/'.runtime-v2/model-parity/report.json').read_text())
if report.get('exitCode')!=0 or report.get('adapterHash')!=adapter_hash or report.get('runtimeLockHash')!=lock_hash:
    raise ValueError('CURRENT_ADAPTER_PARITY_REQUIRED')
manifests=[]
for family,relative,competitions in [('V6',f'mahoraga_v6_league_policies/models/HONEST_CANDIDATE_2025_{lg}.json',[lg]) for lg in LEAGUES]+[('V7','mahoraga_v7_lab/models/return_partial_2026.json',LEAGUES)]:
    content=(assets/relative).read_bytes()
    if digest(content)!=pins[relative]:raise ValueError('MODEL_HASH_MISMATCH')
    m=json.loads(content)
    if m.get('status','').startswith('RETROSPECTIVE'):raise ValueError('RETROSPECTIVE_FORBIDDEN')
    audit=m.get('training_audit',{})
    variant='V6_C388_STRESS_REFERENCE' if family=='V6' else 'V7_RETURN_PARTIAL_UNBLENDED'
    manifest=dict(manifestSchemaVersion=1,family=family,variant=variant,
        artifactSha256=pins[relative],artifactRelativePath=relative,codeSha256=adapter_hash,
        featureSchemaVersion='FROZEN_ARCHIVE_FEATURES_V1',featureBuilderSha256=adapter_hash,
        orderedFeatureNames=m.get('features',m.get('coefficient_names')),
        units='PRESERVED_RESEARCH_FEATURE_UNITS',transforms='FLOAT32_TREE_PATH' if family=='V6' else 'FIXED_SCALER_CLIP_AND_LEAGUE_COLUMNS',
        missingPolicy='REJECT_REQUIRED_FEATURE',trainCutoffAt=None,calibrationCutoffAt=None,
        sourceTrainCutoffDate=m.get('last_train_date',audit.get('last_discovery_date')),
        sourceCalibrationCutoffDate=m.get('blend',{}).get('last_calibration_date',audit.get('last_calibration_date')),
        cutoffTimeBasis='SOURCE_DATE_ONLY_NO_VERIFIED_TIMEZONE',trainDataManifestHash=None,
        researchProtocolId='ARCHIVED_FEATURE_SOFTWARE_PARITY_V1',supportedCompetitions=competitions,
        supportedMarkets=['1X2_REGULATION_90'],outputKind='SELECTION_STRESS_ONLY' if family=='V6' else 'CENTRAL_1X2',
        probabilityMeaning='SELECTION_CONDITIONAL_STRESS_NOT_NORMALIZED' if family=='V6' else 'UNCALIBRATED_EXPLORATORY_CENTRAL',
        inferenceEntryPoint=variant,runtimeLockHash=lock_hash,numericTolerance=1e-8,
        historyRequirement=dict(embargoCalendarDays=3,historyDateZone='RESEARCH_DATE_LABEL',rawHistoryBuilder='NOT_CONNECTED'),
        quoteTimingDomain='HISTORICAL_CLOSING_REFERENCE_NOT_VALIDATED_T_MINUS_60',
        status='BLOCKED',reason='LIVE_FEATURE_BUILDER_INPUTS_AND_TRAINING_MANIFEST_MISSING',researchOnly=True,
        historicalSelectionBiasNote='Posthoc exploratory configuration; software parity does not establish profit or approve promotion',
        parity=dict(sampleCount=report['counts']['V6ArchivedRows' if family=='V6' else 'V7ArchivedRows'],
                    sampleManifestHash=report['V6SampleManifestHash' if family=='V6' else 'V7SampleManifestHash'],status='PASSED_HISTORICAL_SOFTWARE_ONLY'))
    manifest['modelId']=variant+'_'+digest(canonical(manifest).encode())[:16]
    manifests.append(manifest)
out=ROOT/'.runtime-v2/model-parity/registry.json'
out.write_text(json.dumps(manifests,indent=2),encoding='utf-8')
print(json.dumps(dict(manifests=len(manifests),status='BLOCKED',file=str(out))))
