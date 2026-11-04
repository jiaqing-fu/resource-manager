const sending = new Set<string>();

/** 单进程内的发送锁；系统按单实例部署。 */
export function tryAcquireNotificationLock(id: string): boolean {
  if (sending.has(id)) return false;
  sending.add(id);
  return true;
}

export function releaseNotificationLock(id: string): void {
  sending.delete(id);
}

export function isNotificationSending(id: string): boolean {
  return sending.has(id);
}
