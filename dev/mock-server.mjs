// Заглушка бэкенда для локальной проверки загрузки, пока настоящего бэкенда нет.
// Запросы API — как в UPLOAD_API_FLOW.html, Tus — настоящий сервер @tus/server.
// Файлы пишутся в dev/.data. Остановили и запустили снова — это «сервер был недоступен».
//
// Запуск: npm run mock
// Настройки через переменные окружения:
//   SPEED_MB=10   — скорость приёма одного файла, МБ/с (локально всё грузится мгновенно,
//                   а так видно прогресс и можно успеть оборвать загрузку);
//   TOKEN_TTL=600 — сколько секунд живёт upload-токен (поставьте 30, чтобы проверить его обновление).
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pipeline, Transform } from 'node:stream';
import { FileStore } from '@tus/file-store';
import { Server } from '@tus/server';

const PORT = 3101;
const SPEED_MB = Number(process.env.SPEED_MB ?? 10);
const TOKEN_TTL = Number(process.env.TOKEN_TTL ?? 600);
const MAX_FILE_SIZE = 25 * 1024 ** 3;
const MAX_BATCH_SIZE = 100 * 1024 ** 3;

const dataDir = path.join(import.meta.dirname, '.data');
const dbFile = path.join(dataDir, 'batches.json');
fs.mkdirSync(dataDir, { recursive: true });

// Пакеты сохраняются в файл, чтобы пережить перезапуск заглушки.
// Токены — только в памяти: после перезапуска старые токены не действуют,
// и фронтенд должен сам получить новые.
const batches = fs.existsSync(dbFile) ? JSON.parse(fs.readFileSync(dbFile, 'utf8')) : {};
const save = () => fs.writeFileSync(dbFile, JSON.stringify(batches, null, 2));
const tokens = new Map(); // токен → { batchId, expiresAt }

// Хранилище Tus, которое принимает данные не быстрее SPEED_MB.
class SlowFileStore extends FileStore {
  write(readable, id, offset) {
    const slow = throttle(SPEED_MB * 1024 * 1024);
    pipeline(readable, slow, () => {});
    return super.write(slow, id, offset);
  }
}

function throttle(bytesPerSecond) {
  const start = Date.now();
  let bytes = 0;
  return new Transform({
    transform(chunk, _encoding, done) {
      bytes += chunk.length;
      const wait = (bytes / bytesPerSecond) * 1000 - (Date.now() - start);
      setTimeout(() => done(null, chunk), Math.max(0, wait));
    },
  });
}

const tokenOf = (req) => tokens.get(req.headers.get('authorization')?.replace('Bearer ', ''));
const reject = (status_code, message) => ({ status_code, body: `${message}\n` });

const tus = new Server({
  path: '/api/uploads',
  datastore: new SlowFileStore({ directory: path.join(dataDir, 'uploads') }),
  // Каждый Tus-запрос должен прийти с действующим upload-токеном.
  onIncomingRequest: async (req) => {
    const token = tokenOf(req);
    if (!token || token.expiresAt < Date.now()) throw reject(401, 'upload-токен недействителен');
  },
  // Новая загрузка файла: сверяем метаданные со списком файлов пакета.
  onUploadCreate: async (req, upload) => {
    const { batchId } = tokenOf(req);
    const batch = batches[batchId];
    const fileIndex = Number(upload.metadata?.fileIndex);
    const file = batch?.files[fileIndex];
    console.log(`        файл №${fileIndex} пакета ${upload.metadata?.batchId}: ${upload.metadata?.filename}`);
    if (upload.metadata?.batchId !== batchId || !file) throw reject(403, 'файл не из этого пакета');
    if (file.uploaded) throw reject(403, 'файл уже загружен');
    if (upload.size !== file.size) throw reject(400, 'размер не совпадает со списком файлов');
    file.uploadId = upload.id;
    save();
    return {};
  },
  // Файл загружен целиком.
  onUploadFinish: async (_req, upload) => {
    for (const batch of Object.values(batches)) {
      for (const file of batch.files) if (file.uploadId === upload.id) file.uploaded = true;
    }
    save();
    return {};
  },
});

// Четыре запроса API.
async function handleApi(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost');
  const [, , , batchId, action] = pathname.split('/'); // /api/batches/{batchId}/{action}

  if (req.method === 'POST' && pathname === '/api/batches') {
    const input = await readJson(req);
    const files = input.files ?? [];
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (!input.dataType || files.length === 0) return send(res, 400, { error: 'нужны тип данных и файлы' });
    if (files.some((file) => file.size > MAX_FILE_SIZE) || total > MAX_BATCH_SIZE) {
      return send(res, 422, { error: 'превышен лимит размера' });
    }
    const id = crypto.randomUUID().slice(0, 8);
    batches[id] = {
      dataType: input.dataType,
      metadata: input.metadata,
      files: files.map((file) => ({ name: file.name, size: file.size, uploaded: false })),
    };
    save();
    return send(res, 201, { batchId: id });
  }

  const batch = batches[batchId];
  if (!batch) return send(res, 404, { error: 'пакет не найден' });

  if (req.method === 'POST' && action === 'upload-token') {
    const token = crypto.randomUUID();
    const expiresAt = Date.now() + TOKEN_TTL * 1000;
    tokens.set(token, { batchId, expiresAt });
    return send(res, 200, { token, expiresAt: new Date(expiresAt).toISOString() });
  }

  if (req.method === 'POST' && action === 'complete') {
    if (!batch.files.every((file) => file.uploaded)) return send(res, 422, { error: 'загружены не все файлы' });
    revokeTokens(batchId);
    return send(res, 202);
  }

  if (req.method === 'DELETE' && !action) {
    for (const file of batch.files) {
      if (file.uploadId) await tus.datastore.remove(file.uploadId).catch(() => {});
    }
    delete batches[batchId];
    save();
    revokeTokens(batchId);
    return send(res, 204);
  }

  send(res, 404, { error: 'нет такого запроса' });
}

function revokeTokens(batchId) {
  for (const [token, entry] of tokens) if (entry.batchId === batchId) tokens.delete(token);
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

function send(res, status, data) {
  res.writeHead(status, data ? { 'Content-Type': 'application/json' } : {});
  res.end(data ? JSON.stringify(data) : undefined);
}

const server = http.createServer((req, res) => {
  // Пишем в консоль каждый запрос: так видно весь путь загрузки.
  res.on('close', () => {
    const offset = req.headers['upload-offset'];
    const result = res.writableFinished ? res.statusCode : 'оборван';
    console.log(`${req.method.padEnd(7)} ${req.url} → ${result}${offset ? `  (с байта ${offset})` : ''}`);
  });
  if (req.url.startsWith('/api/uploads')) return void tus.handle(req, res);
  handleApi(req, res).catch((error) => {
    console.error(error);
    send(res, 500, { error: 'ошибка заглушки' });
  });
});
// Без ограничения времени запроса: большой файл на малой скорости грузится долго.
server.requestTimeout = 0;
server.listen(PORT, () => {
  console.log(`Заглушка бэкенда: http://localhost:${PORT} · ${SPEED_MB} МБ/с на файл · токен живёт ${TOKEN_TTL} с`);
});
