import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';

import App from './App';
import {installInternalNavigation} from './navigation';

installInternalNavigation();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
