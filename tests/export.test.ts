import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { auditSpecialty, exportStep, inspectLesson } from '../src/audit-export.js';
import { feedbackEvidence, finalize, optionHash } from '../src/core.js';
import { writeJson } from '../src/storage.js';
import type { Frame,Lesson,Step } from '../src/types.js';

function completeLesson():Lesson {
  const options=[{key:'old-a',text:'درست',position:1,content:[{tag:'text',text:'درست'}],selected:true,correctMarked:true,wrongMarked:false},{key:'old-b',text:'غلط',position:2,content:[{tag:'text',text:'غلط'}],selected:false,correctMarked:false,wrongMarked:false}];
  const question={id:'question:12',position:2,kind:'question',sourceQuestionId:'12',sourceStepId:null,questionType:'single-choice',sourceProgress:'',title:'test',prompt:'P',content:[],options,answer:feedbackEvidence({questionType:'single-choice',options,feedback:'درست',feedbackContent:[]} as unknown as Frame)} as Step;
  return finalize({schemaVersion:3,id:'1',sourceUrl:'https://app.dentigoapp.com/fa/lesson/1',specialtyKey:'test',specialtyName:'test',title:'lesson',chapterId:'7',chapterTitle:'chapter',chapterPosition:1,lessonPosition:1,steps:[{...question,id:'theory:1',sourceQuestionId:null,position:1,kind:'theory',content:[{tag:'text',text:'before'},{tag:'strong',children:[{tag:'text',text:'after'}]}],options:[],answer:null},question],visits:[{stepId:'theory:1',at:'test',progress:''},{stepId:'question:12',at:'test',progress:''}],warnings:[],completion:{heading:'پایان',at:'test'}} as unknown as Lesson);
}

test('chapter export preserves source order, stable answer mapping and raw checkpoints; incomplete stays out',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'dentigo-export-'));
  try {
    const lesson=completeLesson();
    const catalog={specialtyKey:'test',specialtyName:'test',chapterCount:2,declaredChapterCount:2,lessons:[{id:'1',title:'lesson',url:lesson.sourceUrl,chapterId:'7',chapterPosition:1,chapterTitle:'chapter',position:1},{id:'2',title:'pending',url:null,chapterId:'8',chapterPosition:2,chapterTitle:'second',position:1}]};
    await writeJson(path.join(root,'catalog.json'),catalog);await writeJson(path.join(root,'lessons/1/lesson.json'),lesson);
    const before=await readFile(path.join(root,'lessons/1/lesson.json'),'utf8');
    const report=await auditSpecialty(root,true);assert.equal(report.summary.completeSessions,1);assert.equal(report.summary.notCaptured,1);assert.equal(report.allLessonsImportReady,false);
    const exported=JSON.parse(await readFile(path.join(root,'organized/chapters/001-7/lessons/001-1.json'),'utf8'));
    assert.equal(exported.steps[0].sourceContent[0].text,'before');
    assert.deepEqual(exported.steps[1].answer.correctOptionIds,[optionHash(lesson.steps[1].options[0])]);
    assert.equal(exported.entireSourceQuestionBankProven,false);assert.equal(exported.countsComparedWithConfiguredExpectation,false);
    assert.ok(exported.visits.every((v:{stepId:string})=>exported.steps.some((s:{id:string})=>s.id===v.stepId)));
    assert.notEqual(exportStep(lesson.steps[0]).contentKey,exportStep({...lesson.steps[0],content:[{tag:'text',text:'different page'}]}).contentKey);
    assert.deepEqual(exported.visits,lesson.visits);
    const pending=JSON.parse(await readFile(path.join(root,'organized/chapters/002-8/chapter.json'),'utf8'));
    assert.equal(pending.lessons[0].file,null);assert.equal(pending.complete,false);
    assert.equal(await readFile(path.join(root,'lessons/1/lesson.json'),'utf8'),before);
    const broken={...lesson,id:'2',chapterId:'8',chapterPosition:2,sourceUrl:'https://app.dentigoapp.com/fa/lesson/2',completion:undefined,status:'incomplete'} as Lesson;
    await writeJson(path.join(root,'lessons/2/lesson.json'),broken);
    const next=await auditSpecialty(root,true);assert.equal(next.summary.incomplete,1);assert.equal(next.lessons[1].importReady,false);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('answer keys use content hashes despite shuffled source keys; invalid mapping and option-only images block import',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'dentigo-export-invalid-'));
  try {
    const lesson=completeLesson(),step=lesson.steps[1];
    step.options.reverse();step.options[0].key='old-a';step.options[1].key='old-b';
    const exported=exportStep(step);assert.equal(exported.options.find(o=>exported.answer!.correctOptionIds.includes(o.id))?.text,'درست');
    assert.deepEqual(await inspectLesson(lesson,root),[]);
    step.answer!.correctOptionHashes=['not-an-option'];
    assert.ok((await inspectLesson(lesson,root)).includes('ANSWER_OPTION_MAPPING_INVALID:2'));
    step.options[0].content=[{tag:'img',src:'https://app.dentigoapp.com/missing.png'}];
    assert.ok((await inspectLesson(lesson,root)).includes('IMAGE_UNRESOLVED:2'));
    step.options[0].content=[{tag:'img',assetPath:'../private.json'}];
    assert.ok((await inspectLesson(lesson,root)).includes('ASSET_PATH_INVALID:2'));
  }finally{await rm(root,{recursive:true,force:true});}
});
