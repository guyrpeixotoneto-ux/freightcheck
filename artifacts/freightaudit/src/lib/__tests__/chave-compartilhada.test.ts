import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Duas consultas com a mesma chave são **uma** consulta — e o código precisa
 * saber disso.
 *
 * Este teste não é sobre a tela de Unidades. É sobre a regra que ela violou, e
 * existe porque a violação é invisível na revisão: dois arquivos distantes, cada
 * um com um `useQuery` perfeitamente razoável, e nada no meio que os obrigue a
 * concordar. O compilador não vê, o lint não vê, e a tela só acusa quando a rede
 * falha em produção.
 *
 * O que o React Query garante é isto: existe **um** objeto `Query` por chave,
 * com **uma** `queryFn` e **uma** política de repetição. Quando vários
 * observadores compartilham a chave, quem dispara a busca é quem define as duas
 * para todos — os outros apenas assinam o resultado. Chave igual com `queryFn`
 * diferente não é duplicação: é uma consulta cujo comportamento depende de qual
 * componente montou primeiro.
 *
 * Foi exatamente isso em `["contexts"]`: quatro `useQuery`, três `queryFn`, três
 * conjuntos de opções. A que rodava era a da barra lateral (o `Layout` monta em
 * volta, e efeitos do React correm de dentro para fora); ela traduzia
 * `!response.ok` em `[]` e trazia `retry: false`. O resultado, na tela que
 * responde pela lista: 502 e 401 viravam "nenhuma vigência importada ainda",
 * cinco tentativas viravam uma, e o único erro que sobrava para diagnosticar era
 * o `fetch` rejeitando — o que fazia o aviso afirmar sempre a mesma coisa.
 *
 * A regra que este teste prende: **para a mesma chave literal, `queryFn` e
 * `retry` têm de ser os mesmos.** Não "parecidos": os mesmos. Quando duas telas
 * precisam de comportamentos diferentes, ou a consulta vira uma função
 * compartilhada (`lib/contextos.ts`) ou as chaves se separam — que é o que
 * `components/layout/contadores.ts` já fazia com o sufixo `"casca"`.
 */

const RAIZ = path.resolve(import.meta.dirname, "..", "..");

function arquivosDeCodigo(dir: string): string[] {
  const achados: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const caminho = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name !== "__tests__") achados.push(...arquivosDeCodigo(caminho));
    } else if (/\.tsx?$/.test(entrada.name)) {
      achados.push(caminho);
    }
  }
  return achados;
}

/**
 * O bloco `{...}` que segue um `useQuery(`, por contagem de chaves.
 *
 * Contar chaves basta e é de propósito: a alternativa é um parser de TypeScript
 * dentro de um teste, e um teste que precisa de um compilador para afirmar uma
 * regra é um teste que ninguém conserta quando ele quebra. O custo desta escolha
 * é conhecido — chave dentro de string ou de comentário desalinha a contagem —,
 * e a proteção é a asserção de piso lá embaixo: se a varredura parar de
 * encontrar consultas, o teste falha em vez de passar vazio.
 */
function blocosDeUseQuery(fonte: string): { texto: string; linha: number }[] {
  const blocos: { texto: string; linha: number }[] = [];
  let i = 0;
  while ((i = fonte.indexOf("useQuery(", i)) !== -1) {
    const abre = fonte.indexOf("{", i);
    if (abre === -1) break;
    let nivel = 0;
    let j = abre;
    for (; j < fonte.length; j++) {
      if (fonte[j] === "{") nivel++;
      else if (fonte[j] === "}") {
        nivel--;
        if (nivel === 0) break;
      }
    }
    blocos.push({
      texto: fonte.slice(abre, j + 1),
      linha: fonte.slice(0, i).split("\n").length,
    });
    i = j + 1;
  }
  return blocos;
}

/**
 * Duas escritas da mesma busca não podem contar como divergência.
 *
 * Os genéricos saem porque `fetchJson<Categoria[]>(x)` e
 * `fetchJson<OpcaoDeCategoria[]>(x)` são a **mesma** chamada — o tipo é apagado
 * na compilação e não muda uma linha do que roda. Espaço em branco sai pelo
 * mesmo motivo. O que sobra é comportamento, que é o que a chave compartilha.
 */
function normalizar(trecho: string): string {
  return trecho
    .replace(/<[^<>()]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** O valor de uma propriedade do bloco, até a vírgula do mesmo nível. */
function propriedade(bloco: string, nome: string): string | null {
  const marca = new RegExp(`(^|[{,\\s])${nome}\\s*:`).exec(bloco);
  if (!marca) return null;
  let i = marca.index + marca[0].length;
  let nivel = 0;
  const inicio = i;
  for (; i < bloco.length; i++) {
    const c = bloco[i];
    if (c === "{" || c === "[" || c === "(") nivel++;
    else if (c === "}" || c === "]" || c === ")") {
      if (nivel === 0) break;
      nivel--;
    } else if (c === "," && nivel === 0) break;
  }
  return normalizar(bloco.slice(inicio, i));
}

interface Consulta {
  onde: string;
  chave: string;
  queryFn: string;
  retry: string;
}

function consultasComChaveLiteral(): Consulta[] {
  const consultas: Consulta[] = [];
  for (const arquivo of arquivosDeCodigo(RAIZ)) {
    const fonte = readFileSync(arquivo, "utf8");
    for (const bloco of blocosDeUseQuery(fonte)) {
      const chave = propriedade(bloco.texto, "queryKey");
      // Só chave literal: uma chave montada de variáveis é decidida em tempo de
      // execução, e afirmar coisa alguma sobre ela a partir do texto seria
      // inventar. As consultas compartilhadas de verdade (`lib/contextos.ts`)
      // passam a chave por constante, e é por isso que elas não caem aqui.
      if (chave === null || !chave.startsWith("[") || /[A-Za-z_$]/.test(chave[1] ?? "")) {
        continue;
      }
      consultas.push({
        onde: `${path.relative(RAIZ, arquivo)}:${bloco.linha}`,
        chave,
        queryFn: propriedade(bloco.texto, "queryFn") ?? "(sem queryFn)",
        retry: propriedade(bloco.texto, "retry") ?? "(padrão global)",
      });
    }
  }
  return consultas;
}

describe("chaves de consulta compartilhadas", () => {
  const consultas = consultasComChaveLiteral();

  /*
    A guarda contra o teste vazio. Uma varredura que deixa de encontrar
    consultas passa em silêncio e para de proteger — e é o desfecho mais
    provável de um refactor que mude a forma como as telas chamam `useQuery`.
  */
  it("a varredura encontra as consultas da aplicação", () => {
    expect(consultas.length).toBeGreaterThan(50);
  });

  it("a mesma chave literal nunca tem duas queryFn ou duas políticas de repetição", () => {
    const porChave = new Map<string, Consulta[]>();
    for (const consulta of consultas) {
      const lista = porChave.get(consulta.chave) ?? [];
      lista.push(consulta);
      porChave.set(consulta.chave, lista);
    }

    const divergentes: string[] = [];
    for (const [chave, lista] of porChave) {
      if (lista.length < 2) continue;
      const fns = new Set(lista.map((c) => c.queryFn));
      const retries = new Set(lista.map((c) => c.retry));
      if (fns.size === 1 && retries.size === 1) continue;
      divergentes.push(
        `\n${chave} — ${lista.length} consultas, ${fns.size} queryFn, ${retries.size} políticas:\n` +
          lista
            .map((c) => `    ${c.onde}\n        queryFn: ${c.queryFn.slice(0, 100)}\n        retry:   ${c.retry}`)
            .join("\n"),
      );
    }

    expect(
      divergentes.join(""),
      "Chaves iguais são a mesma consulta no cache: quem disparar a busca dita a " +
        "queryFn e o retry para todos os observadores. Compartilhe a consulta " +
        "(como lib/contextos.ts) ou separe as chaves (como o sufixo \"casca\" de " +
        "components/layout/contadores.ts).",
    ).toBe("");
  });
});
