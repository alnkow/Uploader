import type Uppy from '@uppy/core';
import { useUppyState } from '@uppy/react';
import { formatSize } from '../formatSize';

type Props = {
  uppy: Uppy;
  disabled?: boolean;
};

/** Список выбранных в форме файлов с кнопкой «Убрать». */
export function FileList({ uppy, disabled = false }: Props) {
  const files = Object.values(useUppyState(uppy, (state) => state.files));
  if (files.length === 0) return null;

  return (
    <ul>
      {files.map((file) => (
        <li key={file.id}>
          {file.name} — {formatSize(file.size ?? 0)}{' '}
          {/* Файл ещё не загружался, поэтому убрать его безопасно: на сервере ничего нет. */}
          <button type="button" disabled={disabled} onClick={() => uppy.removeFile(file.id)}>
            Убрать
          </button>
        </li>
      ))}
    </ul>
  );
}
