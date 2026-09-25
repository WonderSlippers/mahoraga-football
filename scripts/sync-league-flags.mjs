// Import only the country flags actually used by the local league UI.
// Source: https://flagcdn.com/ (Flagpedia; SVG vectors based on Wikimedia Commons).
// This is a mechanical static-asset sync; the site never needs this network call at runtime.
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const output=resolve(fileURLToPath(new URL('../public/flags/',import.meta.url)));
const codes=['ar','at','au','be','br','ch','cn','de','es','fr','gb-eng','gb-sct','it','jp','kr','mx','nl','pt','sa','tr','us'];
await mkdir(output,{recursive:true});
for(const code of codes){
  const response=await fetch(`https://flagcdn.com/${code}.svg`,{signal:AbortSignal.timeout(15000)});
  if(!response.ok||!String(response.headers.get('content-type')).includes('image/svg+xml'))throw new Error(`${code}: unexpected flag response ${response.status}`);
  const svg=await response.text();
  if(svg.length>500000||!/^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(svg)||/<script\b|onload\s*=|<foreignObject\b/i.test(svg))throw new Error(`${code}: unsafe SVG`);
  await writeFile(resolve(output,`${code}.svg`),svg,'utf8');
  process.stdout.write(`${code}.svg ${svg.length} bytes\n`);
}
