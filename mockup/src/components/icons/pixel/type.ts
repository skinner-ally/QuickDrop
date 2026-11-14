import type { PixelMap } from '../compile'

// Цветные значки типа записи, 10×10. Перенесены из мокапа (mockup/app.js, TYPE_IC) без изменений.

const text: PixelMap = [
  '.kkkkkk...',
  '.kwwwwkk..',
  '.kwwwwwk..',
  '.kwnnwwk..',
  '.kwwwwwk..',
  '.kwnnnwk..',
  '.kwwwwwk..',
  '.kwnnnwk..',
  '.kwwwwwk..',
  '.kkkkkkk..',
]

const link: PixelMap = [
  '..........',
  '....kkkkk.',
  '...kbbbbbk',
  '...kbkkkbk',
  '.kkkbk.kbk',
  'kbbkbbbbbk',
  'kbkkkkkkk.',
  'kbk.kbk...',
  'kbbbbbk...',
  '.kkkkk....',
]

const code: PixelMap = [
  'kkkkkkkkkk',
  'kssssssssk',
  'kkkkkkkkkk',
  'kddddddddk',
  'kdGddddddk',
  'kddGdddddk',
  'kdGddGGGdk',
  'kddddddddk',
  'kkkkkkkkkk',
  '..........',
]

const idea: PixelMap = [
  '..........',
  '.gg...gg..',
  'gGGg.gGGg.',
  'gGGGgGGGg.',
  '.gGGGGGg..',
  '..ggGgg...',
  '....G.....',
  '....G.....',
  '.nnnGnnn..',
  '..nnnnn...',
]

const file: PixelMap = [
  '..........',
  '.kkkkkkkk.',
  'kNNNNNNNNk',
  'knnnnnnnnk',
  'kkkkyykkkk',
  'kNNNyyNNNk',
  'kNNNNNNNNk',
  'knnnnnnnnk',
  '.kkkkkkkk.',
  '..........',
]

const image: PixelMap = [
  'kkkkkkkkkk',
  'kbbbbbbyyk',
  'kbbbbbbyyk',
  'kbbbgbbbbk',
  'kbbgGgbbbk',
  'kbgGGGgbgk',
  'kgGGGGGgGk',
  'kGGGGGGGGk',
  'kkkkkkkkkk',
  '..........',
]

export const TYPE_PIXELS = {
  'type-text': text,
  'type-link': link,
  'type-code': code,
  'type-idea': idea,
  'type-file': file,
  'type-image': image,
  // росток — логотип и пустые состояния; тот же рисунок, что у «идеи»
  sprout: idea,
}
