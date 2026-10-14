// Cooperative controller ownership. Kernel flock releases even after SIGKILL;
// keep the inode forever so a new owner cannot lock a replacement inode.
import { dlopen, FFIType } from "bun:ffi";
import { closeSync, constants, fchmodSync, mkdirSync, openSync, writeSync, ftruncateSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { validateAgentSlug } from "./agent-session";
const system = dlopen(process.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6", { flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } });
export interface Lease { readonly owner: string; readonly agent: string; release(): void }
export const acquireLease = (agent: string, directory = join(homedir(), ".arcmod", "leases")): Lease => {
  validateAgentSlug(agent);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const fd = openSync(join(directory, `${agent}.lock`), constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  if (system.symbols.flock(fd, 2 | 4) !== 0) { closeSync(fd); throw new Error(`session_busy: ${agent} already has a controller; use a different agent session`); }
  const owner = crypto.randomUUID();
  try { fchmodSync(fd, 0o600); ftruncateSync(fd, 0); writeSync(fd, JSON.stringify({ agent, owner, pid: process.pid })); }
  catch (error) { closeSync(fd); throw error; }
  let released = false;
  return { owner, agent, release() { if (released) return; released = true; system.symbols.flock(fd, 8); closeSync(fd); } };
};
