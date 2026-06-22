export function isQuoEnabled() {
  return Boolean(process.env.QUO_API_KEY?.trim() && process.env.QUO_FROM_PHONE?.trim());
}

export function getQuoApiKey() {
  const key = process.env.QUO_API_KEY?.trim();
  if (!key) throw new Error("QUO_API_KEY is not configured.");
  return key;
}

export function getQuoFromPhone() {
  const phone = process.env.QUO_FROM_PHONE?.trim();
  if (!phone) throw new Error("QUO_FROM_PHONE is not configured.");
  return phone;
}
