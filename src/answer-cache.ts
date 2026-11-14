import { readFile } from 'node:fs/promises';
import type { Step } from './types.js';
type Cache={schemaVersion:1;sourceOrigin:string;lessons:Record<string,Step[]>};
let cached:Promise<Cache>|undefined;
export async function bundledAnswers(baseUrl:string,lessonId:string):Promise<Step[]> {
  cached??=readFile(new URL('../data/verified-answers.json',import.meta.url),'utf8').then(raw=>JSON.parse(raw) as Cache);
  const bank=await cached;
  if(bank.schemaVersion!==1||bank.sourceOrigin!==new URL(baseUrl).origin)return [];
  return structuredClone(bank.lessons[lessonId]??[]);
}
