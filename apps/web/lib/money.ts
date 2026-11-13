/** ₹ in Indian grouping: 125000 → "₹1,25,000"; paise always two digits: 2999.5 → "₹2,999.50". */
export const inr = (n: number) => {
  const d = Number.isInteger(n) ? 0 : 2;
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
};
