import { readFile, stat } from 'node:fs/promises';
import type { BrowserContext } from 'playwright';

export type AuthState = {
  cookies: Array<{name:string;value:string;domain:string;path:string;expires?:number;httpOnly:boolean;secure:boolean;sameSite:'Strict'|'Lax'|'None'}>;
  origins: Array<{origin:string;localStorage:Array<{name:string;value:string}>}>;
  sessionStorage: Array<{origin:string;entries:Array<{name:string;value:string}>}>;
};
const fail=()=>{throw new Error('AUTH_FILE_INVALID_OR_WRONG_DOMAIN');};
export function normalizeAuth(input:unknown,baseUrl:string):AuthState {
  const base=new URL(baseUrl),host=base.hostname;
  const allowed=new Set([host,...(host==='app.dentigoapp.com'?['dentigoapp.com']:[])]);
  const data=input as Record<string,unknown>;
  const raw=Array.isArray(input)?input:data?.cookies;
  if(!Array.isArray(raw)||raw.length>300)fail();
  const cookies:AuthState['cookies']=[];
  for(const value of raw as unknown[]) {
    if(!value||typeof value!=='object')fail();
    const c=value as Record<string,unknown>;
    const domain=typeof c.domain==='string'?c.domain:host;
    if(!allowed.has(domain.replace(/^\./,'')))fail();
    if(typeof c.name!=='string'||!c.name||typeof c.value!=='string'||c.name.length>1024||c.value.length>65536)fail();
    if(c.partitionKey)throw new Error('PARTITIONED_AUTH_COOKIE_UNSUPPORTED');
    const path=typeof c.path==='string'?c.path:'/';if(!path.startsWith('/'))fail();
    const expiry=c.expires??c.expirationDate;
    if(expiry!==undefined && (typeof expiry!=='number'||!Number.isFinite(expiry)))fail();
    // Session cookies commonly have expires=-1 in Playwright or no expirationDate in Chrome.
    if(typeof expiry==='number'&&expiry>0&&expiry<Date.now()/1000)continue;
    const sameSite=({strict:'Strict',lax:'Lax',none:'None',no_restriction:'None',unspecified:'Lax'} as const)[String(c.sameSite??'unspecified').toLowerCase() as 'lax'];
    if(!sameSite)fail();
    cookies.push({name:c.name as string,value:c.value as string,domain,path,expires:typeof expiry==='number'&&expiry>0?expiry:undefined,httpOnly:c.httpOnly===true,secure:c.secure===true,sameSite});
  }
  const parseEntries=(input:unknown)=>{
    if(!Array.isArray(input)||input.length>1000)fail();
    return (input as unknown[]).map(v=>{const x=v as {name?:unknown;value?:unknown};if(!x||typeof x.name!=='string'||typeof x.value!=='string')fail();return {name:x.name as string,value:x.value as string};});
  };
  const origins:AuthState['origins']=[],sessionStorage:AuthState['sessionStorage']=[];
  for(const item of (Array.isArray(data?.origins)?data.origins:[])) {
    if(item?.origin!==base.origin)fail();
    origins.push({origin:base.origin,localStorage:parseEntries(item.localStorage??[])});
  }
  for(const item of (Array.isArray(data?.sessionStorage)?data.sessionStorage:[])) {
    if(item?.origin!==base.origin)fail();
    sessionStorage.push({origin:base.origin,entries:parseEntries(item.entries??[])});
  }
  if(!cookies.length&&!origins.some(o=>o.localStorage.length)&&!sessionStorage.some(o=>o.entries.length))throw new Error('AUTH_FILE_EMPTY_OR_EXPIRED');
  return {cookies,origins,sessionStorage};
}
export async function importAuth(context:BrowserContext,file:string,baseUrl:string,runId:string) {
  if((await stat(file)).size>2*1024*1024)throw new Error('AUTH_FILE_TOO_LARGE');
  let input:unknown;try{input=JSON.parse(await readFile(file,'utf8'));}catch{throw new Error('AUTH_FILE_NOT_JSON');}
  const state=normalizeAuth(input,baseUrl);
  await context.addCookies(state.cookies);
  await context.addInitScript(({state,origin,marker})=>{
    if(location.origin!==origin||sessionStorage.getItem(marker))return;
    for(const o of state.origins)for(const e of o.localStorage)localStorage.setItem(e.name,e.value);
    for(const o of state.sessionStorage)for(const e of o.entries)sessionStorage.setItem(e.name,e.value);
    sessionStorage.setItem(marker,'1');
  },{state,origin:new URL(baseUrl).origin,marker:`__dentigo_crawler_auth_loaded_${runId}`});
  // Counts only. Never log tokens, cookie values, paths or full input JSON.
  return {cookies:state.cookies.length,origins:state.origins.length};
}
