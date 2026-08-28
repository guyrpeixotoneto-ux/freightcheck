/**
 * A CHAVE DE MONITORAMENTO — a única coisa que liga um processo desenhado a um
 * número medido, e por isso a única coisa deste desenho que precisa de regra.
 *
 * `cte.autorizacao_sefaz` é um endereço, não um rótulo. Ele é escrito à mão no
 * painel da etapa, por quem desenha o processo, e é lido por um coletor que
 * ninguém do outro lado conhece. Duas pontas que nunca se falam só se encontram
 * se a forma for combinada — e é isso, e só isso, que este arquivo combina:
 *
 *     minúsculas, dígitos, `_`, e `.` separando os níveis
 *
 * ---------------------------------------------------------------------------
 * A forma se confere, e não se corrige à revelia
 * ---------------------------------------------------------------------------
 *
 * `normalizarChave` apara e baixa a caixa — `" CTe.Autorizacao "` e
 * `"cte.autorizacao"` são a mesma chave, porque a diferença entre as duas é
 * digitação, e um farol apagado por causa de um espaço à direita é o tipo de
 * defeito que ninguém encontra olhando a tela.
 *
 * O que ela **não** faz é consertar `taxa de rejeição` em `taxa_de_rejeicao`.
 * Um acento trocado por baixo do pano cria uma chave que existe no banco, não
 * existe em coletor nenhum e parece certa em toda leitura. Chave mal formada
 * fica como está e aparece no diagnóstico de cobertura, onde alguém a conserta.
 *
 * Pelo mesmo motivo, a validação de escrita da etapa **não** foi endurecida:
 * `chaveMonitoramento` continua entrando como texto opcional
 * (`validacao.ts`). Passar a recusar chave fora do formato quebraria o cadastro
 * de quem já escreveu uma — e o cadastro é do desenho do processo, que é
 * trabalho de meses; o farol é uma leitura que se conserta em um minuto.
 */

import type { Etapa, FluxoCompleto } from "../modelo";

const FORMA_DA_CHAVE = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

/** Aparada e em minúsculas. `null` para o que não é chave nenhuma. */
export function normalizarChave(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const chave = valor.trim().toLowerCase();
  return chave === "" ? null : chave;
}

/** A chave está na forma combinada? Só informa — nunca recusa uma escrita. */
export function chaveBemFormada(chave: string): boolean {
  return FORMA_DA_CHAVE.test(chave);
}

/** Uma chave e as etapas do fluxo que a declaram. */
export interface ChaveDoFluxo {
  chave: string;
  etapas: { id: string; nome: string }[];
  bemFormada: boolean;
}

/**
 * As chaves que um fluxo pede, agrupadas — a lista que vira `PedidoDeColeta`.
 *
 * Agrupadas porque **a mesma chave pode aparecer em mais de uma etapa, e isso é
 * legítimo**: "Integração com Rodopar" e "Reprocessamento da integração" olham
 * o mesmo indicador, e as duas acendem juntas. O que não pode é a colheita pedir
 * a mesma medição duas vezes ao coletor por causa disso.
 */
export function chavesDoFluxo(completo: FluxoCompleto): ChaveDoFluxo[] {
  const porChave = new Map<string, ChaveDoFluxo>();
  for (const etapa of completo.etapas) {
    const chave = normalizarChave(etapa.chaveMonitoramento);
    if (chave === null) continue;
    const jaVista = porChave.get(chave);
    if (jaVista) {
      jaVista.etapas.push({ id: etapa.id, nome: etapa.nome });
      continue;
    }
    porChave.set(chave, {
      chave,
      etapas: [{ id: etapa.id, nome: etapa.nome }],
      bemFormada: chaveBemFormada(chave),
    });
  }
  return [...porChave.values()];
}

/** As mesmas chaves, sem agrupamento — o que a colheita consome. */
export function listaDeChaves(completo: FluxoCompleto): string[] {
  return chavesDoFluxo(completo).map((c) => c.chave);
}

/** A chave de uma etapa, já normalizada. */
export function chaveDaEtapa(etapa: Etapa): string | null {
  return normalizarChave(etapa.chaveMonitoramento);
}
