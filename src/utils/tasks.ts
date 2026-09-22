/**
 * Generates default task titles formatted as "任务1：9.22" (Task 1: 9.22).
 * Format: 任务{number}：{month}.{day}
 */
export function generateDefaultTaskTitle(
  sessions: { title: string; projectId?: string | null }[],
  projectId?: string | null,
  t?: (key: string, options?: any) => string
): string {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const dateStr = `${month}.${day}`;

  // Filter tasks within the specific project if provided
  const relevantTasks = projectId
    ? sessions.filter((s) => s.projectId === projectId)
    : sessions;

  // Extract the highest sequence number among existing tasks matching "任务X" or "Task X"
  let maxNum = 0;
  for (const s of relevantTasks) {
    const match = s.title.match(/(?:任务|Task\s*)(\d+)/i);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }

  const nextNum = Math.max(relevantTasks.length + 1, maxNum + 1);

  if (t) {
    return t("sidebar.defaultTaskTitle", {
      number: nextNum,
      date: dateStr,
      defaultValue: `任务${nextNum}：${dateStr}`,
    });
  }

  return `任务${nextNum}：${dateStr}`;
}
