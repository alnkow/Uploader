import type Uppy from '@uppy/core';

/** Данные формы, с которыми создаётся пакет. */
export type BatchInput = {
  dataType: string;
  metadata: Record<string, unknown>;
};

/**
 * Запросы к бэкенду. Их реализует приложение через свой HTTP-клиент
 * (с обычным токеном пользователя).
 *
 * Если сервер ответил ошибкой, функция должна выбросить ошибку с полем `status`
 * (HTTP-код). По нему менеджер понимает, стоит ли повторять запрос.
 */
export type UploadApi = {
  /** Создать пакет. Порядок файлов в списке задаёт их номер (fileIndex). */
  createBatch(input: BatchInput & { files: { name: string; size: number }[] }): Promise<{ batchId: string }>;
  /** Выдать токен для загрузки файлов этого пакета. */
  issueUploadToken(batchId: string): Promise<string>;
  /** Сообщить, что все файлы пакета загружены. */
  completeBatch(batchId: string): Promise<void>;
  /** Отменить пакет и удалить его файлы на сервере. */
  cancelBatch(batchId: string): Promise<void>;
};

/**
 * Этап пакета:
 * - queued — ждёт своей очереди;
 * - uploading — файлы загружаются;
 * - completing — файлы загружены, сообщаем об этом серверу;
 * - failed — ошибка, которую автоповтор не исправит. Пакет ждёт решения пользователя
 *   («Повторить» или «Отменить») и не мешает загружаться следующим.
 */
export type BatchPhase = 'queued' | 'uploading' | 'completing' | 'failed';

/** Пакет в том виде, в каком его показывает интерфейс. */
export type BatchView = {
  batchId: string;
  phase: BatchPhase;
  fileCount: number;
  /** Имя первого файла — по нему пользователь отличает пакеты в списке. */
  firstFileName: string;
  bytesUploaded: number;
  bytesTotal: number;
  /** Нет связи с сервером, загрузка скоро повторится сама. */
  waitingRetry: boolean;
  /** Ошибка, которую автоповтор не исправит: пользователь выбирает «Повторить» или «Отменить». */
  error: string | null;
};

/** Пакет внутри менеджера. */
export type Batch = {
  batchId: string;
  uppy: Uppy;
  phase: BatchPhase;
  error: string | null;
  /** Таймер автоповтора, если он запланирован. */
  retryTimer?: ReturnType<typeof setTimeout>;
};
