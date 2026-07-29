import { createRoot } from 'react-dom/client'
import './index.css'
import RootApp from './RootApp.tsx'

createRoot(document.getElementById('root')!).render(
  <RootApp />,
)
