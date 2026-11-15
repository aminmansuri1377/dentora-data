import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {prepareAiImage} from '../src/ai-image.js';
import {chooseWithOllama} from '../src/ai.js';
import {sanitizeAiError} from '../src/ai-error.js';
import type {Frame,Lesson} from '../src/types.js';

test('WebP becomes bounded PNG only for AI; original, aspect ratio and cache preserved',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'ai-image-'));
 try{
  const file=path.join(root,'large.webp');
  const original=await sharp({create:{width:2816,height:1536,channels:3,background:'white'}}).webp().toBuffer();
  await writeFile(file,original);
  const result=await prepareAiImage(root,file);
  assert.equal(result.info.width,1280);assert.equal(result.info.height,698);assert.equal(result.info.sourceFormat,'webp');
  assert.equal((await sharp(Buffer.from(result.data,'base64')).metadata()).format,'png');
  assert.deepEqual(await readFile(file),original);
  assert.equal(await prepareAiImage(root,file),result);
  const small=path.join(root,'small.png');await sharp({create:{width:40,height:20,channels:3,background:'white'}}).png().toFile(small);
  assert.equal((await prepareAiImage(root,small)).info.width,40);
  await writeFile(path.join(root,'broken.png'),'not an image');
  await assert.rejects(prepareAiImage(root,path.join(root,'broken.png')),/AI_IMAGE_DECODE_FAILED/);
  await assert.rejects(prepareAiImage(root,file,4096),/AI_IMAGE_EDGE_INVALID/);
  await assert.rejects(prepareAiImage(path.join(root,'missing'),file),/AI_IMAGE_UNAVAILABLE/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('three theory images retain mapping; schema-specific HTTP400 fallback is validated',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'ai-http-')),original=globalThis.fetch;
 try{
  for(let i=0;i<3;i++)await sharp({create:{width:2816,height:1536,channels:3,background:{r:i*50,g:0,b:0}}}).webp().toFile(path.join(root,`${i}.webp`));
  const lesson={steps:[{kind:'theory',content:[0,1,2].map(i=>({tag:'img',assetPath:`${i}.webp`,alt:`figure ${i}`}))}]} as unknown as Lesson;
  const frame={questionType:'single-choice',questionId:'541',prompt:'Question',content:[],options:['true','false'].map(key=>({key,text:key,content:[]}))} as unknown as Frame;
  let calls=0;
  globalThis.fetch=(async(_url,init)=>{
   const body=JSON.parse(String(init?.body));calls++;
   assert.equal(body.messages[1].images.length,3);
   for(const data of body.messages[1].images){const meta=await sharp(Buffer.from(data,'base64')).metadata();assert.equal(meta.format,'png');assert.equal(meta.width,1280);}
   assert.ok(body.messages[1].content.includes('Image 3'));
   if(calls===1)return new Response(JSON.stringify({error:'failed to compile JSON schema grammar'}),{status:400});
   assert.equal(body.format,'json');
   return new Response(JSON.stringify({done:true,message:{content:'{"optionKey":"false"}'}}));
  }) as typeof fetch;
  assert.equal(await chooseWithOllama(frame,lesson,root,'qwen3-vl:2b-instruct'),'false');assert.equal(calls,2);
  calls=0;
  globalThis.fetch=(async()=>{calls++;return new Response(JSON.stringify({error:'failed to decode image'}),{status:400});}) as typeof fetch;
  await assert.rejects(chooseWithOllama(frame,lesson,root,'qwen3-vl:2b-instruct'),/AI_HTTP_400/);
  assert.equal(calls,1);
  const raw=await readFile(path.join(root,'ai-http-error.json'),'utf8'),diagnostic=JSON.parse(raw);
  assert.equal(diagnostic.detail,'failed to decode image');assert.equal(diagnostic.imageCount,3);
  assert.ok(!raw.includes('base64'));assert.ok(!raw.includes('provisionalAnswer'));
 }finally{globalThis.fetch=original;await rm(root,{recursive:true,force:true});}
});

test('error summary removes URLs, image payloads and environment secrets',()=>{
 process.env.TEST_API_KEY='sensitive-example-123';
 try{
  const result=sanitizeAiError(`error sensitive-example-123 https://example.test/private data:image/png;base64,${'a'.repeat(100)} Bearer abc`);
  assert.ok(!result.includes('sensitive-example-123'));assert.ok(!result.includes('example.test'));assert.ok(!result.includes('a'.repeat(100)));assert.ok(!result.includes('Bearer abc'));
 }finally{delete process.env.TEST_API_KEY;}
});
