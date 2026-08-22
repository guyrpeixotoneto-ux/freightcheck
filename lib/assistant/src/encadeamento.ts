/**
 * A diferença entre consultar muito e investigar — medida, e não afirmada.
 *
 * **O erro que este módulo existe para não cometer.** "O agente fez dez
 * consultas" é um número que soa como profundidade e quase nunca é. Dez buscas
 * disparadas na mesma rodada foram todas decididas **antes** de qualquer
 * resultado existir: são largura pré-planejada. O que separa investigar de
 * consultar muito é uma consulta cujo argumento **não existia** antes de outra
 * consulta voltar — "achei o parâmetro que mais pesou; agora abro as linhas
 * dele". Essa é uma decisão tomada depois de ver o dado, e é a única forma de
 * encadeamento que se pode verificar sem perguntar ao modelo o que ele quis
 * dizer.
 *
 * **Três exclusões, e cada uma tapa um jeito de inflar a métrica.**
 *
 * 1. *A rodada.* Duas consultas pedidas no mesmo `tool_use` partiram juntas; a
 *    segunda não pôde reagir à primeira, mesmo que por acaso um argumento dela
 *    apareça no resultado da outra. Sem esta exclusão, um leque paralelo se
 *    reporta como cadeia — exatamente a leitura que o relatório não pode dar.
 * 2. *A pergunta.* Um valor que a pessoa escreveu não foi descoberto por
 *    consulta nenhuma. `alteracoes(equipamento: "CAVALO")` depois de "e nos
 *    cavalos?" não é encadeamento: é obediência.
 * 3. *O que já se tinha usado.* Se o mesmo valor já era argumento de uma
 *    consulta anterior à candidata a origem, ele não foi aprendido ali.
 *
 * **E uma restrição de forma:** só argumento de texto, com quatro caracteres ou
 * mais. Um `limite: 100` casa com quase qualquer resultado, e o que se
 * descobre neste domínio — código de parâmetro, placa, vigência, rótulo de
 * grupo — é texto. Contar inteiros transformaria paginação em investigação.
 *
 * **Sobre o caminho determinístico.** Ele não tem `tool_use`: quem escolhe a
 * próxima consulta é o código. Mas a pergunta é a mesma — *este argumento
 * existia antes daquela consulta voltar?* —, e por isso o aprofundamento
 * declara os seus passos na mesma forma (`Encadeamento`), em vez de os deduzir.
 * Um encadeamento declarado por quem o executou é mais forte que um inferido de
 * texto; os dois convivem porque medem a mesma coisa nas duas evidências
 * disponíveis.
 */

/** Uma consulta, no mínimo que a medida precisa saber sobre ela. */
export interface ConsultaMedivel {
  nome: string;
  argumentos: unknown;
  /** O que ela devolveu — onde um valor pode ter sido descoberto. */
  conteudo: unknown;
  /**
   * Em que ida ao modelo ela foi pedida.
   *
   * Ausente no caminho determinístico e nos registros antigos; nesse caso a
   * ordem da lista é o que resta, e a medida recai sobre ela. Ver a exclusão 1.
   */
  rodada?: number | undefined;
}

export interface Encadeamento {
  /** O índice da consulta que reagiu. */
  consulta: number;
  /** O índice da consulta de cujo resultado o argumento saiu. */
  derivaDe: number;
  /** Em que argumento o valor entrou. */
  campo: string;
  /** O valor que não existia antes. */
  valor: string;
}

/** O tamanho mínimo de um texto para ele ser considerado uma descoberta. */
const MINIMO = 4;

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Os argumentos de texto de uma chamada, com o campo em que cada um entrou. */
function textuais(argumentos: unknown): { campo: string; valor: string }[] {
  if (!argumentos || typeof argumentos !== "object" || Array.isArray(argumentos)) return [];
  const saida: { campo: string; valor: string }[] = [];
  for (const [campo, valor] of Object.entries(argumentos as Record<string, unknown>)) {
    if (typeof valor === "string" && valor.trim().length >= MINIMO) {
      saida.push({ campo, valor: valor.trim() });
    }
    if (Array.isArray(valor)) {
      for (const item of valor) {
        if (typeof item === "string" && item.trim().length >= MINIMO) {
          saida.push({ campo, valor: item.trim() });
        }
      }
    }
  }
  return saida;
}

/**
 * Os encadeamentos verdadeiros de uma investigação.
 *
 * Uma consulta pode encadear-se a mais de uma anterior; devolve-se a mais
 * recente que explica cada argumento, e um registro por argumento explicado.
 * Duas descobertas na mesma consulta são duas razões para ela ter acontecido, e
 * o relatório fica mais honesto mostrando as duas do que escolhendo uma.
 */
export function encadeamentosDe(
  consultas: readonly ConsultaMedivel[],
  pergunta = "",
): Encadeamento[] {
  const conteudos = consultas.map((c) => normalizar(JSON.stringify(c.conteudo ?? null)));
  const frase = normalizar(pergunta);
  const argumentosDe = consultas.map((c) => textuais(c.argumentos));

  const saida: Encadeamento[] = [];

  for (let i = 0; i < consultas.length; i++) {
    const rodadaAtual = consultas[i]!.rodada;

    for (const { campo, valor } of argumentosDe[i]!) {
      const agulha = normalizar(valor);

      // Exclusão 2 — o valor veio de quem perguntou, não de consulta nenhuma.
      if (frase.includes(agulha)) continue;

      for (let j = i - 1; j >= 0; j--) {
        // Exclusão 1 — pedidas na mesma rodada, decididas antes de qualquer
        // resultado. Sem rodada declarada, a ordem da lista é o que resta.
        const rodadaAnterior = consultas[j]!.rodada;
        if (
          rodadaAtual !== undefined &&
          rodadaAnterior !== undefined &&
          rodadaAnterior >= rodadaAtual
        ) {
          continue;
        }

        if (!conteudos[j]!.includes(agulha)) continue;

        /*
          Exclusão 3 — já se tinha o valor antes de #j voltar.

          A janela é "toda consulta decidida antes de #j ter resultado": no
          caminho do agente, as das rodadas até a de #j inclusive; sem rodada
          declarada, as de índice até j. Encontrar o valor ali significa que ele
          não foi aprendido em #j.
        */
        let jaUsado = false;
        for (let k = 0; k < i; k++) {
          const rodadaK = consultas[k]!.rodada;
          const decididaAntes =
            rodadaAnterior !== undefined && rodadaK !== undefined
              ? rodadaK <= rodadaAnterior
              : k <= j;
          if (!decididaAntes) continue;
          if (argumentosDe[k]!.some((a) => normalizar(a.valor) === agulha)) {
            jaUsado = true;
            break;
          }
        }
        if (jaUsado) break;

        saida.push({ consulta: i, derivaDe: j, campo, valor });
        break;
      }
    }
  }

  return saida;
}

/**
 * Quantas **consultas** reagiram a um resultado anterior.
 *
 * Conta consultas, não razões: uma consulta que usou dois valores descobertos é
 * um encadeamento, não dois. É o número que vai para o relatório e para o
 * painel, e é o que a meta "≥3 encadeamentos em causa raiz" mede.
 */
export function quantosEncadeamentos(encadeamentos: readonly Encadeamento[]): number {
  return new Set(encadeamentos.map((e) => e.consulta)).size;
}

/**
 * Para cada consulta, de qual anterior ela saiu — a forma que o rastro guarda.
 *
 * `null` significa "não encadeada", que é o correto para uma consulta de
 * abertura e para toda a largura pré-planejada.
 */
export function derivacaoPorConsulta(
  quantas: number,
  encadeamentos: readonly Encadeamento[],
): (number | null)[] {
  const mapa = new Array<number | null>(quantas).fill(null);
  for (const e of encadeamentos) {
    if (e.consulta < quantas && mapa[e.consulta] === null) mapa[e.consulta] = e.derivaDe;
  }
  return mapa;
}

/**
 * O encadeamento em uma linha técnica e curta — para o painel e o relatório.
 *
 * "#2 → #3: «cavalo.finame» saiu de #2 e entrou em `atributo`". Não é
 * raciocínio do modelo: é o que aconteceu com os argumentos, lido do log.
 */
export function explicarEncadeamento(
  e: Encadeamento,
  consultas: readonly ConsultaMedivel[],
): string {
  const de = consultas[e.derivaDe]?.nome ?? "?";
  const para = consultas[e.consulta]?.nome ?? "?";
  return (
    `#${e.derivaDe + 1} ${de} → #${e.consulta + 1} ${para}: ` +
    `"${e.valor}" saiu do resultado de #${e.derivaDe + 1} e entrou em ${e.campo}`
  );
}

/**
 * A **largura pré-planejada**: consultas decididas antes de qualquer resultado.
 *
 * O contraponto explícito do encadeamento, e a razão de ele ser publicado ao
 * lado. Uma investigação de dez consultas com nove pré-planejadas e uma
 * encadeada não é a mesma coisa que uma de quatro com três encadeadas, e sem os
 * dois números lado a lado as duas se reportam como "dez" e "quatro".
 */
export function preplanejadas(
  consultas: readonly ConsultaMedivel[],
  encadeamentos: readonly Encadeamento[],
): number {
  const reagiram = new Set(encadeamentos.map((e) => e.consulta));
  return consultas.length - reagiram.size;
}
