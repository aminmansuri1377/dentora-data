import type { ContentNode, Lesson } from './types.js';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const tags=new Set('div p span strong b em i u s h1 h2 h3 h4 h5 h6 ul ol li table thead tbody tfoot tr td th caption figure figcaption blockquote br hr sub sup code pre a picture svg path circle rect line polyline polygon ellipse g text'.split(' '));
export function renderNode(n:ContentNode):string {
  if(n.tag==='text'&&n.text!==undefined)return esc(n.text);
  if(n.tag==='img')return n.assetPath?`<figure><img src="../../${esc(n.assetPath)}" alt="${esc(n.alt||'')}"></figure>`:`<p class="warning">تصویر ذخیره نشده: ${esc(n.alt||'')}</p>`;
  const tag=tags.has(n.tag)?n.tag:'div';
  const attributes=Object.entries(n.attributes??{}).filter(([k,v])=>k!=='href'&&k!=='tone'&&!/url\s*\(|javascript:/i.test(v)).map(([k,v])=>` ${esc(k)}="${esc(v)}"`).join('');
  return `<${tag}${attributes}>${(n.children??[]).map(renderNode).join('')}</${tag}>`;
}
export async function writePreview(root:string,lesson:Lesson) {
  const dir=path.join(root,'lessons',lesson.id);await mkdir(dir,{recursive:true});
  const sections=lesson.steps.map(s=>`<section><header>قدم ${s.position} · ${s.kind}</header>${s.content.map(renderNode).join('')}${s.jumble?`<p>نوع سؤال: ساخت کلمه · ${s.jumble.slotCount} خانه</p><p>حروف منبع: ${s.jumble.tiles.map(t=>esc(t.text)).join(' · ')}</p>`:''}${s.answer?`<aside><b>بازخورد منبع · ${esc(s.answer.status)}</b>${s.answer.content.map(renderNode).join('')}<p>پاسخ ثبت‌شده: ${(s.answer.correctText?esc(s.answer.correctText):s.answer.correctOptionTexts.map(esc).join(' / '))||'تأییدنشده'}</p></aside>`:''}</section>`).join('');
  await writeFile(path.join(dir,'preview.html'),`<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline';"><title>${esc(lesson.title)}</title><style>body{font:18px/1.9 Tahoma,sans-serif;max-width:850px;margin:30px auto;padding:16px;background:#f7f5fc;color:#211735}section{background:white;padding:24px;margin:24px 0;border:1px solid #ddd;border-radius:16px}header,aside{background:#eee8fa;padding:12px}img,svg{max-width:100%;height:auto}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:8px}.warning{color:#a20}</style><h1>${esc(lesson.title)}</h1><p>نسخه استخراج‌شده؛ ترجمه یا تأیید علمی انجام نشده است. وضعیت: ${esc(lesson.status)}</p>${sections}</html>`);
}
