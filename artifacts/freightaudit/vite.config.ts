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

/**
 * Código de servidor no bundle do navegador derruba o build, em vez de apagar a
 * tela em produção.
 *
 * Foi assim que o produto inteiro passou a abrir em branco: uma função de três
 * linhas importada do índice de `@workspace/curation` arrastou `@workspace/db`,
 * `drizzle-orm` e o `pg` inteiro para dentro do bundle. O `pg` pede `net`,
 * `tls`, `fs`, `crypto`; o Vite troca cada um por um substituto vazio e
 * **avisa** — e aviso no meio de um build verde não é lido por ninguém. No
 * navegador o `pg` toca `Buffer` ao ser avaliado, `Buffer` não existe ali, e o
 * erro estoura antes de `createRoot().render()` — antes, portanto, do
 * `ErrorBoundary`, que só protege o que já montou. O resultado é `#root` vazio,
 * nenhuma mensagem, e do lado de fora isso é indistinguível de um servidor fora
 * do ar.
 *
 * O sintoma é caríssimo e a causa é barata de detectar: módulo que roda no
 * navegador não tem por que importar builtin do Node. O aviso que já existia
 * passa a ser o erro que ele sempre foi.
 *
 * Isto deixa a versão anterior publicada quando alguém erra — o que é ruim, e é
 * muito melhor do que publicar uma tela em branco: o defeito aparece no log do
 * deploy, com o nome do módulo e de quem o importou, em vez de aparecer para
 * quem ia usar o sistema.
 */
function recusarBuiltinDoNode(aviso: { message: string }): void {
  if (
    aviso.message.includes('has been externalized for browser compatibility')
  ) {
    throw new Error(
      `Código de servidor entrou no bundle do navegador.\n\n${aviso.message}\n\n` +
        'Importe do subcaminho que não fala com o banco — ' +
        '`@workspace/curation/significado`, `@workspace/curation/equipamento` — ' +
        'em vez do índice do pacote.',
    );
  }
}

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
    rollupOptions: {
      onwarn(aviso, avisar) {
        recusarBuiltinDoNode(aviso);
        avisar(aviso);
      },
    },
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
