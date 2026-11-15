import {readdir} from 'node:fs/promises';
import path from 'node:path';
import {chooseWithOllama} from '../src/ai.js';
import {isVerifiedAnswer,safeCode} from '../src/core.js';
import {readJson} from '../src/storage.js';
import {StudyMemory,contentText} from '../src/study-memory.js';
import type {Frame,Lesson} from '../src/types.js';

const args=process.argv.slice(2);
function arg(name:string,fallback:string){const i=args.indexOf(name);return i<0?fallback:args[i+1]??fallback;}
let diagnosticRoot='';
try {
  const id=arg('--lesson','56');
  if(!/^\d+$/.test(id))throw new Error('INVALID_LESSON_ID');
  const output=path.resolve(arg('--output','output-restorative'));
  const roots=[output,...(await readdir(output,{withFileTypes:true})).filter(e=>e.isDirectory()&&e.name.startsWith('specialty-')).map(e=>path.join(output,e.name))];
  const matches:Array<{root:string;lesson:Lesson}>=[];
  for(const root of roots){const lesson=await readJson<Lesson>(path.join(root,'lessons',id,'lesson.json'));if(lesson)matches.push({root,lesson});}
  if(matches.length!==1)throw new Error(matches.length?'AI_CHECK_LESSON_AMBIGUOUS':'AI_CHECK_LESSON_NOT_FOUND');
  const {root,lesson}=matches[0];
  const questions=lesson.steps.filter(s=>s.kind==='question');
  const step=questions.find(s=>!isVerifiedAnswer(s.answer))??questions.at(-1);
  if(!step)throw new Error('AI_CHECK_QUESTION_NOT_FOUND');
  const imageMaxEdge=Number(arg('--ai-image-max-edge','1280'));
  if(!Number.isSafeInteger(imageMaxEdge)||imageMaxEdge<256||imageMaxEdge>2048)throw new Error('INVALID_AI_IMAGE_MAX_EDGE');
  const frame={...step,questionId:step.sourceQuestionId} as unknown as Frame;
  // Reproduce context available at this question, excluding any later pages.
  const active={...lesson,steps:lesson.steps.filter(s=>s.position<=step.position)};
  const memory=await StudyMemory.load(root,lesson.sourceUrl,lesson.specialtyKey);memory.remember(active);
  const primary=active.steps.filter(s=>s.kind==='theory').map(s=>contentText(s.content)).join('\n\n');
  const budget=Math.max(0,Math.min(1200,15500-primary.length-frame.prompt.length-frame.options.reduce((n,o)=>n+o.text.length,0)));
  diagnosticRoot=path.join(root,'ai-checks',`lesson-${id}`);
  const key=await chooseWithOllama(frame,active,root,arg('--model','qwen3-vl:2b-instruct'),memory.context(frame,active,budget,2),undefined,diagnosticRoot,{imageMaxEdge});
  console.log(JSON.stringify({event:'AI_LESSON_CHECK_OK',lesson:id,question:frame.questionId,provisionalAnswer:key,verified:false,diagnosticRoot}));
  console.log('این تست فقط درخواست محلی Ollama را اجرا کرد؛ پاسخ تأییدشده نیست و هیچ پاسخ، قلب یا پیشرفتی در سایت تغییر نکرد.');
}catch(error){console.error(JSON.stringify({event:'AI_LESSON_CHECK_FAILED',error:safeCode(error),diagnosticRoot}));process.exitCode=1;}
