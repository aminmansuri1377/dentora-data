import type { Jumble } from './types.js';

export function normalizeWord(value:string):string {
  return value.normalize('NFC').replace(/ي|ى/g,'ی').replace(/ك/g,'ک').replace(/[\s\u200c\u200d\u0640\u064b-\u065f]/g,'');
}
export function wordTiles(jumble:Jumble):boolean {
  return jumble.tiles.some(t=>Array.from(normalizeWord(t.text)).length>1);
}
export function joinTiles(values:string[],jumble:Jumble):string {
  if(!wordTiles(jumble))return normalizeWord(values.join(''));
  return values.map(v=>v.normalize('NFC').replace(/[يى]/g,'ی').replace(/ك/g,'ک').replace(/[\u0640\u064b-\u065f]/g,'').replace(/\s+/g,' ').trim()).join(' ');
}
/** Plausible whole words from supplied source text, filtered by exact tile counts. */
export function letterCandidates(value:string,jumble:Jumble):string[] {
  if(wordTiles(jumble))return [];
  const found=new Set<string>();
  for(const token of value.match(/[\p{L}\p{M}\u200c]+/gu)??[]) {
    try{letterPlan(token,jumble);found.add(normalizeWord(token));}catch{/* Not a usable source word. */}
  }
  return [...found].sort().slice(0,20);
}
/** Match repeated letters to distinct tile identities; never reuse a tile. */
export function letterPlan(answer:string,jumble:Jumble):string[] {
  if(wordTiles(jumble))return wordPlan(answer,jumble);
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
/** Slots count tiles, not characters. Supports repeated words and old joined answers. */
function wordPlan(answer:string,jumble:Jumble):string[] {
  if(!Number.isSafeInteger(jumble.slotCount)||jumble.slotCount<1||jumble.slotCount>64||jumble.tiles.length>128||new Set(jumble.tiles.map(t=>t.key)).size!==jumble.tiles.length||jumble.tiles.some(t=>!/^\d+$/.test(t.key)||!normalizeWord(t.text)))throw new Error('LETTERS_IDENTITIES_INVALID');
  const parts=answer.trim().split(/\s+/).map(normalizeWord);
  if(parts.length===jumble.slotCount) {
    const available=[...jumble.tiles],keys:string[]=[];
    for(const part of parts) {const index=available.findIndex(t=>normalizeWord(t.text)===part);if(index<0)break;keys.push(available.splice(index,1)[0].key);}
    if(keys.length===jumble.slotCount)return keys;
  }
  const joined=normalizeWord(answer),tiles=jumble.tiles.map(t=>({...t,value:normalizeWord(t.text)}));
  const visited=new Set<string>();let states=0;
  const search=(offset:number,used:bigint,keys:string[]):string[]|null=>{
    if(++states>5000)throw new Error('LETTERS_PLAN_TOO_COMPLEX');
    if(keys.length===jumble.slotCount)return offset===joined.length?keys:null;
    const state=`${offset}:${used}`;if(visited.has(state))return null;visited.add(state);
    for(let i=0;i<tiles.length;i++) {
      const bit=1n<<BigInt(i),tile=tiles[i];
      if((used&bit)||!joined.startsWith(tile.value,offset))continue;
      const result=search(offset+tile.value.length,used|bit,[...keys,tile.key]);if(result)return result;
    }
    return null;
  };
  const result=search(0,0n,[]);if(!result)throw new Error('LETTERS_NOT_IN_POOL');return result;
}
function formattedAnswer(answer:string,jumble:Jumble):string {
  const keys=letterPlan(answer,jumble),byKey=new Map(jumble.tiles.map(t=>[t.key,t.text]));
  return joinTiles(keys.map(k=>byKey.get(k)!),jumble);
}
export function parseLetterAnswer(content:string,jumble:Jumble):string {
  let value:unknown;
  try{value=JSON.parse(content);}catch{throw new Error('AI_INVALID_JSON');}
  const tileKeys=(value as {tileKeys?:unknown})?.tileKeys;
  if(tileKeys!==undefined) {
    if(!Array.isArray(tileKeys)||tileKeys.length!==jumble.slotCount||tileKeys.some(k=>typeof k!=='string')||new Set(tileKeys).size!==tileKeys.length)throw new Error('AI_LETTER_CONSTRAINT_VIOLATION');
    const tiles=new Map(jumble.tiles.map(t=>[t.key,t.text]));
    if(tileKeys.some(k=>!tiles.has(k)))throw new Error('AI_LETTER_CONSTRAINT_VIOLATION');
    const answer=joinTiles(tileKeys.map(k=>tiles.get(k)!),jumble);
    try{letterPlan(answer,jumble);}catch{throw new Error('AI_LETTER_CONSTRAINT_VIOLATION');}
    return formattedAnswer(answer,jumble);
  }
  const word=(value as {answerText?:unknown})?.answerText;
  if(typeof word!=='string')throw new Error('AI_INVALID_LETTER_ANSWER');
  try{letterPlan(word,jumble);}catch{throw new Error('AI_LETTER_CONSTRAINT_VIOLATION');}
  return formattedAnswer(word,jumble);
}
export function sourceRevealedWord(value:string,jumble:Jumble):string|null {
  // Accept an explicit source answer field, not an arbitrary word in explanation.
  const stripped=value.trim().replace(/^(?:پاسخ|جواب)\s*(?:صحیح|درست)?\s*[:：]\s*/,'');
  try{return formattedAnswer(stripped,jumble);}catch{return null;}
}
