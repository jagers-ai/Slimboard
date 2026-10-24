const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Seoul",
});
const dateTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Seoul",
});

export function formatNoteDate(value: string, includeTime = false): string {
  return (includeTime ? dateTimeFormatter : dateFormatter).format(new Date(value));
}
