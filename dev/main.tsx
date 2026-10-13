// Страница для локальной проверки загрузки. Работает с заглушкой бэкенда (dev/mock-server.mjs).
// В основное приложение не переносится: там будет своя разметка.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { uploadManager } from '../src/services/Uploader';
import { BatchList } from '../src/upload/components/BatchList';
import { UploadForm } from '../src/upload/components/UploadForm';

function App() {
  const [formOpen, setFormOpen] = useState(true);
  // Новый key — новая пустая форма после отправки.
  const [formKey, setFormKey] = useState(0);

  return (
    <main style={{ maxWidth: 760, margin: '24px auto', padding: '0 16px', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Проверка загрузки</h1>
      {formOpen ? (
        <section style={{ border: '1px solid #ccc', borderRadius: 8, padding: 16 }}>
          <UploadForm key={formKey} manager={uploadManager} onSubmitted={() => setFormKey((key) => key + 1)} />
          <p>
            <button type="button" onClick={() => setFormOpen(false)}>
              Закрыть форму
            </button>
          </p>
        </section>
      ) : (
        <button type="button" onClick={() => setFormOpen(true)}>
          Новая загрузка
        </button>
      )}
      <h2>Загрузки</h2>
      <BatchList manager={uploadManager} />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
