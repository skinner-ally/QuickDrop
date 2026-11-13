// Значки расширения Chrome из public/icon.svg: node scripts/gen-extension-icons.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..')
const outDir = path.join(root, 'extension', 'icons')
const svg = await readFile(path.join(root, 'public', 'icon.svg'))

await mkdir(outDir, { recursive: true })
for (const size of [16, 32, 48, 128]) {
  // Большая плотность растра — чёткий знак и на 16 px.
  const png = await sharp(svg, { density: 768 }).resize(size, size).png().toBuffer()
  await writeFile(path.join(outDir, `icon-${size}.png`), png)
}
console.log('extension icons ok')
