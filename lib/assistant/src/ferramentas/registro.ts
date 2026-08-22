/**
 * O contrato de uma ferramenta — e as garantias que ele carrega por construção.
 *
 * **O que muda de desenho.** Hoje o código decide o que consultar e o modelo
 * redige o resultado. Uma ferramenta inverte isso: ela é uma **capacidade de
 * negócio estável** — "alterações", "resultado", "documentos" — que o modelo
 * escolhe chamar, com os argumentos que a pergunta pedir. A diferença entre
 * uma ferramenta e um endpoint por pergunta é essa: a ferramenta tem eixos que
 * compõem, e nenhum caso especial para "liste as alterações" ou "o que mudou
 * nos cavalos".
 *
 * **Cinco garantias, e onde cada uma mora.**
 *
 * 1. *Rastreabilidade.* Toda saída carrega `evidencias` no mesmo formato que a
 *    trava de lastro já confere. Um número que chega ao texto sem ter passado
 *    por aqui não tem como ser citado — a lista de números autorizados é a
 *    união das evidências dos `tool_result` daquele turno, e nada mais.
 * 2. *Isolamento.* O recorte **não é argumento**. Ele entra pelo executor, a
 *    partir do que a tela mandou, e a validação recusa qualquer ferramenta que
 *    declare `scopeHash`, `channel` ou equivalente entre os seus campos. O
 *    modelo não tem como pedir dado de outra unidade porque não tem como
 *    escrever a pergunta.
 * 3. *Nada inventado.* A ferramenta só devolve o que a consulta devolveu. Não
 *    há caminho em que um valor apareça na saída sem ter vindo do banco ou de
 *    um cálculo determinístico dos pacotes de domínio.
 * 4. *Log completo.* Cada execução vira um `ChamadaDeFerramenta` com nome,
 *    argumentos como o modelo os mandou, duração, desfecho e o erro quando
 *    houve. É o rastro que responde "o que ele consultou antes de concluir
 *    isso?".
 * 5. *Comparabilidade.* Nada aqui é chamado pelo caminho de produção. O
 *    registro existe, é testável e fica desligado — o comportamento atual segue
 *    byte a byte igual até a flag do PR 2.
 *
 * **Por que o esquema é declarado à mão, e não gerado de zod.** A API precisa de
 * JSON Schema; a validação precisa acontecer em runtime porque o modelo pode
 * mandar qualquer coisa; e a descrição de cada campo é superfície de prompt —
 * é o texto que ensina o modelo quando usar aquele eixo. Um conversor põe uma
 * tradução entre o que se declara e o que o modelo lê, e essa tradução é
 * exatamente o lugar onde uma descrição some sem ninguém notar. O subconjunto
 * abaixo cobre o que estas ferramentas precisam, é a fonte única do esquema e
 * da validação, e cabe em setenta linhas.
 */

import type { Database } from "@workspace/db";
import type { Evidencia } from "../ferramentas";
import { alteracoes } from "./alteracoes";
import { CATALOGO } from "./catalogo";

// ── O esquema dos argumentos ────────────────────────────────────────────────

export type Campo =
  | { tipo: "texto"; descricao: string; opcoes?: readonly string[]; obrigatorio?: boolean }
  | { tipo: "inteiro"; descricao: string; minimo?: number; maximo?: number; obrigatorio?: boolean }
  | { tipo: "booleano"; descricao: string; obrigatorio?: boolean }
  | { tipo: "lista"; descricao: string; obrigatorio?: boolean };

export type Argumentos = Record<string, Campo>;

/**
 * Os nomes que uma ferramenta **não pode** declarar.
 *
 * São os que carregam o recorte. Deixar um deles virar argumento faria o
 * isolamento depender de o modelo se comportar, quando ele pode depender do
 * executor — e a diferença entre as duas é a diferença entre uma garantia e
 * uma esperança.
 */
export const NOMES_RESERVADOS: ReadonlySet<string> = new Set([
  "scopehash", "scope_hash", "scope", "channel", "canal", "unidade", "unit",
  "empresa", "company", "tenant", "contexto", "context",
]);

export function paraJsonSchema(argumentos: Argumentos): {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
} {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [nome, campo] of Object.entries(argumentos)) {
    if (campo.obrigatorio) required.push(nome);
    switch (campo.tipo) {
      case "texto":
        properties[nome] = campo.opcoes
          ? { type: "string", enum: [...campo.opcoes], description: campo.descricao }
          : { type: "string", description: campo.descricao };
        break;
      case "inteiro":
        properties[nome] = {
          type: "integer",
          description: campo.descricao,
          ...(campo.minimo !== undefined ? { minimum: campo.minimo } : {}),
          ...(campo.maximo !== undefined ? { maximum: campo.maximo } : {}),
        };
        break;
      case "booleano":
        properties[nome] = { type: "boolean", description: campo.descricao };
        break;
      case "lista":
        properties[nome] = {
          type: "array",
          items: { type: "string" },
          description: campo.descricao,
        };
        break;
    }
  }

  return { type: "object", properties, required, additionalProperties: false };
}

export interface Recusa {
  campo: string;
  motivo: string;
}

/**
 * Os argumentos como o modelo os mandou, conferidos contra a declaração.
 *
 * Devolve as recusas em vez de lançar: um argumento errado é uma coisa que se
 * **conta de volta ao modelo**, para ele corrigir na rodada seguinte. Derrubar
 * a pergunta inteira por causa de um enum digitado errado seria transformar um
 * erro recuperável numa resposta perdida.
 */
export function validar(
  argumentos: Argumentos,
  bruto: unknown,
): { ok: true; valor: Record<string, unknown> } | { ok: false; recusas: Recusa[] } {
  const recusas: Recusa[] = [];
  const entrada = (bruto ?? {}) as Record<string, unknown>;
  const valor: Record<string, unknown> = {};

  if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) {
    return { ok: false, recusas: [{ campo: "(raiz)", motivo: "os argumentos têm de ser um objeto" }] };
  }

  for (const nome of Object.keys(entrada)) {
    if (!(nome in argumentos)) {
      recusas.push({ campo: nome, motivo: `campo desconhecido; esperados: ${Object.keys(argumentos).join(", ")}` });
    }
  }

  for (const [nome, campo] of Object.entries(argumentos)) {
    const v = entrada[nome];

    if (v === undefined || v === null) {
      if (campo.obrigatorio) recusas.push({ campo: nome, motivo: "obrigatório e não veio" });
      continue;
    }

    switch (campo.tipo) {
      case "texto": {
        if (typeof v !== "string") {
          recusas.push({ campo: nome, motivo: "esperava texto" });
          break;
        }
        if (campo.opcoes && !campo.opcoes.includes(v)) {
          recusas.push({ campo: nome, motivo: `valor "${v}" fora de: ${campo.opcoes.join(", ")}` });
          break;
        }
        valor[nome] = v;
        break;
      }
      case "inteiro": {
        if (typeof v !== "number" || !Number.isInteger(v)) {
          recusas.push({ campo: nome, motivo: "esperava um inteiro" });
          break;
        }
        if (campo.minimo !== undefined && v < campo.minimo) {
          recusas.push({ campo: nome, motivo: `mínimo ${campo.minimo}` });
          break;
        }
        if (campo.maximo !== undefined && v > campo.maximo) {
          recusas.push({ campo: nome, motivo: `máximo ${campo.maximo}` });
          break;
        }
        valor[nome] = v;
        break;
      }
      case "booleano": {
        if (typeof v !== "boolean") {
          recusas.push({ campo: nome, motivo: "esperava true ou false" });
          break;
        }
        valor[nome] = v;
        break;
      }
      case "lista": {
        if (!Array.isArray(v) || v.some((i) => typeof i !== "string")) {
          recusas.push({ campo: nome, motivo: "esperava uma lista de textos" });
          break;
        }
        valor[nome] = v;
        break;
      }
    }
  }

  return recusas.length > 0 ? { ok: false, recusas } : { ok: true, valor };
}

// ── A ferramenta ────────────────────────────────────────────────────────────

/**
 * O que o executor entrega à ferramenta, e que o modelo não escolhe.
 *
 * O recorte vem daqui e de nenhum outro lugar. Uma ferramenta que precise de
 * unidade ou canal os lê deste objeto; não há caminho em que eles cheguem pelos
 * argumentos, porque `registrar` recusa a ferramenta que os declare.
 */
export interface ContextoDaFerramenta {
  db: Database;
  /** O recorte da tela — a fronteira de isolamento desta conversa. */
  recorte: { scopeHash?: string; channel?: string | null };
  /** A vigência em foco, quando a tela ou a conversa fixou uma. */
  periodo?: string | undefined;
  /**
   * Os filtros que a conversa estabeleceu — e que o modelo não precisa repetir.
   *
   * **Por que injetados, e não argumentados.** É a mesma decisão do recorte, e
   * pelo mesmo motivo: um filtro que depende de o modelo lembrar de repeti-lo em
   * toda chamada é um filtro que se perde na terceira pergunta. "E somente
   * cavalos" vale até alguém dizer outra coisa, e quem garante isso é o
   * executor, não a memória do modelo.
   *
   * **O modelo continua podendo trocar.** Um argumento explícito vence o
   * padrão — é assim que "e nas carretas?" funciona. O que ele não pode é
   * *esquecer*: omitir o argumento mantém o filtro do fio, em vez de voltar em
   * silêncio para a frota inteira.
   */
  filtros?:
    | {
        equipamento?: "CAVALO" | "CARRETA" | null | undefined;
        /** Onde a última lista parou — para "me mostre os 5 seguintes". */
        apartirDe?: number | undefined;
        limite?: number | undefined;
      }
    | undefined;
}

export interface SaidaDaFerramenta {
  /**
   * O que o modelo lê, já em JSON.
   *
   * Nunca prosa pronta: uma ferramenta que devolvesse frase estaria de volta a
   * escrever a resposta em código, que é o desenho que estamos saindo.
   */
  conteudo: unknown;
  /**
   * O que este resultado autoriza citar.
   *
   * Mesmo formato de `Evidencia` que a trava de lastro já confere hoje. É o que
   * permite o PR 3 ser pequeno: a trava não muda de regra, muda de fonte.
   */
  evidencias: Evidencia[];
}

export interface Ferramenta {
  nome: string;
  /**
   * O que ela responde, na língua de quem opera.
   *
   * Isto é superfície de prompt: é o texto pelo qual o modelo decide chamá-la.
   * Descreve a **capacidade**, nunca as perguntas que ela atende — uma
   * descrição que lista perguntas é um `if pergunta = X` escrito em português.
   */
  descricao: string;
  argumentos: Argumentos;
  executar(ctx: ContextoDaFerramenta, args: Record<string, unknown>): Promise<SaidaDaFerramenta>;
}

export class Registro {
  private readonly ferramentas = new Map<string, Ferramenta>();

  registrar(ferramenta: Ferramenta): this {
    if (this.ferramentas.has(ferramenta.nome)) {
      throw new Error(`ferramenta duplicada: ${ferramenta.nome}`);
    }
    for (const campo of Object.keys(ferramenta.argumentos)) {
      if (NOMES_RESERVADOS.has(campo.toLowerCase())) {
        throw new Error(
          `${ferramenta.nome}.${campo}: o recorte não pode ser argumento — ele vem do ` +
            "executor, e deixá-lo entrar pelo modelo abriria o isolamento por unidade e canal",
        );
      }
    }
    this.ferramentas.set(ferramenta.nome, ferramenta);
    return this;
  }

  obter(nome: string): Ferramenta | undefined {
    return this.ferramentas.get(nome);
  }

  lista(): Ferramenta[] {
    return [...this.ferramentas.values()];
  }

  /** As ferramentas no formato que a API espera. */
  paraAnthropic(): { name: string; description: string; input_schema: unknown }[] {
    return this.lista().map((f) => ({
      name: f.nome,
      description: f.descricao,
      input_schema: paraJsonSchema(f.argumentos),
    }));
  }
}

// ── A execução, e o seu rastro ──────────────────────────────────────────────

export interface ChamadaDeFerramenta {
  nome: string;
  /** Os argumentos como o modelo os mandou — antes da validação. */
  argumentos: unknown;
  ok: boolean;
  ms: number;
  /** O que o modelo recebe de volta. Em falha, é a explicação da falha. */
  conteudo: unknown;
  evidencias: Evidencia[];
  erro: string | null;
}

/**
 * Executa uma ferramenta e **nunca lança**.
 *
 * Uma consulta que falha é um fato sobre esta pergunta, e o modelo tem de
 * recebê-lo como fato: com a falha declarada, ele diz que não conseguiu
 * consultar; com uma exceção, a pergunta inteira morre e quem perguntou recebe
 * um erro genérico. A regra que isto sustenta é a de nunca concluir sobre uma
 * consulta que não aconteceu.
 */
export async function executar(
  registro: Registro,
  nome: string,
  argumentos: unknown,
  ctx: ContextoDaFerramenta,
): Promise<ChamadaDeFerramenta> {
  const comecou = Date.now();
  const falha = (erro: string, conteudo: unknown): ChamadaDeFerramenta => ({
    nome,
    argumentos,
    ok: false,
    ms: Date.now() - comecou,
    conteudo,
    evidencias: [],
    erro,
  });

  const ferramenta = registro.obter(nome);
  if (!ferramenta) {
    return falha(`ferramenta desconhecida: ${nome}`, {
      erro: `Não existe ferramenta chamada "${nome}". Disponíveis: ${registro
        .lista()
        .map((f) => f.nome)
        .join(", ")}.`,
    });
  }

  const conferido = validar(ferramenta.argumentos, argumentos);
  if (!conferido.ok) {
    return falha(
      `argumentos inválidos: ${conferido.recusas.map((r) => `${r.campo} (${r.motivo})`).join("; ")}`,
      {
        erro: "Os argumentos não passaram na validação; corrija e chame de novo.",
        recusas: conferido.recusas,
      },
    );
  }

  try {
    const saida = await ferramenta.executar(ctx, conferido.valor);
    return {
      nome,
      argumentos,
      ok: true,
      ms: Date.now() - comecou,
      conteudo: saida.conteudo,
      evidencias: saida.evidencias,
      erro: null,
    };
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    return falha(mensagem, {
      erro:
        `A consulta "${nome}" falhou: ${mensagem}. Não conclua nada a partir dela — ` +
        "diga que esta consulta não pôde ser feita.",
    });
  }
}

/**
 * Os números que um conjunto de chamadas autoriza citar.
 *
 * É a ponte para o PR 3: a trava de lastro confere o texto contra as evidências
 * do dossiê, e no mundo do agente o dossiê **é** isto. A função vive aqui, e não
 * na trava, porque quem sabe o que uma chamada autorizou é quem a executou.
 */
export function evidenciasDe(chamadas: ChamadaDeFerramenta[]): Evidencia[] {
  return chamadas.filter((c) => c.ok).flatMap((c) => c.evidencias);
}

// ── O registro do produto ───────────────────────────────────────────────────

/**
 * As dez capacidades que o modelo pode chamar.
 *
 * Dez, e não vinte, e o critério foi um só: cada uma é um **eixo de consulta**
 * com argumentos que compõem, nunca uma resposta a uma pergunta. Perda e ganho
 * não são duas ferramentas — são `ordenacao` com `sentido`. Curadoria,
 * importação e balanço não são três — são `estado_do_dado` com `aspecto`. Vinte
 * ferramentas seriam o `switch` do orquestrador com outro nome, e a promessa de
 * responder pergunta nova sem código novo morreria junto.
 *
 * `alteracoes` vem primeiro por ser a mais usada, e a ordem daqui é a que o
 * modelo lê na lista de ferramentas.
 */
export function registroPadrao(): Registro {
  const registro = new Registro().registrar(alteracoes);
  for (const ferramenta of CATALOGO) registro.registrar(ferramenta);
  return registro;
}
