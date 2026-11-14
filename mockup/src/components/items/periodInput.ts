/**
 * Поле даты ещё набирают: Chromium / WebView2 при наборе года отдаёт промежуточные полные значения
 * («0002-11-10», «0020-11-10», «0202-11-10»). Такой ввод не ошибка и фильтр не меняет.
 */
export function isUnfinishedDate(value: string): boolean {
  const m = /^(\d{1,6})-\d{2}-\d{2}$/.exec((value ?? '').trim())
  return !!m && Number(m[1]) < 1000
}
