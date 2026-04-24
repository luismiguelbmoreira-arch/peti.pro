export const QUOTA = {
  trial:      10,
  basico:     30,
  pro:        100,
  escritorio: Infinity,
};

export function planFromPriceId(priceId) {
  if (priceId === process.env.STRIPE_PRICE_BASICO)     return 'basico';
  if (priceId === process.env.STRIPE_PRICE_PRO)        return 'pro';
  if (priceId === process.env.STRIPE_PRICE_ESCRITORIO) return 'escritorio';
  return null;
}

export function currentMonth() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
}
