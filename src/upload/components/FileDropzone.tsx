import { useEffect, useState } from 'react';
import type Uppy from '@uppy/core';
import { useDropzone, useUppyEvent } from '@uppy/react';
import { isAllowedFileName, MAX_BATCH_SIZE, MAX_FILE_SIZE } from '../fileRules';
import { formatSize } from '../formatSize';

type Props = {
  uppy: Uppy;
  disabled?: boolean;
};

type Rejected = { name: string; reason: string };

/**
 * Зона «перетащите файлы сюда или нажмите, чтобы выбрать».
 * Должна лежать внутри <UppyContextProvider uppy={uppy}> — этого требует useDropzone.
 */
export function FileDropzone({ uppy, disabled = false }: Props) {
  // Файлы, которые не удалось добавить, с причиной.
  const [rejected, setRejected] = useState<Rejected[]>([]);

  const { getRootProps, getInputProps } = useDropzone({
    // Пришли новые файлы — старые сообщения об ошибках больше не нужны.
    onDrop: () => setRejected([]),
    onFileInputChange: () => setRejected([]),
  });

  // Uppy не добавил файл — запоминаем понятную причину.
  useUppyEvent(uppy, 'restriction-failed', (file) => {
    if (file) setRejected((list) => [...list, { name: file.name, reason: rejectionReason(uppy, file) }]);
  });

  // Если бросить файл мимо зоны, браузер откроет его сам и уйдёт со страницы.
  // Запрещаем это, пока зона на экране.
  useEffect(() => {
    const prevent = (event: DragEvent) => event.preventDefault();
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  return (
    <div>
      <div
        // Во время отправки формы зона не реагирует ни на клик, ни на перетаскивание.
        {...(disabled ? {} : getRootProps())}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        style={{
          border: '2px dashed #999',
          borderRadius: 8,
          padding: 24,
          textAlign: 'center',
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        Перетащите файлы сюда или нажмите, чтобы выбрать
        <input {...getInputProps()} hidden />
      </div>
      {rejected.length > 0 && (
        <ul role="alert">
          {rejected.map(({ name, reason }, index) => (
            <li key={index}>
              «{name}» не добавлен: {reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Почему Uppy не добавил файл. Проверяем те же ограничения, что заданы в UploadManager.createDraft.
function rejectionReason(uppy: Uppy, file: { id: string; name: string; size: number | null }): string {
  if (Object.hasOwn(uppy.getState().files, file.id)) return 'этот файл уже добавлен';
  if (!isAllowedFileName(file.name)) return 'такой формат не поддерживается';
  if ((file.size ?? 0) > MAX_FILE_SIZE) return `файл больше ${formatSize(MAX_FILE_SIZE)}`;
  // Других ограничений нет — значит, превышен общий размер загрузки.
  return `общий размер загрузки больше ${formatSize(MAX_BATCH_SIZE)}`;
}
