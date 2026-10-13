import Uppy from '@uppy/core';
import Tus from '@uppy/tus';
import { isAllowedFileName, MAX_BATCH_SIZE, MAX_FILE_SIZE } from './fileRules';
import type { Batch, BatchInput, BatchView, UploadApi } from './types';

// Пауза перед новой попыткой, если сервер недоступен.
const RETRY_INTERVAL = 10_000;

/**
 * Управляет всеми загрузками приложения.
 *
 * Создаётся один раз на всё приложение, а не внутри компонента. Поэтому загрузка
 * продолжается, даже если форму закрыли или пользователь ушёл на другую страницу.
 *
 * Пакеты загружаются по очереди: одновременно активен только один.
 * Повторы бывают двух уровней:
 * - сначала tus сам повторяет неудачный запрос несколько раз (около 9 секунд);
 * - если не помогло, менеджер ждёт 10 секунд и пробует снова (новая попытка опять начинается
 *   с повторов tus — выходит цикл около 20 секунд), и так, пока не получится.
 *
 * Подробности — в UPPY_UPLOAD_IMPLEMENTATION.md.
 */
export class UploadManager {
  private readonly tusEndpoint: string;
  private readonly api: UploadApi;
  // Все пакеты в порядке очереди.
  private readonly batches = new Map<string, Batch>();
  // Черновики, уже отправленные в startBatch. Их нельзя удалять при закрытии формы.
  private readonly submitted = new WeakSet<Uppy>();
  // Токены загрузки: id пакета → токен.
  private readonly tokens = new Map<string, Promise<string>>();
  // Компоненты, которые следят за списком загрузок.
  private readonly listeners = new Set<() => void>();
  private snapshot: BatchView[] = [];

  constructor({ tusEndpoint, api }: { tusEndpoint: string; api: UploadApi }) {
    this.tusEndpoint = tusEndpoint;
    this.api = api;
    // Пока есть незавершённые загрузки, браузер спросит подтверждение перед закрытием вкладки.
    window.addEventListener('beforeunload', (event) => {
      if (this.batches.size === 0) return;
      event.preventDefault();
      event.returnValue = ''; // нужно старым браузерам
    });
  }

  // subscribe и getSnapshot нужны хуку useUploadBatches.
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  /** Создаёт черновик для формы: пустой Uppy с нашими ограничениями и настройками загрузки. */
  createDraft(): Uppy {
    const uppy = new Uppy({
      // Уникальный id нужен, чтобы зона перетаскивания нашла своё поле выбора файлов.
      // Документация советует постоянный id ради localStorage, но мы localStorage не используем.
      id: crypto.randomUUID(),
      restrictions: { maxFileSize: MAX_FILE_SIZE, maxTotalFileSize: MAX_BATCH_SIZE },
      // Не добавляем повторно тот же файл и файлы неподдерживаемых форматов.
      onBeforeFileAdded: (file, files) => !Object.hasOwn(files, file.id) && isAllowedFileName(file.name),
    });
    // id пакета появится после отправки формы (см. startBatch).
    const batchId = () => String(uppy.getState().meta.batchId);

    return uppy.use(Tus, {
      endpoint: this.tusEndpoint,
      // Сколько файлов пакета загружать одновременно. Начинаем с 4, подбираем по замерам.
      limit: 4,
      // Не запоминать загрузки в localStorage: продолжать их после перезагрузки страницы не нужно.
      storeFingerprintForResuming: false,
      // Перед каждым запросом подставляем токен загрузки.
      onBeforeRequest: async (req) => {
        req.setHeader('Authorization', `Bearer ${await this.getUploadToken(batchId())}`);
      },
      // Ответ 401 значит, что токен устарел. Повторяем запрос — он уйдёт с новым токеном.
      onShouldRetry: (error, _retryAttempt, _options, next) =>
        error.originalResponse?.getStatus() === 401 || next(error),
      onAfterResponse: (req, res) => {
        const status = res.getStatus();
        // Токен устарел — забываем его, следующий запрос получит новый.
        if (status === 401) this.tokens.delete(batchId());
        // После обрыва tus сначала спрашивает сервер, сколько байт уже загружено (запрос HEAD).
        // Если сервер ответил ошибкой, tus начинает загрузку файла заново, с нуля.
        // При временной ошибке (401 или сбой сервера 5xx) это не нужно: выбрасываем
        // исключение, tus повторит вопрос и продолжит с того же места.
        if (req.getMethod() === 'HEAD' && (status === 401 || status >= 500)) {
          throw new Error(`tus: HEAD вернул ${status}`);
        }
      },
    });
  }

  /** Удаляет черновик, если форму закрыли без отправки. На сервере у черновика ничего нет. */
  discardDraft(uppy: Uppy): void {
    if (!this.submitted.has(uppy)) uppy.destroy();
  }

  /**
   * Отправка формы: создаёт пакет на сервере и ставит его в очередь на загрузку.
   * Пока функция выполняется, форма не должна давать добавлять файлы:
   * список файлов уже ушёл на сервер.
   */
  async startBatch(uppy: Uppy, input: BatchInput): Promise<string> {
    // Помечаем сразу: если форму закроют во время запроса, черновик не удалится.
    this.submitted.add(uppy);
    const files = uppy.getFiles();
    let batchId: string;
    try {
      ({ batchId } = await this.api.createBatch({
        ...input,
        files: files.map((file) => ({ name: file.name, size: file.size ?? 0 })),
      }));
    } catch (error) {
      // Не получилось — черновик остаётся черновиком, форма покажет ошибку.
      this.submitted.delete(uppy);
      throw error;
    }
    // С каждым файлом на сервер уйдут id пакета и номер файла в нём.
    uppy.setMeta({ batchId });
    files.forEach((file, fileIndex) => uppy.setFileMeta(file.id, { fileIndex }));

    const batch: Batch = { batchId, uppy, phase: 'queued', error: null };
    this.batches.set(batchId, batch);

    // Прогресс. Uppy сам присылает его не чаще двух раз в секунду.
    uppy.on('progress', this.notify);
    // Файл загружен. Когда загружены все файлы пакета — сообщаем серверу.
    uppy.on('upload-success', () => {
      if (batch.phase !== 'uploading') return;
      if (uppy.getFiles().every((file) => file.progress.uploadComplete)) void this.complete(batch);
      else this.failIfStuck(batch);
    });
    // Файл не загрузился, даже после повторов внутри tus.
    uppy.on('upload-error', (_file, error, response) => {
      this.handleError(batch, error.message, isRetryable(response?.status));
    });

    this.startNext();
    this.notify();
    return batchId;
  }

  /** Кнопка «Повторить». */
  retryBatchNow(batchId: string): void {
    const batch = this.batches.get(batchId);
    // Пакет из очереди так не запускаем — он стартует, когда дойдёт его очередь.
    if (!batch || batch.phase === 'queued') return;
    this.clearRetry(batch);
    batch.error = null;
    if (batch.phase === 'failed') {
      // Пакет с ошибкой не запускаем сразу, а ставим в конец очереди:
      // одновременно должен загружаться только один пакет.
      this.batches.delete(batchId);
      batch.phase = 'queued';
      this.batches.set(batchId, batch);
      this.startNext();
    } else {
      // Активный пакет: сюда приходит таймер автоповтора.
      this.run(batch);
    }
    this.notify();
  }

  /** Кнопка «Отменить»: останавливает загрузку и удаляет пакет на сервере. */
  async cancelBatch(batchId: string): Promise<void> {
    const batch = this.batches.get(batchId);
    if (!batch) return;
    this.remove(batch);
    this.startNext();
    try {
      await this.api.cancelBatch(batchId);
    } finally {
      // Токен удаляем только теперь: он был нужен запросам, которые удаляли недогруженные файлы.
      this.tokens.delete(batchId);
    }
  }

  /** Запускает следующий пакет из очереди, если сейчас ничего не загружается. */
  private startNext(): void {
    const batches = [...this.batches.values()];
    if (batches.some((batch) => batch.phase === 'uploading' || batch.phase === 'completing')) return;
    const next = batches.find((batch) => batch.phase === 'queued');
    if (!next) return;
    this.run(next);
    this.notify();
  }

  /** Запускает или продолжает загрузку пакета. */
  private run(batch: Batch): void {
    if (batch.uppy.getFiles().every((file) => file.progress.uploadComplete)) {
      void this.complete(batch); // файлы уже загружены — осталось сообщить серверу
      return;
    }
    batch.phase = 'uploading';
    // upload() сам перезапускает файлы с ошибкой (с того места, где они остановились)
    // и начинает ещё не начатые. Уже загруженные не трогает.
    batch.uppy.upload().catch((error: unknown) => this.handleError(batch, String(error), false));
  }

  /** Все файлы пакета загружены — сообщаем серверу. Повторный вызов безопасен. */
  private async complete(batch: Batch): Promise<void> {
    batch.phase = 'completing';
    this.notify();
    try {
      await this.api.completeBatch(batch.batchId);
    } catch (error) {
      this.handleError(batch, String(error), isRetryable((error as { status?: number }).status));
      return;
    }
    // Пакет могли отменить, пока шёл запрос, — тогда он уже удалён.
    if (this.batches.has(batch.batchId)) this.remove(batch);
    this.tokens.delete(batch.batchId); // больше запросов по этому пакету не будет
    this.startNext();
  }

  /**
   * Ошибка загрузки или запроса к серверу.
   * Временная (нет связи, сервер недоступен) — через 10 секунд пробуем снова, пока не получится.
   * Пакет при этом держит очередь: следующие без связи всё равно не загрузятся.
   * Постоянная (например, нет доступа) — пакет ждёт решения пользователя и отпускает очередь.
   */
  private handleError(batch: Batch, message: string, retryable: boolean): void {
    if (!this.batches.has(batch.batchId)) return; // пакет уже отменён
    if (!retryable) {
      batch.error = message;
      this.clearRetry(batch);
    } else if (!batch.error && !batch.retryTimer) {
      // Если упали сразу несколько файлов, повтор всё равно один.
      batch.retryTimer = setTimeout(() => this.retryBatchNow(batch.batchId), RETRY_INTERVAL);
    }
    this.failIfStuck(batch);
    this.notify();
  }

  /**
   * Пакет с постоянной ошибкой переводим в «failed» и запускаем следующий.
   * Но только когда ни один его файл уже не загружается — иначе два пакета
   * загружались бы одновременно.
   */
  private failIfStuck(batch: Batch): void {
    if (!batch.error || batch.phase === 'failed') return;
    const isUploading = batch.uppy
      .getFiles()
      .some((file) => file.progress.uploadStarted && !file.progress.uploadComplete && !file.error);
    if (isUploading) return;
    batch.phase = 'failed';
    this.startNext();
  }

  // Отменяет запланированный автоповтор.
  private clearRetry(batch: Batch): void {
    clearTimeout(batch.retryTimer);
    batch.retryTimer = undefined;
  }

  // Убирает пакет из списка и останавливает его Uppy.
  // Если файлы не догружены, Uppy заодно удалит их на сервере.
  private remove(batch: Batch): void {
    this.clearRetry(batch);
    batch.uppy.destroy();
    this.batches.delete(batch.batchId);
    this.notify();
  }

  /**
   * Токен загрузки пакета. Запрашиваем у сервера один раз и запоминаем.
   * После ответа 401 токен забывается, и при следующем запросе здесь получим новый.
   */
  private getUploadToken(batchId: string): Promise<string> {
    let token = this.tokens.get(batchId);
    if (!token) {
      token = this.api.issueUploadToken(batchId);
      this.tokens.set(batchId, token);
      // Если запрос не удался, не запоминаем его — в следующий раз попробуем снова.
      token.catch(() => {
        if (this.tokens.get(batchId) === token) this.tokens.delete(batchId);
      });
    }
    return token;
  }

  // Сообщает компонентам, что список загрузок изменился.
  private notify = (): void => {
    this.snapshot = [...this.batches.values()].map(toView);
    this.listeners.forEach((listener) => listener());
  };
}

// Готовит данные пакета для интерфейса.
function toView({ batchId, uppy, phase, error, retryTimer }: Batch): BatchView {
  const files = uppy.getFiles();
  return {
    batchId,
    phase,
    fileCount: files.length,
    firstFileName: files[0]?.name ?? '',
    bytesUploaded: files.reduce((sum, file) => sum + (file.progress.bytesUploaded || 0), 0),
    bytesTotal: files.reduce((sum, file) => sum + (file.size ?? 0), 0),
    waitingRetry: retryTimer !== undefined,
    error,
  };
}

// Временная ошибка — та, после которой есть смысл повторить: сервер не ответил,
// 401 (токен обновится), 408, 409, 423, 429 или сбой самого сервера (5xx).
function isRetryable(status: number | undefined): boolean {
  return status === undefined || status === 0 || [401, 408, 409, 423, 429].includes(status) || status >= 500;
}
