import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function findKey() {
  const secret = Buffer.from(process.env.APP_SECRET ?? "", "base64");
  if (secret.length < 32) throw new Error("APP_SECRET must be at least 32 random bytes, base64 encoded");
  return createHash("sha256").update(secret).digest();
}

const key = findKey();

export function encrypt(plaintext: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64")).join(".");
}

export function decrypt(stored: string) {
  const [iv = "", tag = "", ciphertext = ""] = stored.split(".");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
}
