import { mkdir, readFile, writeFile, rename, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
export async function readJson<T>(file:string):Promise<T|null> {
  if(!existsSync(file))return null;
  // Corrupt checkpoints must never be silently overwritten.
  return JSON.parse(await readFile(file,'utf8')) as T;
}
export async function writeJson(file:string,value:unknown) {
  await mkdir(path.dirname(file),{recursive:true});
  const temp=file+'.tmp'; await writeFile(temp,JSON.stringify(value,null,2),'utf8'); await rename(temp,file);
}
export async function archive(file:string,runId:string) {
  if(!existsSync(file))return;
  const dir=path.join(path.dirname(file),'history');await mkdir(dir,{recursive:true});
  await copyFile(file,path.join(dir,`${path.basename(file,'.json')}-${runId}-${randomUUID().slice(0,8)}.json`));
}
