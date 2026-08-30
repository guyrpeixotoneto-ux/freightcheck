/**
 * Integrações — o vocabulário da tela, longe do React.
 *
 * O que mora aqui é o que precisa ser lido sem montar componente nenhum: os
 * tipos que a API devolve e a leitura de estado de uma integração. A tela
 * desenha; este arquivo decide o que ela está desenhando.
 *
 * A regra que a lista respeita, e que é a mesma das outras telas deste
 * produto: **nenhum estado é inventado.** "Nunca chamou" não vira "com
 * problema", e "sem chave" não vira "desativada" — são situações diferentes,
 * com consertos diferentes, e a frase de cada uma diz o que fazer.
 */

export interface ChaveDaIntegracao {
  id: string;
  prefixo: string;
  apelido: string | null;
  escopos: string[];
  criadaEm: string;
  criadaPor: string;
  ultimaChamadaEm: string | null;
  revogadaEm: string | null;
  revogadaPor: string | null;
}

export interface Integracao {
  id: string;
  nome: string;
  sistema: string;
  descricao: string | null;
  criadaEm: string;
  criadaPor: string;
  desativadaEm: string | null;
  desativadaPor: string | null;
  chaves: ChaveDaIntegracao[];
  ultimas24h: { ok: number; recusadas: number; falhas: number };
  ultimaChamadaEm: string | null;
}

export interface DescricaoDeEscopo {
  escopo: string;
  titulo: string;
  permite: string;
  rotas: string[];
  direcao: "ENTRADA" | "SAIDA";
}

export interface PainelDeIntegracoes {
  escopos: DescricaoDeEscopo[];
  integracoes: Integracao[];
}

export interface ChamadaDaIntegracao {
  id: string;
  em: string;
  metodo: string;
  caminho: string;
  status: number;
  duracaoMs: number;
  resultado: string;
  motivo: string | null;
  bytes: number;
  prefixo: string | null;
  importRunId: string | null;
}

/** As chaves que ainda valem — as revogadas ficam na lista, mas não contam. */
export function chavesVivas(integracao: Integracao): ChaveDaIntegracao[] {
  return integracao.chaves.filter((c) => c.revogadaEm === null);
}

export type EstadoDaIntegracao =
  | "DESATIVADA"
  | "SEM_CHAVE"
  | "NUNCA_CHAMOU"
  | "RECUSANDO"
  | "ATIVA";

/**
 * O estado de uma integração, na ordem em que quem lê precisa saber.
 *
 * Desativada vem primeiro porque ela explica todas as outras: uma integração
 * desligada não chama, e dizer "nunca chamou" sobre ela mandaria procurar o
 * problema no sistema de fora. Depois vem o que falta para ela existir (chave),
 * depois o que falta para ela funcionar (a primeira chamada), e só então o
 * julgamento sobre as chamadas que houve.
 *
 * **RECUSANDO é a única leitura de saúde, e ela é conservadora**: só aparece
 * quando *todas* as chamadas das últimas 24 horas foram recusadas ou falharam.
 * Uma integração que manda o arquivo certo e apanha um 409 de duplicata na
 * segunda tentativa do dia está funcionando, e pintá-la de vermelho ensinaria
 * quem opera a ignorar o vermelho.
 */
export function estadoDa(integracao: Integracao): EstadoDaIntegracao {
  if (integracao.desativadaEm !== null) return "DESATIVADA";
  if (chavesVivas(integracao).length === 0) return "SEM_CHAVE";
  if (integracao.ultimaChamadaEm === null) return "NUNCA_CHAMOU";

  const { ok, recusadas, falhas } = integracao.ultimas24h;
  if (ok === 0 && recusadas + falhas > 0) return "RECUSANDO";
  return "ATIVA";
}

/** O que cada estado quer dizer, e o que fazer a respeito. */
export const EXPLICACAO_DO_ESTADO: Record<EstadoDaIntegracao, string> = {
  DESATIVADA:
    "Desativada: nenhuma chave desta integração entra enquanto ela estiver assim.",
  SEM_CHAVE:
    "Sem chave válida — emita uma para o sistema do outro lado poder chamar.",
  NUNCA_CHAMOU:
    "A chave existe, e ninguém a usou ainda. Confira a configuração do outro lado com GET /api/v1/ping.",
  RECUSANDO:
    "Todas as chamadas das últimas 24 horas foram recusadas. Veja o motivo no log abaixo.",
  ATIVA: "Chamando e sendo atendida.",
};

/** Data e hora no formato que o resto do produto usa. */
export function quando(iso: string | null): string {
  if (iso === null) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
