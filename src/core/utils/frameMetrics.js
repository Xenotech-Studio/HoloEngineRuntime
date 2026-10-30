// Observational timings only. No fences, finishes, readbacks or extra passes.
export class FrameMetrics {
  constructor(gl, interval = 8) {
    this.gl = gl;
    this.interval = interval;
    this.frame = 0;
    this.pool = [];
    this.pending = [];
    this.active = null;
    this.sums = {};
    try { this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'); }
    catch { this.ext = null; }
  }

  add(name, value) {
    if (!Number.isFinite(value) || value < 0) return;
    const bucket = this.sums[name] ||= { sum: 0, count: 0 };
    bucket.sum += value;
    bucket.count++;
  }

  take() {
    const result = {};
    for (const key of ['gpuMs', 'cpuMs', 'submitMs', 'sortRoundTripMs', 'sortWaitMs', 'sortUploadMs']) {
      const b = this.sums[key];
      result[key] = b?.count ? b.sum / b.count : null;
    }
    this.sums = {};
    return result;
  }

  begin() {
    this.frame++;
    const { gl, ext } = this;
    if (!ext) return;
    try {
      if (gl.isContextLost()) { this.disable(); return; }
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        // All outstanding intervals may overlap the disjoint event.
        for (const item of this.pending) gl.deleteQuery(item.query);
        this.pending = [];
        delete this.sums.gpuMs;
        return;
      }
      this.pending = this.pending.filter(item => {
        // Never inspect a query in its issuing frame; RESULT only after AVAILABLE.
        if (item.frame >= this.frame || !gl.getQueryParameter(item.query, gl.QUERY_RESULT_AVAILABLE)) return true;
        const ns = gl.getQueryParameter(item.query, gl.QUERY_RESULT);
        this.add('gpuMs', ns / 1e6);
        this.pool.push(item.query);
        return false;
      });
      if (this.frame % this.interval || this.pending.length >= 3) return;
      // Respect another owner's timer, without changing its query state.
      if (gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) return;
      const query = this.pool.pop() || gl.createQuery();
      if (!query) { this.disable(); return; }
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
      this.active = query;
    } catch { this.disable(); }
  }

  end() {
    if (!this.active) return;
    try {
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.pending.push({ query: this.active, frame: this.frame });
      this.active = null;
    } catch { this.disable(); }
  }

  disable() {
    try {
      if (this.active) this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      for (const q of [...this.pool, ...this.pending.map(p => p.query), this.active]) {
        if (q) this.gl.deleteQuery(q);
      }
    } catch { /* Context loss / unavailable instrumentation must not break drawing. */ }
    this.active = null;
    this.pool = [];
    this.pending = [];
    this.ext = null;
    delete this.sums.gpuMs;
  }

  dispose() { this.disable(); }
}
