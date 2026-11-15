/** Store only a bounded server error summary, never a request body or reasoning trace. */
export function sanitizeAiError(value:string):string {
  let result=value.slice(0,8000).replace(/\b(?:https?|postgres(?:ql)?):\/\/[^\s"'<>]+/gi,'[URL REDACTED]').replace(/data:[^,\s]+,[A-Za-z0-9+/=]+/g,'[IMAGE REDACTED]').replace(/[A-Za-z0-9+/]{80,}={0,2}/g,'[BINARY REDACTED]').replace(/\b(?:Bearer\s+\S+|(?:sk-|sb_secret_)[A-Za-z0-9_-]+)/gi,'[SECRET REDACTED]');
  for(const [key,value] of Object.entries(process.env))if(value&&value.length>=8&&/PASSWORD|SECRET|TOKEN|API_KEY|DATABASE_URL|DIRECT_URL/i.test(key))result=result.split(value).join('[REDACTED]');
  return result.slice(0,1200);
}
export async function aiHttpError(response:Response):Promise<{detail:string;schemaRejected:boolean}> {
  const raw=await response.text();let message='No error summary returned';
  try{const parsed=JSON.parse(raw);if(typeof parsed.error==='string')message=parsed.error;else if(typeof parsed.error?.message==='string')message=parsed.error.message;}catch{message=raw;}
  return {detail:sanitizeAiError(message),schemaRejected:response.status===400&&/grammar|json[ -]?schema|schema.*(?:invalid|unsupported)/i.test(message)};
}
