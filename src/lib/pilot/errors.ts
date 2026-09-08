export class PilotAccessError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly messageRu: string,
  ) {
    super(code);
  }
}
