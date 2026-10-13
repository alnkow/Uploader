// Лимиты. «ГБ» считаем как 1024³ байт — так размер показывает Windows. Сервер должен считать так же.
const GB = 1024 ** 3;
export const MAX_FILE_SIZE = 25 * GB;
export const MAX_BATCH_SIZE = 100 * GB;

// Разрешённые форматы — по окончанию имени файла.
const ALLOWED_NAME_PATTERNS = [
  /\.(jpe?g|png|tiff?)$/i, // фото: .jpg, .jpeg, .png, .tif, .tiff
  /\.(mp4|mov|mkv|avi|ts)$/i, // видео
  /\.mbtiles$/i, // карты MBTiles
  /\.(zip|rar)$/i, // архивы, в том числе тома вида name.part1.rar
  /\.z\d{2,}$/i, // тома zip-архива: .z01, .z02 …
  /\.r\d{2,}$/i, // тома rar-архива старого формата: .r00, .r01 …
  /\.zx\d{2,}$/i, // .zx01 — так назвал аналитик, что это за формат, ещё уточняется
];

/**
 * Можно ли загружать файл с таким именем.
 * Проверяем по расширению: тип файла (MIME), который сообщает браузер,
 * для архивов и MBTiles часто пустой или неверный.
 */
export const isAllowedFileName = (name: string) =>
  ALLOWED_NAME_PATTERNS.some((pattern) => pattern.test(name));
