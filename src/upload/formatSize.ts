const UNITS = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];

/** Размер файла для людей: 1536 → «1,5 КБ». */
export function formatSize(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ${UNITS[unit]}`;
}
