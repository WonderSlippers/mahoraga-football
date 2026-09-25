export class FeedDateWindowError extends RangeError {
  constructor() { super('日期范围无效'); }
}

// Date.parse normalizes some impossible dates (e.g. Feb 30) into March.
// Match the requested UTC calendar day before generating upstream requests.
export function parseFeedDateWindow(dates: string, mode: string, extended: boolean) {
  if (!/^\d{8}-\d{8}$/.test(dates) || !['all', 'live'].includes(mode)) throw new FeedDateWindowError();
  const parseDay = (day: string) => {
    const iso = `${day.slice(0,4)}-${day.slice(4,6)}-${day.slice(6,8)}`;
    const value = new Date(`${iso}T00:00:00Z`);
    if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0,10) !== iso) throw new FeedDateWindowError();
    return value;
  };
  const first = parseDay(dates.slice(0,8)), last = parseDay(dates.slice(9));
  const spanDays = (last.getTime() - first.getTime()) / 86_400_000;
  const maxSpanDays = mode === 'all' && extended ? 24 : 9;
  if (spanDays < 0 || spanDays > maxSpanDays) throw new FeedDateWindowError();
  const days = Array.from({length:spanDays+1}, (_,offset) => new Date(first.getTime()+offset*86_400_000).toISOString().slice(0,10).replaceAll('-', ''));
  return {first, last, days};
}
