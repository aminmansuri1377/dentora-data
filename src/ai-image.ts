import {readFile,realpath,stat} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

type Prepared={data:string;info:{sourceFormat:string;sourceWidth:number;sourceHeight:number;width:number;height:number;format:'png';bytes:number}};
const cache=new Map<string,Prepared>();
/** AI-only copies in memory. Never overwrite the original educational asset. */
export async function prepareAiImage(root:string,file:string,maxEdge=1280):Promise<Prepared> {
  if(!Number.isSafeInteger(maxEdge)||maxEdge<256||maxEdge>2048)throw new Error('AI_IMAGE_EDGE_INVALID');
  let absolute:string,base:string,size:number,mtime:number;
  try{absolute=await realpath(file);base=await realpath(root);const s=await stat(absolute);size=s.size;mtime=s.mtimeMs;}catch{throw new Error('AI_IMAGE_UNAVAILABLE');}
  if(!absolute.startsWith(base+path.sep))throw new Error('AI_IMAGE_PATH_INVALID');
  if(size>8*1024*1024)throw new Error('AI_IMAGE_TOO_LARGE');
  const key=`${absolute}:${size}:${mtime}:${maxEdge}`;
  const hit=cache.get(key);if(hit){cache.delete(key);cache.set(key,hit);return hit;}
  try {
    const bytes=await readFile(absolute),image=sharp(bytes,{limitInputPixels:40_000_000,failOn:'error'}),meta=await image.metadata();
    if(!['png','jpeg','webp'].includes(meta.format??''))throw new Error('AI_IMAGE_FORMAT_UNSUPPORTED');
    if((meta.pages??1)>1)throw new Error('AI_IMAGE_ANIMATION_UNSUPPORTED');
    const result=await image.rotate().resize({width:maxEdge,height:maxEdge,fit:'inside',withoutEnlargement:true}).png({compressionLevel:3}).toBuffer({resolveWithObject:true});
    if(result.data.length>8*1024*1024)throw new Error('AI_IMAGE_TOO_LARGE');
    const prepared:Prepared={data:result.data.toString('base64'),info:{sourceFormat:meta.format!,sourceWidth:meta.width??0,sourceHeight:meta.height??0,width:result.info.width,height:result.info.height,format:'png',bytes:result.data.length}};
    cache.set(key,prepared);if(cache.size>16)cache.delete(cache.keys().next().value!);
    return prepared;
  }catch(error){if(error instanceof Error&&/^AI_[A-Z_]+$/.test(error.message))throw error;throw new Error('AI_IMAGE_DECODE_FAILED');}
}
