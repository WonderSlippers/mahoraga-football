import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {matchTeamZh,leagueFlagAsset} from '../public/names-zh.js';

test('league flags use local SVG assets rather than Windows flag emoji',()=>{
  for(const code of ['arg.1','aut.1','bel.1','bra.1','chn.1','eng.1','sco.1','usa.nwsl']){
    const path=leagueFlagAsset(code);
    assert.match(path,/^\/flags\/[a-z-]+\.svg$/);
    assert.ok(existsSync(new URL(`../public${path}`,import.meta.url)),`${code}: ${path}`);
  }
  assert.equal(leagueFlagAsset('afc.champions'),null);
  assert.equal(matchTeamZh('Real Madrid','uefa.wchampions'),'皇家马德里女足');
  assert.equal(matchTeamZh('PSG','uefa.wchampions'),'巴黎圣日耳曼女足');
});
