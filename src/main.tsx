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
