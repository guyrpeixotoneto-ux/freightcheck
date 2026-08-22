/**
 * O item de que a conversa está falando **agora** — por referência, não por texto.
 *
 * **O problema, dito com a sequência que o expõe.** "Qual teve maior perda?" →
 * "Por quê?" → "Tem certeza?" → "De onde saiu esse número?". Do segundo turno em
 * diante, nenhuma frase nomeia o assunto: quem responde precisa saber que "esse
 * número" é o impacto de um parâmetro específico, numa vigência específica, que
 * uma consulta específica apurou. O estado guardava o **assunto** (uma string) e
 * as evidências da última resposta (uma lista) — e nenhum dos dois responde
 * *qual dos números* está em discussão.
 *
 * **Por que referência estruturada e não o texto da última resposta.** Guardar
 * a prosa e reinterpretá-la no turno seguinte é memória frágil por construção:
 * ela depende de o modelo ter escrito de um jeito, e quebra quando ele escreve
 * de outro. Aqui o foco é o que a **consulta** devolveu — o código do parâmetro,
 * a placa, a vigência, a grandeza —, que é a mesma coisa que a próxima consulta
 * vai precisar como argumento.
 *
 * **O que ele deliberadamente não é.** Não é cache de resposta. O valor
 * guardado nunca é reexibido como se fosse consulta nova: ele serve para
 * *escolher a próxima consulta* e para *conferir uma composição*, e quem
 * responde refaz a consulta. Ver a mesma decisão em `PROCEDENCIA`, no
 * orquestrador.
 */

import type { Evidencia } from "./ferramentas";
import { comoGrandeza, afirmacoesDoTexto } from "./lastro";

export type TipoDeFoco =
  /** Uma gaveta: "consumo negociado cavalo". */
  | "PARAMETRO"
  /** Um veículo, pela placa. */
  | "VEICULO"
  /** Um grupo de alteração — parâmetro × equipamento. */
  | "GRUPO"
  /** O recorte inteiro: o movimento da vigência. */
  | "RECORTE"
  /** Um bloco do Book. */
  | "BLOCO";

export interface ValorEmFoco {
  numero: number;
  /** Como ele foi escrito — é esta forma que "esse número" quer dizer. */
  escrito: string;
  grandeza: "MOEDA" | "PERCENTUAL" | "NUMERO";
}

export interface FocoDaConversa {
  tipo: TipoDeFoco;
  /**
   * O identificador que a próxima consulta usa como argumento.
   *
   * Código do atributo, placa, chave do bloco. Nunca o rótulo gerencial: é o
   * rótulo que muda quando a curadoria renomeia uma gaveta, e um foco que
   * quebra com um rename é um foco que não serve para nada.
   */
  id: string;
  /** O nome que quem opera usa — para a tela e para a prosa. */
  rotulo: string;
  /** O número em discussão, quando há um. */
  valor: ValorEmFoco | null;
  vigencia: string | null;
  /** De qual consulta ele saiu — a ligação com a evidência. */
  ferramenta: string;
  /**
   * O grupo que estava aberto quando este foco foi fixado.
   *
   * É o que permite a pergunta seguinte **continuar de onde a investigação
   * parou** em vez de redescobrir o grupo mais pesado do zero. Sem ele, "o que
   * mudou nesses veículos?" recomeça pelo agregado, e a resposta é sobre o
   * grupo que mais pesa hoje — que pode não ser o que se estava discutindo.
   */
  grupo?: { codigo: string; equipamento: string; rotulo: string } | undefined;
}

/**
 * Onde o número mora numa evidência.
 *
 * `destaque` é o campo que a ferramenta preenche quando sabe qual dos fatos
 * responde; sem ele, o primeiro fato não interno com número é a melhor leitura
 * disponível — e é a mesma que a redação determinística faz.
 */
function valorDe(e: Evidencia): ValorEmFoco | null {
  const candidatos = e.fatos.filter((f) => !f.interno);
  const escolhido =
    (e.destaque ? candidatos.find((f) => f.rotulo === e.destaque) : undefined) ??
    candidatos.find((f) => /\d/.test(f.valor));
  if (!escolhido) return null;

  const tipada = afirmacoesDoTexto(`${escolhido.valor} ${escolhido.rotulo}`)[0];
  const numero = tipada?.valor ?? comoGrandeza(escolhido.valor.match(/\d[\d.,]*/)?.[0] ?? "");
  if (!Number.isFinite(numero)) return null;

  return {
    numero,
    escrito: escolhido.valor,
    grandeza:
      tipada?.tipo === "PERCENTUAL"
        ? "PERCENTUAL"
        : /R\$/.test(escolhido.valor)
          ? "MOEDA"
          : "NUMERO",
  };
}

/** A placa que esta evidência autoriza, quando ela fala de um veículo só. */
function placaUnica(e: Evidencia): string | null {
  const ids = e.identificadores ?? [];
  return ids.length === 1 ? ids[0]! : null;
}

/**
 * O foco desta resposta — lido do que as consultas devolveram.
 *
 * A ordem de preferência é a da granularidade: o que a investigação **desceu
 * até** é mais específico do que o que ela começou vendo. Um veículo vence um
 * grupo, que vence um parâmetro, que vence o recorte. É a ordem em que um
 * analista responderia "estamos falando de quê?" no meio da conversa.
 */
export function focoDe(evidencias: readonly Evidencia[], vigencia: string | null): FocoDaConversa | null {
  /** O grupo aberto nesta resposta — a referência que a próxima consulta usa. */
  const grupo = [...evidencias].reverse().find((e) => e.alvoDaDescida)?.alvoDaDescida;

  const comPlaca = [...evidencias].reverse().find((e) => placaUnica(e));
  if (comPlaca) {
    return {
      tipo: "VEICULO",
      id: placaUnica(comPlaca)!,
      rotulo: placaUnica(comPlaca)!,
      valor: valorDe(comPlaca),
      vigencia: comPlaca.recorte?.vigencia ?? vigencia,
      ferramenta: comPlaca.ferramenta,
      ...(grupo ? { grupo } : {}),
    };
  }

  /*
    O que **esta consulta descobriu ser o que mais pesa** é o foco natural de
    "por quê?". Só as ferramentas que ordenam preenchem `assuntoEmDestaque`;
    um agregado descreveu o conjunto, não descobriu item nenhum.
  */
  const ordenou = [...evidencias].reverse().find((e) => e.assuntoEmDestaque);
  if (ordenou) {
    return {
      tipo: "GRUPO",
      id: ordenou.alvoDaDescida?.codigo ?? ordenou.assuntoEmDestaque!,
      rotulo: ordenou.assuntoEmDestaque!,
      valor: valorDe(ordenou),
      vigencia: ordenou.recorte?.vigencia ?? vigencia,
      ferramenta: ordenou.ferramenta,
      ...(grupo ? { grupo } : {}),
    };
  }

  const comNumero = evidencias.find((e) => valorDe(e));
  if (comNumero) {
    return {
      tipo: "RECORTE",
      id: comNumero.recorte?.contexto ?? "recorte",
      rotulo: comNumero.titulo,
      valor: valorDe(comNumero),
      vigencia: comNumero.recorte?.vigencia ?? vigencia,
      ferramenta: comNumero.ferramenta,
    };
  }

  return null;
}

/** O foco em uma linha, para o painel técnico e o relatório. */
export function explicarFoco(f: FocoDaConversa): string {
  const valor = f.valor ? ` = ${f.valor.escrito}` : "";
  const quando = f.vigencia ? ` · ${f.vigencia}` : "";
  return `${f.tipo} ${f.rotulo}${valor}${quando} (de ${f.ferramenta})`;
}
