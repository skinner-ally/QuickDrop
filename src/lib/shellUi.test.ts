import { describe, expect, it } from 'vitest'
import {
  EXTENSION_DIR_SOURCE_HINT,
  EXTENSION_INSTALL_STEPS,
  EXTENSION_UPDATE_HINT,
  EXT_PORT_MAX,
  EXT_PORT_MIN,
  QUICK_CAPTURE_DESKTOP_HINT,
  extensionManifestPath,
  extStatusText,
  globalShortcutHint,
  isExtensionToken,
  maskToken,
  portRejectedText,
  tokenFromBytes,
  validateExtPort,
} from './shellUi'

const TOKEN = 'A'.repeat(39) + '-_z9'

describe('isExtensionToken', () => {
  it('ровно 43 символа base64url', () => {
    expect(isExtensionToken(TOKEN)).toBe(true)
    expect(isExtensionToken(TOKEN.slice(1))).toBe(false)
    expect(isExtensionToken(TOKEN + 'a')).toBe(false)
    expect(isExtensionToken(TOKEN.slice(1) + '=')).toBe(false)
    expect(isExtensionToken(TOKEN.slice(1) + '+')).toBe(false)
    expect(isExtensionToken(TOKEN.slice(1) + '/')).toBe(false)
    expect(isExtensionToken(TOKEN.slice(1) + 'ж')).toBe(false)
    expect(isExtensionToken(` ${TOKEN.slice(1)}`)).toBe(false)
    expect(isExtensionToken(`${TOKEN}\n`)).toBe(false)
    expect(isExtensionToken('')).toBe(false)
    expect(isExtensionToken(undefined)).toBe(false)
    expect(isExtensionToken(123)).toBe(false)
  })
})

describe('tokenFromBytes', () => {
  it('32 байта → 43 символа без «=», «+» и «/»', () => {
    const all = new Uint8Array(32).fill(0xff)
    const t = tokenFromBytes(all)
    expect(t).toHaveLength(43)
    expect(t).toBe('_'.repeat(42) + '8')
    expect(isExtensionToken(t)).toBe(true)
    expect(isExtensionToken(tokenFromBytes(new Uint8Array(32)))).toBe(true)
    expect(tokenFromBytes(new Uint8Array(32))).toBe('A'.repeat(43))
  })

  it('совпадает со стандартным base64url', () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf, 0x00, 0x10])
    expect(tokenFromBytes(bytes)).toBe(Buffer.from(bytes).toString('base64url'))
    const rnd = new Uint8Array(32)
    crypto.getRandomValues(rnd)
    expect(tokenFromBytes(rnd)).toBe(Buffer.from(rnd).toString('base64url'))
  })
})

describe('validateExtPort', () => {
  it('целое в пределах', () => {
    expect(validateExtPort('47821')).toBeNull()
    expect(validateExtPort(String(EXT_PORT_MIN))).toBeNull()
    expect(validateExtPort(String(EXT_PORT_MAX))).toBeNull()
    expect(validateExtPort(' 50000 ')).toBeNull()
  })

  it('прочее — текст ошибки', () => {
    const err = 'Число от 1024 до 65535'
    for (const v of ['', ' ', '1023', '65536', '0', '-1', '1e4', '4782.1', '47821a', 'abc', '999999', '0x1000']) {
      expect(validateExtPort(v), v).toBe(err)
    }
  })
})

describe('maskToken', () => {
  it('точки и последние 4 символа', () => {
    expect(maskToken(TOKEN)).toBe('••••••••-_z9')
    expect(maskToken(TOKEN)).not.toContain(TOKEN.slice(0, 8))
  })

  it('пусто — «не создан»; короткое не раскрывается', () => {
    expect(maskToken('')).toBe('не создан')
    expect(maskToken('abc')).toBe('••••••••')
  })
})

describe('extStatusText', () => {
  it('выключено', () => {
    expect(extStatusText(false)).toEqual({ text: 'Выключено', error: false })
    expect(extStatusText(false, { running: true, port: 47821 })).toEqual({ text: 'Выключено', error: false })
  })

  it('работает', () => {
    expect(extStatusText(true, { running: true, port: 47821 })).toEqual({
      text: 'Принимает записи на 127.0.0.1:47821',
      error: false,
    })
  })

  it('не запущен — текст ошибки', () => {
    expect(extStatusText(true, { running: false, port: null, error: 'Порт 47821 занят другой программой' })).toEqual({
      text: 'Порт 47821 занят другой программой',
      error: true,
    })
    expect(extStatusText(true, { running: false, port: null })).toEqual({ text: 'Приём не запущен', error: true })
  })

  it('состояние ещё не получено', () => {
    expect(extStatusText(true)).toEqual({ text: 'Проверяем…', error: false })
  })
})

describe('тексты', () => {
  it('пять шагов установки, подсказка вне Tauri', () => {
    expect(EXTENSION_INSTALL_STEPS).toHaveLength(5)
    expect(EXTENSION_INSTALL_STEPS[0]).toContain('chrome://extensions')
    expect(EXTENSION_INSTALL_STEPS[4]).toContain('«Соединение есть»')
    expect(QUICK_CAPTURE_DESKTOP_HINT).toContain('Windows')
  })

  it('шаг 2 ведёт к папке из установщика: путь ниже и «Показать папку»', () => {
    expect(EXTENSION_INSTALL_STEPS[1]).toContain('«Загрузить распакованное расширение»')
    expect(EXTENSION_INSTALL_STEPS[1]).toContain('путь показан ниже')
    expect(EXTENSION_INSTALL_STEPS[1]).toContain('«Показать папку»')
    expect(EXTENSION_INSTALL_STEPS[1]).not.toContain('в установщик она не входит')
    expect(EXTENSION_DIR_SOURCE_HINT).toContain('extension')
    expect(EXTENSION_DIR_SOURCE_HINT).toContain('исходниках')
    expect(EXTENSION_UPDATE_HINT).toContain('chrome://extensions')
  })

  it('extensionManifestPath: разделитель как в пути, без удвоения', () => {
    expect(extensionManifestPath('C:\\Program Files\\QuickDrop\\extension')).toBe(
      'C:\\Program Files\\QuickDrop\\extension\\manifest.json',
    )
    expect(extensionManifestPath('C:\\QuickDrop\\extension\\')).toBe('C:\\QuickDrop\\extension\\manifest.json')
    expect(extensionManifestPath('/Applications/QuickDrop.app/Contents/Resources/extension')).toBe(
      '/Applications/QuickDrop.app/Contents/Resources/extension/manifest.json',
    )
    expect(extensionManifestPath('/opt/quickdrop/extension/')).toBe('/opt/quickdrop/extension/manifest.json')
    // смешанные разделители — прямая косая (Windows её тоже понимает)
    expect(extensionManifestPath('C:\\x/extension')).toBe('C:\\x/extension/manifest.json')
  })

  it('подсказка глобального сочетания зависит от мини-окна', () => {
    expect(globalShortcutHint(true)).toContain('мини-окно')
    expect(globalShortcutHint(true)).toContain('прячет')
    expect(globalShortcutHint(false)).toContain('поднимает окно QuickDrop')
    expect(globalShortcutHint(false)).not.toContain('мини-окно')
  })
})

describe('portRejectedText', () => {
  it('причина из Rust и прежний порт; без причины — общий текст', () => {
    expect(portRejectedText('Порт 8080 занят другой программой', 47821)).toBe(
      'Порт 8080 занят другой программой. Порт не изменён: 47821',
    )
    expect(portRejectedText('Порт занят. ', 50000)).toBe('Порт занят. Порт не изменён: 50000')
    expect(portRejectedText(undefined, 47821)).toBe('Не удалось открыть порт. Порт не изменён: 47821')
    expect(portRejectedText('  ', 47821)).toBe('Не удалось открыть порт. Порт не изменён: 47821')
  })
})
