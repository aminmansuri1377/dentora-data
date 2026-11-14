/** Executed in the page. Reads rendered DOM only; never cookies, scripts, snapshots or application globals. */
export function readPage(config) {
  const s=config.selectors;
  const visible=e=>!!e && !e.closest('[hidden],[aria-hidden="true"]') && getComputedStyle(e).display!=='none' && getComputedStyle(e).visibility!=='hidden' && e.getClientRects().length>0;
  const text=e=>e?.innerText?.trim()||'';
  const url=value=>{ try {const u=new URL(value,location.href);return ['https:','http:','data:'].includes(u.protocol)?u.href:null;}catch{return null;} };
  const walk=e=>{
    if(e.nodeType===3) return e.textContent.trim()?{tag:'text',text:e.textContent}:null;
    if(e.nodeType!==1 || ['SCRIPT','STYLE','TEMPLATE','BUTTON','INPUT','TEXTAREA','SELECT'].includes(e.tagName) || e.matches('.quiz-question-tools,.quiz-correct-mascot,[data-extractor-ignore]') || !visible(e)) return null;
    const attributes={};
    for(const key of ['colspan','rowspan','start','dir','lang','title']) if(e.hasAttribute(key)) attributes[key]=e.getAttribute(key);
    if(['VIDEO','AUDIO','CANVAS','IFRAME','OBJECT','EMBED'].includes(e.tagName)) { attributes.unsupportedMedia=e.tagName.toLowerCase(); if(e.getAttribute('src'))attributes.sourceUrl=url(e.getAttribute('src')); }
    if(getComputedStyle(e).backgroundImage?.includes('url('))attributes.unsupportedMedia='css-background';
    const cls=e.className?.baseVal??e.className;
    if(typeof cls==='string') {
      if(/tigo-warn/.test(cls)) attributes.tone='warning';
      else if(/tigo-note/.test(cls)) attributes.tone='note';
    }
    if(e.tagName==='IMG') return {tag:'img',src:url((e.currentSrc&&!e.currentSrc.startsWith('data:')?e.currentSrc:null)||e.getAttribute('data-src')||e.getAttribute('src')||''),alt:e.getAttribute('alt')||'',attributes:{width:e.getAttribute('width')||'',height:e.getAttribute('height')||''}};
    if(e.tagName==='A') {const href=url(e.getAttribute('href'));if(href&&!href.startsWith('data:'))attributes.href=href;}
    // Preserve inline educational diagrams, never their event handlers or scripts.
    for(const key of ['viewBox','d','fill','stroke','stroke-width','points','cx','cy','r','x','y','width','height','x1','y1','x2','y2']) if(e.namespaceURI==='http://www.w3.org/2000/svg' && e.hasAttribute(key)) attributes[key]=e.getAttribute(key);
    return {tag:e.tagName.toLowerCase(),attributes,children:[...e.childNodes].map(walk).filter(Boolean)};
  };
  const content=e=>e?[...e.childNodes].map(walk).filter(Boolean):[];
  const done=document.querySelector(s.completion), root=[...document.querySelectorAll(s.slide)].find(visible);
  const f=document.querySelector(s.feedback), action=document.querySelector(s.action);
  const feedback=visible(f)?text(f):'';
  const base={url:location.origin+location.pathname,title:document.title,content:[],prompt:'',questionId:null,questionType:'unknown',options:[],action:text(action),actionEnabled:visible(action)&&!action.disabled,feedback,feedbackContent:feedback?content(f):[],feedbackClass:feedback?f.className:'',progress:document.querySelector(s.progress)?.getAttribute('style')||'',declaredStepId:null,blockers:[]};
  if(visible(done))return {...base,kind:'complete',heading:text(document.querySelector(s.completionHeading))||text(done).slice(0,500)};
  if(!root)return {...base,kind:'unknown',blockers:[...document.querySelectorAll('[role="alert"],.alert,.error-message')].filter(visible).map(text)};
  const prompt=text(root.querySelector(s.prompt));
  const hint=[...root.querySelectorAll('[x-data]')].find(e=>/^questionHint\(/.test(e.getAttribute('x-data')||''));
  const options=[...root.querySelectorAll(s.options)].filter(visible).map((e,i)=>({key:e.getAttribute('data-key')??`position:${i+1}`,position:i+1,text:text(e.querySelector(s.optionText))||text(e),content:content(e.querySelector(s.optionText)||e),correctMarked:e.classList.contains('correct'),wrongMarked:e.classList.contains('wrong'),selected:e.classList.contains('selected')}));
  let questionType='unknown';
  if(options.length>=2 && options.every(o=>!o.key.startsWith('position:')) && !root.querySelector('input[type=checkbox],[role=checkbox]')) questionType='single-choice';
  else if(root.querySelector('input[type=checkbox],[role=checkbox]')) questionType='multiple-choice';
  else if(root.querySelector('input[type=text],textarea')) questionType='text';
  let jumble;
  const pool=root.querySelector('#jumble-tiles'),slots=[...root.querySelectorAll('#jumble-slots .jumble-slot')];
  if(pool&&slots.length) {
    const tiles=[...pool.querySelectorAll('.jumble-tile[data-tile-index]')].map((e,i)=>({key:e.getAttribute('data-tile-index'),position:i+1,text:e.textContent?.trim()||''}));
    if(tiles.length&&tiles.every(t=>/^\d+$/.test(t.key)&&t.text)) {
      questionType='letter-order';
      const revealed=root.querySelector('#jumble-correct-word');
      jumble={tiles,slotCount:slots.length,slotTexts:slots.map(e=>text(e)),correctSlots:slots.every(e=>e.classList.contains('correct')),correctWord:visible(revealed)?text(revealed):''};
    }
  }
  const kind=prompt?'question':root.querySelector(s.theory)?'theory':'unknown';
  return {...base,kind,prompt,questionType,jumble,options,content:content(root),declaredStepId:root.getAttribute('data-step-id')||root.getAttribute('data-id')||root.id||null,questionId:root.getAttribute('data-question-id')||hint?.getAttribute('x-data')?.match(/^questionHint\((\d+)\)/)?.[1]||null};
}

export function readCatalog(config) {
  const s=config.selectors,panel=document.querySelector(s.catalog);
  if(!panel)return null;
  const pill=document.querySelector('button[aria-label^="تخصص فعلی:"]');
  const name=pill?.getAttribute('title')||document.querySelector(s.specialtyTitle)?.textContent?.replace(/✦/g,'').trim()||'';
  const chapters=[...panel.querySelectorAll(s.chapter)];
  const lessons=chapters.flatMap((ch,ci)=>[...ch.querySelectorAll(s.step)].map((step,i)=>{
    const link=step.querySelector('a.path-step__pin'),href=link?.getAttribute('href')||'';
    let url=null;try{const u=new URL(href,location.href);if(u.origin===location.origin&&/^\/fa\/lesson\/\d+\/?$/.test(u.pathname))url=u.origin+u.pathname;}catch{}
    return {id:step.getAttribute('data-lesson-id'),title:link?.getAttribute('aria-label')||'',url,chapterId:ch.getAttribute('data-path-chapter')||`position-${ci+1}`,chapterPosition:ci+1,chapterTitle:ch.querySelector('.path-unit-header__subtitle')?.textContent?.trim()||ch.querySelector('h2')?.textContent?.trim()||'',position:i+1,accessReason:step.getAttribute('data-access-reason')};
  }));
  const digits=(document.querySelector('.learn-strip')?.textContent||'').replace(/[۰-۹٠-٩]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.includes(c)?'۰۱۲۳۴۵۶۷۸۹'.indexOf(c):'٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
  const declared=digits.match(/(\d+)\s*بخش/);
  return {specialtyKey:name,specialtyName:name,lessons,chapterCount:chapters.length,declaredChapterCount:declared?Number(declared[1]):null,nextSpecialtyAvailable:!!document.querySelector(s.nextSpecialty)};
}
