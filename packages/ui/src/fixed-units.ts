const group = (value: string): string => value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** Integer thousandths as a quantity people write, such as "10" or "2.5". */
export const formatQuantity = (milli: string): string => {
  // bigint / and % truncate toward zero: format the sign and the magnitude, or -5 reads "0.-5".
  const value = BigInt(milli), sign = value < 0n ? "-" : "", abs = value < 0n ? -value : value;
  const whole = abs / 1000n, fraction = abs % 1000n;
  return fraction === 0n ? `${sign}${whole}` : `${sign}${whole}.${fraction.toString().padStart(3, "0").replace(/0+$/, "")}`;
};

/** A typed quantity to thousandths; excess precision is rejected rather than rounded. */
export const parseQuantity = (typed: string): string => {
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(typed.trim());
  if (!match) throw new Error(`"${typed}" is not a quantity`);
  return (BigInt(match[1]!) * 1000n + BigInt((match[2] ?? "").padEnd(3, "0") || "0")).toString();
};

/** Integer minor units as a human amount, such as "1,234.56 USD". */
export const formatMoney = (minor: string, currency = "USD"): string => {
  const value = BigInt(minor), sign = value < 0n ? "-" : "", abs = value < 0n ? -value : value;
  const whole = abs / 100n, cents = (abs % 100n).toString().padStart(2, "0");
  return `${sign}${group(whole.toString())}.${cents} ${currency}`;
};

/** A typed amount to integer minor units; callers provide their established validation wording. */
export const parseMoney = (typed: string, invalidMessage = `"${typed}" is not an amount`): string => {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(typed.trim());
  if (!match) throw new Error(invalidMessage);
  return (BigInt(match[1]!) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0")).toString();
};
