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

  // —— 分配复用池：消除每帧排序的数组分配（长时间运动 / 拖拽时的 GC 抖动 → 越来越卡的根因）——
  // scratch* 仅在单次排序内用作暂存，跨帧复用；内容每次被完整覆写（counts0 是累加器，需先清零）。
  let scratchSizeList = null;   // Int32Array(vertexCount)
  let scratchN = 0;
  let scratchCounts0 = null;    // Uint32Array(65536)
  let scratchStarts0 = null;    // Uint32Array(65536)
  // depthIndex 结果 buffer 复用：主线程上传到 GPU 后把 ArrayBuffer transfer 回来，收进这里下次复用。
  // 正常在途最多 1~2 个；上限做个兜底防止意外无界增长。
  const freeDepthBuffers = [];
  function acquireDepthIndex(n) {
    const needBytes = n * 4;
    while (freeDepthBuffers.length) {
      const buf = freeDepthBuffers.pop();
      if (buf.byteLength === needBytes) return new Uint32Array(buf);  // 尺寸符 → 复用（内容随后被完整覆写）
      // 尺寸不符（换了模型 → vertexCount 变）→ 丢弃让 GC 回收
    }
    return new Uint32Array(n);
  }

  function runSort(viewProj) {
    if (!positions) return;
    if (!viewProj) return;
    const sortStart = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    // 是否需要排序完全由外层 seq/pump 决定（见 self.onmessage 与 pump）：只有 view 的深度投影行
    // (viewProj[2/6/10]) 变化、或带 motion 时 time 变化、或排序策略 / motion 模式切换，才会推进 viewSeq
    // 从而触发排序。因此这里不再自行判 skip —— 被调用即执行一次真实排序（静止/暂停场景根本不会进入此函数）。

    let maxDepth = -Infinity;
    let minDepth = Infinity;
    // 复用暂存（内容随后被完整覆写，无需清零）；仅在 vertexCount 变化时重建。
    if (!scratchSizeList || scratchN !== vertexCount) { scratchSizeList = new Int32Array(vertexCount); scratchN = vertexCount; }
    const sizeList = scratchSizeList;
    // 注意: 这里不要再声明 hasMotion 同名 const, 会跟外层 hasMotion 撞 TDZ -> 整个
    // runSort 抛 ReferenceError -> worker 永远不出 depthIndex -> 黑屏.
    const applyMotion = useMotionEvolvedSort && motion && trbfCenter;
    for (let i = 0; i < vertexCount; i++) {
      let x = positions[3 * i + 0], y = positions[3 * i + 1], z = positions[3 * i + 2];
      if (applyMotion) {
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
      const depthIndex = acquireDepthIndex(vertexCount);
      for (let i = 0; i < vertexCount; i++) depthIndex[i] = i;
      lastProj = viewProj;
      const sortMs = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - sortStart;
      self.postMessage({ depthIndex, viewProj, vertexCount, sortMs, time: currentTime }, [depthIndex.buffer]);
      return;
    }

    let depthInv = (256 * 256) / (maxDepth - minDepth);
    // counts0 是累加器 → 复用前必须清零；starts0 下面被两分支之一完整覆写 → 复用不必清零。
    if (!scratchCounts0) scratchCounts0 = new Uint32Array(256 * 256); else scratchCounts0.fill(0);
    const counts0 = scratchCounts0;
    for (let i = 0; i < vertexCount; i++) {
      // 桶下标必须落在 [0, 65535]。最远点 depth==maxDepth 时原式得 65536（越界 → counts0/starts0
      // 越界读写被静默忽略 → 该点漏计漏放 → total<vertexCount → 复用的 depthIndex 末尾留旧值 → 最近端
      // 渲染出错帧的残留点）。故 clamp 到 65535；同时 clamp 下界 0 防浮点误差致 depth<minDepth 出负下标。
      sizeList[i] = Math.max(0, Math.min(65535, ((sizeList[i] - minDepth) * depthInv) | 0));
      counts0[sizeList[i]]++;
    }

    if (!scratchStarts0) scratchStarts0 = new Uint32Array(256 * 256);
    const starts0 = scratchStarts0;
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

    const depthIndex = acquireDepthIndex(vertexCount);
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
    // 回传本次排序所用的 4D time：主线程据此让 shader 渲染「与当前深度顺序对应的那一刻时间」，
    // 使异步排序的延迟只体现为动画整体略晚，而深度顺序始终与所显示的几何一致。
    self.postMessage({ depthIndex, viewProj, vertexCount, sortMs, time: currentTime }, [depthIndex.buffer]);
  }

  // —— 排序调度：seq + 「泵」+ MessageChannel 立即宏任务 ——
  // viewSeq 只在「排序相关输入」真正变化时推进；sortedSeq 记录已排到哪个 seq。
  // pump() 同步排一次「当前最新」视图，然后把继续排序的机会让回事件循环——但用 MessageChannel 的
  // 宏任务（不被浏览器钳到 ~4ms 的 setTimeout(0)）。让出期间 worker 仍会处理主线程新来的 {view,time}
  // 消息（它们也是宏任务，会与泵交错执行），所以：不忙等、不饿死消息队列，运动时排序几乎背靠背、延迟更低。
  let viewSeq = 0;
  let sortedSeq = -1;
  let pumpScheduled = false;

  function pump() {
    pumpScheduled = false;
    if (!viewProj || !positions) return;
    if (sortedSeq === viewSeq) return;          // 无更新输入 → 不空转（静止 / 暂停场景直接跳过）
    const seq = viewSeq;
    runSort(viewProj);                          // 同步排序当前最新视图
    sortedSeq = seq;
    if (viewSeq !== sortedSeq) schedulePump();  // 让出期间又有更新 → 继续泵，保证收敛到最新
  }

  let schedulePump;
  if (typeof MessageChannel !== 'undefined') {
    const pumpChan = new MessageChannel();
    pumpChan.port1.onmessage = pump;            // 赋值 onmessage 即隐式 start 端口
    schedulePump = () => { if (!pumpScheduled) { pumpScheduled = true; pumpChan.port2.postMessage(0); } };
  } else {
    // 兜底：无 MessageChannel 时退回 setTimeout(0)
    schedulePump = () => { if (!pumpScheduled) { pumpScheduled = true; setTimeout(pump, 0); } };
  }

  // viewProj[2/6/10] 是唯一影响深度排序的行（depth = vp[2]x + vp[6]y + vp[10]z），只比这三个分量即可。
  function depthRowChanged(a, b) {
    if (!a || !b) return true;
    const dx = a[2] - b[2], dy = a[6] - b[6], dz = a[10] - b[10];
    return (dx * dx + dy * dy + dz * dz) >= 0.0001;  // 与旧 skip 的 hypot < 0.01 同阈值
  }

  self.onmessage = (e) => {
    if (e.data.returnedDepthBuffer) {
      // 主线程上传完 depthIndex 后 transfer 回来的 ArrayBuffer：收进空闲池下次复用（消除每帧结果分配）。
      // 只 push 不立即用 —— 排序是同步的，不会与在途 buffer 冲突；上限兜底防意外无界增长。
      freeDepthBuffers.push(e.data.returnedDepthBuffer);
      if (freeDepthBuffers.length > 4) freeDepthBuffers.shift();
      return;
    }
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
      if (sortStrategy !== newStrategy) {
        sortStrategy = newStrategy;
        viewSeq++;                                 // 策略变（前后 / 后前）→ 强制重排
        if (viewProj && positions) schedulePump();
      }
    } else if (e.data.view) {
      // E5: 每帧的 time 跟着 view 一起送过来；motion-evolved sort 需要它。
      const v = e.data.view;
      const t = (typeof e.data.time === 'number' && Number.isFinite(e.data.time)) ? e.data.time : currentTime;
      const timeMatters = useMotionEvolvedSort && hasMotion;   // 3DGS / 非 motion-evolved 时 time 不影响排序
      const changed = depthRowChanged(v, viewProj) || (timeMatters && t !== currentTime);
      viewProj = v;
      currentTime = t;
      if (changed) { viewSeq++; schedulePump(); }  // 静止（view 深度行 + time 均未变）→ 不推进 → pump 跳过，不空转
    } else if (typeof e.data.time === 'number' && Number.isFinite(e.data.time)) {
      // 单独的 time 更新（如 __holoDebug.setTime，view 不变）：仅在带 motion 时才影响排序
      const timeMatters = useMotionEvolvedSort && hasMotion;
      const changed = timeMatters && e.data.time !== currentTime;
      currentTime = e.data.time;
      if (changed && viewProj) { viewSeq++; schedulePump(); }
    } else if (typeof e.data.useMotionEvolvedSort === 'boolean') {
      if (useMotionEvolvedSort !== e.data.useMotionEvolvedSort) {
        useMotionEvolvedSort = e.data.useMotionEvolvedSort;
        viewSeq++;                                 // motion 排序模式切换 → 强制重排
        if (viewProj && positions) schedulePump();
      }
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
