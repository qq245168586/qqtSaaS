import '@ant-design/v5-patch-for-react-19';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './legacy-print.css';
import './print-templates.css';
import './style.css';
function reportRendererError(kind: 'error' | 'rejection', error: unknown) {
  const stack = error instanceof Error ? (error.stack ?? '') : '';
  const frames = stack
    .split('\n')
    .slice(1)
    .flatMap((line) => {
      const match = line.match(/(?:[/\\])([a-zA-Z0-9_.-]+\.[cm]?js:\d+:\d+)\)?$/);
      return match ? [match[1].slice(0, 120)] : [];
    })
    .slice(0, 8);
  void window.desktop.reportRendererError({ kind, frames }).catch(() => undefined);
}
window.addEventListener('error', (event) => reportRendererError('error', event.error));
window.addEventListener('unhandledrejection', (event) =>
  reportRendererError('rejection', event.reason),
);
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
