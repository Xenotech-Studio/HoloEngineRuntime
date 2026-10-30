import { readFileSync } from 'node:fs';
import { parseKiriV, evaluateKiriVRecord } from '../src/utils/kiriv.js';
import { vertexShaderSource } from '../src/shaders/splatShaders.js';
const request=JSON.parse(readFileSync(process.argv[2],'utf8'));
const files=[];
for (const item of request.files) {
  const texture=parseKiriV(readFileSync(item.path));
  files.push({path:item.path,header:texture.kirivHeader,records:item.rows.map(row=>{
    const a=texture.buffer.subarray(row*128,row*128+74);
    const sigma=a[12]/(texture.representation==='freetimegs'?Math.SQRT2:1);
    const times=[0,0.5,1,a[11],a[11]-sigma,a[11]+sigma,a[11]+10*sigma];
    return {row,record:[...a],samples:times.map(time=>({time,...evaluateKiriVRecord(a,texture.representation,time,texture.opacityFloor)}))};
  })});
}
// Execute the actual shader's scalar SH assignments as JS doubles (CPU only).
// This checks constants/signs/order from shipped GLSL, not a separate JS copy.
const assignments=[...vertexShaderSource.matchAll(/b\[\d+\]\s*=[^;]+;/g)].map(m=>m[0]).join('\n');
if(assignments.split(';').length!==17) throw Error('Unexpected shader SH assignment count');
const bases=new Function('x','y','z',`const z2=z*z,b=[];${assignments};return b;`);
console.log(JSON.stringify({files,shader_bases:request.directions.map(d=>bases(...d))}));
