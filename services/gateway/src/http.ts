/** A refusal the dispatcher maps to its status. 500 is not one of these — that status is reserved for bugs. */
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
