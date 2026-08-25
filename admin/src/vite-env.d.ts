/// <reference types="vite/client" />

import type {HTMLAttributes} from 'react';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      's-app-nav': HTMLAttributes<HTMLElement>;
      's-link': HTMLAttributes<HTMLElement> & {href: string; rel?: 'home'};
    }
  }
}

export {};
