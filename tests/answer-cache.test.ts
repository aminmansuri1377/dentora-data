import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bundledAnswers } from '../src/answer-cache.js';
import { hash,optionHash } from '../src/core.js';
import { readFile } from 'node:fs/promises';
test('bundled source answers map to exactly one option and isolate source origin',async()=>{
  const all=[];
  const data=JSON.parse(await readFile('data/verified-answers.json','utf8'));
  for(const id of Object.keys(data.lessons))all.push(...await bundledAnswers('https://app.dentigoapp.com',id));
  assert.equal(all.length,118);
  const signatures=new Set();
  for(const s of all) {
    assert.equal(s.answer?.status,'observed-single-key');
    assert.equal(s.options.filter(o=>s.answer!.correctOptionHashes.includes(optionHash(o))).length,1);
    assert.ok(s.answer?.explanation);
    const key=hash({id:s.id,prompt:s.prompt,options:s.options.map(optionHash).sort()});assert.ok(!signatures.has(key));signatures.add(key);
  }
  assert.deepEqual(await bundledAnswers('https://example.com','1636'),[]);
  const first=await bundledAnswers('https://app.dentigoapp.com','1636');first[0].prompt='mutated';
  assert.notEqual((await bundledAnswers('https://app.dentigoapp.com','1636'))[0].prompt,'mutated');
});
