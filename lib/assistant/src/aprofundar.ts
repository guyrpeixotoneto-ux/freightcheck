/**
 * A descida — de agregado a grupo, a linha, a fato, a célula da planilha.
 *
 * **O que faltava, dito com a pergunta que expõe.** "Por que a remuneração caiu
 * em agosto em Camaçari?" recebia o movimento da vigência: o total, quantas
 * alterações, quanto custou. Verdadeiro, e não é a resposta — a resposta é
 * *qual* parâmetro puxou a queda, em *quais* veículos, o que mudou *neles*, e de
 * *onde* essa mudança veio. Cada uma dessas perguntas só pode ser feita depois
 * de a anterior ter sido respondida: o código do parâmetro não existe antes do
 * ranking, e a placa não existe antes de abrir o grupo.
 *
 * **Por isso isto não é "mais consultas".** O plano executa um conjunto de
 * consultas independentes, todas decididas antes da primeira leitura — largura.
 * Aqui cada passo usa como argumento um valor que **voltou** do passo anterior:
 * é a única forma de encadeamento que se pode verificar sem perguntar ao modelo
 * o que ele quis dizer, e é a que `encadeamento.ts` mede.
 *
 * **A profundidade é proporcional, e a proporção é a evidência.** A descida não
 * roda para toda pergunta: ela roda quando a pergunta é causal e para quando o
 * passo seguinte não teria argumento. Um recorte sem grupo com impacto não
 * desce; um grupo sem placa não desce; uma placa sem célula de origem não desce.
 * Parar cedo é um desfecho normal, e o que sobra é dito como o que é.
 *
 * **Tetos.** Três passos e uma consulta por passo. Não porque quatro seria caro,
 * mas porque abaixo da célula da planilha não há mais nível: a descida termina
 * onde o dado entrou no produto.
 */

import type { Database } from "@workspace/db";
import { getGroupedView } from "@workspace/comparison";
import { provenienciaDoValor } from "@workspace/coverage";
import { veiculosDoGrupo, type ContextoResolvido, type Evidencia } from "./ferramentas";
import { dinheiro } from "./formato";

/** Um passo da descida — o que foi consultado, e o que o motivou. */
export interface PassoDaDescida {
  /** A capacidade exercida. */
  ferramenta: string;
  /**
   * O valor que **não existia** antes do passo anterior, e o campo em que
   * entrou. `null` no primeiro passo, que abre a investigação.
   */
  descoberto: { campo: string; valor: string } | null;
  /** O índice do passo de cujo resultado o argumento saiu. */
  derivaDe: number | null;
  /** Uma linha técnica e curta: o que o resultado anterior fez esta consulta ser. */
  porque: string;
}

export interface Descida {
  evidencias: Evidencia[];
  passos: PassoDaDescida[];
}

/**
 * Até onde descer — a profundidade proporcional ao que foi perguntado.
 *
 * **Por que ela não é sempre a máxima.** Descer até a célula custa uma consulta
 * a mais e responde uma pergunta que nem sempre foi feita. Quem pergunta
 * "quais veículos explicam a queda?" quer as placas: a planilha de onde o valor
 * veio é o passo seguinte, não a resposta. Descer sempre até o fundo é o mesmo
 * defeito da largura pré-planejada, escrito na vertical — trabalho decidido
 * antes de saber se ele responde alguma coisa.
 *
 * A escolha sai do **plano**, que já leu a pergunta: procedência pede a célula,
 * veículos pedem a linha, ranking e atenção pedem o grupo aberto. Nenhuma
 * palavra nova é lida aqui.
 */
export type Fundo = "GRUPO" | "LINHA" | "CELULA";

export interface PedidoDeDescida {
  db: Database;
  ctx: ContextoResolvido;
  /**
   * A vigência em foco — ou `null` quando a pergunta não pediu nenhuma.
   *
   * `null` **não** desliga a descida: quem pergunta "por que a remuneração
   * caiu?" está falando da vigência corrente, e exigir que ela fosse nomeada
   * faria a descida rodar só nas perguntas que já dizem a data. A vigência é
   * então a que a própria consulta resolve, e ela sai declarada nas evidências.
   */
  periodo: string | null;
  equipamento?: "CAVALO" | "CARRETA" | null | undefined;
  /** Até que nível descer. Ver `Fundo`. */
  ate: Fundo;
  /**
   * O grupo que a conversa já tinha aberto — de onde **continuar**.
   *
   * Sem ele, a segunda pergunta de uma investigação redescobre o grupo mais
   * pesado do zero, e responde sobre o que mais pesa **hoje** em vez do que se
   * estava discutindo. Com ele, o primeiro passo deixa de ser uma descoberta e
   * passa a ser a confirmação do que já estava em foco — e o passo 1 some da
   * trajetória, porque ele não aconteceu.
   */
  grupoEmFoco?: { codigo: string; equipamento: string; rotulo: string } | undefined;
  /** O que a tela mostra enquanto cada passo roda — verificável, sempre. */
  aoAvancar?: ((rotulo: string) => void) | undefined;
}

/**
 * Desce até onde a evidência permitir.
 *
 * Nunca lança: um passo que falha encerra a descida com o que já foi
 * descoberto. Uma investigação que perde o terceiro passo continua valendo
 * pelos dois primeiros, e derrubá-la inteira jogaria fora consulta já paga.
 */
export async function descer(pedido: PedidoDeDescida): Promise<Descida> {
  const { db, ctx, equipamento } = pedido;
  const evidencias: Evidencia[] = [];
  const passos: PassoDaDescida[] = [];

  // ---- passo 1: qual grupo puxou o movimento -------------------------------
  pedido.aoAvancar?.("Analisando o movimento por grupo");
  const visao = await getGroupedView(db, pedido.periodo ?? undefined, {
    scopeHash: ctx.contexto.scopeHash,
    channel: ctx.contexto.channel,
  }).catch(() => null);
  if (!visao) return { evidencias, passos };
  /*
    A vigência que a consulta de fato leu — e não a que se pediu.

    Quando ninguém nomeou período, `getGroupedView` resolve a corrente; usá-la
    daqui para baixo é o que mantém os três passos falando da **mesma**
    vigência. Ler a corrente uma vez e reusá-la é o oposto de resolver de novo
    em cada passo, que é como duas consultas de uma mesma resposta acabam em
    meses diferentes.
  */
  const periodo = visao.period;

  const comImpacto = visao.groups
    .filter((g) => g.impact.amount !== null && g.attributeCode && g.entityType)
    .filter((g) => !equipamento || g.entityType === equipamento);
  if (comImpacto.length === 0) return { evidencias, passos };

  const emFoco = pedido.grupoEmFoco;
  const doFoco = emFoco
    ? comImpacto.find(
        (g) => g.attributeCode === emFoco.codigo && g.entityType === emFoco.equipamento,
      )
    : undefined;
  const maior =
    doFoco ??
    [...comImpacto].sort(
      (a, b) => Math.abs(b.impact.amount ?? 0) - Math.abs(a.impact.amount ?? 0),
    )[0]!;

  const totalDoLado = comImpacto.reduce((s, g) => s + Math.abs(g.impact.amount ?? 0), 0);
  evidencias.push({
    ferramenta: "grupoQueMaisPesou",
    titulo: `O grupo que mais pesou em ${periodo}`,
    fatos: [
      {
        rotulo: maior.title,
        valor: dinheiro(maior.impact.amount!, maior.impact.periodicity ?? "MENSAL"),
        detalhe: `${maior.vehicles} veículos · ${maior.changes} alterações`,
      },
      ...comImpacto
        .filter((g) => g !== maior)
        .sort((a, b) => Math.abs(b.impact.amount ?? 0) - Math.abs(a.impact.amount ?? 0))
        .slice(0, 4)
        .map((g) => ({
          rotulo: g.title,
          valor: dinheiro(g.impact.amount!, g.impact.periodicity ?? "MENSAL"),
          detalhe: `${g.vehicles} veículos · ${g.changes} alterações`,
        })),
      {
        rotulo: "Grupos com impacto apurado nesta vigência",
        valor: String(comImpacto.length),
        detalhe: `soma dos módulos: ${dinheiro(totalDoLado, maior.impact.periodicity ?? "MENSAL")}`,
      },
    ],
    numeros: [
      ...comImpacto.map((g) => g.impact.amount!).filter((n): n is number => n !== null),
      ...comImpacto.map((g) => g.vehicles),
      ...comImpacto.map((g) => g.changes),
      comImpacto.length,
      totalDoLado,
    ],
    origem: `getGroupedView → groups, ordenado por |impacto| · ${periodo}`,
    recorte: {
      unidade: ctx.info.label,
      canal: ctx.contexto.channel,
      contexto: ctx.info.label,
      vigencia: periodo,
    },
    tela: { label: "Alterações", href: "/alteracoes" },
    assuntoEmDestaque: maior.title,
    alvoDaDescida: {
      codigo: maior.attributeCode!,
      equipamento: maior.entityType!,
      rotulo: maior.title,
    },
  });
  passos.push({
    ferramenta: "grupoQueMaisPesou",
    descoberto: null,
    derivaDe: null,
    porque: doFoco
      ? `continua no grupo que a conversa já tinha aberto: ${maior.title}`
      : "abre a investigação: qual grupo de alteração pesou mais nesta vigência",
  });

  if (pedido.ate === "GRUPO") return { evidencias, passos };

  // ---- passo 2: quais veículos, dentro daquele grupo -----------------------
  /*
    `maior.attributeCode` não existia antes do passo 1. É este o encadeamento —
    não "mais uma consulta", mas uma consulta cujo argumento a anterior
    produziu.
  */
  const codigo = maior.attributeCode!;
  const tipo = maior.entityType!;
  pedido.aoAvancar?.(`Abrindo os veículos de ${maior.title}`);
  const linhas = await veiculosDoGrupo(db, ctx, periodo, codigo, tipo).catch(() => null);
  if (!linhas) return { evidencias, passos };

  evidencias.push(linhas);
  passos.push({
    ferramenta: "veiculosDoGrupo",
    descoberto: { campo: "atributo", valor: codigo },
    derivaDe: 0,
    porque: doFoco
      ? `o grupo "${maior.title}" já estava em foco na conversa; este abre as linhas dele`
      : `o passo 1 apontou "${maior.title}" como o grupo de maior impacto; este abre as linhas dele`,
  });

  if (pedido.ate === "LINHA") return { evidencias, passos };

  // ---- passo 3: de onde veio o valor de um daqueles veículos ---------------
  const placa = linhas.identificadores?.[0];
  if (!placa) return { evidencias, passos };

  pedido.aoAvancar?.(`Conferindo a origem do valor de ${placa}`);
  const origem = await provenienciaDoValor(db, {
    placa,
    atributo: codigo,
    vigencia: periodo,
    scopeHash: ctx.contexto.scopeHash,
    ...(ctx.contexto.channel !== null ? { canal: ctx.contexto.channel } : {}),
  }).catch(() => null);

  if (!origem || !origem.achou) return { evidencias, passos };
  const p = origem.proveniencia;

  evidencias.push({
    ferramenta: "proveniencia",
    titulo: `A origem do valor de ${placa} em ${maior.title}`,
    fatos: [
      {
        rotulo: "Arquivo",
        valor: p.importacao.arquivo,
        detalhe: `recebido em ${p.importacao.recebidoEm}`,
      },
      {
        rotulo: "Célula",
        valor: `aba ${p.celula.aba}, linha ${p.celula.linha}, coluna ${p.celula.coluna}`,
        ...(p.celula.valorBruto ? { detalhe: `valor bruto: ${p.celula.valorBruto}` } : {}),
      },
      { rotulo: "Importação", valor: p.importacao.importRunId, interno: true },
    ],
    numeros: [p.celula.linha],
    identificadores: [placa],
    origem: `fact → raw_cell → raw_row → raw_sheet → import_run → source_file`,
    recorte: {
      unidade: ctx.info.label,
      canal: ctx.contexto.channel,
      contexto: ctx.info.label,
      vigencia: periodo,
    },
  });
  passos.push({
    ferramenta: "proveniencia",
    descoberto: { campo: "placa", valor: placa },
    derivaDe: 1,
    porque: `o passo 2 devolveu ${placa} entre os veículos do grupo; este desce até a célula que originou o valor`,
  });

  return { evidencias, passos };
}
