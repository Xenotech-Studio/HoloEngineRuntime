import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../src/core/utils/renderTarget.js', import.meta.url), 'utf8')
  .replace(/^import .*;$/gm, '').replace(/export /g, '');
const context = vm.createContext({ window: {devicePixelRatio:2} });
vm.runInContext(source+'\nthis.Target=CanvasRenderTarget;',context);
const Target=context.Target;
const size=(...args)=>JSON.parse(JSON.stringify(Target.getRenderSize(...args)));

test('SSAA defaults to three, accepts two, and retains edge/pixel caps and host zoom',()=>{
  assert.deepEqual(size(100,100,2),{width:600,height:600});
  assert.deepEqual(size(100,100,2,1,2),{width:400,height:400});
  assert.deepEqual(size(100,100,2,.5,2),{width:200,height:200});
  for(const factor of [3,2]) assert.deepEqual(size(1920,1080,2,1,factor),{width:3861,height:2172});
  assert.deepEqual(size(5000,100,2),{width:4096,height:81});
  for(const factor of [NaN,Infinity,0,-1]) assert.deepEqual(size(100,100,2,1,factor),size(100,100,2));
});
