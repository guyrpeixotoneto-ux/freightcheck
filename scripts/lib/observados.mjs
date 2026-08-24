/**
 * O que, ao mudar, torna obsoleto o que o api-server está servindo.
 *
 * Morava dentro de `dev.mjs`, como `watchedSourceDirs()`, e listava só os
 * `src/`. A lista estava incompleta, e a falta tinha efeito visível: o bundle
 * do api-server **carrega as migrations junto** — `build.mjs` copia
 * `lib/db/migrations` para `dist/migrations`, para que o servidor as encontre
 * em qualquer ambiente. Um `git pull` que trouxesse apenas `.sql` novo não
 * mexia em nenhum `src/`, nada disparava o rebuild, o processo continuava de pé
 * com a pasta antiga — e, como quem aplica a fila é o servidor **na partida**
 * (`deveMigrarNaPartida`, em NODE_ENV=development), sem reinício não havia
 * partida e sem partida não havia migration. Development ficava atrás do build
 * em silêncio, até alguém abrir uma tela e o portão de prontidão recusar.
 *
 * Migration nova é, para este processo, a mesma categoria de mudança que código
 * novo: o que está rodando deixou de ser o que o repositório diz. Por isso ela
 * entra na mesma lista, e não numa segunda máquina de observar com regra
 * própria — duas listas divergem, e a divergência aqui é invisível até o dia em
 * que custa uma tarde.
 *
 * **Só o que o repositório escreve à mão.** Nada de `dist/` nem de
 * `node_modules/`: `dist/migrations` é *produzido* pelo rebuild, e observá-lo
 * faria o rebuild disparar a si mesmo. A pasta observada é a de origem, que só
 * muda por pull, por `drizzle-kit generate` ou por mão humana — nunca por
 * efeito de subir o servidor, e nunca por aplicar a fila, que escreve no banco
 * e não no disco.
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Os diretórios que o `dev.mjs` observa para decidir reconstruir e reiniciar.
 *
 * Recebe a raiz por parâmetro — e não a deduz de `import.meta.url` — porque é o
 * que permite prová-la sobre uma árvore de mentira, sem depender do formato do
 * repositório de verdade no dia do teste.
 *
 * @param {string} root raiz do repositório
 * @returns {string[]} caminhos absolutos existentes, sem repetição
 */
export function diretoriosObservados(root) {
  const dirs = [];

  const apiSrc = path.join(root, "artifacts/api-server/src");
  if (existsSync(apiSrc)) dirs.push(apiSrc);

  const libRoot = path.join(root, "lib");
  if (existsSync(libRoot)) {
    for (const entry of readdirSync(libRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const src = path.join(libRoot, entry.name, "src");
      if (existsSync(src)) dirs.push(src);
    }
  }

  /*
    A fila versionada. Vem depois dos `src/` só por leitura; a ordem não
    significa nada para quem observa, porque o efeito de qualquer um deles é o
    mesmo: reconstruir e reiniciar, uma vez, com debounce.
  */
  const migrations = path.join(root, "lib/db/migrations");
  if (existsSync(migrations)) dirs.push(migrations);

  return dirs;
}
