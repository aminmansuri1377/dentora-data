import type { Page } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { readCatalog } from './dom-reader.js';
import { hash, now } from './core.js';
import { readJson, writeJson } from './storage.js';
import type { Catalog, Config, Lesson } from './types.js';
import type { Engine } from './engine.js';
export async function catalog(page:Page,config:Config):Promise<Catalog> {
  await page.locator(config.selectors.catalog as string).waitFor({state:'visible',timeout:config.timeoutMs});
  let last='',since=0;const deadline=Date.now()+config.timeoutMs;
  // Lazy rendered chapters are collected by scrolling the public page, never guessing URLs.
  let previousHeight=0;
  for(let i=0;i<8;i++) {
    const height=await page.evaluate(()=>document.documentElement.scrollHeight);
    if(height===previousHeight)break;previousHeight=height;
    await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await delay(config.settleMs);
  }
  while(Date.now()<deadline) {
    const c=await page.evaluate(readCatalog,config) as Catalog|null;
    if(c?.specialtyName&&c.lessons.length) {
      const fingerprint=hash({name:c.specialtyName,lessons:c.lessons});
      if(fingerprint!==last){last=fingerprint;since=Date.now();}
      if(Date.now()-since>=config.settleMs) {
        c.specialtyKey=hash(c.specialtyName).slice(0,16);
        if(c.lessons.some(l=>!l.id||!l.title)||new Set(c.lessons.map(l=>l.id)).size!==c.lessons.length)throw new Error('CATALOG_IDENTITIES_INVALID');
        return c;
      }
    }
    await delay(150);
  }
  throw new Error('CATALOG_NOT_READY_OR_LAYOUT_CHANGED');
}
export async function crawlSpecialty(page:Page,config:Config,root:string,first:Catalog,engine:Engine,maxLessons:number,force:boolean,runId?:string) {
  const attempted=new Set<string>();let current=first;let processed=0;
  const file=path.join(root,'catalog.json');
  for(let round=0;round<config.maxCatalogRounds;round++) {
    if(current.specialtyKey!==first.specialtyKey)throw new Error('SPECIALTY_CHANGED_UNEXPECTEDLY');
    await writeJson(file,{schemaVersion:3,capturedAt:now(),...current});
    let candidate=current.lessons.find(l=>!!l.url&&!attempted.has(l.id));
    while(candidate) {
      const old=await readJson<Lesson>(path.join(root,'lessons',candidate.id,'lesson.json'));
      if(!old||!['captured','validated'].includes(old.status)||force)break;
      attempted.add(candidate.id);candidate=current.lessons.find(l=>!!l.url&&!attempted.has(l.id));
    }
    if(!candidate||processed>=maxLessons)break;
    attempted.add(candidate.id);const result=await engine.scrape(candidate);processed++;
    if(!['captured','validated'].includes(result.status))break;
    await delay(config.actionDelayMs);
    await page.goto(new URL(config.homePath,config.baseUrl).href,{waitUntil:'domcontentloaded',timeout:config.timeoutMs});
    current=await catalog(page,config);
  }
  await writeJson(file,{schemaVersion:3,capturedAt:now(),...current});
  const rows:Array<{id:string;title:string;chapterId:string;chapterPosition:number;position:number;status:string;accessReason:string|null;pages:number;questions:number;error?:string;issues:string[];runId?:string}>=[];
  for(const row of current.lessons) {
    const lesson=await readJson<Lesson>(path.join(root,'lessons',row.id,'lesson.json'));
    rows.push({runId:lesson?.runId,id:row.id,title:row.title,chapterId:row.chapterId,chapterPosition:row.chapterPosition,position:row.position,status:lesson?.status??(row.url?'pending':'locked'),accessReason:row.accessReason,pages:lesson?.theoryPageCount??0,questions:lesson?.questionCount??0,error:lesson?.error,issues:lesson?.validation?.issues??[]});
  }
  const counts:Record<string,number>=Object.fromEntries(['captured','validated','incomplete','needs-review','pending','locked'].map(s=>[s,rows.filter(l=>l.status===s).length]));
  if(current.declaredChapterCount!==null&&current.declaredChapterCount!==current.chapterCount)counts['catalog-incomplete']=1;
  await writeJson(path.join(root,'coverage.json'),{schemaVersion:3,specialtyName:current.specialtyName,chapterCount:current.chapterCount,totalLessons:rows.length,runId,processedThisRun:processed,capturedThisRun:rows.filter(r=>r.runId===runId&&['captured','validated'].includes(r.status)).length,allCapturedThisRun:!!runId&&rows.length>0&&rows.every(r=>r.runId===runId&&['captured','validated'].includes(r.status)),counts,declaredChapterCount:current.declaredChapterCount,catalogCountsMatch:current.declaredChapterCount===null||current.declaredChapterCount===current.chapterCount,allSourceFinished:(current.declaredChapterCount===null||current.declaredChapterCount===current.chapterCount)&&rows.length>0&&rows.every(r=>['captured','validated'].includes(r.status)),allCountsVerified:!counts['catalog-incomplete']&&rows.length>0&&rows.every(r=>r.status==='validated'),lessons:rows});
  return {current,counts};
}
