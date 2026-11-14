import { readFile,readdir } from 'node:fs/promises';
import path from 'node:path';
import { chooseWithOllama } from './ai.js';
import { canonical,hash,isVerifiedAnswer,now,optionHash,safeCode } from './core.js';
import { normalizeWord } from './letters.js';
import { readJson,writeJson } from './storage.js';
import { StudyMemory,contentText } from './study-memory.js';
import type { Frame,Lesson,Step } from './types.js';
type Sample={lesson:Lesson;frame:Frame;step:Step};
type Result={lessonId:string;questionId:string|null;type:string;correct:boolean|null;elapsedMs:number;error?:string};

export async function benchmarkSamples(root:string,limit:number):Promise<Sample[]> {
  const samples=new Map<string,Sample>(),recent=new Set<string>();
  const entries=(await readdir(path.join(root,'lessons'),{withFileTypes:true})).filter(e=>e.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name));
  for(const entry of entries) {
    const dir=path.join(root,'lessons',entry.name),lesson=await readJson<Lesson>(path.join(dir,'lesson.json'));
    if(!lesson)continue;
    const attempts=await readFile(path.join(dir,'answer-attempts.jsonl'),'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
    for(const line of attempts.split('\n').filter(Boolean)) {const a=JSON.parse(line);if(a.source==='ai'&&a.questionContentKey)recent.add(`${entry.name}:${a.questionContentKey}`);}
    const bank=await readJson<{questions:Step[]}>(path.join(dir,'question-bank.json'));
    for(const step of [...lesson.steps,...(bank?.questions??[])]) {
      if(step.kind!=='question'||!isVerifiedAnswer(step.answer)||!['single-choice','letter-order'].includes(step.questionType))continue;
      const frame={kind:'question',questionId:step.sourceQuestionId,questionType:step.questionType,prompt:step.prompt,content:step.content,options:step.options.map(o=>({...o,selected:false,correctMarked:false,wrongMarked:false})),jumble:step.jumble?{...step.jumble,slotTexts:Array(step.jumble.slotCount).fill(''),correctSlots:false,correctWord:''}:undefined,feedback:'',feedbackContent:[],feedbackClass:'',url:lesson.sourceUrl,title:lesson.title,action:'',actionEnabled:false,progress:'',declaredStepId:null,blockers:[]} satisfies Frame;
      const key=`${entry.name}:${canonical(frame)}`;
      if(!samples.has(key))samples.set(key,{lesson,frame,step});
    }
  }
  let pool=[...samples].filter(([key])=>recent.has(key)).map(([,s])=>s);
  if(!pool.length)pool=[...samples.values()];
  // Deterministic mixed sample: same questions for every compared model.
  const groups=[pool.filter(s=>s.frame.questionType==='single-choice'),pool.filter(s=>s.frame.questionType==='letter-order')];
  for(const group of groups)group.sort((a,b)=>canonical(a.frame).localeCompare(canonical(b.frame)));
  const selected:Sample[]=[];
  while(selected.length<limit&&groups.some(g=>g.length))for(const group of groups) {if(selected.length===limit)break;const sample=group.shift();if(sample)selected.push(sample);}
  return selected;
}

export async function runBenchmark(root:string,model:string,limit:number,answer:typeof chooseWithOllama=chooseWithOllama) {
  if(!Number.isSafeInteger(limit)||limit<1||limit>200)throw new Error('INVALID_BENCHMARK_LIMIT');
  const samples=await benchmarkSamples(root,limit);if(!samples.length)throw new Error('BENCHMARK_NO_VERIFIED_QUESTIONS');
  const first=samples[0].lesson,memory=new StudyMemory(new URL(first.sourceUrl).origin,first.specialtyKey);
  // Hold out all answer records. Retrieval contains theory only, including sibling lessons.
  for(const entry of await readdir(path.join(root,'lessons'),{withFileTypes:true}))if(entry.isDirectory()) {
    const lesson=await readJson<Lesson>(path.join(root,'lessons',entry.name,'lesson.json'));
    if(lesson)memory.remember({...lesson,steps:lesson.steps.filter(s=>s.kind==='theory')});
  }
  const diagnosticRoot=path.join(root,'benchmarks',hash(model).slice(0,12)),results:Result[]=[];
  for(const sample of samples) {
    const started=Date.now(),{frame,lesson,step}=sample;
    let correct:boolean|null=null,error:string|undefined;
    try {
      const primary=lesson.steps.filter(s=>s.kind==='theory').map(s=>contentText(s.content)).join('\n\n');
      const budget=Math.max(0,Math.min(1200,15500-primary.length-frame.prompt.length-frame.options.reduce((n,o)=>n+o.text.length,0)));
      const references=memory.context(frame,lesson,budget,2);
      const proposed=await answer(frame,{...lesson,steps:lesson.steps.filter(s=>s.kind==='theory')},root,model,references,undefined,diagnosticRoot);
      correct=frame.questionType==='letter-order'?normalizeWord(proposed)===normalizeWord(step.answer!.correctText??''):!!frame.options.find(o=>o.key===proposed&&step.answer!.correctOptionHashes.includes(optionHash(o)));
    }catch(e){error=safeCode(e);}
    const row={lessonId:lesson.id,questionId:frame.questionId,type:frame.questionType,correct,elapsedMs:Date.now()-started,error};results.push(row);
    console.log(JSON.stringify({event:'BENCHMARK_RESULT',model,...row}));
    if(error&&/^AI_HTTP_4/.test(error))break;
  }
  const latencies=results.map(r=>r.elapsedMs).sort((a,b)=>a-b);
  const counts={correct:results.filter(r=>r.correct===true).length,wrong:results.filter(r=>r.correct===false).length,failed:results.filter(r=>r.correct===null).length};
  const report={model,at:now(),requested:limit,sampleCount:samples.length,attempted:results.length,complete:results.length===samples.length,answerRecordsHeldOut:true,sampleIds:samples.map(s=>({lessonId:s.lesson.id,questionId:s.frame.questionId,contentKey:canonical(s.frame)})),...counts,accuracy:counts.correct/results.length,medianMs:latencies[Math.floor(latencies.length/2)],results};
  const file=path.join(diagnosticRoot,'report.json');await writeJson(file,report);
  console.log(JSON.stringify({event:'BENCHMARK_FINISHED',file,model,...counts,accuracy:report.accuracy,medianMs:report.medianMs}));
  return report;
}
