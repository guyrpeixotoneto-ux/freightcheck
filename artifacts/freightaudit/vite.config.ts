import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

/**
 * `PORT` é exigido para servir, não para construir.
 *
 * Este arquivo exigia a porta ao ser carregado, e `vite build` carrega o mesmo
 * arquivo: sem `PORT` no ambiente, o build de produção morria antes de gerar um
 * único asset — e um build que falha no deploy deixa publicada a versão
 * anterior, que é indistinguível, do navegador, de um deploy que deu certo. Um
 * bundle estático não tem porta; exigir uma para produzi-lo é pedir uma coisa
 * que não existe naquele momento.
 */
function servePort(): number {
  const rawPort = process.env.PORT;

  if (!rawPort) {
    throw new Error(
      'PORT environment variable is required but was not provided.',
    );
  }

  const port = Number(rawPort);

  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  return port;
}

/**
 * `BASE_PATH` muda o conteúdo gerado — é o prefixo dos assets no `index.html` —
 * então ele vale no build. O padrão é o mesmo `/` que o artifact declara, para
 * que a ausência da variável não derrube o build nem mude o resultado.
 */
const basePath = process.env.BASE_PATH ?? '/';

// `async` porque os plugins do Replit são carregados sob demanda logo abaixo.
export default defineConfig(async ({ command }) => ({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port: command === 'serve' ? servePort() : undefined,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
    // On Replit the platform router mounts the API at /api. Outside it — local
    // dev, CI, a screenshot run — set API_PROXY_TARGET to point /api at a
    // locally running api-server. Unset, this changes nothing.
    proxy: process.env.API_PROXY_TARGET
      ? {
          // No path rewrite: the server itself mounts its router at /api,
          // matching how the Replit router forwards the full path.
          '/api': {
            target: process.env.API_PROXY_TARGET,
            changeOrigin: true,
          },
        }
      : undefined,
  },
  preview: {
    port: command === 'serve' ? servePort() : undefined,
    host: '0.0.0.0',
    allowedHosts: true,
  },
}));
