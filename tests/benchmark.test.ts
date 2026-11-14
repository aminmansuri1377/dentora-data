import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {runBenchmark,benchmarkSamples} from '../src/benchmark.js';
import {writeJson} from '../src/storage.js';
import {feedbackEvidence} from '../src/core.js';
import type {Frame,Lesson} from '../src/types.js';
import {chooseWithOllama} from '../src/ai.js';

test('offline comparison holds out target answers, keeps same samples across models and never changes source',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'dentigo-benchmark-'));
 const options=[{key:'a',text:'A',content:[],position:1,correctMarked:true,wrongMarked:false,selected:true},{key:'b',text:'B',content:[],position:2,correctMarked:false,wrongMarked:false,selected:false}];
 const step={id:'question:12',position:2,kind:'question',sourceQuestionId:'12',questionType:'single-choice',prompt:'Q',content:[],options,answer:feedbackEvidence({questionType:'single-choice',options,feedback:'TARGET_EXPLANATION_NOT_FOR_MODEL',feedbackContent:[]} as unknown as Frame)};
 const lesson={schemaVersion:3,id:'1',sourceUrl:'https://app.dentigoapp.com/fa/lesson/1',specialtyKey:'test',chapterId:'7',steps:[{kind:'theory',content:[{tag:'text',text:'source theory'}]},step]} as unknown as Lesson;
 try {
  await writeJson(path.join(root,'lessons/1/lesson.json'),lesson);
  const before=await readFile(path.join(root,'lessons/1/lesson.json'),'utf8');
  const call=(async(frame,l,_root,_model,references)=>{
   assert.equal(l.steps.length,1);assert.equal(l.steps[0].kind,'theory');
   assert.ok(!references?.includes('TARGET_EXPLANATION_NOT_FOR_MODEL'));
   assert.ok(frame.options.every(o=>!o.correctMarked&&!o.wrongMarked&&!o.selected));
   return 'a';
  }) as typeof chooseWithOllama;
  const a=await runBenchmark(root,'qwen3-vl:2b-instruct',10,call),b=await runBenchmark(root,'qwen3.5:4b',10,call);
  assert.deepEqual(a.sampleIds,b.sampleIds);assert.equal(a.correct,1);assert.equal(a.accuracy,1);assert.equal(a.attempted,1);assert.equal(a.sampleCount,1);assert.equal(a.answerRecordsHeldOut,true);
  assert.equal(await readFile(path.join(root,'lessons/1/lesson.json'),'utf8'),before);
  assert.equal((await benchmarkSamples(root,10)).length,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
