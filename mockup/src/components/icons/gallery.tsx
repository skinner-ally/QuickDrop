// Витрина значков, только для разработки: /src/components/icons/gallery.html (стили — в gallery.html).
import { createRoot, type Root } from 'react-dom/client'
import { Icon } from './Icon'
import { ICON_NAMES, type IconName } from './names'
import { PIXEL_ICONS } from './pixel'
import { PixelIcon } from './PixelIcon'
import { LUCIDE } from './registry'
import { usePixel } from './usePixel'

/** Группы значков, которые обязаны различаться с первого взгляда на 16px (спецификация этапа 1, §4.3) и соседи по смыслу. */
const GROUPS: ReadonlyArray<readonly IconName[]> = [
  ['archive', 'archive-restore', 'trash', 'inbox'],
  ['star', 'star-off', 'sparkles', 'zap'],
  ['eye', 'eye-off'],
  ['search', 'search-x'],
  ['download', 'upload', 'inbox', 'filter'],
  ['chevron-down', 'arrow-down', 'chevron-up', 'arrow-up', 'chevron-right', 'arrow-right', 'arrow-left', 'chevrons-up-down'],
  ['copy', 'file', 'layout', 'library'],
  ['link', 'unlink', 'paperclip', 'external-link'],
  ['tag', 'bookmark', 'shield-check'],
  ['circle-check', 'info', 'error', 'alert', 'clock', 'globe', 'loader'],
  ['grid', 'list', 'menu', 'more', 'minus', 'hash'],
  ['file', 'file-text', 'file-image', 'file-video', 'file-audio', 'file-code', 'file-archive', 'file-spreadsheet'],
  ['plus', 'minus', 'x', 'check'],
  ['folder', 'monitor', 'calendar', 'maximize', 'scan-text'],
  ['code', 'file-code', 'chevrons-up-down'],
  ['refresh', 'undo', 'loader'],
  ['pencil', 'settings', 'sun', 'moon', 'graph'],
]

const isColor = (name: IconName) => PIXEL_ICONS[name].length === 10

function Cell({ name }: { name: IconName }) {
  const Lucide = LUCIDE[name]
  const sizes = isColor(name) ? [20, 30, 40] : [16, 24, 32]
  return (
    <div className="cell">
      <span className="slot s">
        <PixelIcon name={name} size={sizes[0]} />
      </span>
      <span className="slot m">
        <PixelIcon name={name} size={sizes[1]} />
      </span>
      <span className="slot">
        <PixelIcon name={name} size={sizes[2]} />
      </span>
      <span className="slot s lucide-slot">
        <Lucide size={16} strokeWidth={1.75} />
      </span>
      <span className="name">{name}</span>
    </div>
  )
}

function Group({ names }: { names: readonly IconName[] }) {
  return (
    <div className="group">
      <div className="row">
        {names.map((name) => (
          <PixelIcon key={name} name={name} size={16} />
        ))}
      </div>
      <div className="row">
        {names.map((name) => (
          <PixelIcon key={name} name={name} size={24} />
        ))}
      </div>
      <div className="cap">{names.join(' · ')}</div>
    </div>
  )
}

function InUse() {
  return (
    <div className="use">
      <span className="cb on">
        <PixelIcon name="check" size={16} />
      </span>
      <span className="cb on">
        <PixelIcon name="minus" size={16} />
      </span>
      <span className="cb">
        <PixelIcon name="x" size={16} />
      </span>
      <span>
        <PixelIcon name="loader" size={16} className="spin" />
        <PixelIcon name="loader" size={24} className="spin" />
      </span>
      <span className="btn brand">
        <PixelIcon name="plus" size={16} /> Добавить
      </span>
      <span className="btn">
        <PixelIcon name="archive" size={16} /> В архив
      </span>
      <span className="btn goldbg">
        <PixelIcon name="grid" size={16} />
        <PixelIcon name="list" size={16} />
      </span>
      <span className="gold">
        <PixelIcon name="star" size={16} />
      </span>
      <span className="dim">
        <PixelIcon name="star-off" size={16} />
        <PixelIcon name="clock" size={16} /> 5 мин назад
        <PixelIcon name="tag" size={16} /> заметки
        <PixelIcon name="link" size={16} /> 3 связи
        <PixelIcon name="paperclip" size={16} /> файл
      </span>
      <span className="danger">
        <PixelIcon name="trash" size={16} />
        <PixelIcon name="alert" size={16} />
        <PixelIcon name="error" size={16} /> Удалить
      </span>
      <span>
        <PixelIcon name="type-idea" size={30} />
        <PixelIcon name="sprout" size={60} />
      </span>
    </div>
  )
}

function Panel({ mode, title }: { mode: 'day' | 'night'; title: string }) {
  return (
    <section className={`panel ${mode}`}>
      <h2>{title}</h2>
      <div className="cells">
        {ICON_NAMES.map((name) => (
          <Cell key={name} name={name} />
        ))}
      </div>
      <h3>Похожие значки рядом: 16 и 24px</h3>
      <div className="groups">
        {GROUPS.map((names) => (
          <Group key={names.join()} names={names} />
        ))}
      </div>
      <h3>В деле</h3>
      <InUse />
      <h3>Через Icon — набор зависит от класса pixel на html</h3>
      <div className="strip">
        {ICON_NAMES.map((name) => (
          <Icon key={name} name={name} size={16} />
        ))}
      </div>
    </section>
  )
}

function Gallery() {
  const pixel = usePixel()
  return (
    <>
      <div className="top">
        <h1>Значки QuickDrop: {ICON_NAMES.length}</h1>
        <button type="button" onClick={() => document.documentElement.classList.toggle('pixel')}>
          Icon сейчас: {pixel ? 'пиксели' : 'lucide'} — переключить
        </button>
        <span>В ячейке: пиксели трёх размеров (16/24/32, цветные 20/30/40), lucide 16, имя.</span>
      </div>
      <Panel mode="day" title="Осень, день" />
      <Panel mode="night" title="Осень, ночь" />
    </>
  )
}

// правка карты значка заново выполняет этот модуль (HMR): корень React создаётся один раз и хранится на контейнере
const container = document.getElementById('root') as HTMLElement & { galleryRoot?: Root }
const root = (container.galleryRoot ??= createRoot(container))
root.render(<Gallery />)
