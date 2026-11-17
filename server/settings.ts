// Settings made inside the app: the site password, the Anthropic API key and whether the team link is on.
// Kept in DATA_DIR/settings.json (readable only by the app), so the desktop app needs no terminal or .env file.
//
// APP_PASSWORD and ANTHROPIC_API_KEY from the environment still work and win when set, so the Docker and
// Mac setups are unchanged. The key is copied into process.env, which is where the brief interpreter reads it.
//
// Sharing: the app writes DATA_DIR/share/want ("on" or "off"). On the desktop install a small service on the
// machine (outside the container) reads it, turns Tailscale Funnel on or off, and writes its status to a file the
// app can only read (SHARE_STATUS_FILE, mounted read-only), so the app can never change what that service writes.
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { DATA_DIR } from "../engine/paths";

const FILE = path.join(DATA_DIR, "settings.json");
const SHARE_DIR = path.join(DATA_DIR, "share");
const SHARE_STATUS = process.env.SHARE_STATUS_FILE || path.join(SHARE_DIR, "status.json");

/** The desktop app: until a password is chosen, every page shows the setup page instead. */
export const SETUP_MODE = process.env.APP_SETUP === "1";

type Saved = { password?: string; anthropicApiKey?: string; adminPasswordHash?: string };

const ENV_PASSWORD = process.env.APP_PASSWORD ?? "";
const ENV_KEY = process.env.ANTHROPIC_API_KEY ?? "";

function read(): Saved {
  try {
    const s = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return s && typeof s === "object" ? s : {};
  } catch {
    return {};
  }
}

let saved: Saved = read();

function write(next: Saved) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
  saved = next;
}

function applyKey() {
  const key = ENV_KEY || saved.anthropicApiKey || "";
  if (key) process.env.ANTHROPIC_API_KEY = key;
  else delete process.env.ANTHROPIC_API_KEY;
}
applyKey();

export function getPassword(): string {
  return ENV_PASSWORD || saved.password || "";
}

/** True when the password comes from APP_PASSWORD, so it cannot be changed in the app. */
export const PASSWORD_FROM_ENV = ENV_PASSWORD.length > 0;
export const KEY_FROM_ENV = ENV_KEY.length > 0;

export function setPassword(password: string) {
  write({ ...saved, password });
}

export function hasApiKey(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/** The last four characters, so the owner can tell which key is in use without showing it. */
export function apiKeyHint(): string {
  const k = process.env.ANTHROPIC_API_KEY ?? "";
  return k.length > 8 ? `ending ${k.slice(-4)}` : "";
}

export function setApiKey(key: string) {
  write({ ...saved, anthropicApiKey: key || undefined });
  applyKey();
}

// ---------- admin password (guards the Settings page) ----------
// Kept as a salted scrypt hash, never as the password itself.

export function hasAdminPassword(): boolean {
  return !!saved.adminPasswordHash;
}

/** Changes whenever the admin password changes, so admin sign-ins end when it does. */
export function adminPasswordStamp(): string {
  return saved.adminPasswordHash ?? "";
}

export function setAdminPassword(password: string) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  write({ ...saved, adminPasswordHash: `scrypt$${salt.toString("hex")}$${hash.toString("hex")}` });
}

export function checkAdminPassword(password: string): boolean {
  const [kind, salt, hash] = (saved.adminPasswordHash ?? "").split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "hex");
  const got = crypto.scryptSync(password, Buffer.from(salt, "hex"), want.length);
  return crypto.timingSafeEqual(got, want);
}

// ---------- sharing ----------

export type ShareStatus = {
  /** "missing": Tailscale is not installed. "needs-login": installed but not signed in. "running": ready. */
  tailscale?: "missing" | "needs-login" | "running";
  on?: boolean;
  url?: string;
  /** A Tailscale page the owner must open: to sign in, or to allow Funnel for their account. */
  actionUrl?: string;
  message?: string;
  updated?: number;
};

/** False when no service on the machine looks after sharing (the Mac and plain Docker setups). */
export function shareAvailable(): boolean {
  return fs.existsSync(SHARE_STATUS);
}

export function shareWanted(): boolean {
  try {
    return fs.readFileSync(path.join(SHARE_DIR, "want"), "utf8").trim() === "on";
  } catch {
    return false;
  }
}

export function setShareWanted(on: boolean) {
  fs.mkdirSync(SHARE_DIR, { recursive: true });
  fs.writeFileSync(path.join(SHARE_DIR, "want"), on ? "on\n" : "off\n");
}

export function shareStatus(): ShareStatus {
  try {
    return JSON.parse(fs.readFileSync(SHARE_STATUS, "utf8"));
  } catch {
    return {};
  }
}
