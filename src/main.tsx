import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ensureSecureStorageReady, installApiInterceptor } from './lib/apiClient';
import { applyThemePreference, getThemePreference } from './lib/theme';
import './index.css';

installApiInterceptor();
applyThemePreference(getThemePreference());

void ensureSecureStorageReady().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
});
