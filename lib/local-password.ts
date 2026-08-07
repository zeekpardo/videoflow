const encoder = new TextEncoder();

function bytesToBase64(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function base64ToBytes(value: string) {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

async function derive(password: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const saltBuffer = Uint8Array.from(salt).buffer;
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBuffer, iterations: 120_000 }, material, 256);
  return new Uint8Array(bits);
}

export async function createLocalPassword(password: string) {
  if (password.length < 8) throw new Error("Use at least 8 characters");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { passwordSalt: bytesToBase64(salt), passwordHash: bytesToBase64(await derive(password, salt)) };
}

export async function verifyLocalPassword(password: string, salt: string, expected: string) {
  const actual = await derive(password, base64ToBytes(salt));
  const expectedBytes = base64ToBytes(expected);
  if (actual.length !== expectedBytes.length) return false;
  let different = 0;
  for (let index = 0; index < actual.length; index += 1) different |= actual[index] ^ expectedBytes[index];
  return different === 0;
}
