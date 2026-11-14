import { readFile } from 'node:fs/promises';
import type { Config } from './types.js';
export async function loadConfig(file:string):Promise<Config> {
  const c=JSON.parse(await readFile(file,'utf8')) as Config;
  const u=new URL(c.baseUrl);
  if(u.username||u.password||(!['https:'].includes(u.protocol)&&!(u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname))))throw new Error('CONFIG_BASE_URL_INVALID');
  for(const key of ['timeoutMs','settleMs','actionDelayMs','maxTransitions','maxQuestionVisits','maxCatalogRounds','maxSpecialties','maxImageBytes'] as const)if(!Number.isFinite(c[key])||c[key]<1)throw new Error('CONFIG_NUMBER_INVALID');
  if(!Array.isArray(c.allowAssetHosts)||!Array.isArray(c.selectors.tips))throw new Error('CONFIG_LIST_INVALID');
  for(const [k,v] of Object.entries(c.selectors))if(k!=='tips'&&(typeof v!=='string'||!v))throw new Error('CONFIG_SELECTOR_INVALID');
  for(const value of Object.values(c.expectedByLesson))if(!Number.isInteger(value.pages)||!Number.isInteger(value.questions)||value.pages<0||value.questions<0)throw new Error('CONFIG_COUNTS_INVALID');
  return c;
}
