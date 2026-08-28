/**
 * A COLHEITA — pedir as medições a todos os coletores de uma vez, e sobreviver
 * a qualquer um deles.
 *
 * ---------------------------------------------------------------------------
 * Um coletor quebrado apaga o farol dele, e só o dele
 * ---------------------------------------------------------------------------
 *
 * Os coletores são integrações: SEFAZ fora do ar, consulta que travou, resposta
 * com um campo a menos. A pergunta do desenho não é "como impedir isso", é "o
 * que a tela mostra quando acontece" — e a resposta é: as etapas daquele coletor
 * ficam `SEM_DADO`, com a falha nomeada ao lado, e o resto do fluxo continua
 * pintado.
 *
 * Por isso aqui não há `Promise.all`, e sim `allSettled` com tempo limite por
 * coletor. Um `Promise.all` transformaria a lentidão de um coletor no
 * carregamento infinito da tela inteira, que é o defeito clássico do painel de
 * status: o painel que existe para dizer se está tudo bem é o primeiro a cair
 * quando não está.
 *
 * As falhas não são engolidas — voltam em `Colheita.falhas`, com o nome do
 * coletor, o motivo e as chaves que ficaram sem resposta. Um farol apagado sem
 * explicação é indistinguível de uma etapa que ninguém mede.
 *
 * ---------------------------------------------------------------------------
 * O que volta do coletor é conferido, e não confiado
 * ---------------------------------------------------------------------------
 *
 * Três recusas, todas registradas como falha e nenhuma delas fatal:
 *
 * - **leitura fora do território** — o coletor de `financeiro.` devolveu
 *   `cte.emissao`. Descartada: quem pinta o que não é seu pinta com o critério
 *   errado, e o erro seria invisível;
 * - **leitura que ninguém pediu** — chave válida do coletor, mas de nenhuma
 *   etapa deste fluxo. Descartada em silêncio, sem falha: é sobra de um coletor
 *   que devolve o painel dele inteiro, e não um defeito;
 * - **leitura malformada** — sem farol conhecido ou sem `medidoEm` legível.
 *   Descartada com falha: cor inventada é pior do que ausência.
 */

import type { Coletor, Leitura } from "./contrato";
import { ehFarolMedido } from "./contrato";
import { normalizarChave } from "./chaves";
import type { RegistroDeColetores } from "./registro";

/** Quinze segundos: o coletor que passa disso não serve para pintar uma tela. */
export const TEMPO_LIMITE_PADRAO_EM_MS = 15_000;

export interface FalhaDeColetor {
  coletor: string;
  /** `tempo_esgotado`, `erro_do_coletor`, `leitura_invalida`, `leitura_alheia`. */
  motivo: string;
  mensagem: string;
  /** As chaves que ficaram sem resposta por causa disto. */
  chaves: string[];
}

export interface Colheita {
  /** chave normalizada → a medição publicada. */
  leituras: Map<string, Leitura>;
  falhas: FalhaDeColetor[];
  /** Pedidas, e sem coletor que responda por elas. */
  orfas: string[];
  /** O instante da colheita — o mesmo para todos os coletores. */
  agora: Date;
}

export interface PedidoDaColheita {
  empresaId: string;
  chaves: readonly string[];
}

export interface OpcoesDaColheita {
  tempoLimiteEmMs?: number;
  /** Injetado, para o teste não depender do relógio da máquina. */
  agora?: Date;
}

export async function colher(
  registro: RegistroDeColetores,
  pedido: PedidoDaColheita,
  opcoes: OpcoesDaColheita = {},
): Promise<Colheita> {
  const agora = opcoes.agora ?? new Date();
  const tempoLimite = opcoes.tempoLimiteEmMs ?? TEMPO_LIMITE_PADRAO_EM_MS;
  const { lotes, orfas } = registro.distribuir(pedido.chaves);

  const leituras = new Map<string, Leitura>();
  const falhas: FalhaDeColetor[] = [];

  const respostas = await Promise.all(
    lotes.map(async (lote) => {
      try {
        const leituras = await comTempoLimite(
          lote.coletor.ler({
            empresaId: pedido.empresaId,
            chaves: lote.chaves,
            agora,
          }),
          tempoLimite,
        );
        return { lote, leituras };
      } catch (erro) {
        return { lote, erro };
      }
    }),
  );

  for (const resposta of respostas) {
    const { lote } = resposta;
    if ("erro" in resposta) {
      falhas.push({
        coletor: lote.coletor.nome,
        motivo:
          resposta.erro instanceof TempoEsgotado
            ? "tempo_esgotado"
            : "erro_do_coletor",
        mensagem: mensagemDoErro(resposta.erro),
        chaves: lote.chaves,
      });
      continue;
    }
    const pedidas = new Set(lote.chaves);
    for (const bruta of resposta.leituras ?? []) {
      const chave = normalizarChave(bruta?.chave);
      if (chave === null || !pedidas.has(chave)) {
        if (chave !== null && !registro.alcanca(lote.coletor, chave)) {
          falhas.push({
            coletor: lote.coletor.nome,
            motivo: "leitura_alheia",
            mensagem: `Devolveu uma medição de "${chave}", que não é um dos prefixos dele.`,
            chaves: [chave],
          });
        }
        continue;
      }
      if (!ehFarolMedido(bruta.farol) || !dataLegivel(bruta.medidoEm)) {
        falhas.push({
          coletor: lote.coletor.nome,
          motivo: "leitura_invalida",
          mensagem: `A medição de "${chave}" veio sem farol conhecido ou sem \`medidoEm\` legível.`,
          chaves: [chave],
        });
        continue;
      }
      leituras.set(chave, { ...bruta, chave });
    }
  }

  return { leituras, falhas, orfas, agora };
}

class TempoEsgotado extends Error {}

function comTempoLimite<T>(promessa: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolver, recusar) => {
    const relogio = setTimeout(() => {
      recusar(new TempoEsgotado(`Não respondeu em ${ms}ms.`));
    }, ms);
    promessa.then(
      (valor) => {
        clearTimeout(relogio);
        resolver(valor);
      },
      (erro) => {
        clearTimeout(relogio);
        recusar(erro);
      },
    );
  });
}

function dataLegivel(valor: unknown): boolean {
  return typeof valor === "string" && !Number.isNaN(Date.parse(valor));
}

function mensagemDoErro(erro: unknown): string {
  if (erro instanceof Error) return erro.message;
  return String(erro);
}
