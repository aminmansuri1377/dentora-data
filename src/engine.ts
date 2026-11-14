import type { Page } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { readPage } from './dom-reader.js';
import { canonical, optionHash, finalize, hash, lessonUrl, mergeAnswer, feedbackEvidence, now, questionKey, safeCode, isVerifiedAnswer } from './core.js';
import type { CatalogLesson, Config, Frame, Lesson, Step } from './types.js';
import { archive, readJson, writeJson } from './storage.js';
import { Assets } from './assets.js';
import { writePreview } from './preview.js';
import { chooseWithOllama } from './ai.js';
import { bundledAnswers } from './answer-cache.js';
import { Hearts, emptyHearts } from './hearts.js';
import { letterPlan, normalizeWord } from './letters.js';
export type EngineOptions = { root:string;runId:string;specialtyKey:string;specialtyName:string;force?:boolean;answerMode:'first'|'manual'|'ai';aiModel?:string;hearts?:Hearts;manual: (message:string)=>Promise<void> };
export class Engine {
  constructor(private page:Page,private config:Config,private assets:Assets,private options:EngineOptions){}
  async dismissTips() {
    let count=0;
    for(let round=0;round<3;round++) {
      let found=false;
      for(const selector of this.config.selectors.tips as string[]) {
        const tip=this.page.locator(selector);
        if(await tip.isVisible()) {
          const button=tip.getByRole('button',{name:'متوجه شدم',exact:true});
          if(await button.count()===1){await button.click();count++;found=true;}
        }
      }
      if(!found)break;
    }
    return count;
  }
  private async checkHearts() {
    if(this.options.hearts) {
      if(await this.options.hearts.handle(this.page))throw new Error('HEARTS_REFILLED_RESTART');
    } else if(this.options.answerMode==='ai'&&emptyHearts(await this.page.locator('body').innerText()))throw new Error('HEARTS_EMPTY');
  }
  async frame():Promise<Frame> {
    const frame=await this.page.evaluate(readPage,this.config) as Frame;
    // Save source feedback before a hearts modal causes a lesson restart.
    if(!(frame.kind==='question'&&frame.feedback&&frame.actionEnabled))await this.checkHearts();
    return frame;
  }
  async stable(predicate:(f:Frame)=>boolean,error:string):Promise<Frame> {
    const deadline=Date.now()+this.config.timeoutMs;let last='',since=0;
    while(Date.now()<deadline) {
      const f=await this.frame();
      if(predicate(f)) {
        const signature=hash({frame:canonical(f),feedback:f.feedback,action:f.action,enabled:f.actionEnabled,kind:f.kind});
        if(signature!==last){last=signature;since=Date.now();}
        if(Date.now()-since>=this.config.settleMs)return f;
      }else{last='';since=0;}
      await delay(150);
    }
    throw new Error(error);
  }
  async advance(old:Frame) {
    await this.checkHearts();
    await this.dismissTips();
    const button=this.page.locator(this.config.selectors.action as string);
    if(!await button.isVisible()||!await button.isEnabled())throw new Error('ACTION_UNAVAILABLE');
    await delay(this.config.actionDelayMs);await button.click();
    const deadline=Date.now()+this.config.timeoutMs;let tipRetry=false;
    while(Date.now()<deadline) {
      const tips=await this.dismissTips();
      const f=await this.frame();
      if(f.kind==='complete'||(f.kind!=='unknown'&&(canonical(f)!==canonical(old)||(!!old.feedback&&!f.feedback)))) {
        return await this.stable(next=>next.kind==='complete'||(next.kind!=='unknown'&&(canonical(next)!==canonical(old)||(!!old.feedback&&!next.feedback))),'UNSTABLE_NEXT_STEP');
      }
      // A newly displayed onboarding tip consumes the click. One retry is allowed
      // only after actually dismissing that tip, never on a slow answer response.
      if(tips&&!tipRetry){tipRetry=true;await delay(this.config.actionDelayMs);await button.click();}
      await delay(150);
    }
    throw new Error('STEP_DID_NOT_CHANGE');
  }
  async loadLazyImages() {
    const images=this.page.locator(`${this.config.selectors.slide} img`);
    for(let i=0;i<await images.count();i++)await images.nth(i).scrollIntoViewIfNeeded().catch(()=>undefined);
    if(await images.count())await delay(this.config.settleMs);
  }
  async fillLetters(frame:Frame,word:string) {
    if(!frame.jumble)throw new Error('LETTERS_LAYOUT_MISSING');
    const plan=letterPlan(word,frame.jumble),chars=Array.from(normalizeWord(word));
    const fresh=await this.frame();
    if(fresh.kind!=='question'||canonical(fresh)!==canonical(frame)||fresh.feedback)throw new Error('QUESTION_CHANGED_DURING_AI');
    if(fresh.jumble?.slotTexts.some(t=>normalizeWord(t)))throw new Error('LETTERS_ALREADY_FILLED');
    for(let i=0;i<plan.length;i++) {
      const tile=this.page.locator(`${this.config.selectors.slide} .jumble-tile[data-tile-index="${plan[i]}"]`);
      if(await tile.count()!==1||!await tile.isVisible())throw new Error('LETTERS_TILE_UNAVAILABLE');
      await tile.click();
      const expected=chars.slice(0,i+1).join('');
      await this.stable(next=>canonical(next)===canonical(frame)&&normalizeWord(next.jumble?.slotTexts.join('')??'')===expected,'LETTERS_SELECTION_NOT_READY');
    }
  }
  async scrape(item:CatalogLesson):Promise<Lesson> {
    // A refill may return to home or invalidate the source attempt. Start the lesson
    // again with its newly saved verified answer bank; never blindly resubmit a POST.
    for(let restart=0;;restart++) {
      const result=await this.scrapeOnce(item);
      if(result.error!=='HEARTS_REFILLED_RESTART'||restart>=20)return result;
      console.log(JSON.stringify({event:'LESSON_RESTART_AFTER_REFILL',lesson:item.id}));
    }
  }
  private async scrapeOnce(item:CatalogLesson):Promise<Lesson> {
    const url=lessonUrl(item.url!,this.config.baseUrl),id=item.id;
    const file=path.join(this.options.root,'lessons',id,'lesson.json');
    const previous=await readJson<Lesson>(file);
    if(previous&&previous.schemaVersion!==3)throw new Error('CHECKPOINT_VERSION_MISMATCH');
    if(previous&&['captured','validated'].includes(previous.status)&&!this.options.force)return previous;
    await archive(file,this.options.runId);
    const lesson:Lesson={schemaVersion:3,id,sourceUrl:url,title:item.title,specialtyKey:this.options.specialtyKey,specialtyName:this.options.specialtyName,chapterId:item.chapterId||null,chapterTitle:item.chapterTitle||null,chapterPosition:item.chapterPosition||null,lessonPosition:item.position||null,runId:this.options.runId,startedAt:now(),updatedAt:now(),status:'in-progress',steps:[],visits:[],warnings:[],theoryPageCount:0,questionCount:0,expected:this.config.expectedByLesson[id]};
    const checkpoint=async()=>{lesson.updatedAt=now();lesson.theoryPageCount=lesson.steps.filter(s=>s.kind==='theory').length;lesson.questionCount=lesson.steps.filter(s=>s.kind==='question').length;await writeJson(file,lesson);};
    await checkpoint();
    const bankFile=path.join(this.options.root,'lessons',id,'question-bank.json');
    const bank=await readJson<{schemaVersion:1;questions:Step[]}>(bankFile)??{schemaVersion:1,questions:[]};
    if(bank.schemaVersion!==1||!Array.isArray(bank.questions))throw new Error('QUESTION_BANK_INVALID');
    const signature=(s:Step)=>s.questionType==='letter-order'?hash({id:s.id,prompt:s.prompt,type:s.questionType,slots:s.jumble?.slotCount,letters:s.jumble?.tiles.map(t=>normalizeWord(t.text)).sort()}):hash({id:s.id,prompt:s.prompt,options:s.options.map(optionHash).sort()});
    const seeds=await bundledAnswers(this.config.baseUrl,id);
    const known=new Map([...seeds,...bank.questions,...(previous?.steps??[])].filter(s=>s.kind==='question'&&isVerifiedAnswer(s.answer)).map(s=>[signature(s),s]));
    const saveBank=async()=>writeJson(bankFile,{schemaVersion:1,questions:[...known.values()]});
    await saveBank();
    const attempts=new Map<string,number>();
    try {
      await this.page.goto(url,{waitUntil:'domcontentloaded',timeout:this.config.timeoutMs});
      await this.dismissTips();
      await this.stable(f=>f.kind!=='unknown','LESSON_UNAVAILABLE_OR_LAYOUT_CHANGED');
      for(let transition=0;transition<this.config.maxTransitions;transition++) {
        await this.dismissTips();await this.loadLazyImages();
        const f=await this.stable(f=>f.kind!=='unknown','STEP_UNAVAILABLE');
        if(f.kind==='complete') {
          lesson.completion={heading:f.heading||'',at:now()};finalize(lesson);await checkpoint();await writePreview(this.options.root,lesson);return lesson;
        }
        if(f.kind==='unknown')throw new Error('UNSUPPORTED_STEP');
        lesson.title ||= f.title;
        const stepId=f.kind==='question'?questionKey(f):`theory:${canonical(f)}`;
        let record=lesson.steps.find(s=>s.id===stepId);
        if(record&&f.kind==='theory')throw new Error('THEORY_REVISIT_OR_AMBIGUOUS_POSITION');
        if(!record) {
          record={id:stepId,position:lesson.steps.length+1,kind:f.kind,sourceQuestionId:f.questionId,sourceStepId:f.declaredStepId,sourceProgress:f.progress,questionType:f.questionType,jumble:f.jumble,title:f.title,prompt:f.prompt,content:f.content,options:f.options,answer:null} as Step;
          await this.assets.collect(record.content);for (const o of record.options) await this.assets.collect(o.content);lesson.steps.push(record);
        } else if(record.prompt!==f.prompt || (f.questionType==='letter-order'?signature(record)!==signature({...record,jumble:f.jumble,questionType:f.questionType}):hash(record.options.map(optionHash).sort())!==hash(f.options.map(optionHash).sort())))throw new Error('QUESTION_CONTENT_CHANGED');
        lesson.visits.push({stepId,at:now(),progress:f.progress});await checkpoint();
        console.log(JSON.stringify({event:'STEP',lesson:id,position:record.position,kind:f.kind,visits:lesson.visits.length}));
        if(f.kind==='theory'){await this.advance(f);continue;}
        const count=(attempts.get(stepId)??0)+1;attempts.set(stepId,count);
        if(count>this.config.maxQuestionVisits)throw new Error('QUESTION_REPEAT_LIMIT');
        if(!f.feedback) {
          if(this.options.answerMode==='manual') {
            await this.options.manual(`درس ${id}: در مرورگر پاسخ را ثبت کن؛ پس از نمایش بازخورد Enter بزن. «ادامه» را نزن.`);
          } else {
            if(!['single-choice','letter-order'].includes(f.questionType))throw new Error('UNSUPPORTED_QUESTION_TYPE_MANUAL_REQUIRED');
            const old=isVerifiedAnswer(record.answer)?record:known.get(signature(record));
            if(f.questionType==='letter-order') {
              let word=old?.answer?.correctText;
              if(!word) {
                if(this.options.answerMode!=='ai')throw new Error('AI_REQUIRED_FOR_LETTERS');
                console.log(JSON.stringify({event:'AI_ANSWERING_LETTERS',lesson:id,question:f.questionId}));
                word=await chooseWithOllama({...f,content:record.content},lesson,this.options.root,this.options.aiModel??'qwen3-vl:2b-instruct');
              }
              await this.fillLetters(f,word);
            } else {
            if(old&&(old.prompt!==f.prompt||hash(old.options.map(optionHash).sort())!==hash(f.options.map(optionHash).sort())))throw new Error('PREVIOUS_QUESTION_CONTENT_CHANGED');
            const correctHashes=old?.answer?.correctOptionHashes??[];
            // Source answer evidence is matched by content, never by shuffled index/key.
            let selected=f.options.find(o=>correctHashes.includes(optionHash(o)));
            if(!selected&&this.options.answerMode==='ai') {
              console.log(JSON.stringify({event:'AI_ANSWERING',lesson:id,question:f.questionId}));
              const key=await chooseWithOllama({...f,content:record.content,options:f.options.map(o=>({...o,content:record!.options.find(saved=>optionHash(saved)===optionHash(o))?.content??o.content}))},lesson,this.options.root,this.options.aiModel??'qwen3-vl:4b');
              selected=f.options.find(o=>o.key===key);
              if(!selected)throw new Error('AI_INVALID_OPTION');
              const fresh=await this.frame();
              if(fresh.kind!=='question'||canonical(fresh)!==canonical(f)||fresh.feedback)throw new Error('QUESTION_CHANGED_DURING_AI');
            }
            if(!selected&&this.options.answerMode==='ai')throw new Error('AI_NO_SELECTION');
            selected??=f.options[0];
            const index=f.options.indexOf(selected);
            await this.page.locator(`${this.config.selectors.slide} ${this.config.selectors.options}`).filter({visible:true}).nth(index).click();
            }
            await this.stable(next=>next.kind==='question'&&canonical(next)===canonical(f)&&next.actionEnabled,'ANSWER_SELECTION_NOT_READY');
            await delay(this.config.actionDelayMs);await this.page.locator(this.config.selectors.action as string).click();
          }
        }
        const reviewed=await this.stable(next=>next.kind==='question'&&canonical(next)===canonical(f)&&!!next.feedback&&next.actionEnabled,'ANSWER_FEEDBACK_MISSING');
        const evidence=feedbackEvidence(reviewed);await this.assets.collect(evidence.content);
        record.answer=mergeAnswer(record.answer,evidence);
        if(isVerifiedAnswer(record.answer)){known.set(signature(record),structuredClone(record));await saveBank();}
        await checkpoint();
        if(!isVerifiedAnswer(record.answer)) {
          if(record.answer.status==='conflict')throw new Error('ANSWER_KEY_CONFLICT');
          if(this.options.answerMode!=='manual')throw new Error('ANSWER_KEY_UNVERIFIED');
          lesson.warnings.push(`MANUAL_UNVERIFIED_ANSWER:${record.position}`);
        }
        await this.advance(reviewed);
      }
      throw new Error('TRANSITION_LIMIT');
    } catch(error) {
      lesson.error=safeCode(error);finalize(lesson);
      await checkpoint();await writePreview(this.options.root,lesson);
      // Sanitized, content-only frame. Never a whole-page screenshot or raw response.
      const diagnostic=await this.page.evaluate(readPage,this.config).catch(()=>null);
      if(diagnostic)await writeJson(path.join(this.options.root,'lessons',id,'diagnostic.json'),diagnostic);
      console.warn(JSON.stringify({event:'INCOMPLETE',lesson:id,error:lesson.error}));return lesson;
    }
  }
}
