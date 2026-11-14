import { createHash } from 'node:crypto';
import type { Answer, ContentNode, Frame, Lesson } from './types.js';
import { letterPlan, normalizeWord, sourceRevealedWord } from './letters.js';
export const hash = (value:unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const now = () => new Date().toISOString();
export const normalize = (text:string) => text.replace(/\s+/g,' ').trim();
export function sourceNodes(content:ContentNode[]):unknown[] { return content.map(n=>({tag:n.tag,text:n.text,attributes:n.attributes,src:n.src,alt:n.alt,children:sourceNodes(n.children??[])})); }
export function optionHash(option:{text:string;content:ContentNode[]}) {return hash({text:option.text,content:sourceNodes(option.content)});}
export function canonical(frame:Frame) {
  if(frame.kind==='question'&&frame.questionType==='letter-order')return hash({id:frame.questionId,prompt:frame.prompt,type:'letter-order',slots:frame.jumble?.slotCount,letters:frame.jumble?.tiles.map(t=>normalizeWord(t.text)).sort()});
  return frame.kind === 'question'
    ? hash({id:frame.questionId, prompt:frame.prompt, options:frame.options.map(optionHash).sort()})
    : hash({content:sourceNodes(frame.content), step:frame.declaredStepId, progress:frame.progress});
}
export function questionKey(frame:Frame) { return frame.questionId ? `question:${frame.questionId}` : `question:${canonical(frame)}`; }
export function feedbackEvidence(frame:Frame):Answer {
  if(frame.questionType==='letter-order'&&frame.jumble) {
    const j=frame.jumble,submitted=j.slotTexts.join('');
    let word=frame.feedback?sourceRevealedWord(j.correctWord,j):null;
    if(!word&&frame.feedback&&/\bok\b/.test(frame.feedbackClass)&&j.correctSlots&&j.slotTexts.every(t=>normalizeWord(t).length===1)) {
      try{letterPlan(submitted,j);word=normalizeWord(submitted);}catch{/* Keep unverified. */}
    }
    return {status:word?'observed-text':'unverified',correctText:word??undefined,textEvidence:{submittedText:submitted,sourceRevealedWord:j.correctWord,slotsMarkedCorrect:j.correctSlots,feedbackClass:frame.feedbackClass},correctOptionHashes:[],correctOptionKeys:[],correctOptionTexts:[],explanation:frame.feedback,content:frame.feedbackContent,options:[],observedAt:now()};
  }
  const correct = frame.options.filter(o=>o.correctMarked);
  const verified = !!frame.feedback && correct.length === 1 && frame.options.length >= 2 && frame.questionType === 'single-choice' && new Set(frame.options.map(optionHash)).size===frame.options.length && !correct[0].wrongMarked;
  return {status:verified?'observed-single-key':'unverified', correctOptionKeys:verified?correct.map(o=>o.key):[], correctOptionHashes:verified?correct.map(optionHash):[], correctOptionTexts:verified?correct.map(o=>o.text):[], explanation:frame.feedback,content:frame.feedbackContent,options:frame.options.map(o=>({key:o.key,position:o.position,text:o.text,isCorrect:verified?o.correctMarked:o.correctMarked?true:o.wrongMarked?false:null})),observedAt:now()};
}
export function mergeAnswer(previous:Answer|null, next:Answer):Answer {
  if(isVerifiedAnswer(previous)&&isVerifiedAnswer(next)) {
    const value=(a:Answer)=>a.status==='observed-text'?hash({text:normalizeWord(a.correctText??'')}):hash([...a.correctOptionHashes].sort());
    if(value(previous!)!==value(next))return {...next,status:'conflict'};
  }
  return next.status==='unverified' && previous ? previous : next;
}
export function isVerifiedAnswer(answer:Answer|null|undefined):boolean {
  return answer?.status==='observed-single-key'||(answer?.status==='observed-text'&&!!answer.correctText);
}
export function nodes(content:ContentNode[]):ContentNode[] { return content.flatMap(n=>[n,...nodes(n.children??[])]); }
export function validateLesson(lesson:Lesson) {
  const issues:string[]=[];
  const pages=lesson.steps.filter(s=>s.kind==='theory').length, questions=lesson.steps.filter(s=>s.kind==='question').length;
  if (!lesson.completion) issues.push('SOURCE_COMPLETION_NOT_OBSERVED');
  if (!lesson.steps.length) issues.push('NO_STEPS');
  if (lesson.steps.some((s,i)=>s.position!==i+1)) issues.push('NONCONTIGUOUS_STEP_ORDER');
  if (new Set(lesson.steps.map(s=>s.id)).size!==lesson.steps.length) issues.push('DUPLICATE_STEP_IDS');
  for (const step of lesson.steps) {
    if(step.kind==='question'&&!step.sourceQuestionId&&!step.sourceStepId)issues.push(`QUESTION_ID_UNVERIFIED:${step.position}`);
    if (step.kind==='question' && !isVerifiedAnswer(step.answer)) issues.push(`ANSWER_UNVERIFIED:${step.position}`);
    if(step.kind==='question'&&step.answer?.status==='observed-single-key') {
      const matching=step.options.filter(o=>step.answer!.correctOptionHashes.includes(optionHash(o)));
      if(step.questionType!=='single-choice'||step.answer.correctOptionHashes.length!==1||matching.length!==1||new Set(step.options.map(optionHash)).size!==step.options.length)issues.push(`ANSWER_OPTION_MAPPING_INVALID:${step.position}`);
    }
    if(step.questionType==='letter-order'&&step.answer?.status==='observed-text') {
      try{if(!step.jumble)throw Error();letterPlan(step.answer.correctText!,step.jumble);}catch{issues.push(`LETTER_ANSWER_INVALID:${step.position}`);}
    }
    for (const n of nodes([...step.content,...step.options.flatMap(o=>o.content),...(step.answer?.content??[])])) {
      if (n.attributes?.unsupportedMedia) issues.push(`UNSUPPORTED_MEDIA:${step.position}:${n.attributes.unsupportedMedia}`);
      if (n.tag==='img' && (!n.assetPath || n.assetError)) issues.push(`IMAGE_UNRESOLVED:${step.position}`);
    }
  }
  if (lesson.expected && (pages!==lesson.expected.pages || questions!==lesson.expected.questions)) issues.push('EXPECTED_COUNTS_MISMATCH');
  return {issues:[...new Set(issues)],countsVerified:!!lesson.expected && !issues.includes('EXPECTED_COUNTS_MISMATCH'),sourceFinished:!!lesson.completion};
}
export function finalize(lesson:Lesson) {
  lesson.theoryPageCount=lesson.steps.filter(s=>s.kind==='theory').length;
  lesson.questionCount=lesson.steps.filter(s=>s.kind==='question').length;
  lesson.validation=validateLesson(lesson);
  if (!lesson.completion) lesson.status='incomplete';
  else if (lesson.validation.issues.length) lesson.status='needs-review';
  else lesson.status=lesson.validation.countsVerified?'validated':'captured';
  return lesson;
}
export function lessonUrl(value:string, base:string) {
  const u=new URL(value,base), origin=new URL(base).origin;
  if (u.origin!==origin || !/^\/fa\/lesson\/\d+\/?$/.test(u.pathname) || u.username || u.password) throw new Error('INVALID_LESSON_URL');
  return u.origin+u.pathname.replace(/\/$/,'');
}
export function safeCode(error:unknown) {
  const s=error instanceof Error?error.message:'';
  return /^[A-Z][A-Z0-9_]{2,100}$/.test(s)?s:'BROWSER_OR_NETWORK_ERROR';
}
