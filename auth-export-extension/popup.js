import { createExport } from './session-format.js';
const button=document.querySelector('#export'),status=document.querySelector('#status');
button.addEventListener('click',async()=>{
  button.disabled=true;status.textContent='در حال آماده‌سازی فایل محلی…';
  try {
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab?.id||!tab.url||new URL(tab.url).origin!=='https://app.dentigoapp.com'){
      status.textContent='ابتدا تب سایت app.dentigoapp.com را فعال کن؛ باید داخل حساب خودت باشی.';return;
    }
    const [{result}]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>({origin:location.origin,localStorage:Object.entries(localStorage).map(([name,value])=>({name,value})),sessionStorage:Object.entries(sessionStorage).map(([name,value])=>({name,value}))})});
    const cookies=await chrome.cookies.getAll({url:'https://app.dentigoapp.com/fa/home'});
    if(!cookies.length){status.textContent='کوکی دنتیگو پیدا نشد. ورود به حساب را در مرورگر معمولی کامل کن.';return;}
    const data=createExport(cookies,result);
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);
    const link=document.createElement('a');link.href=url;link.download='dentigo-auth.json';document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
    status.textContent='فایل dentigo-auth.json ذخیره شد. آن را فقط در پوشه خصوصی auth اسکرپر قرار بده.';
  }catch{status.textContent='خروجی‌گرفتن انجام نشد. تب دنتیگو و مجوز همین سایت را بررسی کن.';}
  finally{button.disabled=false;}
});
