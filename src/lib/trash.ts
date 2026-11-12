import { DAY_MS, startOfDay } from '@/lib/dates'
import { formatDayLabel } from '@/lib/itemTitle'

/** Сроки хранения в корзине для настройки; 0 — не очищать автоматически. */
export const TRASH_DAYS_OPTIONS: readonly number[] = [7, 14, 30, 90, 365, 0]

const TRASH_DAYS_LABELS = new Map<number, string>([
  [7, '7 дней'],
  [14, '14 дней'],
  [30, '30 дней'],
  [90, '90 дней'],
  [365, '1 год'],
])

const OFF_LABEL = 'Не очищать'

/** «7 дней», «14 дней», «30 дней», «90 дней», «1 год», 0 → «Не очищать»; прочее → «N дн.» */
export function trashDaysLabel(days: number): string {
  // Автоочистка выключена при любом сроке ≤ 0 (как в repo.purgeExpired).
  if (!Number.isFinite(days) || days <= 0) return OFF_LABEL
  return TRASH_DAYS_LABELS.get(days) ?? `${days} дн.`
}

/**
 * Момент автоочистки; null — автоочистка выключена (days ≤ 0 или не число), записи нет в корзине или момент
 * вне диапазона Date (его нельзя показать датой).
 * Та же арифметика, что в repo.purgeExpired (граница now − days × DAY_MS); фактически очистка идёт при
 * запуске и раз в 6 часов, поэтому запись может пролежать до 6 ч после этого момента.
 */
export function trashPurgeAt(deletedAt: number | undefined, trashDays: number): number | null {
  if (typeof deletedAt !== 'number' || !Number.isFinite(deletedAt)) return null
  if (typeof trashDays !== 'number' || !Number.isFinite(trashDays) || trashDays <= 0) return null
  const at = deletedAt + trashDays * DAY_MS
  return Number.isNaN(new Date(at).getTime()) ? null : at
}

/**
 * Сколько календарных суток осталось до дня автоочистки (не меньше 0): 0 — день очистки сегодня или срок прошёл.
 * Считается по суткам, а не по часам: остаток совпадает с датой, которую называет formatDayLabel
 * (иначе «удалится сегодня» при остатке «ещё 1 дн.»). null — как у trashPurgeAt или негодное now.
 */
export function trashDaysLeft(deletedAt: number | undefined, trashDays: number, now: number): number | null {
  const at = trashPurgeAt(deletedAt, trashDays)
  if (at === null || !Number.isFinite(now)) return null
  // round: сутки при переводе часов длятся 23 или 25 часов.
  const days = Math.round((startOfDay(at) - startOfDay(now)) / DAY_MS)
  return Number.isFinite(days) ? Math.max(0, days) : null
}

/** null → ''; 0 → «удалится сегодня»; N → «ещё N дн.» */
export function trashLeftLabel(left: number | null): string {
  if (left === null || !Number.isFinite(left)) return ''
  return left <= 0 ? 'удалится сегодня' : `ещё ${left} дн.`
}

/**
 * Строка о сроке для записи в корзине (плашка в деталях): «Удалится окончательно сегодня» — день очистки сегодня
 * или срок прошёл; иначе «Удалится окончательно 14 ноября (ещё 2 дн.)» — дата и остаток считаются по одним суткам.
 * Автоочистка выключена, записи нет в корзине или негодное now → ''.
 */
export function trashPurgeNote(deletedAt: number | undefined, trashDays: number, now: number): string {
  const at = trashPurgeAt(deletedAt, trashDays)
  const left = trashDaysLeft(deletedAt, trashDays, now)
  if (at === null || left === null) return ''
  if (left === 0) return 'Удалится окончательно сегодня'
  return `Удалится окончательно ${formatDayLabel(at, now)} (${trashLeftLabel(left)})`
}
