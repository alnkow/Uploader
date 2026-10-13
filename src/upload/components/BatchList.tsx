import { formatSize } from '../formatSize';
import { useUploadBatches } from '../hooks';
import type { UploadManager } from '../UploadManager';
import type { BatchView } from '../types';

type Props = {
  manager: UploadManager;
};

/**
 * Текущие загрузки: прогресс, ошибки, кнопки «Повторить» и «Отменить».
 * Когда пакет загружен и сервер это подтвердил, он пропадает из списка.
 */
export function BatchList({ manager }: Props) {
  const batches = useUploadBatches(manager);
  if (batches.length === 0) return null;

  const cancel = (batchId: string) => {
    if (window.confirm('Отменить загрузку? Уже загруженные файлы будут удалены.')) {
      manager.cancelBatch(batchId).catch(console.error);
    }
  };

  return (
    <ul>
      {batches.map((batch) => (
        <li key={batch.batchId}>
          {batch.firstFileName}
          {batch.fileCount > 1 && ` и ещё ${batch.fileCount - 1}`}{' '}
          {batch.phase !== 'queued' && (
            <progress value={batch.bytesUploaded} max={batch.bytesTotal || 1} aria-label="Прогресс загрузки" />
          )}{' '}
          <span role={batch.error ? 'alert' : undefined}>{statusText(batch)}</span>{' '}
          {batch.error && (
            <button type="button" onClick={() => manager.retryBatchNow(batch.batchId)}>
              Повторить
            </button>
          )}{' '}
          <button type="button" onClick={() => cancel(batch.batchId)}>
            Отменить
          </button>
        </li>
      ))}
    </ul>
  );
}

// Текст состояния загрузки.
function statusText(batch: BatchView): string {
  if (batch.error) return 'Ошибка загрузки. Повторите или отмените загрузку.';
  if (batch.waitingRetry) return 'Нет связи с сервером. Повторим автоматически.';
  if (batch.phase === 'queued') return 'В очереди';
  if (batch.phase === 'completing') return 'Завершение…';
  return `${formatSize(batch.bytesUploaded)} из ${formatSize(batch.bytesTotal)}`;
}
