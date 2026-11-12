/**
 * Символ карты → цвет. Запасные значения — палитра мокапа: значки не зависят от того, подключён ли scenes.css.
 * G и N — светлые пары к g и n (переменные --pi-g2, --pi-n2).
 */
export const PALETTE: Readonly<Record<string, string>> = {
  '#': 'currentColor',
  k: 'var(--pi-k, #3b2616)',
  w: 'var(--pi-w, #fff4d6)',
  y: 'var(--pi-y, #f2c14e)',
  g: 'var(--pi-g, #3f7a3a)',
  G: 'var(--pi-g2, #86c84e)',
  b: 'var(--pi-b, #7fb2e0)',
  r: 'var(--pi-r, #d2603a)',
  n: 'var(--pi-n, #8a5a30)',
  N: 'var(--pi-n2, #c08a4e)',
  s: 'var(--pi-s, #b9b3a6)',
  d: 'var(--pi-d, #2b2f3a)',
}
