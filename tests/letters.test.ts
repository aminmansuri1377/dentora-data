import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Page,BrowserContext } from 'playwright';
import { FixturePage } from './fixture-page.js';
import { letterPlan,normalizeWord,parseLetterAnswer } from '../src/letters.js';
import { feedbackEvidence,canonical } from '../src/core.js';
import { readPage } from '../src/dom-reader.js';
import { loadConfig } from '../src/config.js';
import { Engine } from '../src/engine.js';
import { Assets } from '../src/assets.js';
import { crawlSpecialty,catalog } from '../src/catalog.js';
import type { Frame,Jumble } from '../src/types.js';

const jumble:Jumble={tiles:['ت','ی','س','س','ا','ح'].map((text,i)=>({key:String(i),position:i+1,text})),slotCount:6,slotTexts:['','','','','',''],correctSlots:false,correctWord:''};
test('repeated letters use different tile identities and preserve logical Persian order',()=>{
 assert.deepEqual(letterPlan('حساسیت',jumble),['5','2','4','3','1','0']);
 assert.equal(normalizeWord('عاجي'),'عاجی');
 assert.throws(()=>letterPlan('حساسیتت',jumble),/LENGTH/);
 assert.throws(()=>letterPlan('حححححح',jumble),/POOL/);
 assert.equal(parseLetterAnswer('{"answerText":"حساسیت"}',jumble),'حساسیت');
 assert.throws(()=>parseLetterAnswer('{"answerText":"پاسخ حساسیت است"}',jumble));
});
test('letter feedback needs correct source slots or an explicit revealed word, never AI guess',()=>{
 const f={kind:'question',questionId:'3',questionType:'letter-order',prompt:'P',options:[],feedback:'Explanation',feedbackContent:[],feedbackClass:'feedback show no',jumble:{...jumble,slotTexts:['ح','س','ا','س','ی','ت']}} as unknown as Frame;
 assert.equal(feedbackEvidence(f).status,'unverified');
 assert.equal(feedbackEvidence({...f,feedbackClass:'feedback show ok',jumble:{...f.jumble!,correctSlots:true}}).correctText,'حساسیت');
 assert.equal(feedbackEvidence({...f,jumble:{...f.jumble!,correctWord:'پاسخ درست: حساسیت'}}).status,'observed-text');
 const shuffled={...f,jumble:{...jumble,tiles:[...jumble.tiles].reverse()}};
 assert.equal(canonical(f),canonical(shuffled));
 assert.notEqual(canonical(f),canonical({...f,jumble:{...jumble,slotCount:5}}));
});

const html=`<!doctype html><html><head><title>Test letters</title></head><body>
<style>#feedback-msg,#completion-screen{display:none}.jumble-tile.used{visibility:hidden}</style>
<div id="progress-bar-inner"></div><div id="slides-container"></div><div id="feedback-msg"></div><button id="action-btn">ادامه</button>
<div id="completion-screen"><h2 id="completion-heading">Complete</h2></div>
<script>
let stage='theory',selected=[],pool=['ع','ی','ا','ج'],wrong=false;
const slides=document.querySelector('#slides-container'),action=document.querySelector('#action-btn'),feedback=document.querySelector('#feedback-msg');
function render(){
feedback.style.display='none';feedback.textContent='';action.disabled=false;action.textContent=stage==='theory'?'ادامه':'بررسی';
if(stage==='theory'){slides.innerHTML='<div class="slide active"><div class="theory-body"><p>رابردم عاجی رنگ توصیه نمی‌شود.</p></div></div>';return;}
selected=[];action.disabled=true;
slides.innerHTML='<div class="slide active" data-question-id="30435"><div class="question-text">رابردم ............ رنگ توصیه نمی‌شود.</div><div class="jumble-hint">حروف را به ترتیب درست لمس کنید</div><input type="text" hidden><div id="jumble-slots">'+pool.map((_,i)=>'<div class="jumble-slot" data-slot-index="'+i+'"></div>').join('')+'</div><div id="jumble-correct-word" style="display:none"></div><div id="jumble-tiles">'+pool.map((x,i)=>'<div class="jumble-tile" data-tile-index="'+i+'" onclick="pick('+i+')">'+x+'</div>').join('')+'</div></div>';
}
function pick(i){if(selected.includes(i))return;selected.push(i);document.querySelector('.jumble-tile[data-tile-index="'+i+'"]').classList.add('used');const slots=document.querySelectorAll('.jumble-slot');slots[selected.length-1].textContent=pool[i];action.disabled=selected.length!==pool.length;}
action.onclick=()=>{
if(stage==='theory'){stage='question';render();return;}
if(stage==='review'){if(wrong){pool=['ی','ج','ع','ا'];stage='question';render();}else{slides.innerHTML='';action.style.display='none';feedback.style.display='none';document.querySelector('#completion-screen').style.display='block';}return;}
if(selected.length!==pool.length)return;
action.disabled=true;
setTimeout(()=>{wrong=selected.map(i=>pool[i]).join('')!=='عاجی';feedback.style.display='block';feedback.className='feedback show '+(wrong?'no':'ok');feedback.textContent='توضیح منبع';for(const s of document.querySelectorAll('.jumble-slot'))s.classList.add(wrong?'wrong':'correct');if(wrong){const e=document.querySelector('#jumble-correct-word');e.style.display='block';e.textContent='پاسخ درست: عاجی';}action.disabled=false;action.textContent='ادامه';stage='review';},25);
};render();
</script></body></html>`;

test('AI solves letters, wrong answer is corrected from source, shuffled repeat reuses bank and reaches completion',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'dentigo-letters-')),original=globalThis.fetch;
 const config=await loadConfig('crawler.config.json');Object.assign(config,{baseUrl:'http://127.0.0.1:12345',timeoutMs:4000,settleMs:5,actionDelayMs:1,expectedByLesson:{'1':{pages:1,questions:1}}});
 const fp=new FixturePage(config.baseUrl,html,{finished:false}),page=fp as unknown as Page;
 let calls=0;
 globalThis.fetch=(async(_url,init)=>{
  calls++;const request=JSON.parse(String(init?.body));assert.ok(request.format.properties.answerText);assert.equal(JSON.parse(request.messages[1].content).slotCount,4);
  return new Response(JSON.stringify({done:true,message:{content:'{"answerText":"جاعی"}'}}));
 }) as typeof fetch;
 try {
  const engine=new Engine(page,config,new Assets({} as BrowserContext,config,root),{root,runId:'letters',specialtyKey:'test',specialtyName:'Test',answerMode:'ai',force:true,manual:async()=>{throw Error('Unexpected manual');}});
  const item={id:'1',title:'Letters',url:config.baseUrl+'/fa/lesson/1',chapterId:'1',chapterTitle:'Test',chapterPosition:1,position:1,accessReason:'free'};
  const lesson=await engine.scrape(item);
  assert.equal(lesson.status,'validated');assert.equal(lesson.steps.length,2);assert.equal(lesson.visits.length,3);assert.equal(calls,1);
  assert.equal(lesson.steps[1].questionType,'letter-order');assert.equal(lesson.steps[1].jumble?.slotCount,4);
  assert.equal(lesson.steps[1].answer?.status,'observed-text');assert.equal(lesson.steps[1].answer?.correctText,'عاجی');
  const bank=JSON.parse(await readFile(path.join(root,'lessons','1','question-bank.json'),'utf8'));assert.equal(bank.questions[0].answer.correctText,'عاجی');
  assert.ok((await readFile(path.join(root,'lessons','1','preview.html'),'utf8')).includes('ساخت کلمه'));
  const replay=await engine.scrape(item);assert.equal(replay.status,'validated');assert.equal(calls,1);
  // DOM reader recognizes controls, not merely a hidden text input.
  await fp.goto(item.url);await page.locator('#action-btn').click();const frame=await page.evaluate(readPage,config) as Frame;
  assert.equal(frame.questionType,'letter-order');assert.equal(frame.jumble?.tiles.length,4);
 } finally {globalThis.fetch=original;await fp.close();await rm(root,{recursive:true,force:true});}
});

test('catalog stops on an incomplete lesson instead of silently moving on',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'dentigo-stop-')),config=await loadConfig('crawler.config.json');
 Object.assign(config,{baseUrl:'http://127.0.0.1:12345',timeoutMs:2000,settleMs:5,actionDelayMs:1});
 const fp=new FixturePage(config.baseUrl,html,{finished:true}),page=fp as unknown as Page;
 try {
  await fp.goto(config.baseUrl+'/fa/home');const first=await catalog(page,config);let calls=0;
  const engine={scrape:async()=>{calls++;return {status:'incomplete',error:'LETTERS_SELECTION_NOT_READY'};}} as unknown as Engine;
  await crawlSpecialty(page,config,root,first,engine,184,false);assert.equal(calls,1);
 }finally{await fp.close();await rm(root,{recursive:true,force:true});}
});

test('source feedback is readable before a hearts modal interrupts advancing',async()=>{
 const config=await loadConfig('crawler.config.json');config.baseUrl='http://127.0.0.1:12345';
 const root=await mkdtemp(path.join(tmpdir(),'dentigo-feedback-'));
 const fp=new FixturePage(config.baseUrl,html,{finished:false}),page=fp as unknown as Page;
 try {
  await fp.goto(config.baseUrl+'/fa/lesson/1');await page.locator('#action-btn').click();
  for(const i of [0,2,3,1])await page.locator(`.jumble-tile[data-tile-index="${i}"]`).click();
  await page.locator('#action-btn').click();await new Promise(r=>setTimeout(r,60));
  let checks=0;
  const hearts={handle:async()=>{checks++;throw new Error('HEARTS_EMPTY');}} as unknown as import('../src/hearts.js').Hearts;
  const engine=new Engine(page,config,new Assets({} as BrowserContext,config,root),{root,runId:'feedback',specialtyKey:'test',specialtyName:'test',answerMode:'ai',hearts,manual:async()=>{}});
  const f=await engine.frame();assert.equal(feedbackEvidence(f).status,'observed-text');assert.equal(checks,0);
  await assert.rejects(engine.advance(f),/HEARTS_EMPTY/);assert.equal(checks,1);
 }finally{await fp.close();await rm(root,{recursive:true,force:true});}
});
