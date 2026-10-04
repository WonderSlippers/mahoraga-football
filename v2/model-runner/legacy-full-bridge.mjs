import fs from 'node:fs';
import crypto from 'node:crypto';
import {legacyEvaluate} from '../.models-local/frozen/20261004-legacy-full/engine.mjs';
const pins=JSON.parse(fs.readFileSync(new URL('../packages/domain/legacy-september-pins.json',import.meta.url)));
const actual=crypto.createHash('sha256').update(fs.readFileSync(new URL('../.models-local/frozen/20261004-legacy-full/engine.mjs',import.meta.url))).digest('hex');
if(actual!==pins.engineHash)throw Error('FROZEN_ENGINE_CHANGED');
process.stdout.write(JSON.stringify(legacyEvaluate(JSON.parse(fs.readFileSync(0,'utf8')))));
