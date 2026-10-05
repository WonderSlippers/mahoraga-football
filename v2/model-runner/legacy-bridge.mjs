import fs from 'node:fs';
import { evaluate } from '../.models-local/frozen/20261001-r1/legacy-arithmetic.mjs';
process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync(0,'utf8')).map(evaluate)));
