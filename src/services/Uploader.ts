// Единственный менеджер загрузок на всё приложение.
// Компоненты импортируют uploadManager отсюда и сами new UploadManager не вызывают.
import { UploadManager } from '../upload/UploadManager';
import type { UploadApi } from '../upload/types';

// Запрос к API бэкенда. При ошибке выбрасываем ошибку с полем status —
// по нему менеджер понимает, стоит ли повторять запрос.
// В основном приложении замените fetch на его HTTP-клиент: он подставит
// access-токен пользователя и обновит его, когда тот истечёт.
async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw Object.assign(new Error(`${method} ${url} → ${response.status}`), { status: response.status });
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// Запросы к бэкенду — как в UPLOAD_API_FLOW.html.
const uploadApi: UploadApi = {
  createBatch: (input) => request('POST', '/api/batches', input),
  issueUploadToken: (batchId) =>
    request<{ token: string }>('POST', `/api/batches/${batchId}/upload-token`).then((response) => response.token),
  completeBatch: (batchId) => request('POST', `/api/batches/${batchId}/complete`),
  cancelBatch: (batchId) => request('DELETE', `/api/batches/${batchId}`),
};

export const uploadManager = new UploadManager({
  tusEndpoint: '/api/uploads/', // точный путь даст бэкенд
  api: uploadApi,
});
