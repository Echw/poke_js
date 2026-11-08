/** Nonblocking WebGL timer queries. Samples are invalidated on GPU disjoint. */
export class GpuTimer {
    private static readonly current = new WeakMap<WebGL2RenderingContext, GpuTimer>();
    private readonly gl: WebGL2RenderingContext;
    private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    private readonly pending: { query: WebGLQuery; units: number }[] = [];
    private readonly samples: { ms: number; units: number }[] = [];
    private active: { query: WebGLQuery; units: number } | undefined;
    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
        this.ext = import.meta.env.DEV ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
    }
    begin(units = 1): void {
        this.poll();
        if (!this.ext || this.active || this.pending.length >= 24 || GpuTimer.current.has(this.gl)) return;
        const query = this.gl.createQuery();
        if (!query) return;
        this.active = { query, units };
        GpuTimer.current.set(this.gl, this);
        this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    }
    end(): void {
        if (!this.active || !this.ext) return;
        this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
        GpuTimer.current.delete(this.gl);
        this.pending.push(this.active);
        this.active = undefined;
    }
    poll(): void {
        if (!this.ext) return;
        const disjoint = this.gl.getParameter(this.ext.GPU_DISJOINT_EXT);
        while (
            this.pending.length &&
            (disjoint || this.gl.getQueryParameter(this.pending[0].query, this.gl.QUERY_RESULT_AVAILABLE))
        ) {
            const item = this.pending.shift()!;
            if (!disjoint) {
                this.samples.push({
                    ms: this.gl.getQueryParameter(item.query, this.gl.QUERY_RESULT) / 1e6,
                    units: item.units,
                });
                if (this.samples.length > 240) this.samples.shift();
            }
            this.gl.deleteQuery(item.query);
        }
    }
    stats() {
        this.poll();
        const summarize = (values: number[]) => {
            values.sort((a, b) => a - b);
            return {
                median: values.length ? values[Math.floor(values.length / 2)] : null,
                p95: values.length
                    ? values[Math.min(values.length - 1, Math.ceil(values.length * 0.95) - 1)]
                    : null,
            };
        };
        return {
            supported: !!this.ext,
            count: this.samples.length,
            frameMs: summarize(this.samples.map((s) => s.ms)),
            perStepMs: summarize(this.samples.map((s) => s.ms / s.units)),
        };
    }
    clear(): void {
        this.poll();
        for (const item of this.pending) this.gl.deleteQuery(item.query);
        this.pending.length = 0;
        this.samples.length = 0;
    }
    dispose(): void {
        this.end();
        for (const item of this.pending) this.gl.deleteQuery(item.query);
        this.pending.length = 0;
    }
}
