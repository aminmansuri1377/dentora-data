import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chooseWithOllama, parseChoice } from '../src/ai.js';
import { feedbackEvidence } from '../src/core.js';
import type { Frame, Lesson } from '../src/types.js';

test('AI accepts only a key in current options, including false string',()=>{
  assert.equal(parseChoice('{"optionKey":"false"}',['true','false']),'false');
  assert.throws(()=>parseChoice('{"optionKey":false}',['true','false']));
  assert.throws(()=>parseChoice('{"optionKey":"9"}',['0','1']));
  assert.throws(()=>parseChoice('The answer is 1',['0','1']));
});

test('local request includes lesson and mapped images; only source feedback verifies answer',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'dentigo-ai-'));
  const original=globalThis.fetch;
  try {
    await mkdir(path.join(root,'assets'));await writeFile(path.join(root,'assets','test.png'),Buffer.from('image'));
    const opts=[{key:'wrong',position:1,text:'W',content:[],selected:false,correctMarked:false,wrongMarked:false},{key:'right',position:2,text:'R',content:[{tag:'img',assetPath:'assets/test.png',alt:'case'}],selected:false,correctMarked:false,wrongMarked:false}];
    const f={kind:'question',questionId:'1',questionType:'single-choice',prompt:'P',content:[],options:opts,feedback:'',feedbackContent:[]} as unknown as Frame;
    const l={steps:[{kind:'theory',content:[{tag:'text',text:'lesson evidence'}]}]} as unknown as Lesson;
    globalThis.fetch=(async(url,init)=>{
      assert.equal(String(url),'http://127.0.0.1:11434/api/chat');
      const body=JSON.parse(String(init?.body));assert.equal(body.think,false);assert.equal(body.stream,false);
      assert.ok(body.messages[1].content.includes('lesson evidence'));
      assert.equal(body.messages[1].images.length,1);assert.ok(body.messages[1].content.includes('Image 1'));
      return new Response(JSON.stringify({done:true,message:{content:'{"optionKey":"wrong"}'}}));
    }) as typeof fetch;
    assert.equal(await chooseWithOllama(f,l,root,'qwen3-vl:4b'),'wrong');
    assert.equal(feedbackEvidence(f).status,'unverified');
    const observed=feedbackEvidence({...f,feedback:'source explanation',options:opts.map(o=>({...o,correctMarked:o.key==='right',wrongMarked:o.key==='wrong'}))});
    assert.equal(observed.status,'observed-single-key');assert.deepEqual(observed.correctOptionKeys,['right']);
    await assert.rejects(chooseWithOllama(f,l,root,'model-cloud'),/LOCAL_MODEL/);
    await assert.rejects(chooseWithOllama({...f,options:[{...opts[1],content:[{tag:'img',src:'https://example.com/missing.png'}]}]},l,root,'qwen3-vl:4b'),/IMAGE_UNAVAILABLE/);
  } finally {globalThis.fetch=original;await rm(root,{recursive:true,force:true});}
});

test('truncated thinking-only output retries with larger budget and saves metadata without trace',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=await mkdtemp(path.join(tmpdir(),'dentigo-ai-limit-'));
  const original=globalThis.fetch;let calls=0;const budgets:number[]=[];
  const frame={kind:'question',questionId:'limit',questionType:'single-choice',prompt:'Q',content:[],options:[{key:'a',text:'A',content:[]},{key:'b',text:'B',content:[]}]} as unknown as Frame;
  try {
    globalThis.fetch=(async(_url,init)=>{
      calls++;budgets.push(JSON.parse(String(init?.body)).options.num_predict);
      return new Response(JSON.stringify(calls===1?{done:true,done_reason:'length',eval_count:2048,message:{thinking:'private trace',content:''}}:{done:true,done_reason:'stop',message:{content:'{"optionKey":"b"}'}}));
    }) as typeof fetch;
    assert.equal(await chooseWithOllama(frame,{steps:[]} as unknown as Lesson,root,'qwen3-vl:4b'),'b');
    assert.deepEqual(budgets,[2048,4096]);assert.equal(calls,2);
    const diagnostic=await readFile(path.join(root,'ai-diagnostic.json'),'utf8');assert.ok(!diagnostic.includes('private trace'));
  } finally {globalThis.fetch=original;await rm(root,{recursive:true,force:true});}
});

test('empty final answer never becomes a guessed choice after bounded retries',async()=>{
  const original=globalThis.fetch;let calls=0;
  const root=await mkdtemp(path.join(tmpdir(),'dentigo-ai-empty-'));
  try {
    globalThis.fetch=(async()=>{calls++;return new Response(JSON.stringify({done:true,message:{content:''}}));}) as typeof fetch;
    const frame={kind:'question',questionId:'empty',questionType:'single-choice',prompt:'Q',content:[],options:[{key:'a',text:'A',content:[]}]} as unknown as Frame;
    await assert.rejects(chooseWithOllama(frame,{steps:[]} as unknown as Lesson,root,'qwen3-vl:4b'),/AI_EMPTY_FINAL_ANSWER/);
    assert.equal(calls,2);
  }finally{globalThis.fetch=original;await rm(root,{recursive:true,force:true});}
});
