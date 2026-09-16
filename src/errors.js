/** Error class for failures that are the user's to fix (bad flags, missing token, dirty state). */
export class UserError extends Error {
  constructor(message, { hint } = {}) {
    super(message);
    this.name = "UserError";
    this.hint = hint;
  }
}
