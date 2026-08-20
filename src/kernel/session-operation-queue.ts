/**
 * Serializes mutable work per session while allowing independent sessions to
 * progress concurrently. A rejected operation never poisons its session tail.
 */
export class SessionOperationQueue {
  private readonly tails = new Map<string, Promise<void>>();

  public enqueue<T>(sessionId: string, operation: () => Promise<T> | T): Promise<T> {
    const previous = this.tails.get(sessionId) ?? Promise.resolve();
    const pending = previous.then(operation, operation);
    const tail = pending.then(() => undefined, () => undefined);
    this.tails.set(sessionId, tail);
    void tail.finally(() => {
      if (this.tails.get(sessionId) === tail) this.tails.delete(sessionId);
    });
    return pending;
  }
}
