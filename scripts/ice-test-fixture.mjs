import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const root = process.env.SATAKU_3D_AGENT_ROOT || execFileSync('powershell.exe', ['-NoProfile', '-Command',
    "[Environment]::GetEnvironmentVariable('SATAKU_3D_AGENT_ROOT','User')"], { encoding: 'utf8' }).trim();
if (!root) throw new Error('SATAKU_3D_AGENT_ROOT is required for the installed browser test tool');
export const { chromium } = createRequire(path.join(root, 'package.json'))('playwright');
export const launch = () => chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist'] });
export const state = page => page.evaluate(() => window.__pokemonReveal.debug.snapshot());
export const seek = (page, time) => page.evaluate(time => window.__pokemonReveal.debug.seek(time), time);
export async function isolate(page) {
    await page.routeWebSocket(/.*/, client => {
        const upstream = client.connectToServer();
        upstream.onMessage(message => {
            if (typeof message === 'string' && /"type"\s*:\s*"(?:update|full-reload)"/.test(message)) return;
            client.send(message);
        });
    });
}
