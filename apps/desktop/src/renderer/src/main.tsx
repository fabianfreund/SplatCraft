import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/app.css';

async function start() {
  // Plain-browser preview: install the mock bridge (never loaded in Electron).
  if (!window.splatcraft) {
    const { createMockApi } = await import('./lib/mock/mockApi');
    window.splatcraft = createMockApi();
  }
  const { App } = await import('./App');
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
