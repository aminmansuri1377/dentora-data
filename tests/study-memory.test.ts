import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StudyMemory } from '../src/study-memory.js';
import { chooseWithOllama } from '../src/ai.js';
import { mkdtemp,rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { Frame,Lesson } from '../src/types.js';

test('retrieves related chapter theory and verified feedback, excludes guesses and other origins',()=>{
  const memory=new StudyMemory('https://app.dentigoapp.com','test');
  const lesson={schemaVersion:3,id:'1',sourceUrl:'https://app.dentigoapp.com/fa/lesson/1',specialtyKey:'test',chapterId:'7',steps:[
    {kind:'theory',content:[{tag:'text',text:'انتخاب شید پیش از گذاشتن رابردم انجام می‌شود.'}]},
    {kind:'question',sourceQuestionId:'12',prompt:'شید و رابردم',answer:{status:'observed-single-key',correctOptionTexts:['شید پیش از رابردم'],explanation:'خشک شدن مینا رنگ دندان را تغییر می‌دهد.'}},
    {kind:'question',sourceQuestionId:'13',prompt:'شید و رابردم',answer:{status:'unverified',correctText:'UNVERIFIED_GUESS',explanation:'untrusted'}}]} as unknown as Lesson;
  memory.remember(lesson);
  memory.remember({...lesson,id:'99',sourceUrl:'https://elsewhere.test/fa/lesson/99',steps:[{kind:'theory',content:[{tag:'text',text:'شید رابردم OTHER_ORIGIN'}]}]} as unknown as Lesson);
  const frame={questionId:'14',prompt:'انتخاب شید و رابردم',options:[]} as unknown as Frame;
  const references=memory.context(frame,{...lesson,id:'2'},4500);
  assert.ok(references.includes('انتخاب شید'));assert.ok(references.includes('source-verified-answer'));
  assert.ok(!references.includes('UNVERIFIED_GUESS'));assert.ok(!references.includes('OTHER_ORIGIN'));
  assert.ok(!memory.context(frame,lesson,4500).includes('"kind":"theory"'));
  assert.equal(memory.context(frame,{...lesson,id:'2'},10),'');
});

test('Ollama receives retrieved source excerpts in one request without replacing active theory',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'dentigo-memory-')),original=globalThis.fetch;let calls=0;
  try {
    globalThis.fetch=(async(_url,init)=>{
      calls++;const request=JSON.parse(String(init?.body)),input=JSON.parse(request.messages[1].content);
      assert.equal(input.lesson,'درسنامه کامل');assert.equal(input.sourceReferences[0].excerpt,'مرجع مرتبط');
      return new Response(JSON.stringify({done:true,message:{content:'{"optionKey":"a"}'}}));
    }) as typeof fetch;
    await chooseWithOllama({questionType:'single-choice',questionId:'1',prompt:'P',options:[{key:'a',text:'A',content:[]},{key:'b',text:'B',content:[]}],content:[]} as unknown as Frame,{steps:[{kind:'theory',content:[{tag:'text',text:'درسنامه کامل'}]}]} as unknown as Lesson,root,'qwen3-vl:2b-instruct',JSON.stringify([{excerpt:'مرجع مرتبط'}]));
    assert.equal(calls,1);
  }finally{globalThis.fetch=original;await rm(root,{recursive:true,force:true});}
});
