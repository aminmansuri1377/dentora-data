import path from 'node:path';
import { finalize, now } from './core.js';
import { inspectLesson } from './audit-export.js';
import { archive,readJson,writeJson } from './storage.js';
import { writePreview } from './preview.js';
import type { Lesson } from './types.js';

/** Only upgrade an observed complete session whose sole old issue was source identity. */
export async function revalidateCompletedLesson(root:string,id:string,runId:string):Promise<Lesson|null> {
  const file=path.join(root,'lessons',id,'lesson.json'),old=await readJson<Lesson>(file);
  if(!old||old.schemaVersion!==3||old.status!=='needs-review'||!old.completion||!old.validation?.issues.length||!old.validation.issues.every(i=>/^QUESTION_ID_UNVERIFIED:\d+$/.test(i)))return old;
  const checked=finalize(structuredClone(old));
  if(!['captured','validated'].includes(checked.status)||(await inspectLesson(checked,root)).length)return old;
  await archive(file,runId);
  checked.updatedAt=now();
  await writeJson(file,checked);await writePreview(root,checked);
  console.log(JSON.stringify({event:'LESSON_REVALIDATED',lesson:id,status:checked.status,sourceIdentity:'local-content-hash-with-warning'}));
  return checked;
}
