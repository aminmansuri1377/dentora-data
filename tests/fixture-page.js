import { JSDOM } from 'jsdom';
/** DOM test driver. It intentionally does not claim to be a real browser. */
export class FixturePage {
  constructor(base, fixture, state) {this.base=base;this.fixture=fixture;this.state=state;}
  async goto(url) {
    this.dom?.window.close();
    const home='<button aria-label="تخصص فعلی: آزمایش — تغییر تخصص" title="آزمایش"></button><div id="home-path-panel"><div class="path-chapter-block" data-path-chapter="7"><p class="path-unit-header__subtitle">بخش آزمایشی</p><div class="path-step" data-lesson-id="1" data-access-reason="free"><a class="path-step__pin" aria-label="درس اول" href="/fa/lesson/1">درس</a></div><div class="path-step" data-lesson-id="2" data-access-reason="previous_lesson_required"><a class="path-step__pin" aria-label="درس دوم" href="'+(this.state.finished?'/fa/lesson/2':'javascript:void(0)')+'">درس بعد</a></div></div></div>';
    this.dom=new JSDOM(new URL(url).pathname==='/fa/home'?home:this.fixture,{url,runScripts:'dangerously',pretendToBeVisual:true,beforeParse:window=>{
      window.fetch=async()=>{this.state.finished=true;return {ok:true};};
      window.scrollTo=()=>{};
      Object.defineProperty(window.HTMLElement.prototype,'innerText',{get(){return this.textContent;}});
      window.Element.prototype.getClientRects=function(){let e=this;while(e){if(e.hidden||e.style?.display==='none')return [];e=e.parentElement;}return [{x:0,y:0,width:10,height:10}];};
    }});
  }
  locator(selector){return new FixtureLocator(this,()=>[...this.dom.window.document.querySelectorAll(selector)]);}
  async evaluate(fn,arg){return this.dom.window.eval(`(${fn.toString()})(${JSON.stringify(arg)??''})`);}
  async close(){this.dom?.window.close();}
}
class FixtureLocator {
  constructor(page,resolve){this.page=page;this.resolve=resolve;}
  async innerText(){return this.resolve()[0]?.innerText??'';}
  async count(){return this.resolve().length;}
  async isVisible(){return this.resolve().some(e=>e.getClientRects().length>0);}
  async isEnabled(){return !this.resolve()[0]?.disabled;}
  getByRole(role,{name}){return new FixtureLocator(this.page,()=>this.resolve().flatMap(e=>[...e.querySelectorAll(role==='button'?'button':'*')]).filter(e=>e.textContent.trim()===name));}
  filter({visible}){return new FixtureLocator(this.page,()=>this.resolve().filter(e=>!visible||e.getClientRects().length));}
  nth(i){return new FixtureLocator(this.page,()=>this.resolve().slice(i,i+1));}
  async click(){const e=this.resolve()[0];if(!e)throw Error('FIXTURE_LOCATOR_MISSING');e.click();}
  async scrollIntoViewIfNeeded(){}
  async waitFor(){if(!await this.isVisible())throw Error('FIXTURE_LOCATOR_MISSING');}
}
