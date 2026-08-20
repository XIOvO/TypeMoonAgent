export class IdempotencyRegistry<TResult> {
  private readonly processed = new Map<string, { fingerprint: string; result: TResult }>();
  private readonly inFlight = new Map<string, { fingerprint: string; result: Promise<TResult> }>();
  private readonly active = new Map<string, string>();

  public run(input: {
    id: string;
    fingerprint: string;
    load: () => TResult | undefined;
    enqueue: (operation: () => Promise<TResult>) => Promise<TResult>;
    operation: () => Promise<TResult>;
  }): Promise<TResult> {
    const prior = this.find(input.id, input.fingerprint, input.load);
    if (prior !== undefined) return Promise.resolve(prior);
    const inFlight = this.inFlight.get(input.id);
    if (inFlight) {
      if (inFlight.fingerprint !== input.fingerprint) return Promise.reject(new Error("action_id_conflict"));
      return inFlight.result;
    }
    this.active.set(input.id, input.fingerprint);
    const result = input.enqueue(input.operation).finally(() => {
      this.inFlight.delete(input.id);
      this.active.delete(input.id);
    });
    this.inFlight.set(input.id, { fingerprint: input.fingerprint, result });
    return result;
  }

  public remember(id: string, fingerprint: string, result: TResult): void {
    this.processed.set(id, { fingerprint, result });
  }

  public activeFingerprint(id: string): string | undefined { return this.active.get(id); }

  private find(id: string, fingerprint: string, load: () => TResult | undefined): TResult | undefined {
    const prior = this.processed.get(id);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new Error("action_id_conflict");
      return prior.result;
    }
    const persisted = load();
    if (persisted !== undefined) this.remember(id, fingerprint, persisted);
    return persisted;
  }
}
