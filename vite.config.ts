import { defineConfig, normalizePath, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const names = ['gpuSmokeSimulation.ts', 'gpuSmokeShaders.ts', 'smokeBoundary.ts', 'smokeProfile.ts', 'groundEvents.ts'];
const sources = new Map(names.map(name => [name, fileURLToPath(new URL(`./src/effects/${name}`, import.meta.url))]));
const virtualId = 'virtual:smoke-source-hashes';
const resolvedId = `\0${virtualId}`;

/** Keep replay compatibility checks without shipping entire source files in the browser bundle. */
function smokeSourceHashes(): Plugin {
    return {
        name: 'smoke-source-hashes',
        resolveId(id) { if (id === virtualId) return resolvedId; },
        load(id) {
            if (id !== resolvedId) return;
            const hashes = Object.fromEntries([...sources].map(([name, file]) => {
                this.addWatchFile(file);
                return [name, createHash('sha256').update(readFileSync(file, 'utf8').replace(/\r\n?/g, '\n')).digest('hex')];
            }));
            return `export default ${JSON.stringify(hashes)};`;
        },
        handleHotUpdate({ file, server }) {
            if (![...sources.values()].some(source => normalizePath(source) === normalizePath(file))) return;
            const module = server.moduleGraph.getModuleById(resolvedId);
            if (module) server.moduleGraph.invalidateModule(module);
            server.ws.send({ type: 'full-reload' });
        },
    };
}

export default defineConfig({ plugins: [smokeSourceHashes()] });
