// Minimal PCM WAV reading and writing, so the voice track is built with exact sample offsets.
import fs from "node:fs";

export interface Wav {
  sampleRate: number;
  channels: number;
  /** Mono 16-bit samples. Stereo input is mixed down. */
  samples: Int16Array;
}

export function readWav(file: string): Wav {
  const buf = fs.readFileSync(file);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error(`${file} is not a WAV file`);
  let pos = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  let data: Buffer | null = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = buf.subarray(pos + 8, pos + 8 + size);
    if (id === "fmt ") fmt = { format: body.readUInt16LE(0), channels: body.readUInt16LE(2), rate: body.readUInt32LE(4), bits: body.readUInt16LE(14) };
    else if (id === "data") data = body;
    pos += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error(`${file} has no fmt or data chunk`);
  const frames = Math.floor(data.length / ((fmt.bits / 8) * fmt.channels));
  const out = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c++) {
      const off = (i * fmt.channels + c) * (fmt.bits / 8);
      let v: number;
      if (fmt.format === 3 && fmt.bits === 32) v = Math.max(-1, Math.min(1, data.readFloatLE(off))) * 32767;
      else if (fmt.bits === 16) v = data.readInt16LE(off);
      else if (fmt.bits === 24) v = (data.readIntLE(off, 3) / 8388608) * 32767;
      else if (fmt.bits === 32) v = (data.readInt32LE(off) / 2147483648) * 32767;
      else throw new Error(`${file}: unsupported WAV sample format`);
      sum += v;
    }
    out[i] = Math.round(sum / fmt.channels);
  }
  return { sampleRate: fmt.rate, channels: 1, samples: out };
}

export function wavSeconds(file: string): number {
  const w = readWav(file);
  return w.samples.length / w.sampleRate;
}

export function writeWav(file: string, sampleRate: number, samples: Int16Array): void {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i], 44 + i * 2);
  fs.writeFileSync(file, buf);
}

/** Place clips on a silent track at exact times (seconds). Overlaps are mixed and clipped. */
export function mixTrack(totalSeconds: number, sampleRate: number, clips: Array<{ file: string; at: number }>): Int16Array {
  const total = Math.ceil(totalSeconds * sampleRate);
  const acc = new Float64Array(total);
  for (const c of clips) {
    const w = readWav(c.file);
    if (w.sampleRate !== sampleRate) throw new Error(`${c.file} is ${w.sampleRate} Hz; the track is ${sampleRate} Hz`);
    const start = Math.round(c.at * sampleRate);
    for (let i = 0; i < w.samples.length && start + i < total; i++) acc[start + i] += w.samples[i];
  }
  const out = new Int16Array(total);
  for (let i = 0; i < total; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(acc[i])));
  return out;
}
