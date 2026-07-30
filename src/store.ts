import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export type Subscriber = {
  chatId: number;
  username?: string;
  firstName?: string;
  joinedAt: string;
};

type StoreShape = {
  subscribers: Record<string, Subscriber>;
  seenSignatures: string[];
};

const MAX_SEEN = 2000;

function storePath(): string {
  return path.join(config.dataDir, "store.json");
}

function emptyStore(): StoreShape {
  return { subscribers: {}, seenSignatures: [] };
}

function ensureDir(): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
}

function read(): StoreShape {
  ensureDir();
  const file = storePath();
  if (!fs.existsSync(file)) {
    return emptyStore();
  }
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as StoreShape;
    return {
      subscribers: parsed.subscribers ?? {},
      seenSignatures: Array.isArray(parsed.seenSignatures) ? parsed.seenSignatures : [],
    };
  } catch {
    return emptyStore();
  }
}

function write(data: StoreShape): void {
  ensureDir();
  fs.writeFileSync(storePath(), JSON.stringify(data, null, 2), "utf8");
}

export function addSubscriber(sub: Subscriber): { isNew: boolean } {
  const data = read();
  const key = String(sub.chatId);
  const isNew = !data.subscribers[key];
  data.subscribers[key] = sub;
  write(data);
  return { isNew };
}

export function removeSubscriber(chatId: number): boolean {
  const data = read();
  const key = String(chatId);
  if (!data.subscribers[key]) return false;
  delete data.subscribers[key];
  write(data);
  return true;
}

export function listSubscribers(): Subscriber[] {
  return Object.values(read().subscribers);
}

/** Returns true if this signature is new (and records it). */
export function markSignatureSeen(signature: string): boolean {
  const data = read();
  if (data.seenSignatures.includes(signature)) {
    return false;
  }
  data.seenSignatures.push(signature);
  if (data.seenSignatures.length > MAX_SEEN) {
    data.seenSignatures = data.seenSignatures.slice(-MAX_SEEN);
  }
  write(data);
  return true;
}
