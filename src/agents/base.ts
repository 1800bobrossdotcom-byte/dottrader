import type { IntelReport, MarketSnapshot, Signal } from "../core/types.js";
import type { MarketData } from "../data/market.js";
import type { Ledger } from "../core/ledger.js";
import { Store } from "../data/store.js";

export interface Ctx {
  snap: MarketSnapshot;
  market: MarketData;
  ledger: Ledger;
  intel: IntelReport | null;
}

export abstract class Agent<S extends object = {}> {
  abstract readonly name: string;
  protected store = new Store();
  protected state!: S;
  constructor(private readonly defaults: S) {}
  init() { this.state = { ...this.defaults, ...this.store.readJson<Partial<S>>(`agent-${this.name}.json`, {}) }; }
  protected save() { this.store.writeJson(`agent-${this.name}.json`, this.state); }
  abstract propose(ctx: Ctx): Promise<Signal[]>;
}
