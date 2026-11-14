import { stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { hash, isVerifiedAnswer, nodes, now, optionHash, sourceNodes, validateLesson } from './core.js';
import { readJson, writeJson } from './storage.js';
import type { Catalog, CatalogLesson, Lesson, Step } from './types.js';

export async function inspectLesson(lesson:Lesson,root:string):Promise<string[]> {
  const issues=[...validateLesson(lesson).issues];
  for(const step of lesson.steps)for(const node of nodes([...step.content,...step.options.flatMap(o=>o.content),...(step.answer?.content??[])])) {
    if(node.tag!=='img'||!node.assetPath)continue;
    const absolute=path.resolve(root,node.assetPath);
    if(!/^assets\/[a-f0-9]{64}\.[a-z]+$/i.test(node.assetPath)||!absolute.startsWith(path.resolve(root)+path.sep)) {issues.push(`ASSET_PATH_INVALID:${step.position}`);continue;}
    const info=await stat(absolute).catch(()=>null);
    if(!info?.isFile()||!info.size)issues.push(`LOCAL_ASSET_FILE_MISSING:${step.position}`);
  }
  return [...new Set(issues)];
}
export function exportStep(step:Step) {
  const options=step.options.map(o=>({id:optionHash(o),sourceKey:o.key,position:o.position,text:o.text,content:o.content}));
  const correctOptionIds=step.answer?.correctOptionHashes??[];
  return {id:step.id,sourceId:step.sourceQuestionId??step.sourceStepId??step.id,sourceProgress:step.sourceProgress,contentKey:hash({kind:step.kind,type:step.questionType,prompt:step.prompt,content:step.kind==='theory'?sourceNodes(step.content):undefined,options:options.map(o=>o.id).sort(),slots:step.jumble?.slotCount,jumble:step.jumble?.tiles.map(t=>t.text).sort()}),position:step.position,kind:step.kind,type:step.questionType,
    prompt:step.prompt,sourceContent:step.content,options,
    answer:step.answer?{verification:step.answer.status,correctOptionIds,correctText:step.answer.correctText,explanation:step.answer.explanation,content:step.answer.content,observedAt:step.answer.observedAt}:null,
    letterLayout:step.jumble?{slotCount:step.jumble.slotCount,tiles:step.jumble.tiles}:undefined};
}
type AuditRow={id:string;title:string;chapterId:string;chapterPosition:number;position:number;status:string;importReady:boolean;issues:string[];pages:number;questions:number;verifiedQuestions:number;bankQuestions:number;images:number;file:string|null};
const chapterDirectory=(row:CatalogLesson)=>`chapters/${String(row.chapterPosition).padStart(3,'0')}-${row.chapterId}`;

/** Offline audit and additive export. Raw checkpoints are never moved or rewritten. */
export async function auditSpecialty(root:string,exportFiles=false) {
  const catalog=await readJson<Catalog>(path.join(root,'catalog.json'));
  if(!catalog)throw new Error('EXPORT_CATALOG_MISSING');
  if(!Array.isArray(catalog.lessons)||catalog.lessons.some(r=>!/^\d+$/.test(r.id)||!/^[-\w]+$/.test(r.chapterId)||!Number.isSafeInteger(r.chapterPosition)||r.chapterPosition<1||!Number.isSafeInteger(r.position)||r.position<1)||new Set(catalog.lessons.map(r=>r.id)).size!==catalog.lessons.length)throw new Error('EXPORT_CATALOG_INVALID');
  const rows:AuditRow[]=[];
  for(const row of catalog.lessons) {
    const lesson=await readJson<Lesson>(path.join(root,'lessons',row.id,'lesson.json'));
    const result:AuditRow={id:row.id,title:row.title,chapterId:row.chapterId,chapterPosition:row.chapterPosition,position:row.position,status:lesson?.status??(row.url?'pending':'locked'),importReady:false,issues:[],pages:0,questions:0,verifiedQuestions:0,bankQuestions:0,images:0,file:null};
    if(lesson) {
      result.issues=await inspectLesson(lesson,root);
      if(lesson.schemaVersion!==3||lesson.id!==row.id||lesson.specialtyKey!==catalog.specialtyKey||lesson.chapterId!==row.chapterId||lesson.chapterPosition!==row.chapterPosition||lesson.lessonPosition!==row.position)result.issues.push('CATALOG_LESSON_METADATA_MISMATCH');
      try{const source=new URL(lesson.sourceUrl);if(source.pathname!==`/fa/lesson/${row.id}`||!['https:','http:'].includes(source.protocol))result.issues.push('SOURCE_URL_INVALID');}catch{result.issues.push('SOURCE_URL_INVALID');}
      result.pages=lesson.steps.filter(s=>s.kind==='theory').length;
      result.questions=lesson.steps.filter(s=>s.kind==='question').length;
      result.verifiedQuestions=lesson.steps.filter(s=>s.kind==='question'&&isVerifiedAnswer(s.answer)).length;
      result.images=lesson.steps.flatMap(s=>nodes([...s.content,...s.options.flatMap(o=>o.content),...(s.answer?.content??[])])).filter(n=>n.tag==='img').length;
      const bank=await readJson<{schemaVersion:number;questions:Step[]}>(path.join(root,'lessons',row.id,'question-bank.json'));
      if(bank&&(bank.schemaVersion!==1||!Array.isArray(bank.questions)))throw new Error('QUESTION_BANK_INVALID');
      const sessionKeys=new Set(lesson.steps.filter(s=>s.kind==='question'&&isVerifiedAnswer(s.answer)).map(s=>exportStep(s).contentKey));
      const extra:ReturnType<typeof exportStep>[]=[];const seen=new Set(sessionKeys);
      for(const step of bank?.questions??[]) {
        if(!isVerifiedAnswer(step.answer))continue;
        const key=exportStep(step).contentKey;
        if(seen.has(key))continue;
        const problems=await inspectLesson({...lesson,steps:[{...step,position:1}],expected:undefined,completion:{heading:'bank-evidence',at:now()}},root);
        if(problems.length){result.issues.push('QUESTION_BANK_ENTRY_INVALID');continue;}
        seen.add(key);extra.push(exportStep(step));
      }
      result.bankQuestions=seen.size;
      result.importReady=!!lesson.completion&&result.issues.length===0;
      if(exportFiles&&result.importReady) {
        result.file=`${chapterDirectory(row)}/lessons/${String(row.position).padStart(3,'0')}-${row.id}.json`;
        await writeJson(path.join(root,'organized',result.file),{schemaVersion:1,assetPathsRelativeTo:'specialty-root',sourceDataPath:`lessons/${row.id}/lesson.json`,id:row.id,title:row.title,specialtyKey:catalog.specialtyKey,chapter:{id:row.chapterId,title:row.chapterTitle,position:row.chapterPosition},position:row.position,
          importReady:true,countsComparedWithConfiguredExpectation:validateLesson(lesson).countsVerified,sourceSessionFinished:true,entireSourceQuestionBankProven:false,
          order:'first-encounter-with-remediation-visits-preserved',steps:lesson.steps.map(exportStep),visits:lesson.visits,extraVerifiedQuestions:extra});
      }
    }
    rows.push(result);
  }
  const chapterMap=new Map<string,{id:string;title:string;position:number;lessons:AuditRow[]}>();
  for(const row of catalog.lessons) {
    if(!chapterMap.has(row.chapterId))chapterMap.set(row.chapterId,{id:row.chapterId,title:row.chapterTitle,position:row.chapterPosition,lessons:[]});
    chapterMap.get(row.chapterId)!.lessons.push(rows.find(r=>r.id===row.id)!);
  }
  const chapters=[...chapterMap.values()].sort((a,b)=>a.position-b.position);
  const catalogIssues:string[]=[];
  if(catalog.declaredChapterCount!==null&&catalog.declaredChapterCount!==chapters.length)catalogIssues.push('DECLARED_CHAPTER_COUNT_MISMATCH');
  if(catalog.chapterCount!==chapters.length)catalogIssues.push('CATALOG_CHAPTER_COUNT_MISMATCH');
  for(const ch of chapters) {
    ch.lessons.sort((a,b)=>a.position-b.position);
    if(ch.lessons.some((l,i)=>l.position!==i+1))catalogIssues.push(`LESSON_ORDER_INVALID:${ch.id}`);
    if(exportFiles)await writeJson(path.join(root,'organized',`chapters/${String(ch.position).padStart(3,'0')}-${ch.id}/chapter.json`),{schemaVersion:1,id:ch.id,title:ch.title,position:ch.position,complete:ch.lessons.every(l=>l.importReady),lessons:ch.lessons});
  }
  if(chapters.some((ch,i)=>ch.position!==i+1))catalogIssues.push('CHAPTER_ORDER_INVALID');
  const summary={catalogLessons:rows.length,chapters:chapters.length,completeSessions:rows.filter(r=>r.importReady).length,incomplete:rows.filter(r=>r.status==='incomplete'||r.status==='in-progress').length,needsReview:rows.filter(r=>r.issues.length&&r.status!=='incomplete'&&r.status!=='in-progress').length,notCaptured:rows.filter(r=>['pending','locked'].includes(r.status)).length,theoryPages:rows.reduce((n,r)=>n+r.pages,0),questions:rows.reduce((n,r)=>n+r.questions,0),sourceVerifiedQuestions:rows.reduce((n,r)=>n+r.verifiedQuestions,0),images:rows.reduce((n,r)=>n+r.images,0)};
  const report={schemaVersion:1,auditedAt:now(),specialtyKey:catalog.specialtyKey,specialtyName:catalog.specialtyName,summary,catalogIssues,allLessonsImportReady:!catalogIssues.length&&rows.length>0&&rows.every(r=>r.importReady),entireSourceQuestionBankProven:false,chapterSizes:chapters.map(ch=>({position:ch.position,lessons:ch.lessons.length})),lessons:rows};
  await writeJson(path.join(root,'audit-report.json'),report);
  if(exportFiles)await writeJson(path.join(root,'organized','index.json'),{schemaVersion:1,specialtyKey:catalog.specialtyKey,specialtyName:catalog.specialtyName,assetRoot:'..',assetPathsRelativeTo:'specialty-root',summary,complete:report.allLessonsImportReady,catalogIssues,chapters:chapters.map(ch=>({id:ch.id,title:ch.title,position:ch.position,lessons:ch.lessons.length,file:`chapters/${String(ch.position).padStart(3,'0')}-${ch.id}/chapter.json`}))});
  return report;
}

export async function auditOutput(output:string,exportFiles=false) {
  if(await readJson(path.join(output,'catalog.json')))return [await auditSpecialty(output,exportFiles)];
  const reports=[];
  for(const entry of (await readdir(output,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name)))if(entry.isDirectory()&&entry.name.startsWith('specialty-'))reports.push(await auditSpecialty(path.join(output,entry.name),exportFiles));
  if(!reports.length)throw new Error('EXPORT_CATALOG_MISSING');
  return reports;
}
