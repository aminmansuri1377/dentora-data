import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import type {Page,BrowserContext} from 'playwright';
import {feedbackEvidence,finalize,questionKey,validContentIdentity} from '../src/core.js';
import {exportStep} from '../src/audit-export.js';
import {revalidateCompletedLesson} from '../src/revalidate.js';
import {writeJson} from '../src/storage.js';
import {Engine} from '../src/engine.js';
import {Assets} from '../src/assets.js';
import {loadConfig} from '../src/config.js';
import type {Frame,Lesson,Step} from '../src/types.js';

function legacy():Lesson {
 const options=[{key:'a',position:1,text:'A',content:[],correctMarked:true,wrongMarked:false,selected:true},{key:'b',position:2,text:'B',content:[],correctMarked:false,wrongMarked:false,selected:false}];
 const frame={kind:'question',questionId:null,questionType:'single-choice',prompt:'Legacy question',content:[],options,feedback:'Source feedback',feedbackContent:[]} as unknown as Frame;
 const step={id:questionKey(frame),kind:'question',position:1,sourceQuestionId:null,sourceStepId:null,sourceProgress:'',questionType:frame.questionType,prompt:frame.prompt,title:'Legacy',content:[],options,answer:feedbackEvidence(frame)} as Step;
 return {schemaVersion:3,id:'26',sourceUrl:'https://app.dentigoapp.com/fa/lesson/26',specialtyKey:'test',specialtyName:'test',chapterId:'11',chapterTitle:'chapter',chapterPosition:33,lessonPosition:1,title:'Legacy',runId:'old',startedAt:'old',updatedAt:'old',status:'needs-review',warnings:[],steps:[step],visits:[{stepId:step.id,at:'old',progress:''}],theoryPageCount:0,questionCount:1,completion:{heading:'Complete',at:'old'},validation:{issues:['QUESTION_ID_UNVERIFIED:1'],sourceFinished:true,countsVerified:false}};
}
test('local identity must reproduce the source content hash and is never exported as a native source ID',()=>{
 const lesson=legacy(),step=lesson.steps[0];
 assert.equal(validContentIdentity(step),true);finalize(lesson);assert.equal(lesson.status,'captured');
 assert.ok(lesson.warnings.includes('SOURCE_QUESTION_ID_UNAVAILABLE_LOCAL_HASH:1'));
 const exported=exportStep(step);assert.equal(exported.sourceId,null);assert.equal(exported.identityOrigin,'content-hash');assert.equal(exported.id,step.id);
 step.content=[{tag:'img',src:'https://app.dentigoapp.com/stem.png'}];assert.equal(validContentIdentity(step),false);step.content=[];
 step.prompt='Changed after extraction';finalize(lesson);assert.equal(lesson.status,'needs-review');assert.ok(lesson.validation!.issues.includes('QUESTION_ID_UNVERIFIED:1'));
});
test('resume revalidates complete legacy content, archives the old file and never reopens its page',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'dentigo-identity-'));
 try {
  const lesson=legacy(),file=path.join(root,'lessons/26/lesson.json');await writeJson(file,lesson);const before=await readFile(file,'utf8');
  const config=await loadConfig('crawler.config.json'),page={goto:async()=>{throw Error('Must not recrawl completed lesson');}} as unknown as Page;
  const engine=new Engine(page,config,new Assets({} as BrowserContext,config,root),{root,runId:'resume',specialtyKey:'test',specialtyName:'test',answerMode:'ai',manual:async()=>{}});
  const result=await engine.scrape({id:'26',url:lesson.sourceUrl,title:lesson.title,chapterId:'11',chapterPosition:33,chapterTitle:'chapter',position:1,accessReason:'pro'});
  assert.equal(result.status,'captured');assert.equal(result.steps[0].sourceQuestionId,null);
  const history=path.join(root,'lessons/26/history'),files=await readdir(history);assert.equal(files.length,1);assert.equal(await readFile(path.join(history,files[0]),'utf8'),before);
  assert.equal(JSON.parse(await readFile(file,'utf8')).status,'captured');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('incomplete sessions and unverified answers are never upgraded',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'dentigo-identity-guard-'));
 try {
  const file=path.join(root,'lessons/26/lesson.json');
  for(const lesson of [{...legacy(),completion:undefined},(()=>{const l=legacy();l.steps[0].answer!.status='unverified';return l;})()]) {
   await writeJson(file,lesson);const before=await readFile(file,'utf8');const result=await revalidateCompletedLesson(root,'26','guard');
   assert.equal(result?.status,'needs-review');assert.equal(await readFile(file,'utf8'),before);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
