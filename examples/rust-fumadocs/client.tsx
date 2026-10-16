import { hydrateRoot } from 'react-dom/client';
import { Document } from './Document.tsx';

hydrateRoot(document, <Document pathname={window.location.pathname} />);
