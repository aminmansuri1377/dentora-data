import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chooseWithOllama, parseChoice } from '../src/ai.js';
import { feedbackEvidence } from '../src/core.js';
import type { Frame, Lesson } from '../src/types.js';

test('source word candidates prevent arbitrary letter permutations and timings are recorded',async()=>{
 const {readFile}=await import('node:fs/promises');
 const root=await mkdtemp(path.join(tmpdir(),'dentigo-word-candidate-')),original=globalThis.fetch;
 try {
  const frame={questionType:'letter-order',questionId:'30993',prompt:'لایه‌ی مهارشده با ............',options:[],content:[],jumble:{tiles:['ن','ا','ژ','ی','ک','س'].map((text,i)=>({key:String(i),position:i+1,text})),slotCount:6,slotTexts:Array(6).fill(''),correctWord:'',correctSlots:false}} as unknown as Frame;
  globalThis.fetch=(async(_url,init)=>{
   const body=JSON.parse(String(init?.body));assert.deepEqual(body.format.properties.answerText.enum,['اکسیژن']);assert.equal(body.think,false);
   return new Response(JSON.stringify({done:true,load_duration:1000000,prompt_eval_duration:2000000,eval_duration:3000000,message:{content:'{"answerText":"اکسیژن"}'}}));
  }) as typeof fetch;
  const answer=await chooseWithOllama(frame,{steps:[{kind:'theory',content:[{tag:'text',text:'لایه‌ی مهارشده با اکسیژن'}]}]} as unknown as Lesson,root,'qwen3.5:4b');
  assert.equal(answer,'اکسیژن');
  const metric=JSON.parse((await readFile(path.join(root,'ai-metrics.jsonl'),'utf8')).trim());assert.equal(metric.loadMs,1);assert.equal(metric.promptMs,2);assert.equal(metric.generationMs,3);
 }finally{globalThis.fetch=original;await rm(root,{recursive:true,force:true});}
});

test('30292 uses distinct tile keys; repair changes request and stays within a small token budget',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=await mkdtemp(path.join(tmpdir(),'dentigo-letter-repair-'));
  const original=globalThis.fetch;let calls=0;
  // Actual layout in the uploaded diagnostic: two separate س tiles.
  const frame={kind:'question',questionType:'letter-order',questionId:'30292',
    prompt:'وقتی آستانه‌ی تشخیصی را بالا ببری، ویژگی افزایش می‌یابد ولی ............ کاهش پیدا می‌کند و ضایعات کوچک از دست می‌روند.',
    content:[],options:[],feedback:'',feedbackContent:[],feedbackClass:'',
    jumble:{tiles:['ی','ح','س','س','ت','ا'].map((text,i)=>({key:String(i),position:i+1,text})),slotCount:6,slotTexts:['','','','','',''],correctSlots:false,correctWord:''}} as unknown as Frame;
  try {
    globalThis.fetch=(async(_url,init)=>{
      const body=JSON.parse(String(init?.body));calls++;
      assert.equal(body.options.num_predict,128);
      assert.deepEqual(body.format.properties.tileKeys.items.enum,['0','1','2','3','4','5']);
      assert.equal(body.format.properties.tileKeys.minItems,6);
      const input=JSON.parse(body.messages[1].content);
      assert.deepEqual(input.tiles.map((t:{letter:string})=>t.letter),['ی','ح','س','س','ت','ا']);
      if(calls===2) {
        assert.equal(body.messages.length,4);
        assert.equal(JSON.parse(body.messages[3].content).repair,'AI_LETTER_CONSTRAINT_VIOLATION');
      }
      return new Response(JSON.stringify({done:true,message:{content:JSON.stringify({tileKeys:calls===1?['1','2','5','2','0','4']:['1','2','5','3','0','4']})}}));
    }) as typeof fetch;
    const answer=await chooseWithOllama(frame,{steps:[]} as unknown as Lesson,root,'qwen3-vl:2b-instruct');
    assert.equal(answer,'حساسیت');assert.equal(calls,2);
    // AI output is provisional, even when it satisfies every letter constraint.
    assert.equal(feedbackEvidence(frame).status,'unverified');
  } finally {globalThis.fetch=original;await rm(root,{recursive:true,force:true});}
});

test('two invalid letter answers stop safely and retain final-answer diagnostics',async()=>{
  const {readFile}=await import('node:fs/promises');
  const root=await mkdtemp(path.join(tmpdir(),'dentigo-letter-invalid-'));
  const original=globalThis.fetch;let calls=0;
  const frame={questionType:'letter-order',questionId:'bad',prompt:'Q',content:[],options:[],jumble:{tiles:[{key:'0',text:'آ'}],slotCount:1}} as unknown as Frame;
  try {
    globalThis.fetch=(async()=>{calls++;return new Response(JSON.stringify({done:true,message:{thinking:'private trace',content:'{"tileKeys":["99"]}'}}));}) as typeof fetch;
    await assert.rejects(chooseWithOllama(frame,{steps:[]} as unknown as Lesson,root,'qwen3-vl:2b-instruct'),/CONSTRAINT/);
    assert.equal(calls,2);
    const diagnostic=await readFile(path.join(root,'ai-letter-diagnostic.json'),'utf8');
    assert.ok(diagnostic.includes('99'));assert.ok(!diagnostic.includes('private trace'));
  } finally {globalThis.fetch=original;await rm(root,{recursive:true,force:true});}
});

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
    assert.deepEqual(budgets,[64,128]);assert.equal(calls,2);
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
