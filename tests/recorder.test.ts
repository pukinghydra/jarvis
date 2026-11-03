import { suite, eq, ok } from "./t.ts";
// @ts-ignore plain JS module from the web app
import { downsample, encodeWav } from "../web/src/lib/recorder.js";

const { test, run } = suite();
export { run };

test("recorder: 48 kHz pieces become one 16 kHz signal", () => {
  const a = new Float32Array(4800).fill(0.5), b = new Float32Array(4800).fill(-0.5);
  const out = downsample([a, b], 48000, 16000);
  eq(out.length, 3200, "a third as many samples");
  ok(Math.abs(out[0] - 0.5) < 1e-6 && Math.abs(out[3199] + 0.5) < 1e-6, "values kept");
});

test("recorder: WAV header is 16-bit mono 16 kHz PCM", async () => {
  const blob = encodeWav(new Float32Array([0, 1, -1, 0.5]), 16000);
  eq(blob.type, "audio/wav");
  const v = new DataView(await blob.arrayBuffer());
  const s = (o: number, n: number) => String.fromCharCode(...Array.from({ length: n }, (_, i) => v.getUint8(o + i)));
  eq([s(0, 4), s(8, 4), s(12, 4), s(36, 4)], ["RIFF", "WAVE", "fmt ", "data"]);
  eq([v.getUint16(20, true), v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true), v.getUint32(40, true)], [1, 1, 16000, 16, 8]);
  eq([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true)], [0, 32767, -32768]);
});
