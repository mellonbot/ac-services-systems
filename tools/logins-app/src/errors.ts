// Its own module so companies.ts can reach it without rows.ts, whose password hashing (node:crypto) cannot enter the renderer bundle.
export class LoginInputError extends Error {}
