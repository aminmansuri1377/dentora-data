import type { Jumble } from './types.js';

export function normalizeWord(value:string):string {
  return value.normalize('NFC').replace(/ي|ى/g,'ی').replace(/ك/g,'ک').replace(/[\s\u200c\u200d\u0640\u064b-\u065f]/g,'');
}
/** Plausible whole words from supplied source text, filtered by exact tile counts. */
export function letterCandidates(value:string,jumble:Jumble):string[] {
  const found=new Set<string>();
  for(const token of value.match(/[\p{L}\p{M}\u200c]+/gu)??[]) {
    try{letterPlan(token,jumble);found.add(normalizeWord(token));}catch{/* Not a usable source word. */}
  }
  return [...found].sort().slice(0,20);
}
/** Match repeated letters to distinct tile identities; never reuse a tile. */
export function letterPlan(answer:string,jumble:Jumble):string[] {
  const word=Array.from(normalizeWord(answer));
  if(!word.length||word.length!==jumble.slotCount)throw new Error('LETTERS_LENGTH_MISMATCH');
  if(new Set(jumble.tiles.map(t=>t.key)).size!==jumble.tiles.length||jumble.tiles.some(t=>!/^\d+$/.test(t.key)||Array.from(normalizeWord(t.text)).length!==1))throw new Error('LETTERS_IDENTITIES_INVALID');
  const available=[...jumble.tiles];
  return word.map(char=>{
    const index=available.findIndex(t=>normalizeWord(t.text)===char);
    if(index<0)throw new Error('LETTERS_NOT_IN_POOL');
    return available.splice(index,1)[0].key;
  });
}
export function parseLetterAnswer(content:string,jumble:Jumble):string {
  let value:unknown;
  try{value=JSON.parse(content);}catch{throw new Error('AI_INVALID_JSON');}
  const tileKeys=(value as {tileKeys?:unknown})?.tileKeys;
  if(tileKeys!==undefined) {
    if(!Array.isArray(tileKeys)||tileKeys.length!==jumble.slotCount||tileKeys.some(k=>typeof k!=='string')||new Set(tileKeys).size!==tileKeys.length)throw new Error('AI_LETTER_CONSTRAINT_VIOLATION');
    const tiles=new Map(jumble.tiles.map(t=>[t.key,t.text]));
    if(tileKeys.some(k=>!tiles.has(k)))throw new Error('AI_LETTER_CONSTRAINT_VIOLATION');
    const answer=tileKeys.map(k=>tiles.get(k)).join('');
    try{letterPlan(answer,jumble);}catch{throw new Error('AI_LETTER_CONSTRAINT_VIOLATION');}
    return normalizeWord(answer);
  }
  const word=(value as {answerText?:unknown})?.answerText;
  if(typeof word!=='string')throw new Error('AI_INVALID_LETTER_ANSWER');
  try{letterPlan(word,jumble);}catch{throw new Error('AI_LETTER_CONSTRAINT_VIOLATION');}
  return normalizeWord(word);
}
export function sourceRevealedWord(value:string,jumble:Jumble):string|null {
  // Accept an explicit source answer field, not an arbitrary word in explanation.
  const stripped=value.trim().replace(/^(?:پاسخ|جواب)\s*(?:صحیح|درست)?\s*[:：]\s*/,'');
  try{letterPlan(stripped,jumble);return normalizeWord(stripped);}catch{return null;}
}
