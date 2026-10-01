/** voucher status (ACTIVE/DISABLED/...) is independent from presence (ONLINE/OFFLINE). */
export function voucherStatus(u, blocked) {
  if (blocked) return 'BLOCKED';
  if (u.disabled) return 'DISABLED';
  if (u.limitBytesTotal && u.upload + u.download >= u.limitBytesTotal) return 'DATA LIMIT REACHED';
  if (u.limitUptimeSeconds && u.uptimeSeconds >= u.limitUptimeSeconds) return 'TIME LIMIT REACHED';
  return 'ACTIVE';
}
export const isExpired = s => s === 'DATA LIMIT REACHED' || s === 'TIME LIMIT REACHED';
