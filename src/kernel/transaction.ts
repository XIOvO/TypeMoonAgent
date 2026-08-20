/** Commit boundary: publication occurs only after durable commit succeeds. */
export class RuntimeTransaction {
  public commit(input: { commit: () => void; publish: () => void }): void {
    input.commit();
    input.publish();
  }
}
