import { chromium } from 'playwright';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { importAuth } from './auth-state.js';
import { loadConfig } from './config.js';
import { catalog, crawlSpecialty } from './catalog.js';
import { Assets } from './assets.js';
import { Engine } from './engine.js';
import { Hearts } from './hearts.js';
import { finalize, hash, lessonUrl, safeCode } from './core.js';
import { readJson, writeJson } from './storage.js';
import type { CatalogLesson, Lesson } from './types.js';
const args=process.argv.slice(2),command=args[0];
function arg(name:string,fallback=''){const i=args.indexOf(name);return i<0?fallback:args[i+1]||fallback;}
const project=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function validate(root:string) {
  const report:Array<{file:string;id:string;status:string;validation:Lesson["validation"]}>=[];
  async function visit(dir:string) {
    for(const e of await readdir(dir,{withFileTypes:true})) {
      if(e.name==='history'||e.name==='assets')continue;
      const file=path.join(dir,e.name);
      if(e.isDirectory())await visit(file);
      else if(e.name==='lesson.json') {
        const lesson=await readJson<Lesson>(file);if(!lesson)continue;
        finalize(lesson);
        const {existsSync}=await import('node:fs');
        const {nodes}=await import('./core.js');
        const specialtyRoot=path.dirname(path.dirname(path.dirname(file)));
        for(const s of lesson.steps)for(const n of nodes([...s.content,...(s.answer?.content??[])]))if(n.assetPath&&!existsSync(path.join(specialtyRoot,n.assetPath)))lesson.validation!.issues.push('LOCAL_ASSET_FILE_MISSING');
        if(lesson.validation!.issues.length&&lesson.completion)lesson.status='needs-review';
        report.push({file:path.relative(root,file),id:lesson.id,status:lesson.status,validation:lesson.validation});
      }
    }
  }
  await visit(root);await writeJson(path.join(root,'validation-report.json'),report);console.log(JSON.stringify(report,null,2));
  if(!report.length||report.some(r=>r.validation?.issues.length))process.exitCode=2;
}
async function main() {
  if(!['login','crawl','validate'].includes(command)){console.log('Commands: login | crawl [--lesson URL] [--all-specialties] [--max-lessons N] [--answer-mode first|manual|ai --ai-model NAME] [--resume] [--auto-refill --max-gems N] | validate\nOptions: --auth FILE (or --cookies FILE) --output DIR --config FILE --profile DIR --channel chrome|msedge|chromium --executable PATH');return;}
  const output=path.resolve(arg('--output',path.join(project,'output')));
  if(command==='validate'){await validate(output);return;}
  const config=await loadConfig(path.resolve(arg('--config',path.join(project,'crawler.config.json'))));
  const runId=new Date().toISOString().replace(/[:.]/g,'-');
  const maxLessons=Number(arg('--max-lessons','100000'));
  if(!Number.isInteger(maxLessons)||maxLessons<1)throw new Error('INVALID_MAX_LESSONS');
  const answerMode=arg('--answer-mode','ai');if(!['first','manual','ai'].includes(answerMode))throw new Error('INVALID_ANSWER_MODE');
  const force=args.includes('--force')||!args.includes('--resume');
  const maxGems=Number(arg('--max-gems','0'));
  if(!Number.isSafeInteger(maxGems)||maxGems<0||(args.includes('--auto-refill')&&maxGems<60))throw new Error('HEARTS_EXPLICIT_BUDGET_REQUIRED');
  const hearts=new Hearts(output,runId,args.includes('--auto-refill'),maxGems,config.timeoutMs);
  await mkdir(output,{recursive:true});
  const terminal=createInterface({input:stdin,output:stdout});
  const channel=arg('--channel',config.browserChannel);
  const context=await chromium.launchPersistentContext(path.resolve(arg('--profile',path.join(project,'.session'))),{
    chromiumSandbox: true,
    headless:args.includes('--headless'),viewport:{width:1280,height:900},
    ...(arg('--executable')?{executablePath:arg('--executable')} : channel==='chromium'?{}:{channel}),
  }).catch(()=>{terminal.close();throw new Error('BROWSER_START_FAILED_USE_CHROME_OR_EDGE');});
  const stop=()=>{void context.close().catch(()=>undefined);terminal.close();};
  process.once('SIGINT',stop);
  try {
    const authFile=arg('--auth')||arg('--cookies');
    if(authFile){const imported=await importAuth(context,path.resolve(authFile),config.baseUrl,runId);console.log(JSON.stringify({event:'AUTH_IMPORTED',...imported}));}
    const page=context.pages()[0]??await context.newPage();page.setDefaultTimeout(config.timeoutMs);
    await page.goto(new URL(config.homePath,config.baseUrl).href,{waitUntil:'domcontentloaded',timeout:config.timeoutMs});
    if(authFile&&(new URL(page.url()).origin!==new URL(config.baseUrl).origin||new URL(page.url()).pathname!==new URL(config.homePath,config.baseUrl).pathname))throw new Error('AUTH_SESSION_REJECTED_OR_EXPIRED');
    if(!args.includes('--no-prompt'))await terminal.question(authFile?'نشست وارد شد؛ ورود و تخصص را در صفحه دنتیگو بررسی کن و Enter بزن: ':'در مرورگر وارد حساب شو و تخصص شروع را انتخاب کن؛ سپس اینجا Enter بزن. نشست ورود در پوشه خصوصی .session نگه داشته می‌شود: ');
    if(command==='login')return;
    console.log('AUTO NAVIGATION: ثبت پاسخ‌ها ممکن است قلب/پیشرفت/امتیاز حساب را تغییر دهد. کلید صحیح فقط از بازخورد قابل مشاهده ثبت می‌شود.');
    const seen=new Set<string>(),summaries:Array<{specialtyKey:string;specialtyName:string;[key:string]:string|number}>=[];
    for(let index=0;index<config.maxSpecialties;index++) {
      let first;
      if(arg('--lesson')) {
        // Optional direct-lesson runs can still collect catalog metadata when accessible.
        first=await catalog(page,config).catch(()=>null);
      } else first=await catalog(page,config);
      const specialtyName=first?.specialtyName||arg('--specialty','Unassigned');
      const specialtyKey=first?.specialtyKey||hash(specialtyName).slice(0,16);
      if(seen.has(specialtyKey))break;seen.add(specialtyKey);
      const root=path.join(output,`specialty-${specialtyKey}`);
      const assets=new Assets(context,config,root);
      const engine=new Engine(page,config,assets,{root,runId,specialtyName,specialtyKey,force,hearts,answerMode:answerMode as 'first'|'manual'|'ai',aiModel:arg('--ai-model','qwen3-vl:2b-instruct'),manual:async message=>{if(args.includes('--headless'))throw new Error('MANUAL_MODE_REQUIRES_VISIBLE_BROWSER');await terminal.question(message+'\n');}});
      if(arg('--lesson')) {
        const url=lessonUrl(arg('--lesson'),config.baseUrl),id=url.split('/').pop()!;
        const item=first?.lessons.find(l=>l.id===id)??{id,title:'',url,chapterId:'',chapterTitle:'',chapterPosition:0,position:0,accessReason:null} as CatalogLesson;
        if(!first?.lessons.some(l=>l.id===id)&&!arg('--specialty'))throw new Error('LESSON_NOT_IN_SELECTED_SPECIALTY');
        item.url=url;const result=await engine.scrape(item);console.log(JSON.stringify({event:'LESSON_RESULT',id,status:result.status,pages:result.theoryPageCount,questions:result.questionCount,error:result.error}));
        if(!['captured','validated'].includes(result.status))process.exitCode=2;return;
      }
      const result=await crawlSpecialty(page,config,root,first!,engine,maxLessons,force,runId);
      summaries.push({specialtyKey,specialtyName,...result.counts});
      await writeJson(path.join(output,'run-report.json'),{runId,specialties:summaries});
      if(!args.includes('--all-specialties')||result.counts.incomplete||result.counts['needs-review']||result.counts.pending||result.counts.locked)break;
      const next=page.locator(config.selectors.nextSpecialty as string);
      if(await next.count()!==1||!await next.isEnabled())break;
      await delay(config.actionDelayMs);await next.click();
      const deadline=Date.now()+config.timeoutMs;
      while(Date.now()<deadline) {
        await delay(config.settleMs);
        const changed=await catalog(page,config);
        if(changed.specialtyKey!==specialtyKey)break;
      }
      const changed=await catalog(page,config);
      if(changed.specialtyKey===specialtyKey)throw new Error('SPECIALTY_SWITCH_DID_NOT_CHANGE');
    }
    if(summaries.some(s=>s.locked||s.pending||s.incomplete||s['needs-review']||s['catalog-incomplete']))process.exitCode=2;
    console.log(JSON.stringify({event:process.exitCode?'RUN_INCOMPLETE':'RUN_FINISHED',specialties:summaries}));
  } catch(error) {process.exitCode=1;throw error;}
  finally {
    if(process.exitCode&&args.includes('--keep-open-on-error')&&!args.includes('--headless')&&!args.includes('--no-prompt')) {
      await terminal.question('اجرا ناقص است؛ مرورگر برای بررسی باز مانده. برای بستن Enter بزن: ').catch(()=>undefined);
    }
    process.removeListener('SIGINT',stop);await context.close();terminal.close();
  }
}
main().catch(error=>{console.error(JSON.stringify({event:'RUN_STOPPED',error:safeCode(error)}));process.exitCode=1;});
