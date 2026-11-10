import { describe, expect, it } from 'vitest'
import {
  LANGUAGES,
  detectFileType,
  detectInput,
  detectLanguage,
  isUrl,
  languageFromFileName,
  normalizeLanguage,
  normalizeUrl,
} from './detect'

describe('isUrl', () => {
  it.each([
    'https://example.com',
    'http://example.com/path?x=1#y',
    'https://sub.example.co.uk/a/b',
    'ftp://files.example.com/x.zip',
    'www.example.com',
    'WWW.Example.COM/Page',
    'example.com',
    'example.com/path',
    'example.com?q=1',
    'github.com/tauri-apps/tauri',
    'docs.rs/serde',
    'claude.ai',
    't.me/channel',
    'habr.ru',
    'https://medium.com/@user/how-to-build-1a2b3c',
    'localhost:3000',
    'localhost/admin',
    'http://localhost:5173/',
    '127.0.0.1:8080',
    '192.168.1.1',
    '[::1]:3000',
    'пример.рф',
    'Президент.РФ/новости',
    'https://пример.рф/путь',
    'xn--e1afmkfd.xn--p1ai',
    '  https://example.com  ',
    '//cdn.example.com/lib.js',
  ])('ссылка: %s', (s) => {
    expect(isUrl(s)).toBe(true)
  })

  it.each([
    '',
    '   ',
    'hello',
    'localhost',
    'версия 1.2.3',
    '1.2.3',
    'v1.2.3',
    '3.14',
    'file.txt',
    'README.md',
    'main.py',
    'script.sh',
    'photo.jpg',
    'node.js',
    'Vue.js',
    'user@example.com',
    'mailto:user@example.com',
    'конец.',
    'word.',
    'e.g.',
    'т.е.',
    'Привет.Мир',
    'TODO:fix',
    'Note:something',
    'example .com',
    'https://example.com и ещё текст',
    'https://a.com\nhttps://b.com',
    'javascript:alert(1)',
    'file:///C:/x.txt',
    'C:\\Users\\me\\file.txt',
    'https://',
    '(example.com)',
    // имена файлов с «зоной»-расширением, названия технологий, версии
    'script.pl',
    'main.cc',
    'libfoo.so',
    'Makefile.am',
    'config.in',
    'Node.js/Express',
    'Chart.js/docs',
    'ASP.NET',
    'Node.JS',
    '1.0.0.1',
    '8.8.8.8',
  ])('не ссылка: %j', (s) => {
    expect(isUrl(s)).toBe(false)
  })

  it.each([
    'google.co.in',
    'wp.pl/news',
    'vk.cc/abc',
    'notion.so/page',
    'docs.rs/serde',
    '8.8.8.8/dns-query',
    '1.1.1.1:53',
    '10.0.0.1',
    'github.io',
  ])('ссылка несмотря на «файловую» зону или IP: %s', (s) => {
    expect(isUrl(s)).toBe(true)
  })
})

describe('normalizeUrl', () => {
  it('добавляет https:// и обрезает пробелы', () => {
    expect(normalizeUrl('  example.com/a  ')).toBe('https://example.com/a')
    expect(normalizeUrl('www.example.com')).toBe('https://www.example.com')
    expect(normalizeUrl('пример.рф')).toBe('https://пример.рф')
  })
  it('не трогает адреса со схемой', () => {
    expect(normalizeUrl('http://example.com')).toBe('http://example.com')
    expect(normalizeUrl('HTTPS://Example.com')).toBe('HTTPS://Example.com')
  })
  it('протокол-относительные адреса', () => {
    expect(normalizeUrl('//cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png')
  })
  it('для localhost и частных IP — http://', () => {
    expect(normalizeUrl('localhost:3000')).toBe('http://localhost:3000')
    expect(normalizeUrl('127.0.0.1:8080/api')).toBe('http://127.0.0.1:8080/api')
    expect(normalizeUrl('192.168.0.10')).toBe('http://192.168.0.10')
  })
  it('пустая строка остаётся пустой', () => {
    expect(normalizeUrl('  ')).toBe('')
  })
})

describe('detectInput: ссылки и текст', () => {
  it('пустой ввод — текст', () => {
    expect(detectInput('')).toEqual({ type: 'text' })
    expect(detectInput('  \n ')).toEqual({ type: 'text' })
  })

  it('одна ссылка → link с нормализованным url', () => {
    expect(detectInput('  github.com/tauri-apps/tauri \n')).toEqual({
      type: 'link',
      url: 'https://github.com/tauri-apps/tauri',
    })
    expect(detectInput('https://habr.com/ru/articles/1/')).toEqual({
      type: 'link',
      url: 'https://habr.com/ru/articles/1/',
    })
  })

  it('ссылка с комментарием — не link', () => {
    expect(detectInput('https://example.com — почитать вечером').type).toBe('text')
  })

  it.each([
    'Купить молоко и хлеб',
    'Идея: сделать приложение для заметок, которое само раскладывает всё по полочкам.',
    'Позвонить маме (в субботу), обсудить поездку; взять билеты.',
    'Сегодня (в понедельник) я купил: хлеб, молоко; а также {что-то} ещё.',
    'Формула: x = (a + b) / 2; потом округлить до целого.',
    'Не забыть: npm install && npm run build перед релизом',
    'Используй console.log(x) для отладки, а не alert().',
    'Москва -> Питер -> Казань',
    '- купить молоко;\n- позвонить маме (срочно);\n- отправить отчёт.',
    '1. Первый пункт\n2. Второй пункт (важный)\n3. Третий',
    '# План на неделю\n\n- [ ] купить продукты\n- [ ] сходить в спортзал\n\n**Важно:** не забыть про отчёт.',
    'Задача: купить хлеб\nСрок: завтра\nПриоритет: высокий',
    'версия 1.2.3',
    'Hello world',
    'Remember to call John (he asked about the project) tomorrow.',
    'Remember (this is important) that the meeting {room 4} starts at 10.',
    'for example: buy milk',
    'x = 5',
    'let it go',
    'Note: buy milk\nDeadline: tomorrow',
    'Make sure it works before the release.\nThen find the best way to ship it.\nGo to the store after.',
    '## Ideas\n- Build a bookmark manager\n- Learn Rust\nSome notes about the project (draft).',
    'git — система контроля версий',
    'Список дел:\n— зарядка;\n— завтрак;\n— работа (до 18:00).',
    // заметки «ключ: значение» без структуры YAML
    'Login: admin\nPassword: 12345\nPort: 8080',
    'Width: 100\nHeight: 200',
    'Todo: today\nBuy:\n- milk\n- bread\nCall: mom',
    // «слово = слово» без «;» — список, а не код
    'Meeting notes:\nbudget = 500\ndeadline = friday\nowner = me',
    // фразы с пояснениями в скобках и «;» в конце
    'TODO (tomorrow):\ncall John (again);\nsend report (v2);',
    // SELECT…FROM без других признаков SQL
    'SELECT the best option FROM the list we discussed',
    'script.pl',
    'ASP.NET',
    '1.0.0.1',
  ])('обычный текст: %j', (s) => {
    expect(detectInput(s)).toEqual({ type: 'text' })
  })

  it('тип idea автоматически не ставится', () => {
    expect(detectInput('Идея: сервис для обмена книгами').type).toBe('text')
  })
})

describe('detectInput: код', () => {
  it.each<[string, string]>([
    ['const x = 5;', 'js'],
    ['console.log(user.name)', 'js'],
    ["import { useState } from 'react'\nconst [a, setA] = useState(0)", 'js'],
    [
      "const greeting = 'Привет, мир';\nconsole.log(greeting);\nexport default greeting;",
      'js',
    ],
    [
      'function add(a, b) {\n  // складываем\n  return a + b;\n}\n\nmodule.exports = add;',
      'js',
    ],
    ['interface User {\n  id: string;\n  name: string;\n}', 'ts'],
    ['type Id = string | number\nexport const toId = (v: unknown): Id => String(v)', 'ts'],
    [
      "import { useState } from 'react'\n\nexport function Counter() {\n  const [count, setCount] = useState<number>(0)\n  return (\n    <button onClick={() => setCount(count + 1)}>\n      {count}\n    </button>\n  )\n}",
      'tsx',
    ],
    [
      'export default function App() {\n  return (\n    <div className="app">\n      <h1>Hello</h1>\n    </div>\n  )\n}',
      'jsx',
    ],
    ['def greet(name):\n    print(f"Hello, {name}")\n\ngreet("World")', 'python'],
    [
      'def add(a, b):\n    """Return the sum of two numbers."""\n    return a + b',
      'python',
    ],
    [
      '# Считаем сумму\ndef total(items):\n    return sum(i.price for i in items)  # цена\n\nif __name__ == "__main__":\n    print(total([]))',
      'python',
    ],
    ['import numpy as np\nfrom pathlib import Path\n\nclass Loader:\n    def __init__(self):\n        self.path = Path(".")', 'python'],
    ["print('hello')", 'python'],
    ['{"name": "quickdrop", "version": "0.1.0", "private": true}', 'json'],
    ['[\n  {"id": 1},\n  {"id": 2}\n]', 'json'],
    ['<!DOCTYPE html>\n<html>\n<head><title>x</title></head>\n</html>', 'html'],
    ['<div class="card">\n  <h1>Title</h1>\n  <p>Text</p>\n</div>', 'html'],
    ['.card {\n  display: flex;\n  border-radius: 8px;\n  color: #333;\n}', 'css'],
    ['$primary: #333;\n.btn {\n  color: $primary;\n  &:hover { opacity: 0.8; }\n}', 'scss'],
    ['SELECT * FROM users WHERE id = 1;', 'sql'],
    [
      'SELECT u.name, COUNT(o.id) AS orders\nFROM users u\nLEFT JOIN orders o ON o.user_id = u.id\nGROUP BY u.name\nORDER BY orders DESC;',
      'sql',
    ],
    ['CREATE TABLE items (\n  id SERIAL PRIMARY KEY,\n  title VARCHAR(255) NOT NULL\n);', 'sql'],
    ['npm install dexie', 'bash'],
    ['docker compose up -d', 'bash'],
    ['git commit -m "исправил баг"', 'bash'],
    ['$ npm run dev', 'bash'],
    ['cd ~/projects\ngit clone https://github.com/x/y.git\ncd y && npm ci', 'bash'],
    ['#!/bin/bash\nfor f in *.txt; do\n  echo "$f"\ndone', 'bash'],
    ['#!/usr/bin/env python3\nprint("hi")', 'python'],
    ['#!/usr/bin/env node\nconsole.log(1)', 'js'],
    ['Get-ChildItem -Path . -Recurse | Where-Object { $_.Length -gt 1MB }', 'powershell'],
    [
      '$files = Get-ChildItem -Path . -Filter *.log\nforeach ($f in $files) {\n    Write-Host $f.Name\n}',
      'powershell',
    ],
    ['fn main() {\n    let mut v = vec![1, 2, 3];\n    println!("{:?}", v);\n}', 'rust'],
    [
      'package main\n\nimport "fmt"\n\nfunc main() {\n    x := 5\n    fmt.Println(x)\n}',
      'go',
    ],
    [
      'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello");\n    }\n}',
      'java',
    ],
    [
      'using System;\n\nclass Program {\n    static void Main() {\n        Console.WriteLine("Hi");\n    }\n}',
      'csharp',
    ],
    ['#include <stdio.h>\n\nint main(void) {\n    printf("hi\\n");\n    return 0;\n}', 'c'],
    ['#include <iostream>\n\nint main() {\n    std::cout << "Hi" << std::endl;\n}', 'cpp'],
    [
      'version: "3.9"\nservices:\n  web:\n    image: nginx:latest\n    ports:\n      - "80:80"',
      'yaml',
    ],
    [
      'name: CI\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: |\n          npm ci\n          npm test',
      'yaml',
    ],
    ['[package]\nname = "quickdrop"\nversion = "0.1.0"\nedition = "2021"', 'toml'],
    ['FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nRUN npm ci\nCMD ["node", "index.js"]', 'dockerfile'],
    ['<?php\necho "hi";', 'php'],
  ])('%j → %s', (input, language) => {
    expect(detectInput(input)).toEqual({ type: 'code', language })
  })

  it('кириллица в строках и комментариях не мешает', () => {
    const r = detectInput('// Приветствие пользователя\nconst msg = `Привет, ${name}!`;\nalert(msg);')
    expect(r).toEqual({ type: 'code', language: 'js' })
  })

  it('код без опознанного языка всё равно code', () => {
    const r = detectInput('a[i] = b[j];\nc[k] = d[l];\nswap(a, c);')
    expect(r.type).toBe('code')
  })

  it('после ужесточения эвристик настоящий код по-прежнему распознаётся', () => {
    expect(detectInput('SELECT name FROM users')).toEqual({ type: 'code', language: 'sql' })
    expect(detectInput('a = 1\nb = 2\nc = a + b\nprint(c)')).toEqual({ type: 'code', language: 'python' })
    expect(detectInput('foo(1,\n  2,\n  bar);\nfree(ptr);\nx = (a + b);')).toMatchObject({ type: 'code' })
    expect(detectInput('server:\n  port: 8080\n  host: localhost')).toEqual({ type: 'code', language: 'yaml' })
    expect(detectInput('---\nport: 8080\ndebug: true')).toEqual({ type: 'code', language: 'yaml' })
    expect(detectInput('items:\n  - a\n  - b\ncount: 2')).toEqual({ type: 'code', language: 'yaml' })
  })
})

describe('detectInput: fenced-блоки', () => {
  it('язык из метки, stripped без обёртки', () => {
    expect(detectInput('```ts\nconst a: number = 1\n```')).toEqual({
      type: 'code',
      language: 'ts',
      stripped: 'const a: number = 1',
    })
  })

  it('алиасы меток', () => {
    expect(detectInput('```typescript\nlet x = 1\n```').language).toBe('ts')
    expect(detectInput('```py\nx = 1\n```').language).toBe('python')
    expect(detectInput('```sh\nls -la\n```').language).toBe('bash')
    expect(detectInput('```yml\na: 1\n```').language).toBe('yaml')
    expect(detectInput('~~~c++\nint x;\n~~~').language).toBe('cpp')
  })

  it('без метки — язык определяется по содержимому, отступы сохраняются', () => {
    const r = detectInput('```\ndef f(x):\n    return x * 2\n```')
    expect(r).toEqual({ type: 'code', language: 'python', stripped: 'def f(x):\n    return x * 2' })
  })

  it('fenced-текст — всё равно code (пользователь сам обернул)', () => {
    expect(detectInput('```\nпросто текст\n```')).toEqual({ type: 'code', stripped: 'просто текст' })
  })

  it('пустой блок', () => {
    expect(detectInput('```js\n```')).toEqual({ type: 'code', language: 'js', stripped: '' })
  })

  it('однострочный ```…```', () => {
    expect(detectInput('```npm i dexie```')).toEqual({ type: 'code', language: 'bash', stripped: 'npm i dexie' })
  })

  it('заметка с несколькими блоками — не один fenced-блок', () => {
    const r = detectInput('```js\nconst a = 1\n```\nи потом\n```py\nb = 2\n```')
    expect(r.stripped).toBeUndefined()
  })

  it('markdown-заметка с блоком кода внутри — текст', () => {
    expect(detectInput('Пример настройки:\n```js\nconst a = 1\n```\nВот так.').type).toBe('text')
  })
})

describe('detectInput: производительность', () => {
  // регрессия: вложенные квантификаторы давали экспоненциальный перебор на обычных фразах
  it.each([
    ['фразы', '## Ideas\n- Build a bookmark manager\n- Learn Rust\nSome notes about the project (draft).'],
    ['длинное слово', 'a'.repeat(30_000)],
    ['слова через пробел', 'word '.repeat(10_000)],
    ['много строк прозы', 'Make sure it works before the release, then ship it.\n'.repeat(2_000)],
    ['много строк кода', 'const x = foo(bar, baz);\n'.repeat(2_000)],
    ['селекторы', ('.a .b .c .d .e .f .g .h .i .j .k .l '.repeat(20) + '\n').repeat(50)],
    ['незакрытые скобки', '('.repeat(20_000)],
    // регрессия: `^\s*` с флагом m на каждой пустой строке сканировал всю серию (19 000 строк — 5 с)
    ['серия пустых строк', 'a' + '\n'.repeat(19_000) + 'b'],
    ['пустые строки с пробелами', 'a' + ' \n'.repeat(9_500) + 'b'],
    ['пустые строки с табами', 'x\n' + '\t\n'.repeat(9_000) + 'y'],
    ['экранированные кавычки', 'x\n' + '\\"'.repeat(10_000)],
    ['незакрытые /*', '/*'.repeat(10_000)],
    ['хвост из точек у команды', 'ls ' + '.'.repeat(20_000) + 'x'],
    ['function без скобки', 'function f('.repeat(2_000)],
    ['f-строки без }', 'f"{'.repeat(7_000)],
    ['fenced-блок с мегабайтом пробелов', '```\n' + ' '.repeat(1_000_000) + 'x'],
    ['мегабайт строк в fenced-блоке', '```\n' + 'a\n'.repeat(500_000) + '``'],
  ])('%s', (_name, input) => {
    const t = performance.now()
    detectInput(input)
    isUrl(input)
    expect(performance.now() - t).toBeLessThan(1000)
  })
})

describe('detectLanguage / normalizeLanguage / languageFromFileName', () => {
  it('detectLanguage', () => {
    expect(detectLanguage('fn main() { println!("hi"); }')).toBe('rust')
    expect(detectLanguage('просто текст')).toBeUndefined()
  })
  it('normalizeLanguage', () => {
    expect(normalizeLanguage('TypeScript')).toBe('ts')
    expect(normalizeLanguage('language-js')).toBe('js')
    expect(normalizeLanguage('C#')).toBe('csharp')
    expect(normalizeLanguage('mermaid')).toBe('mermaid')
    expect(normalizeLanguage('  ')).toBeUndefined()
  })
  it('languageFromFileName', () => {
    expect(languageFromFileName('src/App.TSX')).toBe('tsx')
    expect(languageFromFileName('script.ps1')).toBe('powershell')
    expect(languageFromFileName('Dockerfile')).toBe('dockerfile')
    expect(languageFromFileName('photo.jpg')).toBeUndefined()
    expect(languageFromFileName('Makefile')).toBeUndefined()
  })
  it('LANGUAGES: уникальные id, все нужные языки на месте', () => {
    const ids = LANGUAGES.map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ['ts', 'js', 'tsx', 'jsx', 'python', 'json', 'html', 'css', 'sql', 'bash', 'powershell', 'rust', 'go', 'java', 'c', 'cpp', 'csharp', 'yaml', 'markdown']) {
      expect(ids).toContain(id)
    }
  })
})

describe('detectFileType', () => {
  it.each<[{ type: string; name: string }, 'image' | 'file']>([
    [{ type: 'image/png', name: 'a.png' }, 'image'],
    [{ type: 'image/svg+xml', name: 'icon.svg' }, 'image'],
    [{ type: 'image/heic', name: 'IMG_0001.HEIC' }, 'image'],
    [{ type: '', name: 'photo.HEIC' }, 'image'],
    [{ type: '', name: 'shot.jpeg' }, 'image'],
    [{ type: 'application/octet-stream', name: 'x.webp' }, 'image'],
    [{ type: '', name: 'pic.avif' }, 'image'],
    [{ type: '', name: 'old.bmp' }, 'image'],
    [{ type: 'application/pdf', name: 'doc.pdf' }, 'file'],
    [{ type: '', name: 'noext' }, 'file'],
    [{ type: 'text/plain', name: 'notes.txt' }, 'file'],
    [{ type: 'image/vnd.adobe.photoshop', name: 'layout.psd' }, 'file'],
  ])('%j → %s', (file, expected) => {
    expect(detectFileType(file)).toBe(expected)
  })
})
