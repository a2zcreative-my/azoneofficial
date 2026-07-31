const crypto = require('crypto');

function toHex(buf) {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPassword(password, saltHex, pepper, iterations) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password + pepper),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const salt = new Uint8Array(
    saltHex.match(/.{2}/g).map((h) => parseInt(h, 16)),
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return toHex(bits);
}

async function run() {
  const password = "SuperSecretPassword123";
  const pepper = "undefined";
  const iterations = 100000;
  
  const saltBuf = new Uint8Array(16);
  crypto.getRandomValues(saltBuf);
  const saltHex = toHex(saltBuf.buffer);
  
  const hash = await hashPassword(password, saltHex, pepper, iterations);
  const stored = \`pbkdf2$\${iterations}$\${saltHex}$\${hash}\`;
  
  console.log(stored);
}
run();
