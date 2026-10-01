import { createRoot } from 'react-dom/client';
import { App } from '../apps/web/components/App';
import '../apps/web/app/globals.css';

createRoot(document.getElementById('root')!).render(<App />);
