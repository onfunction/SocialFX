// Run with Node.js 18+: node --test tests/spotify-canvas.test.cjs
// Execute the actual editor IIFE in isolation; no CDN, analytics, or live site.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const html = readFileSync(process.env.SOCIALFX_TEST_HTML || join(__dirname, '..', 'index.html'), 'utf8');
const section = html.split('// --- CUSTOM APP LOGIC ---')[1];
assert.ok(section, 'Spotify editor script must exist');
const editor = section.slice(0, section.indexOf('})();') + 5);

function harness(rect = { left: 200, top: 100, width: 720 / 2.7, height: 1280 / 2.7 }) {
    const frames = [], timers = [], draws = [], downloads = [], recorders = [];
    const gradient = { addColorStop() {} };
    const ctx = {
        save() {}, restore() {}, fillRect() {}, createRadialGradient() { return gradient; },
        drawImage(...args) { draws.push({ args, filter: this.filter }); }
    };
    function element() {
        const listeners = new Map(), classes = new Set();
        return {
            style: {}, dataset: {}, value: '1',
            classList: {
                add(...items) { items.forEach(x => classes.add(x)); },
                remove(...items) { items.forEach(x => classes.delete(x)); },
                replace(a, b) { classes.delete(a); classes.add(b); },
                contains(x) { return classes.has(x); }
            },
            addEventListener(type, fn, options) {
                const entries = listeners.get(type) || [];
                entries.push({ fn, options }); listeners.set(type, entries);
            },
            async fire(type, event = {}) {
                event.target ||= this;
                for (const entry of [...(listeners.get(type) || [])]) {
                    if (entry.options?.once) listeners.set(type, listeners.get(type).filter(x => x !== entry));
                    await entry.fn(event);
                }
            },
            click() { downloads.push(this.download); }
        };
    }
    const nodes = new Map();
    const get = id => {
        if (!nodes.has(id)) nodes.set(id, element());
        return nodes.get(id);
    };
    const canvas = get('previewCanvas'), video = get('sourceVideo'), win = element();
    const stream = {};
    let captureRate;
    Object.assign(canvas, {
        getBoundingClientRect: () => rect, getContext: () => ctx,
        captureStream(rate) { captureRate = rate; return stream; }
    });
    Object.assign(video, {
        videoWidth: 1920, videoHeight: 1080, duration: 20,
        play: async () => {}, pause() {}
    });
    Object.defineProperty(video, 'currentTime', {
        get() { return this.time || 0; },
        set(value) { this.time = value; queueMicrotask(() => this.fire('seeked')); }
    });
    get('startTimeSlider').value = '2'; get('durationSlider').value = '3';
    const buttons = ['none', 'sepia(1)', 'leak-warm', 'leak-cool', 'glitch-rgb', 'glitch-slice'].map(val => {
        const button = element();
        button.dataset = { val, type: val.startsWith('leak') || val.startsWith('glitch') ? 'fx' : 'filter' };
        return button;
    });
    class Recorder {
        static isTypeSupported(type) { return type === 'video/webm'; }
        constructor(stream, options) { Object.assign(this, { stream, options }); recorders.push(this); }
        start() { this.started = true; }
        stop() {
            this.stopped = true;
            this.ondataavailable({ data: new Blob(['test recording']) });
            this.onstop();
        }
    }
    const sandbox = {
        window: win, document: {
            getElementById: get, querySelectorAll: () => buttons,
            createElement: element, body: { appendChild() {}, removeChild() {} }
        },
        appMode: 'custom', requestAnimationFrame: fn => frames.push(fn),
        setTimeout: (fn, delay) => timers.push({ fn, delay }),
        Blob, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
        MediaRecorder: Recorder
    };
    // Test-only observation hook inside the closure, without modifying production HTML.
    const exposed = editor.replace(/\}\)\(\);\s*$/, `
        globalThis.inspect = () => ({ panX, panY, scale, lastMouseX, lastMouseY, isDragging, activeFilter, activeFX: [...activeFX], isExporting });
        globalThis.loadVideo = () => { isVideoLoaded = true; };
        globalThis.render = draw;
    })();`);
    vm.runInNewContext(exposed, sandbox, { timeout: 1000 });
    return { sandbox, state: sandbox.inspect, load: sandbox.loadVideo, get, canvas, video, win, rect,
        frames, timers, draws, buttons, downloads, recorders, stream, captureRate: () => captureRate };
}

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
async function move(h, input, type, x, y) {
    const e = input === 'mouse' ? { clientX: x, clientY: y } :
        { touches: [{ clientX: x, clientY: y }], preventDefault() { this.prevented = true; } };
    await (type === 'start' ? h.canvas : h.win).fire(
        input === 'mouse' ? (type === 'start' ? 'mousedown' : 'mousemove') :
            (type === 'start' ? 'touchstart' : 'touchmove'), e);
    if (input === 'touch') assert.equal(e.prevented, true);
}

for (const input of ['mouse', 'touch']) {
    for (const rect of [
        { left: 0, top: 0, width: 720, height: 1280 },
        { left: 200, top: 100, width: 720 / 2.7, height: 1280 / 2.7 },
        { left: -80, top: -120, width: 360, height: 640 },
        { left: 137.5, top: 52.25, width: 300, height: 600 }
    ]) {
        test(`${input}: offset (${rect.left}, ${rect.top}), size ${rect.width}x${rect.height}, successive moves`, async () => {
            const h = harness(rect); h.load();
            const x = rect.left + 30, y = rect.top + 40;
            await move(h, input, 'start', x, y);
            await move(h, input, 'move', x + 10, y + 5);
            close(h.state().panX, 10 * 720 / rect.width);
            close(h.state().panY, 5 * 1280 / rect.height);
            await move(h, input, 'move', x + 20, y - 5);
            close(h.state().panX, 20 * 720 / rect.width);
            close(h.state().panY, -5 * 1280 / rect.height);
            const before = h.state();
            await move(h, input, 'move', x + 20, y - 5);
            close(h.state().panX, before.panX); close(h.state().panY, before.panY);
            close(h.state().lastMouseX, 50 * 720 / rect.width);
            close(h.state().lastMouseY, 35 * 1280 / rect.height);
            await h.win.fire(input === 'mouse' ? 'mouseup' : 'touchend');
            await (input === 'mouse' ? h.win.fire('mousemove', { clientX: 999, clientY: 999 }) :
                h.win.fire('touchmove', { touches: [], preventDefault() {} }));
            close(h.state().panX, before.panX);
            assert.equal(h.state().isDragging, false);
            assert.equal(h.canvas.style.cursor, 'move');
        });
    }
    test(`${input}: coordinates zero and negative remain finite`, async () => {
        const h = harness(); h.load();
        await move(h, input, 'start', 10, 10);
        await move(h, input, 'move', 0, 0);
        close(h.state().panX, -27); close(h.state().panY, -27);
        await move(h, input, 'move', -10, -10);
        close(h.state().panX, -54); close(h.state().panY, -54);
    });
}

test('idle or unloaded input does not pan; missing touch and hidden canvas are safe', async () => {
    const h = harness();
    await h.canvas.fire('mousedown', { clientX: 250, clientY: 150 });
    await h.win.fire('mousemove', { clientX: 260, clientY: 160 });
    assert.equal(h.state().isDragging, false); close(h.state().panX, 0);
    h.load();
    await h.win.fire('mousemove', { clientX: 260, clientY: 160 });
    close(h.state().panX, 0);
    await h.canvas.fire('touchstart', { touches: [], preventDefault() {} });
    assert.equal(h.state().isDragging, false);
    h.rect.width = 0;
    await h.canvas.fire('mousedown', { clientX: 250, clientY: 150 });
    assert.equal(h.state().isDragging, false);
    h.rect.width = 360;
    await move(h, 'touch', 'start', 250, 150);
    await h.win.fire('touchmove', { touches: [], preventDefault() {} });
    h.rect.height = 0;
    await move(h, 'touch', 'move', 260, 160);
    close(h.state().panX, 0); close(h.state().panY, 0);
});

for (const end of ['touchcancel', 'blur']) {
    test(`${end} stops dragging and a new gesture starts from its own point`, async () => {
        const h = harness(); h.load();
        await move(h, 'touch', 'start', 250, 150);
        await move(h, 'touch', 'move', 260, 160);
        await h.win.fire(end);
        assert.equal(h.state().isDragging, false);
        await h.win.fire('mousemove', { clientX: 900, clientY: 900 });
        close(h.state().panX, 27);
        await move(h, 'mouse', 'start', 400, 300);
        await move(h, 'mouse', 'move', 410, 310);
        close(h.state().panX, 54); close(h.state().panY, 54);
    });
}

test('zoom stays centered after pan, and subsequent pan keeps canvas scale', async () => {
    const h = harness(); h.load();
    await move(h, 'mouse', 'start', 250, 150);
    await move(h, 'mouse', 'move', 260, 160);
    const before = h.state();
    h.get('zoomSlider').value = '2'; await h.get('zoomSlider').fire('input');
    close(h.state().panX, 360 - (360 - before.panX) * 2);
    close(h.state().panY, 640 - (640 - before.panY) * 2);
    const zoomed = h.state();
    await move(h, 'mouse', 'move', 270, 170);
    close(h.state().panX, zoomed.panX + 27); close(h.state().panY, zoomed.panY + 27);
    assert.equal(h.get('zoomValue').innerText, '200%');
});

test('filter, all FX, drawing and export use the panned video', async () => {
    const h = harness(); h.load();
    await move(h, 'touch', 'start', 250, 150);
    await move(h, 'touch', 'move', 260, 160);
    for (const button of h.buttons.slice(1)) await button.fire('click');
    assert.equal(h.state().activeFilter, 'sepia(1)');
    assert.equal(h.state().activeFX.length, 4);
    h.get('fxIntensitySlider').value = '0.75'; await h.get('fxIntensitySlider').fire('input');
    assert.equal(h.get('fxIntensityValue').innerText, '75%');
    for (let i = 0; i < 500; i++) h.sandbox.render();
    const base = h.draws.find(d => d.filter === 'sepia(1)');
    assert.equal(base.args[0], h.video);
    close(base.args[1], 27); close(base.args[2], 27);
    assert.equal(base.args[3], 1920); assert.equal(base.args[4], 1080);
    assert.ok(h.draws.some(d => d.filter?.startsWith('blur(')), 'RGB shift rendered');
    assert.ok(h.draws.some(d => d.args[0] === h.canvas), 'slice effect rendered');
    await h.get('exportBtn').fire('click');
    assert.equal(h.recorders.length, 1);
    assert.equal(h.recorders[0].stream, h.stream);
    assert.equal(h.captureRate(), 30);
    assert.equal(h.recorders[0].options.mimeType, 'video/webm');
    assert.equal(h.recorders[0].options.videoBitsPerSecond, 5000000);
    assert.equal(h.recorders[0].started, true);
    assert.equal(h.state().isExporting, true);
    const stop = h.timers.find(t => t.delay === 3000); assert.ok(stop); stop.fn();
    assert.equal(h.recorders[0].stopped, true);
    assert.equal(h.state().isExporting, false);
    assert.match(h.downloads[0], /^canvas_\d+\.webm$/);
    close(h.state().panX, 27); close(h.state().panY, 27);
});
