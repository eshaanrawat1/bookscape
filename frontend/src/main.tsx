import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ToastProvider from './components/ui/ToastProvider'
import './styles.css'

// Above App because App itself raises toasts.
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>
)
