const SAMPLE_RATE = 16_000;
const BYTES_PER_SAMPLE = 2;
const MAX_SECONDS = 60;
const MAX_DATA_BYTES = SAMPLE_RATE * BYTES_PER_SAMPLE * MAX_SECONDS;

export function validateDemoAiWav(buffer: Buffer) {
  if (buffer.length <= 44 || buffer.length > 44 + MAX_DATA_BYTES) throw new Error("Demo audio excerpt is too large or invalid");
  if (
    buffer.toString("ascii", 0, 4) !== "RIFF"
    || buffer.toString("ascii", 8, 12) !== "WAVE"
    || buffer.toString("ascii", 12, 16) !== "fmt "
    || buffer.toString("ascii", 36, 40) !== "data"
    || buffer.readUInt32LE(4) !== buffer.length - 8
    || buffer.readUInt32LE(16) !== 16
    || buffer.readUInt16LE(20) !== 1
    || buffer.readUInt16LE(22) !== 1
    || buffer.readUInt32LE(24) !== SAMPLE_RATE
    || buffer.readUInt32LE(28) !== SAMPLE_RATE * BYTES_PER_SAMPLE
    || buffer.readUInt16LE(32) !== BYTES_PER_SAMPLE
    || buffer.readUInt16LE(34) !== 16
    || buffer.readUInt32LE(40) !== buffer.length - 44
  ) throw new Error("Demo audio excerpt is too large or invalid");
  return buffer;
}
