import { describe, expect, it } from "vitest";
import { validateDemoAiWav } from "@/lib/demo-ai-validation";

function wav(seconds: number, sampleRate = 16_000) {
  const dataBytes = Math.floor(seconds * sampleRate * 2);
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

describe("demo AI WAV validation", () => {
  it("accepts the bounded browser-generated format", () => {
    expect(validateDemoAiWav(wav(60)).length).toBe(1_920_044);
  });

  it("rejects forged long-duration headers and oversized audio", () => {
    expect(() => validateDemoAiWav(wav(2, 1_000))).toThrow(/invalid/i);
    expect(() => validateDemoAiWav(wav(60.01))).toThrow(/too large/i);
  });

  it("rejects malformed RIFF lengths", () => {
    const input = wav(1);
    input.writeUInt32LE(1, 4);
    expect(() => validateDemoAiWav(input)).toThrow(/invalid/i);
  });
});
