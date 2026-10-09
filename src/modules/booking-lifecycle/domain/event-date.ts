export function minimumEventDate(now = new Date()): string {
  const vietnamDate = new Date(now.getTime() + 7 * 60 * 60_000);
  vietnamDate.setUTCDate(vietnamDate.getUTCDate() + 2);
  return vietnamDate.toISOString().slice(0, 10);
}

export function isBookableEventDate(value: string, now = new Date()): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    value >= minimumEventDate(now)
  );
}
