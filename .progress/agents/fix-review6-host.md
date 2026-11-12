# fix-review6-host

Задача: исправления по ревью этапа 6 («Живой фон»), группа «host» (граф, хуки, стили, настройки, DESIGN, README, vite.config).
Статус: готово.

## Сделано
1. Лицензия pixelfx в сборке (находки 1 и 2, дубль): README.md «Сторонний код» и docs/DESIGN.md §11 называют носителем
   уведомления в сборке `public/licenses/pixelfx-LICENSE.txt` (шапку `/*!` в math.ts минимизатор срезает).
   vite.config.ts (workbox): `txt` в globPatterns, `navigateFallbackDenylist: [/\/licenses\//]`.
   Новый тест `src/lib/graph/buildLicense.test.ts`: копия в public есть и равна `src/lib/pixelfx/LICENSE`; конфиг PWA кэширует txt
   и не подменяет /licenses/ оболочкой.
2. Находка 3: `bitmapSize` (components/graph/gestureLogic.ts) верит devicePixelContentBoxSize, только если коробка сходится
   с css·dpr с допуском `DEVICE_BOX_SLACK_PX` = 2; иначе round(css·dpr). Тесты в gestureLogic.test.ts (эмуляция dpr 2 / растр 1×,
   допуск, негодная коробка). GraphCanvas.tsx не менялся.
3. Находка 4: ленивую подгрузку controller не делал; решение записано в DESIGN.md §11 («Память и скорость»).
4. Находка 5: DESIGN.md §11 — бабочка над нодой ×0,3.

## Не сделано (чужие файлы)
- src/lib/pixelfx/README.md:4-6 — заменить «он попадает в любую сборку» на: шапка для исходников, в сборку уведомление идёт
  файлом public/licenses/pixelfx-LICENSE.txt (минимизатор срезает /*!).
- src/lib/pixelfx/pixelfx.test.ts:236 — убрать из имени теста «(в сборке файла LICENSE нет)». Сверку копии уже делает
  src/lib/graph/buildLicense.test.ts.
- CLAUDE.md менять запрещено. Основной сессии: добавить public/licenses/ в коммит этапа 6.

## Изменённые файлы
README.md, docs/DESIGN.md, vite.config.ts, src/components/graph/gestureLogic.ts, src/components/graph/gestureLogic.test.ts,
src/lib/graph/buildLicense.test.ts (новый).

Проверка: typecheck чист, 76 файлов / 2234 теста зелёные.
