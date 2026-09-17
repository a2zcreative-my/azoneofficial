export type LeavePart = "full" | "first_half" | "second_half";
export type TimeWindow = { start: number; end: number };
export type LeaveCoverage = {
  start_date: string; end_date: string; days?: number;
  day_part?: string | null; coverage_json?: string | null;
};

export function mergeWindows(windows: TimeWindow[]): TimeWindow[] {
  const out: TimeWindow[] = [];
  for (const w of windows.filter(w => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
    .map(w => ({ ...w })).sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
    else out.push(w);
  }
  return out;
}

// Split elapsed scheduled blocks, never the gap between split shifts. Breaks
// have a duration but no scheduled position, so neither half invents one.
export function halfDayWindows(windows: TimeWindow[], part: Exclude<LeavePart, "full">): TimeWindow[] {
  const merged = mergeWindows(windows);
  const half = merged.reduce((sum, w) => sum + w.end - w.start, 0) / 2;
  let walked = 0;
  return merged.flatMap(w => {
    const split = Math.max(w.start, Math.min(w.end, w.start + half - walked));
    walked += w.end - w.start;
    const piece = part === "first_half" ? { start: w.start, end: split } : { start: split, end: w.end };
    return piece.end > piece.start ? [piece] : [];
  });
}

export function savedCoverage(row: LeaveCoverage): TimeWindow[] | null {
  if (row.days !== 0.5 || row.start_date !== row.end_date ||
      !["first_half", "second_half"].includes(row.day_part ?? "")) return null;
  try {
    const value: unknown = JSON.parse(row.coverage_json ?? "null");
    if (!Array.isArray(value) || !value.length || !value.every(w => w &&
      Number.isFinite(w.start) && Number.isFinite(w.end) && w.start >= 0 && w.end <= 2880 && w.end > w.start)) return null;
    return mergeWindows(value);
  } catch { return null; }
}

export function isPartialLeave(row: LeaveCoverage): boolean {
  return row.day_part === "first_half" || row.day_part === "second_half" ||
    (typeof row.days === "number" && row.days % 1 !== 0);
}

export function timeWindow(start: unknown, end: unknown): TimeWindow | undefined {
  const minutes = (s: unknown) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
    ? Number(s.slice(0, 2)) * 60 + Number(s.slice(3)) : null;
  const from = minutes(start), to = minutes(end);
  if (from === null || to === null) return undefined;
  return { start: from, end: to > from ? to : to + 1440 };
}

export function leaveOverlaps(row: LeaveCoverage, day: string, window?: TimeWindow): boolean {
  const offset = (Date.parse(`${row.start_date}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 60000;
  const coverage = savedCoverage(row);
  if (coverage) return coverage.some(w => w.start + offset < (window?.end ?? 1440) && (window?.start ?? 0) < w.end + offset);
  // Unknown legacy partial leave is not permission to schedule over it.
  const end = (Date.parse(`${row.end_date}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 60000 + 1440;
  return offset < (window?.end ?? 1440) && (window?.start ?? 0) < end;
}

export function remainingWindows<T extends TimeWindow>(windows: T[], leave: LeaveCoverage[], day: string): T[] | null {
  let result = windows.map(w => ({ ...w }));
  for (const row of leave) {
    if (!result.some(w => leaveOverlaps(row, day, w))) continue;
    const saved = savedCoverage(row);
    if (isPartialLeave(row) && !saved) return null;
    const offset = (Date.parse(`${row.start_date}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 60000;
    const cuts = saved?.map(w => ({ start: w.start + offset, end: w.end + offset })) ?? [{ start: offset,
      end: (Date.parse(`${row.end_date}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 60000 + 1440 }];
    for (const cut of cuts) result = result.flatMap(w => {
      if (cut.start >= w.end || cut.end <= w.start) return [w];
      return [
        ...(w.start < cut.start ? [{ ...w, end: cut.start }] : []),
        ...(w.end > cut.end ? [{ ...w, start: cut.end }] : []),
      ];
    });
  }
  return result;
}
