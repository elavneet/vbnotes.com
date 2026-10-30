import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './app.css';

// The window's buttons sit over the sidebar on macOS (`titleBarStyle: Overlay`).
if (/Mac/.test(navigator.platform)) document.documentElement.classList.add('mac');

createRoot(document.getElementById('root')!).render(<App />);
