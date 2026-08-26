import {shopifyFunctionPlugin} from '@shopify/shopify_function';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [shopifyFunctionPlugin()],
});
