import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FixturePage } from './fixture-page.js';
import type { Page, BrowserContext } from 'playwright';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { readPage } from '../src/dom-reader.js';
import { loadConfig } from '../src/config.js';
import { Engine } from '../src/engine.js';
import { Assets } from '../src/assets.js';
import { canonical, feedbackEvidence, finalize } from '../src/core.js';
import { catalog, crawlSpecialty } from '../src/catalog.js';
import type { Frame, Config, Lesson } from '../src/types.js';
import { fixture } from './fixture-html.js';

async function setup(failImage=false,answerMode:'first'|'manual'|'ai'='first',force=false) {
 const state={finished:false};const base='http://127.0.0.1:12345';
 const config=await loadConfig('crawler.config.json');Object.assign(config,{baseUrl:base,timeoutMs:5000,settleMs:25,actionDelayMs:1,maxTransitions:80,expectedByLesson:{'1':{pages:10,questions:5}}});
 const fixturePage=new FixturePage(base,fixture,state),page=fixturePage as unknown as Page;
 const context={request:{get:async()=>({ok:()=>!failImage,headers:()=>({'content-type':'image/png'}),body:async()=>Buffer.from('PNG_FIXTURE'),dispose:async()=>{}})}} as unknown as BrowserContext;
 const root=await mkdtemp(path.join(tmpdir(),'dentigo-test-'));
 const engine=new Engine(page,config,new Assets(context,config,root),{root,runId:'test-one',specialtyKey:'test',specialtyName:'آزمایش',force,answerMode,manual:async()=>{throw Error('Unexpected manual prompt');}});
 const item={id:'1',title:'درس اول',url:base+'/fa/lesson/1',chapterId:'7',chapterTitle:'آزمایش',chapterPosition:1,position:1,accessReason:'free'};
 return {config,page,engine,root,item,close:async()=>{await fixturePage.close();await rm(root,{recursive:true,force:true});}};
}
test('walks 10 theory pages, 5 questions, delayed feedback and shuffled repeats; preserves images in place',async()=>{
 const t=await setup();try{
 const lesson=await t.engine.scrape(t.item);
 assert.equal(lesson.status,'validated');assert.equal(lesson.steps.length,15);assert.equal(lesson.visits.length,20);
 assert.equal(lesson.theoryPageCount,10);assert.equal(lesson.questionCount,5);
 assert.equal(lesson.steps[10].answer?.correctOptionTexts[0],'درست');
 assert.equal(lesson.steps[10].answer?.correctOptionKeys[0],'0'); // key changed after shuffle; text stayed the same
 assert.equal(lesson.steps[10].content.some(n=>JSON.stringify(n).includes('decoration.png')),false);
 const serialized=JSON.stringify(lesson.steps[0].content);
 assert.ok(serialized.indexOf('قبل عکس')<serialized.indexOf('assetPath'));
 assert.ok(serialized.indexOf('assetPath')<serialized.indexOf('بعد عکس'));
 assert.ok(serialized.includes('مورد دوم'));assert.ok(serialized.includes('سلول جدول'));
 const preview=await readFile(path.join(t.root,'lessons','1','preview.html'),'utf8');assert.ok(preview.includes('../../assets/'));
 assert.equal((await readdir(path.join(t.root,'assets'))).length,1);
 const again=await t.engine.scrape(t.item);assert.equal(again.runId,'test-one');assert.equal(again.status,'validated');
 }finally{await t.close();}
});
test('records missing image as needs-review and can resume via a fresh complete traversal',async()=>{
 const t=await setup(true);try{
 let lesson=await t.engine.scrape(t.item);assert.equal(lesson.status,'needs-review');assert.ok(lesson.validation?.issues.includes('IMAGE_UNRESOLVED:1'));
 lesson=await t.engine.scrape(t.item);assert.equal(lesson.steps.length,15);
 assert.ok((await readdir(path.join(t.root,'lessons','1','history'))).length>0);
 }finally{await t.close();}
});
test('catalog refresh sees newly unlocked links; caps remain reported as pending',async()=>{
 const t=await setup();try{
 await t.page.goto(t.config.baseUrl+'/fa/home');const first=await catalog(t.page,t.config);assert.equal(first.lessons[1].url,null);
 const result=await crawlSpecialty(t.page,t.config,t.root,first,t.engine,1,false);
 assert.equal(result.counts.validated,1);assert.equal(result.counts.pending,1);
 }finally{await t.close();}
});
test('does not infer correct answer from selected option; canonical ignores downloads and option shuffle',()=>{
 const f={kind:'question',questionId:'4',prompt:'P',options:[{key:'a',text:'A',content:[],position:1,selected:true,correctMarked:false,wrongMarked:false},{key:'b',text:'B',content:[],position:2,selected:false,correctMarked:false,wrongMarked:false}],feedback:'',feedbackContent:[],questionType:'single-choice'} as unknown as Frame;
 assert.equal(feedbackEvidence(f).status,'unverified');assert.deepEqual(feedbackEvidence(f).correctOptionKeys,[]);
 const other=structuredClone(f);other.options.reverse();assert.equal(canonical(other),canonical(f));
 other.options[0].content=[{tag:'img',src:'https://example.com/a.png',assetPath:'assets/a.png'}];const before=canonical(other);delete other.options[0].content[0].assetPath;assert.equal(canonical(other),before);
});
test('no completion or mismatched expected counts cannot validate',()=>{
 const l={steps:[],expected:{pages:2,questions:5},completion:undefined} as unknown as Lesson;finalize(l);assert.equal(l.status,'incomplete');assert.ok(l.validation?.issues.includes('EXPECTED_COUNTS_MISMATCH'));
});

test('an interrupted traversal checkpoints a prefix and replays without duplicating old steps',async()=>{
 const t=await setup();try{
 t.config.maxTransitions=3;
 let lesson=await t.engine.scrape(t.item);assert.equal(lesson.status,'incomplete');assert.equal(lesson.error,'TRANSITION_LIMIT');assert.equal(lesson.steps.length,3);
 const stored=JSON.parse(await readFile(path.join(t.root,'lessons','1','lesson.json'),'utf8'));assert.equal(stored.steps.length,3);
 t.config.maxTransitions=80;
 lesson=await t.engine.scrape(t.item);assert.equal(lesson.status,'validated');assert.equal(lesson.steps.length,15);
 }finally{await t.close();}
});

test('ambiguous duplicate options cannot produce a verified answer key',()=>{
 const option={key:'a',position:1,text:'same',content:[],correctMarked:true,wrongMarked:false,selected:true};
 const f={questionType:'single-choice',feedback:'source feedback',feedbackContent:[],options:[option,{...option,key:'b',position:2,correctMarked:false,selected:false}]} as unknown as Frame;
 assert.equal(feedbackEvidence(f).status,'unverified');
});


test('AI mode traverses pages with source-verified answers and never uses first-option guessing',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=(async(_url,init)=>{
   calls++;const body=JSON.parse(String(init?.body));const request=JSON.parse(body.messages[1].content);
   const right=request.options.find((o:{text:string})=>o.text==='درست');assert.ok(right);
   return new Response(JSON.stringify({done:true,message:{content:JSON.stringify({optionKey:right.key})}}));
 }) as typeof fetch;
 const t=await setup(false,'ai');try{
   const lesson=await t.engine.scrape(t.item);assert.equal(lesson.status,'validated');
   assert.equal(calls,5);assert.equal(lesson.questionCount,5);
   assert.ok(lesson.steps.filter(s=>s.kind==='question').every(s=>s.answer?.status==='observed-single-key'));
 }finally{globalThis.fetch=original;await t.close();}
});


test('forced replay really revisits completed lessons and retains verified bank after interruption',async()=>{
 const t=await setup(false,'first',true);try{
   const first=await t.engine.scrape(t.item);assert.equal(first.status,'validated');
   t.config.maxTransitions=3;
   const replay=await t.engine.scrape(t.item);assert.equal(replay.status,'incomplete');assert.equal(replay.steps.length,3);
   const bank=JSON.parse(await readFile(path.join(t.root,'lessons','1','question-bank.json'),'utf8'));
   assert.equal(bank.questions.length,5);assert.ok(bank.questions.every((s: {answer:{status:string}})=>s.answer.status==='observed-single-key'));
   assert.ok((await readdir(path.join(t.root,'lessons','1','history'))).length>0);
 }finally{await t.close();}
});
