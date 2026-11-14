import type { BrowserContext } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { hash, nodes } from './core.js';
import type { Config, ContentNode } from './types.js';
const extensions:Record<string,string>={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/svg+xml':'svg','image/avif':'avif'};
export class Assets {
  private cache=new Map<string,string>();
  constructor(private context:BrowserContext,private config:Config,private root:string){}
  async collect(content:ContentNode[]) {
    for(const node of nodes(content).filter(n=>n.tag==='img')) {
      delete node.assetError;
      try {
        if(!this.config.downloadImages)throw new Error('DOWNLOAD_DISABLED');
        if(!node.src)throw new Error('IMAGE_URL_MISSING');
        if(this.cache.has(node.src)){node.assetPath=this.cache.get(node.src);continue;}
        let bytes:Buffer,mime:string;
        if(node.src.startsWith('data:')) {
          const m=node.src.match(/^data:(image\/[a-z+]+);base64,([a-zA-Z0-9+/=\s]+)$/);
          if(!m || m[2].length>this.config.maxImageBytes*1.4)throw new Error('DATA_IMAGE_UNSUPPORTED');
          mime=m[1];bytes=Buffer.from(m[2],'base64');
        } else {
          const u=new URL(node.src),base=new URL(this.config.baseUrl);
          if(u.username||u.password||u.protocol!==base.protocol || (u.origin!==base.origin && !this.config.allowAssetHosts.includes(u.hostname)))throw new Error('ASSET_HOST_NOT_ALLOWED');
          // Redirect destinations are never followed automatically with session credentials.
          const response=await this.context.request.get(u.href,{timeout:this.config.timeoutMs,maxRedirects:0});
          try {
            if(!response.ok())throw new Error('IMAGE_HTTP_ERROR');
            if(Number(response.headers()['content-length'])>this.config.maxImageBytes)throw new Error('IMAGE_TOO_LARGE');
            mime=response.headers()['content-type']?.split(';')[0]||'';
            if(!extensions[mime])throw new Error('IMAGE_MIME_UNSUPPORTED');
            bytes=await response.body();
          } finally {await response.dispose();}
        }
        if(bytes.length>this.config.maxImageBytes)throw new Error('IMAGE_TOO_LARGE');
        const extension=extensions[mime!];if(!extension)throw new Error('IMAGE_MIME_UNSUPPORTED');
        const relative=`assets/${hash(bytes.toString('base64'))}.${extension}`;
        await mkdir(path.join(this.root,'assets'),{recursive:true});
        const filename=path.join(this.root,relative);
        // Content-addressed files preserve repeats without re-downloading inside this run.
        const old=await readFile(filename).catch(()=>null);
        if(!old)await writeFile(filename,bytes);
        node.assetPath=relative;this.cache.set(node.src,relative);
      } catch(error) {node.assetError=error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'IMAGE_DOWNLOAD_FAILED';}
    }
  }
}
