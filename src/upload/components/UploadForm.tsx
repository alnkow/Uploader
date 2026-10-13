import { useForm } from 'react-hook-form';
import { UppyContextProvider } from '@uppy/react';
import { useUploadDraft } from '../hooks';
import type { UploadManager } from '../UploadManager';
import { FileDropzone } from './FileDropzone';
import { FileList } from './FileList';

type FormValues = {
  dataType: string;
};

type Props = {
  manager: UploadManager;
  /**
   * Вызывается, когда загрузка поставлена в очередь. Родитель закрывает форму
   * (или пересоздаёт её через key), чтобы следующая загрузка началась с чистого листа.
   */
  onSubmitted: () => void;
};

/**
 * Форма новой загрузки: тип данных и файлы.
 * Сами файлы живут в черновике Uppy, а не в состоянии формы.
 */
export function UploadForm({ manager, onSubmitted }: Props) {
  const draft = useUploadDraft(manager);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: { dataType: 'photo' } });

  // Черновик создаётся сразу после первой отрисовки.
  if (!draft) return null;

  const onSubmit = async ({ dataType }: FormValues) => {
    if (draft.getFiles().length === 0) {
      setError('root.files', { message: 'Добавьте хотя бы один файл' });
      return;
    }
    try {
      // Поля метаданных для каждого типа данных добавим, когда аналитик даст их список (вопрос Q6).
      await manager.startBatch(draft, { dataType, metadata: {} });
      onSubmitted();
    } catch {
      setError('root.server', { message: 'Не удалось начать загрузку. Попробуйте ещё раз.' });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <label>
        Тип данных{' '}
        <select {...register('dataType')}>
          <option value="photo">Фото</option>
          <option value="video">Видео</option>
          <option value="mbtiles">MBTiles</option>
        </select>
      </label>




      <UppyContextProvider uppy={draft}>
        <FileDropzone uppy={draft} disabled={isSubmitting} />
      </UppyContextProvider>






      <FileList uppy={draft} disabled={isSubmitting} />

      {errors.root?.files && <p role="alert">{errors.root.files.message}</p>}
      {errors.root?.server && <p role="alert">{errors.root.server.message}</p>}

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Отправка…' : 'Загрузить'}
      </button>
    </form>
  );
}
