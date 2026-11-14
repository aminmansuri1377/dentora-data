export function cookieForExport(c) {
  const sameSite={strict:'Strict',lax:'Lax',no_restriction:'None',unspecified:'Lax'}[c.sameSite||'unspecified'];
  return {name:c.name,value:c.value,domain:c.domain,path:c.path,expires:c.session?-1:c.expirationDate,httpOnly:c.httpOnly,secure:c.secure,sameSite,...(c.partitionKey?{partitionKey:c.partitionKey}:{})};
}
export function createExport(cookies, storage, timestamp=new Date().toISOString()) {
  if(storage.origin!=='https://app.dentigoapp.com')throw Error('WRONG_ORIGIN');
  return {format:'dentigo-local-session-v1',exportedAt:timestamp,cookies:cookies.filter(c=>['app.dentigoapp.com','dentigoapp.com'].includes(c.domain.replace(/^\./,''))).map(cookieForExport),origins:[{origin:storage.origin,localStorage:storage.localStorage}],sessionStorage:[{origin:storage.origin,entries:storage.sessionStorage}]};
}
