/** Tiny synchronous event emitter; a throwing listener never breaks the others. */
export class Emitter<A extends unknown[]> {
  private cbs = new Set<(...args: A) => void>();

  constructor(private readonly tag = 'press.platform') {}

  add(cb: (...args: A) => void): () => void {
    this.cbs.add(cb);
    return () => {
      this.cbs.delete(cb);
    };
  }

  emit(...args: A): void {
    for (const cb of [...this.cbs]) {
      try {
        cb(...args);
      } catch (e) {
        console.error(`[${this.tag}] listener failed`, e);
      }
    }
  }

  clear(): void {
    this.cbs.clear();
  }
}
