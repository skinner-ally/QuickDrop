// Проверка перед релизом: версия совпадает в package.json, tauri.conf.json и Cargo.toml,
// а тег (если передан) равен v<версия>. tauri-action берёт имя релиза из tauri.conf.json,
// поэтому тег без поднятой версии дополнил бы черновик прошлого релиза.
// Использование: node scripts/check-version.mjs [v1.2.3]
import { readFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')

const versions = {
  'package.json': JSON.parse(read('package.json')).version,
  'src-tauri/tauri.conf.json': JSON.parse(read('src-tauri/tauri.conf.json')).version,
  'src-tauri/Cargo.toml': /^\s*version\s*=\s*"([^"]+)"/m.exec(read('src-tauri/Cargo.toml'))?.[1],
}
const list = Object.entries(versions)
  .map(([file, v]) => `  ${file}: ${v ?? 'не найдена'}`)
  .join('\n')

const unique = new Set(Object.values(versions))
if (unique.size !== 1 || unique.has(undefined)) {
  console.error(`Версии расходятся:\n${list}`)
  process.exit(1)
}

const [version] = unique
const tag = process.argv[2]
if (tag && tag !== `v${version}`) {
  console.error(`Тег ${tag} не совпадает с версией приложения v${version}:\n${list}\nПоднимите версию во всех трёх файлах и поставьте тег заново.`)
  process.exit(1)
}

console.log(`Версия ${version}${tag ? `, тег ${tag}` : ''}: согласовано`)
