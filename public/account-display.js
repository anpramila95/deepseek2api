export function resolveAccountLabel(account) {
  return [
    account?.loginValue,
    account?.displayName,
    account?.emailMasked,
    account?.mobileMasked,
    account?.id
  ].find(Boolean) || "";
}

export function resolveAccountDetail(account) {
  const label = resolveAccountLabel(account);

  return [
    account?.displayName,
    account?.mobileMasked,
    account?.emailMasked
  ].find((value) => value && value !== label) || "";
}
