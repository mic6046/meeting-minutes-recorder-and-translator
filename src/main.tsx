import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {AppUpdateNotifier} from './hooks/useAppUpdate.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <AppUpdateNotifier />
  </StrictMode>,
);

// Register the PWA service worker so the app is installable on iPhone, Android, and PC.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* installability is a progressive enhancement; ignore registration failures */
    });
  });
}
