import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Page } from 'playwright';
import { Hearts, emptyHearts, fullRefillLabel } from '../src/hearts.js';

const modal='قلب‌های شما تمام شد! موجودی شما: ۱۰۰۰ الماس';
function pageMock(label='پر کردن همه با ۶۰ الماس',disappear=true) {
  let clicked=0;
  return {clicks:()=>clicked,page:{
    locator:()=>({innerText:async()=>clicked&&disappear?'صفحه درس آماده است':modal}),
    getByRole:()=>({all:async()=>[{isVisible:async()=>true,isEnabled:async()=>true,innerText:async()=>label,click:async()=>{clicked++;}}]})
  } as unknown as Page};
}
test('refill matches all-hearts offer at exactly 60, not one-heart or changed price',()=>{
  assert.ok(emptyHearts(modal));assert.ok(fullRefillLabel('پر کردن همه با ۶۰ الماس'));
  assert.ok(fullRefillLabel('پرکردن همه با 60 الماس')===false);
  assert.equal(fullRefillLabel('۱ قلب با ۶ الماس'),false);
  assert.equal(fullRefillLabel('پر کردن همه با ۶۱ الماس'),false);
});
test('one UI purchase spends budget once; a second refill cannot exceed the run ceiling',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'heart-test-'));
  try {
    const h=new Hearts(root,'run',true,60,2500),p=pageMock();
    assert.equal(await h.handle(p.page),true);assert.equal(p.clicks(),1);
    assert.equal(await h.handle(p.page),false);assert.equal(p.clicks(),1);
    const second=pageMock();await assert.rejects(h.handle(second.page),/BUDGET_REACHED/);assert.equal(second.clicks(),0);
    const ledger=JSON.parse(await readFile(path.join(root,'heart-purchases.json'),'utf8'));
    assert.equal(ledger.entries.length,1);assert.equal(ledger.entries[0].status,'ui-confirmed');
  }finally{await rm(root,{recursive:true,force:true});}
});
test('uncertain purchase is reserved and never repeated even in a new run',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'heart-test-'));
  try {
    const p=pageMock(undefined,false);
    await assert.rejects(new Hearts(root,'run',true,120,20).handle(p.page),/UNCERTAIN/);
    assert.equal(p.clicks(),1);
    await assert.rejects(new Hearts(root,'new-run',true,120).handle(p.page),/UNCERTAIN/);
    assert.equal(p.clicks(),1);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('disabled refill and unexpected offer do not spend diamonds',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'heart-test-'));
  try {
    const p=pageMock('پر کردن همه با ۱۲۰ الماس');
    await assert.rejects(new Hearts(root,'run',false,120).handle(p.page),/HEARTS_EMPTY/);
    await assert.rejects(new Hearts(root,'run',true,120).handle(p.page),/BUTTON_UNAVAILABLE/);
    assert.equal(p.clicks(),0);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('missing balance does not block an explicit eligible 60-diamond offer within budget',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'heart-test-'));
  try {
    const p=pageMock();
    Object.assign(p.page,{locator:()=>({innerText:async()=>p.clicks()?'درس':'قلب‌های شما تمام شد!'})});
    assert.equal(await new Hearts(root,'run',true,60,2500).handle(p.page),true);assert.equal(p.clicks(),1);
    const ledger=JSON.parse(await readFile(path.join(root,'heart-purchases.json'),'utf8'));
    assert.equal(ledger.entries[0].balanceBefore,null);
  }finally{await rm(root,{recursive:true,force:true});}
});
