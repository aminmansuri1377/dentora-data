import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import type { Page } from 'playwright';
import { readJson, writeJson } from './storage.js';

export function normalizePersian(value:string):string {
  return value.replace(/[۰-۹٠-٩]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.includes(c)?'۰۱۲۳۴۵۶۷۸۹'.indexOf(c):'٠١٢٣٤٥٦٧٨٩'.indexOf(c)))
    .replace(/ي/g,'ی').replace(/ك/g,'ک').replace(/[‌\s]+/g,' ').trim();
}
export function emptyHearts(text:string):boolean {
  return /قلب های شما تمام شد|برای شروع درس جدید به قلب نیاز دارید/.test(normalizePersian(text));
}
export function fullRefillLabel(text:string):boolean {
  return /^پر کردن همه با 60 الماس$/.test(normalizePersian(text));
}
type Entry={runId:string;at:string;cost:60;status:'pending'|'ui-confirmed';balanceBefore:number|null};
export class Hearts {
  constructor(private output:string,private runId:string,private enabled:boolean,private budget:number,private timeoutMs=30000) {
    if(!Number.isSafeInteger(budget)||budget<0)throw new Error('HEARTS_INVALID_BUDGET');
  }
  async handle(page:Page):Promise<boolean> {
    const body=await page.locator('body').innerText();
    if(!emptyHearts(body))return false;
    if(!this.enabled)throw new Error('HEARTS_EMPTY');
    const file=path.join(this.output,'heart-purchases.json');
    const ledger=await readJson<{version:1;entries:Entry[]}>(file)??{version:1,entries:[]};
    if(ledger.version!==1||!Array.isArray(ledger.entries)||ledger.entries.some(e=>!['pending','ui-confirmed'].includes(e.status)||e.cost!==60))throw new Error('HEARTS_LEDGER_INVALID');
    // Pending means a click might have reached the server: never automatically buy again.
    if(ledger.entries.some(e=>e.status==='pending'))throw new Error('HEARTS_PURCHASE_UNCERTAIN_CHECK_ACCOUNT');
    const spent=ledger.entries.filter(e=>e.runId===this.runId).reduce((n,e)=>n+e.cost,0);
    if(spent+60>this.budget)throw new Error('HEARTS_BUDGET_REACHED');
    const balance=normalizePersian(body).match(/موجودی(?:\s+فعلی)?(?:\s+شما)?\s*[:：]?\s*([0-9]+)\s*الماس/);
    if(!balance)console.warn(JSON.stringify({event:'HEARTS_BALANCE_UNKNOWN',policy:'EXACT_60_DIAMOND_OFFER_AND_EXPLICIT_BUDGET'}));
    if(balance&&Number(balance[1])<60)throw new Error('HEARTS_INSUFFICIENT_DIAMONDS');
    const matches=[];
    for(const button of await page.getByRole('button').all()) {
      if(await button.isVisible()&&fullRefillLabel(await button.innerText()))matches.push(button);
    }
    if(matches.length!==1||!await matches[0].isEnabled())throw new Error('HEARTS_REFILL_BUTTON_UNAVAILABLE');
    const entry:Entry={runId:this.runId,at:new Date().toISOString(),cost:60,status:'pending',balanceBefore:balance?Number(balance[1]):null};
    ledger.entries.push(entry);await writeJson(file,ledger);
    console.log(JSON.stringify({event:'HEARTS_REFILL_REQUEST',cost:60,runSpendReserved:spent+60,budget:this.budget}));
    try { await matches[0].click({timeout:this.timeoutMs}); }
    catch { throw new Error('HEARTS_PURCHASE_UNCERTAIN_CHECK_ACCOUNT'); }
    const deadline=Date.now()+this.timeoutMs;
    let disappearedAt=0;
    while(Date.now()<deadline) {
      const updated=await page.locator('body').innerText();
      if(!emptyHearts(updated)) {
        if(!disappearedAt)disappearedAt=Date.now();
        if(Date.now()-disappearedAt>=1000) {
          entry.status='ui-confirmed';await writeJson(file,ledger);
          console.log(JSON.stringify({event:'HEARTS_REFILL_UI_CONFIRMED',cost:60,runSpend:spent+60}));
          return true;
        }
      } else disappearedAt=0;
      await delay(150);
    }
    throw new Error('HEARTS_PURCHASE_UNCERTAIN_CHECK_ACCOUNT');
  }
}
