/**
 * A COBERTURA — quanto do processo desenhado alguém realmente mede, dito antes
 * de a primeira tela existir.
 *
 * Este é o diagnóstico que decide se o Modo Monitoramento vale a pena hoje. Ele
 * responde, para um fluxo, quatro coisas que nenhuma tela responderia sozinha:
 * quantas etapas ninguém pediu para medir, quais chaves foram escritas e não têm
 * dono, quais estão fora da forma combinada, e qual coletor responde por cada
 * uma. É de propósito uma função pura sobre o fluxo e o registro — não colhe
 * nada, não precisa de coletor funcionando e roda com o banco vazio.
 *
 * Serve a dois momentos, e os dois importam:
 *
 * - **agora**, para dimensionar o trabalho: um fluxo com dezesseis chaves e zero
 *   coletores é o retrato honesto do estado atual, e é o número que diz quantos
 *   coletores é preciso escrever antes de o farol ter o que mostrar;
 * - **depois**, na tela de administração do módulo, como a lista de pendências
 *   de quem desenha processo — a chave com erro de digitação aparece aqui, e não
 *   como um cinza mudo no meio do fluxograma.
 */

import type { FluxoCompleto } from "../modelo";
import { chavesDoFluxo, type ChaveDoFluxo } from "./chaves";
import type { RegistroDeColetores } from "./registro";

export interface ChaveNaCobertura extends ChaveDoFluxo {
  /** O nome do coletor que responde por ela, ou `null`. */
  coletor: string | null;
}

export interface Cobertura {
  fluxoId: string;
  etapas: number;
  /** Etapas com `chave_monitoramento` preenchida. */
  etapasComChave: number;
  /** Etapas cuja chave tem coletor — o número que dá o tamanho do farol. */
  etapasCobertas: number;
  chaves: ChaveNaCobertura[];
  /** Escritas, e sem coletor. */
  semColetor: string[];
  /** Escritas fora de `minúsculas.separadas_por_ponto` — quase sempre digitação. */
  malFormadas: string[];
}

export function conferirCobertura(
  completo: FluxoCompleto,
  registro: RegistroDeColetores,
): Cobertura {
  const chaves: ChaveNaCobertura[] = chavesDoFluxo(completo).map((chave) => ({
    ...chave,
    coletor: registro.responsavelPor(chave.chave)?.nome ?? null,
  }));
  const etapasComChave = chaves.reduce(
    (total, c) => total + c.etapas.length,
    0,
  );
  const etapasCobertas = chaves
    .filter((c) => c.coletor !== null)
    .reduce((total, c) => total + c.etapas.length, 0);
  return {
    fluxoId: completo.fluxo.id,
    etapas: completo.etapas.length,
    etapasComChave,
    etapasCobertas,
    chaves,
    semColetor: chaves.filter((c) => c.coletor === null).map((c) => c.chave),
    malFormadas: chaves.filter((c) => !c.bemFormada).map((c) => c.chave),
  };
}
