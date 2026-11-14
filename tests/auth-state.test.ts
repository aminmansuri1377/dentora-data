import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { BrowserContext } from 'playwright';
import { normalizeAuth, importAuth } from '../src/auth-state.js';
import { createExport } from '../auth-export-extension/session-format.js';
import { readFileSync } from 'node:fs';
const base='https://app.dentigoapp.com';
const cookie={name:'laravel_session',value:'LOCAL_DUMMY_NOT_A_REAL_COOKIE',domain:'.dentigoapp.com',path:'/',httpOnly:true,secure:true,sameSite:'lax',expirationDate:Date.now()/1000+3600};
test('accepts source-only cookies including HttpOnly and maps Chrome expiry/SameSite',()=>{
 const state=normalizeAuth([cookie],base);assert.equal(state.cookies[0].httpOnly,true);assert.equal(state.cookies[0].secure,true);assert.equal(state.cookies[0].sameSite,'Lax');assert.equal(state.cookies[0].expires,cookie.expirationDate);
});
test('rejects Google, unrelated domains, subdomain lookalikes and broad domain cookies',()=>{
 for(const domain of ['.google.com','.com','app.dentigoapp.com.evil.example','.other.dentigoapp.com'])assert.throws(()=>normalizeAuth([{...cookie,domain}],base),/WRONG_DOMAIN/);
});
test('expired sessions cannot be silently reused',()=>{
 assert.throws(()=>normalizeAuth([{...cookie,expirationDate:1}],base),/EMPTY_OR_EXPIRED/);
});
test('session cookies and SameSite None preserve original attributes',()=>{
 const state=normalizeAuth([{...cookie,expires:-1,expirationDate:undefined,sameSite:'no_restriction'}],base);assert.equal(state.cookies[0].expires,undefined);assert.equal(state.cookies[0].sameSite,'None');
});
test('only exact app origins can import storage',()=>{
 assert.throws(()=>normalizeAuth({cookies:[cookie],origins:[{origin:'https://accounts.google.com',localStorage:[]}]},base),/WRONG_DOMAIN/);
 assert.throws(()=>normalizeAuth({cookies:[cookie],sessionStorage:[{origin:'https://other.example',entries:[]}]},base),/WRONG_DOMAIN/);
});
test('rejects malformed and partitioned cookie exports rather than changing their security scope',()=>{
 assert.throws(()=>normalizeAuth([{...cookie,value:123}],base),/WRONG_DOMAIN/);
 assert.throws(()=>normalizeAuth([{...cookie,partitionKey:{topLevelSite:base}}],base),/PARTITIONED/);
});
test('local exporter retains HttpOnly source cookies and excludes Google',()=>{
 const data=createExport([{...cookie,sameSite:'lax',session:false},{...cookie,domain:'.google.com'}],{origin:base,localStorage:[{name:'specialty',value:'2'}],sessionStorage:[]},'2026-11-14');
 assert.equal(data.cookies.length,1);assert.equal(data.cookies[0].httpOnly,true);assert.equal(data.origins[0].origin,base);assert.equal(data.cookies[0].sameSite,'Lax');assert.equal(normalizeAuth(data,base).cookies.length,1);
});
test('extension permissions are restricted to Dentigo and contain no external service',()=>{
 const manifest=JSON.parse(readFileSync('auth-export-extension/manifest.json','utf8'));
 assert.deepEqual(manifest.host_permissions,[base+'/*']);assert.deepEqual(manifest.permissions,['cookies','scripting']);
 assert.equal(manifest.background,undefined);
});
test('import installs source cookies before navigation and returns counts only',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'dentigo-auth-test-'));try{
  const file=path.join(dir,'auth.json');await writeFile(file,JSON.stringify({cookies:[cookie],origins:[{origin:base,localStorage:[{name:'specialty',value:'2'}]}]}));
  let count=0,script=0;
  const context={addCookies:async(c:unknown[])=>{count=c.length;},addInitScript:async()=>{script++;}} as unknown as BrowserContext;
  const result=await importAuth(context,file,base,'test');assert.equal(count,1);assert.equal(script,1);assert.deepEqual(result,{cookies:1,origins:1});assert.ok(!JSON.stringify(result).includes(cookie.value));
 }finally{await rm(dir,{recursive:true,force:true});}
});
