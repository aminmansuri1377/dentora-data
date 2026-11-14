import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { isVerifiedAnswer } from './core.js';
import { readJson } from './storage.js';
import type { ContentNode, Frame, Lesson } from './types.js';
import { letterCandidates } from './letters.js';

export function contentText(content:ContentNode[]):string {
  return content.map(n=>n.tag==='text'?n.text??'':contentText(n.children??[])+'\n').join('');
}
const stop=new Set('این آن برای است هست بود به از در را با یک که و یا می شود شده خود هر فقط باید دارد نیست چه کدام چرا چگونه'.split(' '));
function tokens(value:string):Set<string> {
  return new Set(value.toLowerCase().replace(/[يى]/g,'ی').replace(/ك/g,'ک').replace(/[\u064b-\u065f]/g,'').split(/[^\p{L}\p{N}]+/u).filter(t=>t.length>1&&!stop.has(t)));
}
type Reference={lessonId:string;chapterId:string|null;questionId?:string;kind:'theory'|'source-verified-answer';text:string;terms:Set<string>};

/** Retrieval from this specialty's local source content; never model-generated facts. */
export class StudyMemory {
  private lessons=new Map<string,Reference[]>();
  constructor(private origin:string,private specialtyKey:string){}
  static async load(root:string,baseUrl:string,specialtyKey:string):Promise<StudyMemory> {
    const memory=new StudyMemory(new URL(baseUrl).origin,specialtyKey);
    const dir=path.join(root,'lessons');
    let entries;
    try{entries=await readdir(dir,{withFileTypes:true});}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return memory;throw error;}
    for(const entry of entries.filter(e=>e.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name))) {
      const lesson=await readJson<Lesson>(path.join(dir,entry.name,'lesson.json'));
      if(lesson)memory.remember(lesson);
    }
    return memory;
  }
  remember(lesson:Lesson) {
    if(lesson.schemaVersion!==3||lesson.specialtyKey!==this.specialtyKey)return;
    try{if(new URL(lesson.sourceUrl).origin!==this.origin)return;}catch{return;}
    const documents:Reference[]=[];
    const add=(text:string,kind:Reference['kind'],questionId?:string)=>{
      if(text.trim())documents.push({lessonId:lesson.id,chapterId:lesson.chapterId,questionId,kind,text,terms:tokens(text)});
    };
    for(const step of lesson.steps) {
      if(step.kind==='theory') {
        const value=contentText(step.content);
        // Explicit excerpts keep retrieval small; the active lesson remains complete.
        for(let start=0;start<value.length;start+=1000)add(value.slice(start,start+1200),'theory');
      }else if(isVerifiedAnswer(step.answer)) {
        add(JSON.stringify({question:step.prompt,sourceCorrectAnswer:step.answer!.correctText??step.answer!.correctOptionTexts,sourceExplanation:step.answer!.explanation}),'source-verified-answer',step.sourceQuestionId??undefined);
      }
    }
    this.lessons.set(lesson.id,documents);
  }
  context(frame:Frame,lesson:Lesson,maxChars=4500,maxReferences=5):string {
    const query=tokens(frame.prompt+' '+frame.options.map(o=>o.text).join(' '));
    const documents=[...this.lessons.values()].flat().filter(d=>!(d.lessonId===lesson.id&&d.kind==='theory')&&!(d.questionId&&d.questionId===frame.questionId));
    const frequency=new Map<string,number>();
    for(const d of documents)for(const t of d.terms)frequency.set(t,(frequency.get(t)??0)+1);
    const ranked=documents.map(d=>({d,score:[...query].reduce((sum,t)=>sum+(d.terms.has(t)?Math.log(1+documents.length/(frequency.get(t)??1)):0),0)/Math.sqrt(Math.max(10,d.terms.size))*(d.chapterId===lesson.chapterId?1.5:1)})).filter(r=>r.score>0).sort((a,b)=>b.score-a.score||a.d.lessonId.localeCompare(b.d.lessonId));
    const chosen:unknown[]=[];const seen=new Set<string>();
    if(frame.questionType==='letter-order'&&frame.jumble) {
      // A compact source vocabulary is cheaper than sending every sibling lesson.
      const words=letterCandidates(documents.filter(d=>d.chapterId===lesson.chapterId).map(d=>d.text).join('\n'),frame.jumble);
      const hint={kind:'source-word-candidates',words};
      if(words.length&&JSON.stringify([hint]).length<=maxChars)chosen.push(hint);
    }
    for(const {d} of ranked) {
      if(chosen.length>=maxReferences)break;
      if(seen.has(d.text))continue;
      const value={lessonId:d.lessonId,chapterId:d.chapterId,questionId:d.questionId,kind:d.kind,excerpt:d.text};
      if(JSON.stringify([...chosen,value]).length>maxChars)continue;
      chosen.push(value);seen.add(d.text);
    }
    return chosen.length?JSON.stringify(chosen):'';
  }
}
