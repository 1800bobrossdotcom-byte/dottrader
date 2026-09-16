import { mkdirSync, existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { config } from "../core/config.js";

/** Tiny JSON / NDJSON persistence. No native deps so it runs anywhere. */
export class Store {
  constructor(readonly dir = config.DATA_DIR) {
    mkdirSync(dir, { recursive: true });
  }
  p(name: string) { return path.join(this.dir, name); }

  readJson<T>(name: string, fallback: T): T {
    const f = this.p(name);
    if (!existsSync(f)) return fallback;
    try { return JSON.parse(readFileSync(f, "utf8")) as T; } catch { return fallback; }
  }
  writeJson(name: string, v: unknown) {
    writeFileSync(this.p(name), JSON.stringify(v, null, 2));
  }
  append(name: string, v: unknown) {
    appendFileSync(this.p(name), JSON.stringify(v) + "\n");
  }
  readLines<T>(name: string): T[] {
    const f = this.p(name);
    if (!existsSync(f)) return [];
    return readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);
  }
}
