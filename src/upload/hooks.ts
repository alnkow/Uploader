import { useEffect, useState, useSyncExternalStore } from 'react';
import type Uppy from '@uppy/core';
import type { UploadManager } from './UploadManager';
import type { BatchView } from './types';

/** Текущие загрузки в порядке очереди. Компонент перерисуется, когда они изменятся. */
export function useUploadBatches(manager: UploadManager): BatchView[] {
  return useSyncExternalStore(manager.subscribe, manager.getSnapshot);
}

/**
 * Черновик для формы. Создаётся при открытии формы и удаляется при закрытии,
 * если форму так и не отправили. Отправленный черновик становится загрузкой
 * и продолжает работать после закрытия формы.
 */
export function useUploadDraft(manager: UploadManager): Uppy | null {
  const [draft, setDraft] = useState<Uppy | null>(null);
  useEffect(() => {
    const uppy = manager.createDraft();
    setDraft(uppy);
    return () => manager.discardDraft(uppy);
  }, [manager]);
  return draft;
}

