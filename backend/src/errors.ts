export type FieldError = { field: string; message: string };

export class AccountError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: FieldError[],
  ) {
    super(message);
    this.name = "AccountError";
  }
}
