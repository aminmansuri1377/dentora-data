import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Page, BrowserContext } from 'playwright';
import { FixturePage } from './fixture-page.js';
import { Engine } from '../src/engine.js';
import { Assets } from '../src/assets.js';
import { loadConfig } from '../src/config.js';

test('optional second review corrects a provisional answer before the only submission',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'dentigo-review-')),original=globalThis.fetch;let calls=0;
  const config=await loadConfig('crawler.config.json');Object.assign(config,{baseUrl:'http://127.0.0.1:12345',timeoutMs:1000,settleMs:1,actionDelayMs:1,expectedByLesson:{'1':{pages:1,questions:1}}});
  const fp=new FixturePage(config.baseUrl,fixture.replace('__IGNORE__','false'),{finished:false}),page=fp as unknown as Page;
  try {
    globalThis.fetch=(async(_url,init)=>{
      calls++;const request=JSON.parse(String(init?.body));
      if(calls===2)assert.equal(JSON.parse(request.messages[1].content).provisionalAnswer,'b');
      return new Response(JSON.stringify({done:true,message:{content:JSON.stringify({optionKey:calls===1?'b':'a'})}}));
    }) as typeof fetch;
    const engine=new Engine(page,config,new Assets({} as BrowserContext,config,root),{root,runId:'review',specialtyKey:'test',specialtyName:'test',answerMode:'ai',aiReview:true,manual:async()=>{}});
    const result=await engine.scrape({id:'1',url:config.baseUrl+'/fa/lesson/1',title:'test',chapterId:'7',chapterTitle:'chapter',chapterPosition:1,position:1,accessReason:'free'});
    assert.equal(result.status,'validated');assert.equal(calls,2);
    const ledger=(await readFile(path.join(root,'lessons/1/answer-attempts.jsonl'),'utf8')).trim().split('\n').map(s=>JSON.parse(s));
    assert.equal(ledger.length,1);assert.equal(ledger[0].correct,true);assert.equal(ledger[0].reviewed,true);assert.equal(ledger[0].source,'ai');
  }finally{globalThis.fetch=original;await fp.close();await rm(root,{recursive:true,force:true});}
});

const fixture=`<style>#feedback-msg,#completion-screen{display:none}</style><div id="progress-bar-inner"></div><div id="slides-container"></div><div id="feedback-msg"></div><button id="action-btn">ادامه</button><div id="completion-screen"><h2 id="completion-heading">پایان</h2></div><script>
let stage=0,clicks=0;const root=document.querySelector('#slides-container'),button=document.querySelector('#action-btn'),feedback=document.querySelector('#feedback-msg');
function render(){if(stage===0){root.innerHTML='<div class="slide active"><div class="theory-body">درسنامه</div></div>';return;}root.innerHTML='<div class="slide active" data-question-id="12"><div class="question-text">سؤال</div><div class="options"><div class="option-wrapper" data-key="a"><span class="option-text">درست</span></div><div class="option-wrapper" data-key="b"><span class="option-text">غلط</span></div></div></div>';button.disabled=true;button.textContent='بررسی';root.querySelector('.option-wrapper').onclick=e=>{e.currentTarget.classList.add('selected');button.disabled=false;};}
button.onclick=()=>{if(stage===0){stage=1;render();return;}if(stage===1){stage=2;root.querySelector('.selected').classList.add('correct');feedback.className='feedback show ok';feedback.textContent='درست';feedback.style.display='block';button.textContent='ادامه';return;}clicks++;if(__IGNORE__){return;}root.innerHTML='';feedback.style.display='none';button.style.display='none';document.querySelector('#completion-screen').style.display='block';};render();</script>`;

test('ignored Continue is retried on unchanged feedback, without checking the answer twice',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'dentigo-continue-'));
  const config=await loadConfig('crawler.config.json');Object.assign(config,{baseUrl:'http://127.0.0.1:12345',timeoutMs:450,settleMs:1,actionDelayMs:1,expectedByLesson:{'1':{pages:1,questions:1}}});
  const fp=new FixturePage(config.baseUrl,fixture.replace('__IGNORE__','clicks===1'),{finished:false}),page=fp as unknown as Page;
  try {
    const engine=new Engine(page,config,new Assets({} as BrowserContext,config,root),{root,runId:'retry',specialtyKey:'test',specialtyName:'test',answerMode:'first',manual:async()=>{}});
    const result=await engine.scrape({id:'1',url:config.baseUrl+'/fa/lesson/1',title:'test',chapterId:'7',chapterTitle:'chapter',chapterPosition:1,position:1,accessReason:'free'});
    assert.equal(result.status,'validated');assert.equal(result.visits.length,2);
    assert.equal(fp.dom.window.eval('clicks'),2);
    const ledger=(await readFile(path.join(root,'lessons/1/answer-attempts.jsonl'),'utf8')).trim().split('\n').map(s=>JSON.parse(s));
    assert.equal(ledger.length,1);assert.equal(ledger[0].correct,true);
  } finally {await fp.close();await rm(root,{recursive:true,force:true});}
});

test('persistent Continue failure restarts the same lesson only twice and stays incomplete',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'dentigo-stalled-'));
  const config=await loadConfig('crawler.config.json');Object.assign(config,{baseUrl:'http://127.0.0.1:12345',timeoutMs:450,settleMs:1,actionDelayMs:1,expectedByLesson:{'1':{pages:1,questions:1}}});
  const fp=new FixturePage(config.baseUrl,fixture.replace('__IGNORE__','true'),{finished:false}),page=fp as unknown as Page;
  let navigations=0;const goto=fp.goto.bind(fp);fp.goto=async url=>{navigations++;return goto(url);};
  try {
    const engine=new Engine(page,config,new Assets({} as BrowserContext,config,root),{root,runId:'stalled',specialtyKey:'test',specialtyName:'test',answerMode:'first',manual:async()=>{}});
    const result=await engine.scrape({id:'1',url:config.baseUrl+'/fa/lesson/1',title:'test',chapterId:'7',chapterTitle:'chapter',chapterPosition:1,position:1,accessReason:'free'});
    assert.equal(result.status,'incomplete');assert.equal(result.error,'STEP_DID_NOT_CHANGE');assert.equal(navigations,3);
    const bank=JSON.parse(await readFile(path.join(root,'lessons/1/question-bank.json'),'utf8'));
    assert.equal(bank.questions.length,1);assert.equal(bank.questions[0].answer.correctOptionTexts[0],'درست');
  } finally {await fp.close();await rm(root,{recursive:true,force:true});}
});

test('advance never retries Check when no source feedback is present',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'dentigo-no-resubmit-'));
  const config=await loadConfig('crawler.config.json');Object.assign(config,{baseUrl:'http://127.0.0.1:12345',timeoutMs:450,settleMs:1,actionDelayMs:1});
  const fp=new FixturePage(config.baseUrl,fixture.replace('__IGNORE__','true'),{finished:false}),page=fp as unknown as Page;
  try {
    await fp.goto(config.baseUrl+'/fa/lesson/1');await page.locator('#action-btn').click();await page.locator('.option-wrapper').nth(0).click();
    const engine=new Engine(page,config,new Assets({} as BrowserContext,config,root),{root,runId:'guard',specialtyKey:'test',specialtyName:'test',answerMode:'first',manual:async()=>{}});
    const f=await engine.frame();let clicks=0;
    fp.dom.window.document.querySelector('#action-btn')!.onclick=()=>{clicks++;};
    await assert.rejects(engine.advance(f),/STEP_DID_NOT_CHANGE/);assert.equal(clicks,1);
  } finally {await fp.close();await rm(root,{recursive:true,force:true});}
});
