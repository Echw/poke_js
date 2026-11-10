import type { SmokeReplayManifest } from './smokeReplayTypes';

type WorkerReply = { header: SmokeReplayManifest; bytes: number; transfers: number[]; cacheHit: boolean }
    | { buffer: ArrayBuffer; decodeMs: number };

const stores = new Map<string, SmokeClipStore>();
let activeStore: SmokeClipStore | undefined;
let downloads = 0;
const waiting: (() => void)[] = [];

async function downloadSlot<T>(task: () => Promise<T>): Promise<T> {
    if (downloads >= 2) await new Promise<void>(resolve => waiting.push(resolve));
    else downloads++;
    try { return await task(); }
    finally { const next = waiting.shift(); if (next) next(); else downloads--; }
}

/** One worker/compressed file per URL; immutable startup segments are shared by Ghost/Fighting. */
export class SmokeClipStore {
    readonly ready: Promise<SmokeReplayManifest>;
    readonly chunks = new Map<number, ArrayBuffer>();
    readonly decodeTimes: number[] = [];
    downloadedBytes = 0;
    transferMs = 0;
    cacheHit = false;
    decodedSegments = 0;
    private references = 0;
    readonly url: string;
    private serial = 0;
    private worker: Worker;
    private disposed = false;
    private wanted = new Set([0, 1]);
    private loads = new Map<number, Promise<ArrayBuffer>>();
    private requests = new Map<number, { resolve: (data: WorkerReply) => void; reject: (error: Error) => void }>();

    static acquire(url: string): SmokeClipStore {
        const key = new URL(url, location.href).href;
        let store = stores.get(key);
        if (!store) { store = new SmokeClipStore(key); stores.set(key, store); }
        store.references++;
        return store;
    }

    private constructor(url: string) {
        this.url = url;
        this.worker = new Worker(new URL('./smokeReplayWorker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = event => {
            const pending = this.requests.get(event.data.id);
            if (!pending) return;
            this.requests.delete(event.data.id);
            if (event.data.error) pending.reject(new Error(event.data.error));
            else pending.resolve(event.data);
        };
        this.worker.onerror = event => {
            for (const pending of this.requests.values()) pending.reject(new Error(event.message));
            this.requests.clear();
        };
        this.ready = downloadSlot(async () => {
            const data = await this.request({ kind: 'init', url });
            if (!('header' in data)) throw new Error('Invalid smoke initialization reply');
            this.downloadedBytes = data.bytes; this.transferMs = data.transfers[0]; this.cacheHit = data.cacheHit;
            return data.header;
        });
    }

    private request(message: Record<string, unknown>): Promise<WorkerReply> {
        if (this.disposed) return Promise.reject(new Error('Smoke store disposed'));
        const id = ++this.serial;
        return new Promise((resolve, reject) => {
            this.requests.set(id, { resolve, reject });
            this.worker.postMessage({ ...message, id });
        });
    }

    /** Only the active source may retain rolling decoded segments, beyond pinned 0/1. */
    activate(chunk: number): void {
        if (activeStore !== this) activeStore?.retainStartup();
        activeStore = this;
        this.wanted = new Set([0, 1, chunk, chunk + 1]);
        this.trim();
    }

    retainStartup(): void { this.wanted = new Set([0, 1]); this.trim(); }
    private trim(): void {
        for (const index of this.chunks.keys()) if (!this.wanted.has(index)) this.chunks.delete(index);
    }

    async load(segment: number): Promise<ArrayBuffer> {
        const cached = this.chunks.get(segment);
        if (cached) return cached;
        const existing = this.loads.get(segment);
        if (existing) return existing;
        const promise = this.request({ segment }).then(data => {
            if (this.disposed) throw new Error('Smoke store disposed');
            if (!('buffer' in data)) throw new Error('Invalid smoke decode reply');
            this.decodeTimes.push(data.decodeMs);
            if (this.decodeTimes.length > 400) this.decodeTimes.shift();
            this.decodedSegments++;
            if (this.wanted.has(segment)) this.chunks.set(segment, data.buffer);
            return data.buffer;
        });
        this.loads.set(segment, promise);
        try { return await promise; } finally { this.loads.delete(segment); }
    }

    release(): void {
        if (--this.references > 0 || this.disposed) return;
        this.disposed = true;
        this.worker.terminate();
        for (const pending of this.requests.values()) pending.reject(new Error('Smoke store disposed'));
        this.requests.clear(); this.loads.clear(); this.chunks.clear();
        stores.delete(this.url);
        if (activeStore === this) activeStore = undefined;
    }
}
