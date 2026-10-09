# Spotify Canvas drag regression tests

Run from the repository root with Node.js 18 or newer:

```sh
node --test tests/spotify-canvas.test.cjs
```

No dependencies or network access are required. The suite executes the actual
Spotify editor closure from index.html in a fresh Node VM for each test. DOM,
canvas drawing, timers, video playback and MediaRecorder are controlled doubles;
the rest of the app and its analytics/CDN scripts are not executed.

Coverage includes mouse and touch listeners at four canvas positions/sizes,
successive/repeated movements, zero/negative client coordinates, gesture end,
touch cancellation, lost window focus, missing touch points, hidden canvas,
centered zoom after pan, all four FX and filters, and the export path using the
preview canvas at 30 FPS with the existing MIME fallback and bitrate.

Baseline validation on main at 68bb22c63a38486d587b602394bdee4f25bf766b:
12 of 15 tests fail, including the reported 567-unit pan instead of 27.
All 15 pass with the fix. The original lastMouseX/lastMouseY assignments already
updated on every move; the fix preserves them and tests successive deltas.

These tests verify editor behavior and export wiring, not browser codecs or
real video output. A browser smoke test was unavailable in the isolated
environment because no Chromium executable was installed.

Before merging, smoke-test locally in a browser with an actual video:

1. Open Spotify Canvas, load a video and drag in both axes with a mouse.
   Repeat at different window sizes and after scrolling the editor.
2. Repeat on a touch device, including a cancelled gesture and a new gesture.
3. Change zoom after panning, toggle filters and each FX, and preview the loop.
4. Export a short clip; play the downloaded file and confirm its framing,
   effects and duration match the preview.

No changes to the production branch or live site are required to run the tests.
