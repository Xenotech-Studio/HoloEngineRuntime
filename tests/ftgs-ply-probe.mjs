// Actual loader -> GPU-ready records -> CPU evaluations. No WebGL/CUDA.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { loadPlyFile } from '../src/hooks/usePlyLoader.js';
import { evaluateFtgsRecord } from '../src/utils/ftgsPly.js';

const [source,out]=process.argv.slice(2);
if(!source || !out) throw Error('Usage: node ftgs-ply-probe.mjs SOURCE.ftgs.ply EMPTY_OUTPUT_DIR');
if(new Uint8Array(new Uint32Array([0x01020304]).buffer)[0]!==4) throw Error('Probe output requires a little-endian host');
const bytes=readFileSync(source);
globalThis.fetch=async()=>new Response(bytes);
const t=await loadPlyFile(pathToFileURL(source).href);
const times=[0,.5,1], samples=new Float64Array(times.length*t.gaussianCount*4);
for(let tick=0;tick<times.length;tick++) for(let row=0;row<t.gaussianCount;row++) {
  const result=evaluateFtgsRecord(t,row,times[tick]);
  samples.set([...result.position,result.opacity],4*(tick*t.gaussianCount+row));
}
mkdirSync(out,{recursive:true});
writeFileSync(join(out,'runtime.f32'),Buffer.from(t.buffer.buffer),{flag:'wx'});
writeFileSync(join(out,'evaluations.f64'),Buffer.from(samples.buffer),{flag:'wx'});
const summary={source:basename(source),source_bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),
  gaussian_count:t.gaussianCount,source_format:t.sourceFormat,render_type:t.renderType,representation:t.representation,
  color_encoding:t.colorEncoding,sh_degree:t.shDegree,width:t.width,height:t.height,runtime_bytes:t.buffer.byteLength,
  times,metadata:t.ftgsMetadata};
writeFileSync(join(out,'js-summary.json'),JSON.stringify(summary,null,2),{flag:'wx'});
console.log(JSON.stringify(summary));
