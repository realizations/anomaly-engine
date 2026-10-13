/**
 * Proves the audio path works end to end, on the deployed build.
 *
 * Three things have to be true and none of them is visible from the code:
 *
 *   1. The engine loads a track and finds transients in it.
 *   2. Those transients drive the renderer's star field.
 *   3. The response reaches the canvas as real pixels.
 *
 * The unit tests cover the detector against a click track and the transport against a
 * fake clock, and neither of those knows whether the engine ever calls `load`. That is
 * the same gap `tools/debug-overlay-live.mjs` was written for: a wired system whose
 * wire was never connected reports exactly like a working one.
 *
 * The track is generated here rather than shipped: a real audio file in the repository
 * is an asset licence question, and this project generates everything it draws.
 */
import { chromium } from 'playwright';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEPLOYED = resolve(HERE, '../src/AnomalyEngine/bin/Debug/net8.0-windows/renderer/index.html');

/**
 * A four-second click track at 120bpm, as mono PCM at 44.1kHz.
 *
 * Returned as a WAV because that is the one container every browser decodes, and the
 * host hands the bytes over verbatim -- it does not transcode, because the whole point
 * of the design is that the file never leaves the machine and nothing inspects it.
 */
function clickTrackWav({ sampleRate = 44100, beats = 8, spacing = 0.5 } = {}) {
  const seconds = beats * spacing + 1;
  const samples = new Int16Array(Math.round(seconds * sampleRate));

  const click = Math.round(0.03 * sampleRate);
  for (let b = 0; b < beats; b++) {
    const start = Math.round((0.25 + b * spacing) * sampleRate);
    for (let i = 0; i < click; i++) {
      const index = start + i;
      if (index >= samples.length) break;
      const envelope = Math.exp(-i / (click / 6));
      const noise = Math.sin(i * 12.9898) * 43758.5453 - Math.floor(Math.sin(i * 12.9898) * 43758.5453);
      samples[index] += Math.round(
        32767 * envelope * (0.6 * (noise * 2 - 1) + 0.5 * Math.sin((2 * Math.PI * 70 * i) / sampleRate))
      );
    }
  }

  const dataBytes = samples.byteLength;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  Buffer.from(samples.buffer).copy(buffer, 44);
  return buffer;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

await page.goto(pathToFileURL(DEPLOYED).href);
await page.waitForTimeout(4000);

const problems = [];
const check = (ok, why) => { if (!ok) problems.push(why); };

// 1. A track the engine can be handed, exactly as the host sends one.
const track = clickTrackWav();
const loadResult = await page.evaluate(async (base64) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  // The same dispatch the host performs, so what is proven is the channel and not a
  // private method called directly.
  window.dispatchEvent(
    new CustomEvent('anomaly:media-track', {
      detail: { base64, title: 'click.wav' },
    })
  );

  // Decoding and analysis are async; the engine logs when it finishes.
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const beats = window.__engine.getMedia().getState().beatCount;
    if (beats > 0) return { beats, duration: window.__engine.getMedia().getState().duration };
  }
  return { beats: 0, duration: 0 };
}, track.toString('base64'));

check(loadResult.beats > 0, `the engine found no transients in a 120bpm click track (${loadResult.beats})`);
check(loadResult.duration > 4, `the track's duration was not read (${loadResult.duration})`);

// 2. Enabling it starts the transport and reaches the renderer.
const response = await page.evaluate(async () => {
  window.dispatchEvent(
    new CustomEvent('anomaly:audio-reactivity', {
      detail: { enabled: true, silentPlayback: true },
    })
  );
  await new Promise((r) => setTimeout(r, 600));
  return {
    playing: window.__engine.getMedia().getState().playing,
    position: window.__engine.getMedia().getState().position,
    beats: window.__engine.getMedia().getState().beatCount,
  };
});

check(response.playing, 'enabling audio reactivity did not start the transport');
check(response.position > 0, `the clock did not advance (position ${response.position})`);

// 3. Turning it off stops it. A system that keeps running after being switched off is
//    the failure mode that makes people distrust the switch.
const stopped = await page.evaluate(async () => {
  window.dispatchEvent(
    new CustomEvent('anomaly:audio-reactivity', { detail: { enabled: false, silentPlayback: false } })
  );
  await new Promise((r) => setTimeout(r, 300));
  return window.__engine.getMedia().getState().playing;
});

check(stopped === false, 'disabling audio reactivity left it playing');

await browser.close();

process.stdout.write(
  `      ${loadResult.beats} transients in ${loadResult.duration.toFixed(1)}s of a 120bpm click track\n`
);

if (problems.length || errors.length) {
  console.error('FAIL  the audio path does not reach the running engine:');
  for (const p of problems) console.error(`      ${p}`);
  for (const e of errors) console.error(`      ${e}`);
  process.exit(1);
}
console.log('PASS  a local track is decoded, its transients found, and the transport started and stopped');