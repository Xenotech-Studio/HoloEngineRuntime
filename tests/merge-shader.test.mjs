import test from 'node:test';
import assert from 'node:assert/strict';
import { vertexShaderSource as shader } from '../src/shaders/splatShaders.js';

// Execute actual scalar GLSL expressions on CPU; ordering is asserted separately.
const mix=(a,b,t)=>a*(1-t)+b*t;
const alphaExpression=shader.match(/vColor = vec4\(color, (max\(kv\(10u\)\*topacity, u_kirivOpacityFloor\))\);/);
assert.ok(alphaExpression,'FTGS final alpha expression');
const finalAlpha=new Function('kv','topacity','u_kirivOpacityFloor','max',
  'return '+alphaExpression[1].replace(/10u/g,'10'));

test('merge: FTGS color/alpha override precedes every final-alpha early cull',()=>{
  const override=shader.indexOf('if (u_kiriv) {',shader.indexOf('uint rgba'));
  const ftgsAlpha=shader.indexOf(alphaExpression[0]);
  const depthCull=shader.indexOf('if (depthWriteOnly && vColor.a < centerOpacityThreshold) return;');
  const colorCull=shader.indexOf('if (!depthWriteOnly && colorOnlyPass && vColor.a == 0.0) return;');
  assert.ok(override>=0 && ftgsAlpha>override && depthCull>ftgsAlpha && colorCull>ftgsAlpha);
  // A zero packed alpha must not hide an opaque FTGS center; an opaque packed
  // value must not force a transparent FTGS center into the depth pass.
  const cullDepth=shader.match(/if \((depthWriteOnly && vColor.a < centerOpacityThreshold)\) return;/);
  const cullColor=shader.match(/if \((!depthWriteOnly && colorOnlyPass && vColor.a == 0.0)\) return;/);
  const culled=new Function('vColor','depthWriteOnly','colorOnlyPass','centerOpacityThreshold',
    `return (${cullDepth[1]}) || (${cullColor[1]});`);
  const opaque=finalAlpha(()=>.8,1,.0001,Math.max);
  assert.equal(opaque,.8); assert.equal(culled({a:opaque},true,false,.65),false);
  assert.equal(culled({a:opaque},false,true,.65),false);
  const tail=finalAlpha(()=>.8,0,.0001,Math.max);
  assert.equal(tail,.0001);assert.equal(culled({a:tail},true,false,.65),true);
  assert.equal(culled({a:tail},false,true,.65),false);
});

test('merge: FTGS bypasses temporal cutoff while STG obeys configurable cutoff including default .02',()=>{
  const block=shader.match(/if \(!u_freetimegs\) \{\s*float topacityCull = mix\(1.0, topacity, scaleT\);\s*if \(topacityCull < motionAlphaCutoff\) return;\s*\}/);
  assert.ok(block,'cutoff must be guarded by the FTGS exemption');
  const cull=new Function('u_freetimegs','topacity','scaleT','motionAlphaCutoff','mix',
    block[0].replace('float ','let ').replace('return;','return true;')+';return false;');
  for(const weight of [0,.019,.02,.049,.05,1]) {
    for(const cutoff of [.02,.05]) {
      assert.equal(cull(true,weight,1,cutoff,mix),false);
      assert.equal(cull(false,weight,1,cutoff,mix),weight<cutoff);
      assert.equal(cull(false,weight,0,cutoff,mix),false);
    }
  }
});

test('merge: packed alpha is declared once and before KiriV override',()=>{
  for(const declaration of [/uint rgba\s*=/g,/vec4 splat\s*=/g,/float alphaEff\s*=/g])
    assert.equal([...shader.matchAll(declaration)].length,1,String(declaration));
  assert.ok(shader.indexOf('uint rgba =')<shader.indexOf(alphaExpression[0]));
});
