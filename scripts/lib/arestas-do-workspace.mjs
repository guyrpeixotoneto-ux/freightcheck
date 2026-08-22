/**
 * As arestas do workspace: quem declara depender de quem, e se o link existe.
 *
 * ---------------------------------------------------------------------------
 * O defeito que este módulo existe para nomear
 * ---------------------------------------------------------------------------
 * `Could not resolve "@workspace/coverage"`, do esbuild, apontando para
 * `lib/assistant/src/aprofundar.ts`. Tudo o que se confere primeiro estava
 * certo: a dependência **declarada** como `workspace:*` no `package.json` de
 * quem importa, o `pnpm-lock.yaml` íntegro, `pnpm install --frozen-lockfile`
 * passando, o símbolo exportado pelo `src/index.ts` do pacote, e um symlink
 * `@workspace/coverage` existindo — em `artifacts/api-server/node_modules/`.
 *
 * O que faltava era o link **do pacote que importa**:
 * `lib/assistant/node_modules/@workspace/coverage`. O pnpm liga por pacote que
 * declara, não por workspace; um `node_modules` montado antes de a dependência
 * ser acrescentada tem todas as outras arestas e não tem aquela. Como só uma
 * aresta é nova, só um specifier falha — e "só o `@workspace/coverage` não
 * resolve" soa como defeito daquele pacote (exports? falta um `dist`? o
 * bundler?) quando é o estado do `node_modules` deste workspace.
 *
 * Medido: com o link no lugar, `import.meta.resolve` e o esbuild resolvem os
 * dois; removendo **só** aquele link, os dois falham, e o esbuild falha com
 * exatamente a mensagem acima. Não há nada de particular no `coverage` — ele
 * só era a aresta mais nova do repositório.
 *
 * ---------------------------------------------------------------------------
 * Por que a conferência mora aqui, e não numa mensagem de erro melhor
 * ---------------------------------------------------------------------------
 * A mensagem do bundler nomeia o **import**; a causa é uma ausência a dois
 * diretórios de distância, e nenhum bundler tem como saber disso. Quem sabe é
 * quem consegue comparar o grafo declarado com os links no disco — que é uma
 * varredura de milissegundos, sem rede e sem gerenciador de pacotes.
 *
 * **Este módulo não invoca o pnpm, e isso é regra da partida, não estilo.** O
 * caminho que abre a porta não passa pelo gerenciador de pacotes — um pnpm em
 * laço no contêiner já deixou as duas portas mudas por 90 segundos, sem
 * mensagem (ver `scripts/__tests__/startup-sem-pnpm.test.mjs`). Aqui se lê o
 * disco e se **diz** o comando; quem o digita é uma pessoa.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** O prefixo dos pacotes deste repositório. */
const ESCOPO = "@workspace/";

/**
 * Os globos de `pnpm-workspace.yaml`, lidos do arquivo e não copiados aqui.
 *
 * Duplicar a lista faria a conferência ficar cega para um diretório novo
 * exatamente no dia em que ele fosse criado — e um pacote recém-criado é o
 * caso mais provável de aresta que ninguém instalou ainda. O formato do bloco
 * é uma lista simples (`  - lib/*`), e é só isso que se lê: nada aqui depende
 * de um parser de YAML completo.
 */
export function globosDoWorkspace(texto) {
  const linhas = texto.split("\n");
  const inicio = linhas.findIndex((l) => /^packages:\s*$/.test(l));
  if (inicio === -1) return [];

  const globos = [];
  for (const linha of linhas.slice(inicio + 1)) {
    const item = /^\s+-\s+["']?([^"'#\s]+)["']?\s*$/.exec(linha);
    if (!item) break; // a lista acabou no primeiro item que não é item
    globos.push(item[1]);
  }
  return globos;
}

/** `lib/*` → os diretórios de `lib`; `scripts` → ele mesmo. Um nível só, que é o que os globos usam. */
function diretoriosDe(raiz, glob) {
  if (!glob.endsWith("/*")) return [path.join(raiz, glob)];
  const pai = path.join(raiz, glob.slice(0, -2));
  if (!existsSync(pai)) return [];
  return readdirSync(pai, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(pai, e.name));
}

/**
 * Os pacotes do workspace, com o manifesto de cada um.
 *
 * Devolve `{ nome, dir, manifesto }` — `dir` absoluto, porque é dele que sai o
 * caminho do link que se confere adiante.
 */
export function lerPacotes(raiz) {
  const globos = globosDoWorkspace(
    readFileSync(path.join(raiz, "pnpm-workspace.yaml"), "utf8"),
  );

  const pacotes = [];
  for (const glob of globos) {
    for (const dir of diretoriosDe(raiz, glob)) {
      const manifestoPath = path.join(dir, "package.json");
      if (!existsSync(manifestoPath)) continue;
      const manifesto = JSON.parse(readFileSync(manifestoPath, "utf8"));
      if (typeof manifesto.name !== "string") continue;
      pacotes.push({ nome: manifesto.name, dir, manifesto });
    }
  }
  return pacotes;
}

/**
 * Toda dependência `@workspace/*` declarada, venha de onde vier.
 *
 * `devDependencies` entra junto: o build de um artifact e a suíte de um pacote
 * resolvem pelo mesmo `node_modules`, e uma aresta de desenvolvimento ausente
 * quebra do mesmo jeito — só que num comando diferente.
 *
 * Pura: recebe os manifestos, devolve as arestas. É o que permite provar a
 * classificação sem montar um workspace de mentira no disco.
 */
export function arestasDeclaradas(pacotes) {
  const arestas = [];
  for (const { nome, dir, manifesto } of pacotes) {
    for (const campo of ["dependencies", "devDependencies"]) {
      for (const dependencia of Object.keys(manifesto[campo] ?? {})) {
        if (!dependencia.startsWith(ESCOPO)) continue;
        arestas.push({ pacote: nome, dir, dependencia });
      }
    }
  }
  return arestas;
}

/**
 * As arestas declaradas que não estão no disco.
 *
 * `existe` é injetado para a prova; em produção é o `existsSync`, que **segue**
 * o symlink — de propósito: um link pendurado (apontando para um diretório que
 * não existe mais) é tão inútil quanto link nenhum, e tem de sair na mesma
 * lista.
 */
export function arestasQuebradas(arestas, existe) {
  return arestas.filter(
    ({ dir, dependencia }) =>
      !existe(path.join(dir, "node_modules", dependencia)),
  );
}

/** `lib/assistant` — o caminho como se lê num aviso, sem a raiz da máquina. */
const relativo = (raiz, dir) => path.relative(raiz, dir) || ".";

/**
 * O aviso: o que falta, onde, e o que resolve.
 *
 * A frase nomeia o **link ausente**, e não o import que vai falhar. Quem lê a
 * mensagem do bundler já tem o import; o que falta a ele é a distância entre o
 * import e a causa — e é justamente essa distância que faz a investigação
 * começar pelo `exports` do pacote errado.
 *
 * Quando o mesmo pacote está linkado em **outro** lugar, isso vai escrito. É a
 * observação que mais custou nesta investigação: "o symlink existe" era
 * verdade, e sobre o diretório errado.
 */
export function frase(quebradas, raiz, existe = existsSync) {
  if (quebradas.length === 0) return null;

  const linhas = quebradas.map(({ pacote, dir, dependencia }) => {
    const onde = `${relativo(raiz, dir)}/node_modules/${dependencia}`;
    return `  - ${dependencia}: declarada por ${pacote} e ausente em ${onde}`;
  });

  const alhures = quebradas
    .map(({ dependencia }) => dependencia)
    .filter((dependencia, i, todas) => todas.indexOf(dependencia) === i)
    .filter((dependencia) =>
      lerPacotes(raiz).some(
        ({ dir }) =>
          !quebradas.some(
            (q) => q.dependencia === dependencia && q.dir === dir,
          ) && existe(path.join(dir, "node_modules", dependencia)),
      ),
    );

  /*
    A cura vem na primeira linha, e é por causa de onde esta frase termina: o
    explicador da porta corta a saída em 500 caracteres (ver `tail`, em
    `api-supervisor.mjs`), e a primeira versão disto morria em "Resolve com um
    coma…" — a única linha que quem lê precisa digitar. Detalhe abaixo,
    comando acima.
  */
  return [
    `O node_modules deste workspace está atrás do que os package.json ` +
      `declaram: rode \`pnpm install --frozen-lockfile\` na raiz. ` +
      `${quebradas.length} aresta(s) sem link:`,
    ...linhas,
    alhures.length > 0
      ? `Atenção: ${alhures.join(", ")} está linkado em outro pacote, e isso não ` +
        `ajuda — o pnpm liga por pacote que declara, e quem importa é o de cima.`
      : null,
    `Não é defeito do pacote importado nem do bundler: o import não tem como ` +
      `resolver enquanto o link não existir.`,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

/**
 * A conferência inteira, do disco: o que falta e a frase que o diz.
 *
 * `{ quebradas: [], frase: null }` quando está tudo no lugar — e é assim que
 * ela custa nada no caminho feliz, que é o que permite chamá-la antes de todo
 * build sem pôr nada entre o workflow e a porta.
 */
export function conferirArestas(raiz, existe = existsSync) {
  const quebradas = arestasQuebradas(
    arestasDeclaradas(lerPacotes(raiz)),
    existe,
  );
  return { quebradas, frase: frase(quebradas, raiz, existe) };
}

/**
 * A mesma conferência, disparada por uma falha de resolução já acontecida.
 *
 * Existe para o caso que a varredura preventiva não cobre: o import de um
 * **subcaminho** (`@workspace/curation/significado`). Ali o link está no lugar
 * e o que falta é a entrada em `exports` do pacote importado — outra causa,
 * outro conserto, e dizer "rode install" seria mandar repetir um comando que
 * não muda nada.
 */
export function explicarFalhaDeResolucao(saida, raiz, existe = existsSync) {
  const specifiers = [
    ...new Set(
      [...String(saida).matchAll(/Could not resolve "(@workspace\/[^"]+)"/g)].map(
        (m) => m[1],
      ),
    ),
  ];
  if (specifiers.length === 0) return null;

  const pacotes = lerPacotes(raiz);
  const explicacoes = specifiers.map((specifier) => {
    const [escopo, nome, ...resto] = specifier.split("/");
    const pacote = `${escopo}/${nome}`;
    const subcaminho = resto.length > 0;

    const semLink = pacotes
      .filter(({ dir }) => !existe(path.join(dir, "node_modules", pacote)))
      .filter(({ manifesto }) =>
        [manifesto.dependencies, manifesto.devDependencies].some(
          (deps) => deps?.[pacote] !== undefined,
        ),
      )
      .map(({ dir }) => relativo(raiz, dir));

    if (semLink.length > 0) {
      return (
        `${specifier}: ${pacote} não está linkado em ${semLink.join(", ")} — ` +
        `node_modules atrás do workspace. Rode \`pnpm install --frozen-lockfile\`.`
      );
    }
    if (subcaminho) {
      return (
        `${specifier}: ${pacote} está linkado, então o que falta é o subcaminho ` +
        `"./${resto.join("/")}" no "exports" de ${pacote}/package.json.`
      );
    }
    return (
      `${specifier}: o link existe e o import não resolve — confira o "exports" ` +
      `e o arquivo que ele aponta em ${pacote}/package.json.`
    );
  });

  return explicacoes.join("\n");
}
