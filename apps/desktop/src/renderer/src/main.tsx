import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/app.css';

async function start() {
  // Plain-browser preview: install the mock bridge (never loaded in Electron).
  if (!window.splatcraft) {
    const { createMockApi } = await import('./lib/mock/mockApi');
    window.splatcraft = createMockApi();
  }
  const { bindPrefs } = await import('./store/prefs');
  bindPrefs();
  (await import('./lib/scrollPolish')).bindScrollPolish();
  // `?kit` renders the component catalog instead of the app (dev aid).
  const Root = new URLSearchParams(location.search).has('kit') ? (await import('./dev/UiKit')).UiKit : (await import('./App')).App;
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
}

void start();
