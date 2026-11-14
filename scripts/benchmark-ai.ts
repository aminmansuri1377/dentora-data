import path from 'node:path';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { runBenchmark } from '../src/benchmark.js';
import { safeCode } from '../src/core.js';
const arg=(name:string,fallback:string)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1]??fallback;};
try {
  let root=path.resolve(arg('--output','output-restorative'));
  if(!existsSync(path.join(root,'catalog.json'))) {
    const dirs=(await readdir(root,{withFileTypes:true})).filter(e=>e.isDirectory()&&e.name.startsWith('specialty-'));
    if(dirs.length!==1)throw new Error('BENCHMARK_SELECT_ONE_SPECIALTY_ROOT');root=path.join(root,dirs[0].name);
  }
  const result=await runBenchmark(root,arg('--model','qwen3-vl:2b-instruct'),Number(arg('--limit','12')));
  if(result.failed)process.exitCode=2;
}catch(error){console.error(JSON.stringify({event:'BENCHMARK_FAILED',error:safeCode(error)}));process.exitCode=1;}
