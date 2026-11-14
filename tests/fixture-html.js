export const fixture=`<!doctype html><meta charset="utf-8"><title>درس آزمایشی</title>
<style>.slide{display:block}.hidden{display:none}#completion-screen{display:none}img{width:30px;height:30px}.feedback{min-height:20px}</style>
<div id="saveTipCard"><button onclick="this.parentElement.remove()">متوجه شدم</button></div>
<div id="slides-container"></div><span id="progress-bar-inner"></span><div id="feedback-msg"></div><button id="action-btn">ادامه</button><div id="completion-screen"><h1 id="completion-heading">پایان درس</h1></div>
<script>
let cursor=0, selected=null, reviewed=false, tipped=false;
const steps=[...Array.from({length:10},(_,i)=>({type:'theory',id:i})),...Array.from({length:5},(_,i)=>({type:'question',id:i})),...Array.from({length:5},(_,i)=>({type:'question',id:i,repeat:true}))];
function render(){let s=steps[cursor];document.querySelector('#feedback-msg').textContent='';selected=null;reviewed=false;
 if(!s){document.querySelector('#slides-container').innerHTML='';document.querySelector('#completion-screen').style.display='block';fetch('/finished');return;}
 document.querySelector('#progress-bar-inner').style.width=cursor*5+'%';
 document.querySelector('#action-btn').textContent=s.type==='theory'?'ادامه':'بررسی';document.querySelector('#action-btn').disabled=s.type==='question';
 if(s.type==='theory')document.querySelector('#slides-container').innerHTML='<div class="slide active"><h1>صفحه '+s.id+'</h1><div class="theory-body"><p>قبل عکس <strong>واژه مهم</strong></p><figure><img src="/diagram.png" alt="شکل آموزشی"><figcaption>توضیح شکل</figcaption></figure><p>بعد عکس</p><ul><li>مورد اول</li><li>مورد دوم</li></ul><table><tr><td>سلول جدول</td></tr></table></div></div>';
 else {const opts=s.repeat?['درست','غلط']:['غلط','درست'];document.querySelector('#slides-container').innerHTML='<div class="slide active"><div class="question-text">سؤال '+s.id+'؟</div><div class="quiz-question-tools"><div x-data="questionHint('+(100+s.id)+')"><button>راهنما</button><img src="/decoration.png"></div></div><div class="options">'+opts.map((t,i)=>'<div class="option-wrapper" data-key="'+i+'" onclick="choose('+i+')"><div class="option-text">'+t+'</div></div>').join('')+'</div></div>';}
}
function choose(i){if(reviewed)return;selected=i;document.querySelectorAll('.option-wrapper').forEach((e,n)=>e.classList.toggle('selected',n===i));document.querySelector('#action-btn').disabled=false;}
document.querySelector('#action-btn').onclick=()=>{
 if(!tipped){tipped=true;let tip=document.createElement('div');tip.id='hlTip';tip.innerHTML='<button onclick="this.parentElement.remove()">متوجه شدم</button>';document.body.append(tip);return;}
 const s=steps[cursor];if(!s)return;
 if(s.type==='theory'||reviewed){cursor++;render();return;}
 if(selected===null)return;document.querySelector('#action-btn').disabled=true;
 setTimeout(()=>{reviewed=true;document.querySelectorAll('.option-wrapper').forEach((e,i)=>{e.classList.add('disabled');if(e.textContent==='درست')e.classList.add('correct');else if(i===selected)e.classList.add('wrong');});document.querySelector('#feedback-msg').innerHTML='<strong>نکته پاسخ</strong><p>توضیح سؤال '+s.id+'</p>';document.querySelector('#action-btn').textContent='ادامه';document.querySelector('#action-btn').disabled=false;},450);
};render();
</script>`;
