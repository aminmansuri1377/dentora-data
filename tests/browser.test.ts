import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fixture } from './fixture-html.js';
import { loadConfig } from '../src/config.js';
import { Assets } from '../src/assets.js';
import { Engine } from '../src/engine.js';
test('real installed Chrome: long lesson, delayed feedback, tips, repeat and images',{timeout:120000},async()=>{
 const server=createServer((req,res)=>{if(req.url==='/diagram.png'){res.setHeader('Content-Type','image/png');res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGgAAAABJRU5ErkJggg==','base64'));}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture);}});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const port=(server.address() as {port:number}).port;
 const root=await mkdtemp(path.join(tmpdir(),'dentigo-real-browser-'));
 let browser;
 try {
  browser=await chromium.launch({headless:true,...(process.env.CRAWLER_TEST_BROWSER?{executablePath:process.env.CRAWLER_TEST_BROWSER}:{channel:'chrome'})});
  const context=await browser.newContext(),page=await context.newPage();
  const config=await loadConfig('crawler.config.json');Object.assign(config,{baseUrl:`http://127.0.0.1:${port}`,settleMs:50,actionDelayMs:10,expectedByLesson:{'1':{pages:10,questions:5}}});
  const engine=new Engine(page,config,new Assets(context,config,root),{root,runId:'browser',specialtyKey:'test',specialtyName:'test',answerMode:'first',manual:async()=>{throw Error('Unexpected manual action');}});
  const result=await engine.scrape({id:'1',title:'test',url:config.baseUrl+'/fa/lesson/1',chapterId:'1',chapterTitle:'test',chapterPosition:1,position:1,accessReason:'free'});
  assert.equal(result.status,'validated');assert.equal(result.steps.length,15);assert.equal(result.visits.length,20);
  await context.close();
 } finally {await browser?.close();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});
