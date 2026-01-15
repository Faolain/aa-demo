import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import App from './App'
import './index.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root container element #root not found')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
    <Toaster
      position="bottom-right"
      richColors
      toastOptions={{
        style: {
          maxHeight: '200px',
          overflowY: 'auto',
        },
      }}
    />
  </StrictMode>
)
