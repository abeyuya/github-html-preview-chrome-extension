export function t(key: string, substitutions?: string | string[]): string {
  const message = chrome.i18n.getMessage(key, substitutions);
  return message || key;
}
