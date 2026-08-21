import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ToastProvider from './components/ToastProvider'
import './styles.css'

// Above App rather than inside it: App's own vault actions raise toasts, and a
// component cannot consume a context it renders the provider for.
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>
)
