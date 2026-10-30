import React from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from './Editor';

declare global {
  interface Window { contentInjected: boolean | undefined }
}

// Android injects the boot config after load; wait for it before rendering.
const interval = setInterval(() => {
  if (!window.contentInjected) return;
  const container = document.getElementById('root');
  createRoot(container!).render(<Editor />);
  clearInterval(interval);
}, 1);
