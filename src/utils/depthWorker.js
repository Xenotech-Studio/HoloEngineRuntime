// Depth sorting Worker 代码
// 这个文件包含 Worker 的代码，会被转换为 Blob URL

function createWorker(self) {
  let lastProj;
  let positions;
  let viewProj;
  let vertexCount;
  let lastVertexCount = 0;
  let sortRunning = false;
  let sortStrategy = 'back-to-front';
  let lastSortStrategy = 'back-to-front';
  let enableDebugLogs = false;

  function runSort(viewProj, forceSort = false) {
    if (!positions) return;
    if (!viewProj) return;
    const strategyChanged = lastSortStrategy !== sortStrategy;
    if (!forceSort && !strategyChanged && lastVertexCount === vertexCount && lastProj) {
      let dist = Math.hypot(...[2, 6, 10].map((k) => lastProj[k] - viewProj[k]));
      if (dist < 0.01) {
        if (enableDebugLogs) console.log('[depthWorker] 跳过排序：view矩阵变化太小且策略未改变');
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
    for (let i = 0; i < vertexCount; i++) {
      let depth =
        ((viewProj[2] * positions[3 * i + 0] + viewProj[6] * positions[3 * i + 1] + viewProj[10] * positions[3 * i + 2]) * 4096) | 0;
      sizeList[i] = depth;
      if (depth > maxDepth) maxDepth = depth;
      if (depth < minDepth) minDepth = depth;
    }

    if (sortStrategy === 'none') {
      let depthIndex = new Uint32Array(vertexCount);
      for (let i = 0; i < vertexCount; i++) depthIndex[i] = i;
      lastProj = viewProj;
      self.postMessage({ depthIndex, viewProj, vertexCount }, [depthIndex.buffer]);
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
    if (enableDebugLogs) {
      console.log('[depthWorker] 排序完成，发送结果:', { sortStrategy, vertexCount, depthIndexLength: depthIndex.length });
    }
    self.postMessage({ depthIndex, viewProj, vertexCount }, [depthIndex.buffer]);
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
      if (e.data.vertexCount !== undefined && e.data.vertexCount !== null) {
        vertexCount = e.data.vertexCount;
      } else {
        vertexCount = Math.floor((texture.byteLength - (e.data.remaining || 0)) / 4 / 16);
      }
      positions = new Float32Array(vertexCount * 3);
      for (let i = 0; i < vertexCount; i++) {
        positions[3 * i + 0] = texture[16 * i + 0];
        positions[3 * i + 1] = texture[16 * i + 1];
        positions[3 * i + 2] = texture[16 * i + 2];
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
      throttledSort();
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
