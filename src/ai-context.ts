/** Explicit per-request context budget; keep the fast 8K default. */
export function aiContextSize(value=8192):number {
  if(!Number.isSafeInteger(value)||value<8192||value>32768||value%1024!==0)throw new Error('INVALID_AI_CONTEXT_SIZE');
  return value;
}
