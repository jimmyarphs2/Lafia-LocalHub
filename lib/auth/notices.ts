export function safeAuthNotice(value: string | undefined) {
  return value === "check_email" ? value : null;
}
