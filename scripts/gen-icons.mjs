// Генерация PNG-иконок PWA из SVG: npm run icons
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const pub = path.resolve(import.meta.dirname, '../public')
const BG = '#D2622E'
const glyph = (scale) => {
  const off = (512 - 16 * scale) / 2
  return `<g transform="translate(${off} ${off}) scale(${scale})" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v8M4.5 7.5 8 11l3.5-3.5M3.5 13.5h9"/></g>`
}
const svg = (inner, rx) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="${rx}" fill="${BG}"/>${inner}</svg>`)

const any = await readFile(path.join(pub, 'icon.svg'))
const out = async (name, input, size) =>
  writeFile(path.join(pub, name), await sharp(input, { density: 384 }).resize(size, size).png().toBuffer())

await out('pwa-192.png', any, 192)
await out('pwa-512.png', any, 512)
// maskable: фон на весь холст, знак в безопасной зоне (центральные ~60%)
await out('pwa-maskable-512.png', svg(glyph(16), 0), 512)
// apple-touch-icon: без прозрачности (iOS сам скругляет), полный фон
await writeFile(
  path.join(pub, 'apple-touch-icon.png'),
  await sharp(svg(glyph(20), 0)).resize(180, 180).flatten({ background: BG }).png().toBuffer(),
)
console.log('icons ok')
