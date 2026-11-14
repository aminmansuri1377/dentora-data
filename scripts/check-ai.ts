import path from 'node:path';
import { chooseWithOllama } from '../src/ai.js';
import { safeCode } from '../src/core.js';
import type { Frame, Lesson } from '../src/types.js';

const options=['سه','چهار','پنج'].map((text,i)=>({key:String(i),position:i+1,text,content:[{tag:'text',text}],correctMarked:false,wrongMarked:false,selected:false}));
const frame={kind:'question',questionId:'connection-test',questionType:'single-choice',prompt:'دو به علاوه دو چند می‌شود؟',content:[],options} as unknown as Frame;
const lesson={steps:[{kind:'theory',content:[{tag:'text',text:'دو به علاوه دو برابر چهار است.'}]}]} as unknown as Lesson;
try {
  const key=await chooseWithOllama(frame,lesson,path.resolve('output-ai-check'),'qwen3-vl:2b-instruct');
  if(key!=='1')throw new Error('AI_CHECK_ANSWER_WRONG');
  console.log('AI_OK: اتصال و پاسخ ساختاریافته موفق بود؛ این تست دقت دندانپزشکی را تأیید نمی‌کند.');
} catch(error) { console.error(JSON.stringify({event:'AI_CHECK_FAILED',error:safeCode(error)}));process.exitCode=1; }
