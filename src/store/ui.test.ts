import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { relativeRange } from '@/lib/dates'
import { currentSearchQuery } from '@/lib/savedSearch'
import { MD_PREVIEW_KEY, useUi } from './ui'

const initial = useUi.getState()

beforeEach(() => {
  useUi.setState(initial, true)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('setDateRange', () => {
  it('быстрый период: границы в фильтре, customDates — false; прочие поля фильтра на месте', () => {
    useUi.getState().setFilter({ tags: ['a'], types: ['link'] })
    useUi.getState().setDateRange({ from: 100, to: 200 })
    expect(useUi.getState().filter).toEqual({ tags: ['a'], types: ['link'], from: 100, to: 200 })
    expect(useUi.getState().customDates).toBe(false)
  })

  it('свой период: customDates — true, если задана хотя бы одна граница', () => {
    useUi.getState().setDateRange({ from: 100 }, true)
    expect(useUi.getState().filter).toEqual({ from: 100 })
    expect(useUi.getState().customDates).toBe(true)

    // Прежняя граница, которой нет в новом диапазоне, снимается.
    useUi.getState().setDateRange({ to: 300 }, true)
    expect(useUi.getState().filter).toEqual({ to: 300 })
    expect(Object.hasOwn(useUi.getState().filter, 'from')).toBe(false)
    expect(useUi.getState().customDates).toBe(true)

    useUi.getState().setDateRange({}, true)
    expect(useUi.getState().filter).toEqual({})
    expect(useUi.getState().customDates).toBe(false)
  })

  it('null снимает период, остальной фильтр сохраняется', () => {
    useUi.getState().setFilter({ categoryId: null, untagged: true })
    useUi.getState().setDateRange({ from: 1, to: 2 }, true)
    useUi.getState().setDateRange(null)
    const { filter, customDates } = useUi.getState()
    expect(filter).toEqual({ categoryId: null, untagged: true })
    expect(Object.hasOwn(filter, 'from') || Object.hasOwn(filter, 'to')).toBe(false)
    expect(customDates).toBe(false)
  })

  it('setFilter признак своего периода не трогает', () => {
    useUi.getState().setDateRange({ from: 1, to: 2 }, true)
    useUi.getState().setFilter({ tags: ['x'] })
    expect(useUi.getState().customDates).toBe(true)
  })
})

describe('сброс customDates', () => {
  const arm = () => {
    useUi.getState().setDateRange({ from: 1, to: 2 }, true)
    expect(useUi.getState().customDates).toBe(true)
  }

  it('setView', () => {
    arm()
    useUi.getState().setView('library')
    expect(useUi.getState()).toMatchObject({ view: 'library', filter: {}, customDates: false })
  })

  it('setView: «Настройки» помнят раздел, откуда их открыли', () => {
    useUi.getState().setView('graph')
    useUi.getState().setView('settings')
    expect(useUi.getState().settingsFrom).toBe('graph')
    // Повторный вход в настройки (уже открыты) прежний раздел не затирает.
    useUi.getState().setView('settings')
    expect(useUi.getState().settingsFrom).toBe('graph')
  })

  it('resetFilter', () => {
    arm()
    useUi.getState().resetFilter()
    expect(useUi.getState()).toMatchObject({ filter: {}, customDates: false })
  })

  it('applyQuery', () => {
    arm()
    useUi.getState().applyQuery('is:archive', 'archive')
    expect(useUi.getState()).toMatchObject({ query: 'is:archive', view: 'archive', filter: {}, customDates: false })
  })
})

describe('rollDatePreset', () => {
  const at = (d: number, h = 0) => new Date(2026, 10, d, h).getTime()
  const EVENING_11 = at(11, 21)
  const MORNING_12 = at(12, 9)

  it('«За неделю» переезжает на новые сутки, прочий фильтр на месте', () => {
    useUi.getState().setDateRange(relativeRange('week', EVENING_11))
    useUi.getState().setFilter({ types: ['link'] })
    useUi.getState().rollDatePreset(EVENING_11, MORNING_12)
    expect(useUi.getState().filter).toEqual({ types: ['link'], ...relativeRange('week', MORNING_12) })
    expect(useUi.getState().customDates).toBe(false)
  })

  it('«Сегодня» после полуночи — снова сегодня, а не вчерашний день (и сохраняется как date:today)', () => {
    useUi.getState().setView('library')
    useUi.getState().setDateRange(relativeRange('today', EVENING_11))
    useUi.getState().rollDatePreset(EVENING_11, MORNING_12)
    const { view, query, filter, customDates } = useUi.getState()
    expect(filter).toEqual(relativeRange('today', MORNING_12))
    expect(currentSearchQuery({ view, query, filter, customDates }, [], MORNING_12)).toBe('is:library date:today')
  })

  it('пропуск нескольких суток (сон компьютера) — период от новых суток', () => {
    useUi.getState().setDateRange(relativeRange('month', at(11, 12)))
    useUi.getState().rollDatePreset(at(11), at(14, 8))
    expect(useUi.getState().filter).toEqual(relativeRange('month', at(14)))
  })

  it('свой период, произвольные границы, пустой фильтр и те же сутки — состояние не меняется', () => {
    const week = relativeRange('week', EVENING_11)
    const unchanged = () => {
      const prev = useUi.getState()
      useUi.getState().rollDatePreset(EVENING_11, MORNING_12)
      expect(useUi.getState()).toBe(prev)
    }

    useUi.getState().setDateRange(week, true)
    unchanged()

    useUi.getState().setDateRange({ from: week.from, to: week.to - 1 })
    unchanged()

    useUi.getState().setDateRange({ from: week.from })
    unchanged()

    useUi.getState().setDateRange(null)
    unchanged()

    useUi.getState().setDateRange(week)
    const prev = useUi.getState()
    useUi.getState().rollDatePreset(at(11, 1), EVENING_11)
    expect(useUi.getState()).toBe(prev)
  })

  it('негодное время — ничего', () => {
    useUi.getState().setDateRange(relativeRange('today', EVENING_11))
    const prev = useUi.getState()
    useUi.getState().rollDatePreset(EVENING_11, Number.NaN)
    useUi.getState().rollDatePreset(Number.NaN, MORNING_12)
    expect(useUi.getState()).toBe(prev)
  })
})

describe('setView и применённый сохранённый поиск', () => {
  const apply = () => useUi.getState().applyQuery('is:library date:week', 'library')

  it('applyQuery запоминает запрос и раздел; пустой запрос — не «применённый»', () => {
    apply()
    expect(useUi.getState()).toMatchObject({
      query: 'is:library date:week',
      appliedQuery: 'is:library date:week',
      appliedView: 'library',
    })
    useUi.getState().applyQuery('  ', 'inbox')
    expect(useUi.getState()).toMatchObject({ appliedQuery: null, appliedView: null })
  })

  it('нетронутый применённый поиск снимается при переходе в другой раздел', () => {
    for (const view of ['inbox', 'archive', 'favorites', 'trash'] as const) {
      apply()
      useUi.getState().setView(view)
      expect(useUi.getState(), view).toMatchObject({ view, query: '', appliedQuery: null, appliedView: null })
    }
  })

  it('home: применённый в «Графе» поиск со своим разделом переносится в этот раздел, в чужой — снимается', () => {
    useUi.getState().applyQuery('is:library date:week', 'graph', 'library')
    expect(useUi.getState()).toMatchObject({ view: 'graph', appliedView: 'library' })
    useUi.getState().setView('library')
    expect(useUi.getState()).toMatchObject({ view: 'library', query: 'is:library date:week' })

    useUi.getState().applyQuery('is:library date:week', 'graph', 'library')
    useUi.getState().setView('inbox')
    expect(useUi.getState()).toMatchObject({ view: 'inbox', query: '', appliedQuery: null })
  })

  it('тот же раздел — поиск остаётся', () => {
    apply()
    useUi.getState().setView('library')
    expect(useUi.getState()).toMatchObject({ query: 'is:library date:week', appliedQuery: 'is:library date:week' })
  })

  it('настройки не снимают поиск: по возвращении он на месте, в чужом разделе — снят', () => {
    apply()
    useUi.getState().setView('settings')
    expect(useUi.getState().query).toBe('is:library date:week')
    useUi.getState().setView('library')
    expect(useUi.getState().query).toBe('is:library date:week')

    useUi.getState().setView('settings')
    useUi.getState().setView('inbox')
    expect(useUi.getState()).toMatchObject({ view: 'inbox', query: '' })
  })

  it('изменённый поиск переходит между разделами, как набранный вручную', () => {
    apply()
    useUi.getState().setQuery('is:library date:week x')
    expect(useUi.getState().appliedQuery).toBeNull()
    useUi.getState().setView('inbox')
    expect(useUi.getState().query).toBe('is:library date:week x')

    // Вернули ту же строку руками — она всё равно своя.
    apply()
    useUi.getState().setQuery('is:library')
    useUi.getState().setQuery('is:library date:week')
    useUi.getState().setView('archive')
    expect(useUi.getState().query).toBe('is:library date:week')
  })

  it('набранный вручную поиск остаётся при смене раздела (прежнее правило)', () => {
    useUi.getState().setQuery('react')
    useUi.getState().setView('archive')
    expect(useUi.getState()).toMatchObject({ view: 'archive', query: 'react', appliedQuery: null })
  })

  it('ввод в строку из настроек (TopBar: setQuery, затем setView) поиск не теряет', () => {
    apply()
    useUi.getState().setView('settings')
    useUi.getState().setQuery('is:inbox')
    useUi.getState().setView('library')
    expect(useUi.getState()).toMatchObject({ view: 'library', query: 'is:inbox' })
  })
})

describe('mdPreview', () => {
  it('без localStorage — «Просмотр»; переключение не бросает', async () => {
    // Явно: в новых версиях Node localStorage может быть и в окружении тестов.
    vi.stubGlobal('localStorage', undefined)
    vi.resetModules()
    const fresh = (await import('./ui')).useUi
    expect(fresh.getState().mdPreview).toBe(true)
    fresh.getState().setMdPreview(false)
    expect(fresh.getState().mdPreview).toBe(false)
    fresh.getState().setMdPreview(true)
    expect(fresh.getState().mdPreview).toBe(true)
  })

  it('начальное значение читается из localStorage, переключение записывается', async () => {
    const store = new Map<string, string>([[MD_PREVIEW_KEY, '0']])
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    })
    vi.resetModules()
    const fresh = (await import('./ui')).useUi
    expect(fresh.getState().mdPreview).toBe(false)
    fresh.getState().setMdPreview(true)
    expect(store.get(MD_PREVIEW_KEY)).toBe('1')
    fresh.getState().setMdPreview(false)
    expect(store.get(MD_PREVIEW_KEY)).toBe('0')

    store.set(MD_PREVIEW_KEY, '1')
    vi.resetModules()
    expect((await import('./ui')).useUi.getState().mdPreview).toBe(true)
  })

  it('сбой localStorage — «Просмотр», запись молча пропускается', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    })
    vi.resetModules()
    const fresh = (await import('./ui')).useUi
    expect(fresh.getState().mdPreview).toBe(true)
    expect(() => fresh.getState().setMdPreview(false)).not.toThrow()
    expect(fresh.getState().mdPreview).toBe(false)
  })
})

describe('CaptureDraft.source', () => {
  it('openCapture передаёт источник черновика', () => {
    useUi.getState().openCapture({ text: 'https://example.com', source: 'manual' })
    expect(useUi.getState().captureDraft).toEqual({ text: 'https://example.com', source: 'manual' })
  })
})
