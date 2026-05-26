// Depth sorting Worker 代码
// 这个文件包含 Worker 的代码，会被转换为 Blob URL

function createWorker(self) {
  let lastProj;
  let positions;        // [N×3] static xyz fp32 (from u32[0..2] uintBitsToFloat)
  let motion;           // [N×9] motion polynomial coefficients (fp32 decoded from packed half2x16)
  let trbfCenter;       // [N] trbf center fp32 (decoded from half2x16 low half of u32[15])
  let hasMotion = false; // 是否有非零 motion (3DGS 全 0, 4DGS 非 0). 决定是否每帧 re-sort.
  let currentTime = 0.5; // 4DGS frozen time; updated each frame via postMessage
  let useMotionEvolvedSort = true; // E5: sort by motion-evolved positions (not static_xyz)
  let viewProj;
  let vertexCount;
  let lastVertexCount = 0;
  let sortRunning = false;
  let sortStrategy = 'back-to-front';
  let lastSortStrategy = 'back-to-front';
  let enableDebugLogs = false;

  // half-float (IEEE 754 binary16) decoder. Same convention as GLSL unpackHalf2x16.
  function halfBitsToFloat(h) {
    const s = (h & 0x8000) >> 15;
    const e = (h & 0x7C00) >> 10;
    const f = h & 0x03FF;
    if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
    if (e === 31) return f ? NaN : ((s ? -1 : 1) * Infinity);
    return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
  }

  let lastSortedTime = NaN;

  function runSort(viewProj, forceSort = false) {
    if (!positions) return;
    if (!viewProj) return;
    const sortStart = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const strategyChanged = lastSortStrategy !== sortStrategy;
    // E5: motion-evolved sort 下 evolved 位置每帧都不同 (time 变 → motion poly 评估变),
    // 即便 view 完全静止也必须 re-sort. 不走 skip 路径.
    const motionAnimating = useMotionEvolvedSort && motion && hasMotion;
    const timeChanged = motionAnimating && lastSortedTime !== currentTime;
    if (!forceSort && !strategyChanged && !timeChanged && !motionAnimating && lastVertexCount === vertexCount && lastProj) {
      let dist = Math.hypot(...[2, 6, 10].map((k) => lastProj[k] - viewProj[k]));
      if (dist < 0.01) {
        if (enableDebugLogs) console.log('[depthWorker] 跳过排序：view矩阵变化太小且策略 / 时间未改变');
        return;
      }
    } else {
      if (strategyChanged || forceSort) {
        if (enableDebugLogs) console.log('[depthWorker] 排序策略改变或强制排序，重新排序:', lastSortStrategy, '->', sortStrategy, 'forceSort:', forceSort);
        lastSortStrategy = sortStrategy;
      }
      if (lastVertexCount !== vertexCount) lastVertexCount = vertexCount;
    }

    let maxDepth = -Infinity;
    let minDepth = Infinity;
    let sizeList = new Int32Array(vertexCount);
    const hasMotion = useMotionEvolvedSort && motion && trbfCenter;
    for (let i = 0; i < vertexCount; i++) {
      let x = positions[3 * i + 0], y = positions[3 * i + 1], z = positions[3 * i + 2];
      if (hasMotion) {
        // E5: 加上 motion polynomial 给出的当前 t 下的位置。每帧重算保持跟 STG CUDA
        // rasterizer 同款 motion-evolved 排序。
        // 索引: motion[9i+0..2]=linear (motion_0..2), [3..5]=quadratic (motion_3..5),
        //       [6..8]=cubic (motion_6..8). 与 shader 中 tpos 公式 (line 48) 对应.
        const dt = currentTime - trbfCenter[i];
        const dt2 = dt * dt;
        const dt3 = dt2 * dt;
        const b = 9 * i;
        x += motion[b + 0] * dt + motion[b + 3] * dt2 + motion[b + 6] * dt3;
        y += motion[b + 1] * dt + motion[b + 4] * dt2 + motion[b + 7] * dt3;
        z += motion[b + 2] * dt + motion[b + 5] * dt2 + motion[b + 8] * dt3;
      }
      let depth = ((viewProj[2] * x + viewProj[6] * y + viewProj[10] * z) * 4096) | 0;
      sizeList[i] = depth;
      if (depth > maxDepth) maxDepth = depth;
      if (depth < minDepth) minDepth = depth;
    }

    if (sortStrategy === 'none') {
      let depthIndex = new Uint32Array(vertexCount);
      for (let i = 0; i < vertexCount; i++) depthIndex[i] = i;
      lastProj = viewProj;
      const sortMs = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - sortStart;
      self.postMessage({ depthIndex, viewProj, vertexCount, sortMs }, [depthIndex.buffer]);
      return;
    }

    let depthInv = (256 * 256) / (maxDepth - minDepth);
    let counts0 = new Uint32Array(256 * 256);
    for (let i = 0; i < vertexCount; i++) {
      sizeList[i] = ((sizeList[i] - minDepth) * depthInv) | 0;
      counts0[sizeList[i]]++;
    }

    let starts0 = new Uint32Array(256 * 256);
    let total = 0;
    if (sortStrategy === 'front-to-back') {
      for (let i = 0; i < 256 * 256; i++) {
        starts0[i] = total;
        total += counts0[i];
      }
    } else if (sortStrategy === 'back-to-front') {
      for (let i = 256 * 256 - 1; i >= 0; i--) {
        starts0[i] = total;
        total += counts0[i];
      }
    }

    let depthIndex = new Uint32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) {
      const depthBucket = sizeList[i];
      depthIndex[starts0[depthBucket]++] = i;
    }

    lastProj = viewProj;
    lastSortStrategy = sortStrategy;
    lastSortedTime = currentTime;
    const sortMs = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - sortStart;
    if (enableDebugLogs) {
      console.log('[depthWorker] 排序完成，发送结果:', { sortStrategy, vertexCount, depthIndexLength: depthIndex.length, sortMs });
    }
    self.postMessage({ depthIndex, viewProj, vertexCount, sortMs }, [depthIndex.buffer]);
  }

  const throttledSort = () => {
    if (!sortRunning && viewProj && positions) {
      sortRunning = true;
      let lastView = viewProj;
      runSort(lastView);
      setTimeout(() => {
        sortRunning = false;
        if (lastView !== viewProj && viewProj && positions) throttledSort();
      }, 0);
    }
  };

  self.onmessage = (e) => {
    if (e.data.texture) {
      let texture = e.data.texture;
      // lite: 16 u32/gauss; hp_scale_rot: 32 u32/gauss. xyz 始终位于每个 gauss 的前 3 个 fp32（u32[0..2]）。
      const strideU32 = (e.data.gaussStridePixels ? e.data.gaussStridePixels : 4) * 4;
      if (e.data.vertexCount !== undefined && e.data.vertexCount !== null) {
        vertexCount = e.data.vertexCount;
      } else {
        vertexCount = Math.floor((texture.byteLength - (e.data.remaining || 0)) / 4 / strideU32);
      }
      positions = new Float32Array(vertexCount * 3);
      // E5: 同时解出 motion + trbf_center，给 motion-evolved depth sort 用。
      // 这块解码是 one-shot, 后续每帧 sort 只读这两个数组。
      motion = new Float32Array(vertexCount * 9);
      trbfCenter = new Float32Array(vertexCount);
      const u32view = new Uint32Array(texture.buffer);
      for (let i = 0; i < vertexCount; i++) {
        const base = strideU32 * i;
        positions[3 * i + 0] = texture[base + 0];
        positions[3 * i + 1] = texture[base + 1];
        positions[3 * i + 2] = texture[base + 2];
        // motion: u32[8..12] = pack_half2x16 of motion_0..motion_8 + pad
        const m8 = u32view[base + 8], m9 = u32view[base + 9], m10 = u32view[base + 10],
              m11 = u32view[base + 11], m12 = u32view[base + 12];
        const mb = 9 * i;
        motion[mb + 0] = halfBitsToFloat(m8 & 0xFFFF);
        motion[mb + 1] = halfBitsToFloat(m8 >>> 16);
        motion[mb + 2] = halfBitsToFloat(m9 & 0xFFFF);
        motion[mb + 3] = halfBitsToFloat(m9 >>> 16);
        motion[mb + 4] = halfBitsToFloat(m10 & 0xFFFF);
        motion[mb + 5] = halfBitsToFloat(m10 >>> 16);
        motion[mb + 6] = halfBitsToFloat(m11 & 0xFFFF);
        motion[mb + 7] = halfBitsToFloat(m11 >>> 16);
        motion[mb + 8] = halfBitsToFloat(m12 & 0xFFFF);
        // trbf: u32[15] low half = trbf_center, high half = exp(trbf_scale) (not needed for sort)
        trbfCenter[i] = halfBitsToFloat(u32view[base + 15] & 0xFFFF);
      }
      // 一次性扫描判定: motion 是否非零. 3DGS splatv u32[8..15] 全 0, 不必每帧 re-sort.
      hasMotion = false;
      for (let k = 0; k < motion.length; k++) {
        if (motion[k] !== 0) { hasMotion = true; break; }
      }
    } else if (e.data.vertexCount) {
      vertexCount = e.data.vertexCount;
    } else if (e.data.enableDebugLogs !== undefined) {
      enableDebugLogs = e.data.enableDebugLogs === true;
    } else if (e.data.sortStrategy) {
      const newStrategy = e.data.sortStrategy || 'back-to-front';
      const strategyChanged = sortStrategy !== newStrategy;
      if (enableDebugLogs) console.log('[depthWorker] 收到排序策略更新:', newStrategy, '当前:', sortStrategy, '改变:', strategyChanged);
      const oldStrategy = sortStrategy;
      sortStrategy = newStrategy;
      if (viewProj && positions) {
        if (enableDebugLogs) console.log('[depthWorker] 立即触发重新排序');
        if (!sortRunning) {
          sortRunning = true;
          lastSortStrategy = oldStrategy;
          runSort(viewProj, true);
          setTimeout(() => { sortRunning = false; }, 0);
        } else {
          lastSortStrategy = oldStrategy;
        }
      } else {
        lastSortStrategy = oldStrategy;
      }
    } else if (e.data.view) {
      viewProj = e.data.view;
      // E5: 每帧的 time 跟着 view 一起送过来。motion-evolved sort 需要 it.
      if (typeof e.data.time === 'number' && Number.isFinite(e.data.time)) {
        currentTime = e.data.time;
      }
      throttledSort();
    } else if (typeof e.data.time === 'number' && Number.isFinite(e.data.time)) {
      // 单独的 time 更新 (eg setTime 但 view 不变): 重新触发 sort 因 evolved positions 变化
      currentTime = e.data.time;
      if (viewProj) throttledSort();
    } else if (typeof e.data.useMotionEvolvedSort === 'boolean') {
      useMotionEvolvedSort = e.data.useMotionEvolvedSort;
      if (viewProj && positions) throttledSort();
    }
  };
}

/**
 * 创建深度排序 Worker
 */
export function createDepthWorker() {
  const workerCode = `(${createWorker.toString()})(self);`;
  const blob = new Blob([workerCode], { type: 'application/javascript' });
  return new Worker(URL.createObjectURL(blob));
}
