import { useQuery, type QueryKey } from "@tanstack/react-query";
import {
  FAROIS,
  type EstadoDaEtapa,
  type Farol,
  type Monitoramento,
  type MotivoDaAusencia,
} from "@workspace/fluxos/monitoramento";
import { fetchJson } from "@/lib/api";

/**
 * O MONITORAMENTO NA TELA — o consumo do motor que já existia, e nada além.
 *
 * ---------------------------------------------------------------------------
 * Nenhuma regra nova mora aqui
 * ---------------------------------------------------------------------------
 *
 * A cor, a validade, o motivo do apagado, o pior farol e o resumo saem prontos
 * de `GET /fluxos/:id/monitoramento`. Este arquivo não recalcula nada disso, não
 * tem limiar, não tem `switch` por cor e não sabe o que é um CT-e. Ele faz três
 * coisas: pede a leitura, traduz segundos em palavras e traduz o código do
 * motivo na frase que alguém consegue agir.
 *
 * ---------------------------------------------------------------------------
 * O vocabulário vem do motor, e por um subcaminho de propósito
 * ---------------------------------------------------------------------------
 *
 * `FAROIS` — com rótulo, descrição e **a classe do tema** de cada cor — mora em
 * `@workspace/fluxos/monitoramento`. A tela lê de lá em vez de ter a própria
 * tabela de cores, pela mesma razão que o catálogo de tipos de etapa vem da API:
 * uma segunda lista escrita aqui é o jeito conhecido de a tela discordar do
 * servidor sobre o que é "sem dado".
 *
 * O import é do **subcaminho** `@workspace/fluxos/monitoramento`, e nunca do
 * índice do pacote. O índice reexporta `repositorio.ts`, que importa
 * `@workspace/db` e o `drizzle` — e arrastar isso para o bundle do navegador é o
 * defeito que `vite.config.ts` transformou em erro de build depois de ele ter
 * publicado uma tela em branco. O subcaminho só alcança `modelo`, `catalogo` e
 * `validacao`: nenhum toca banco, nenhum toca builtin do Node.
 *
 * ⚠️ Não confundir com `components/composicao/farol.tsx`, que tem um `Farol`
 * próprio (`NORMAL | ATENCAO | CRITICO | INCOMPLETO`) para outra coisa. São dois
 * vocabulários diferentes de duas perguntas diferentes, e misturá-los seria
 * criar a segunda definição de cor que o motor existe para não ter.
 */

export type {
  EstadoDaEtapa,
  Farol,
  Monitoramento,
  MotivoDaAusencia,
} from "@workspace/fluxos/monitoramento";
export { FAROIS } from "@workspace/fluxos/monitoramento";

/** A entrada do catálogo de faróis para uma cor — rótulo, descrição e classe. */
export function farolNoCatalogo(farol: Farol) {
  return FAROIS.find((f) => f.valor === farol) ?? FAROIS[FAROIS.length - 1]!;
}

/**
 * POR QUE ESTA ETAPA ESTÁ APAGADA — a frase, no lugar do código.
 *
 * As cinco causas de `MotivoDaAusencia` pedem providências diferentes, e é essa
 * a informação que a tela deve dar. `sem_coletor` é trabalho de quem liga
 * integração; `vencida` é trabalho de quem importa o arquivo da quinzena;
 * `sem_chave` é trabalho de quem desenha o processo. Um cinza mudo pediria as
 * três ao mesmo tempo, para ninguém.
 *
 * Nenhuma delas diz "está tudo bem". É a regra que este módulo inteiro existe
 * para sustentar: **ausência nunca se apresenta como normalidade.**
 */
export const FRASE_DO_MOTIVO: Record<MotivoDaAusencia, string> = {
  sem_chave: "Esta etapa não declara chave de monitoramento — ninguém pediu para medi-la.",
  sem_coletor: "Nenhum coletor responde por esta chave ainda.",
  coletor_falhou: "O coletor desta chave falhou nesta leitura.",
  sem_resposta: "O coletor existe e não devolveu medição para esta chave.",
  vencida: "A última medição passou da validade — dado velho não é dado.",
};

/** O rótulo curto do motivo, para caber ao lado do farol. */
export const ROTULO_DO_MOTIVO: Record<MotivoDaAusencia, string> = {
  sem_chave: "sem chave",
  sem_coletor: "sem coletor",
  coletor_falhou: "coletor falhou",
  sem_resposta: "sem resposta",
  vencida: "vencida",
};

/**
 * A idade de uma medição, em palavras — "há 3 dias", "há 2h", "agora".
 *
 * É o que transforma `idadeEmSegundos: 259200` na informação que faz alguém ir
 * conferir o coletor. Função pura, e por isso testável sem navegador.
 *
 * `null` entra e `null` sai: etapa sem leitura não tem idade, e escrever "há 0
 * segundos" ali seria inventar uma medição que não houve.
 */
export function idadeEmPalavras(segundos: number | null): string | null {
  if (segundos === null || !Number.isFinite(segundos)) return null;
  const s = Math.max(0, Math.round(segundos));
  if (s < 60) return "agora";
  if (s < 3_600) return `há ${Math.round(s / 60)} min`;
  if (s < 86_400) return `há ${Math.round(s / 3_600)}h`;
  const dias = Math.round(s / 86_400);
  return dias === 1 ? "há 1 dia" : `há ${dias} dias`;
}

/**
 * O número medido com a unidade ao lado — `412 CT-e`, `100 %`.
 *
 * `null` quando o coletor só sabe dizer a cor, que é um coletor legítimo: o
 * contrato não obriga ninguém a inventar um número (ver `Leitura`, em
 * `contrato.ts`).
 */
export function valorComUnidade(estado: EstadoDaEtapa): string | null {
  const leitura = estado.leitura;
  if (!leitura || leitura.valor === null || leitura.valor === undefined) return null;
  const numero = leitura.valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  return leitura.unidade ? `${numero} ${leitura.unidade}` : numero;
}

export const chaveDoMonitoramento = (
  empresaId: string | null,
  fluxoId: string,
): QueryKey => ["fluxo", empresaId, fluxoId, "monitoramento"];

/**
 * A leitura do farol de um fluxo.
 *
 * **Consulta própria, e não parte de `useFluxo`.** O fluxo é cadastro e muda
 * quando alguém edita; o monitoramento é uma foto datada que envelhece sozinha.
 * Juntá-los faria toda troca de visualização recolher os coletores, e faria uma
 * integração lenta atrasar o desenho do processo — que é o que a tela precisa
 * mostrar primeiro, e mostra bem sem farol nenhum.
 *
 * Não há `refetchInterval`: a V1 não fica de plantão. `apuradoEm` viaja na
 * resposta e a tela mostra de quando é a foto, em vez de fingir tempo real.
 */
export function useMonitoramentoDoFluxo(
  empresaId: string | null,
  fluxoId: string,
  habilitado = true,
) {
  return useQuery({
    queryKey: chaveDoMonitoramento(empresaId, fluxoId),
    enabled: habilitado && empresaId !== null && fluxoId !== "",
    queryFn: () =>
      fetchJson<Monitoramento>(
        `/fluxos/${fluxoId}/monitoramento${empresaId ? `?empresaId=${encodeURIComponent(empresaId)}` : ""}`,
      ),
    /*
      A colheita é feita na leitura, do outro lado. Meio minuto de folga evita
      que abrir e fechar a visualização refaça as consultas às fontes, sem
      chegar perto de envelhecer a foto: a validade mais curta em produção é de
      uma hora (`VALIDADE_PADRAO_EM_S`).
    */
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * As etapas na ordem de quem está olhando um problema: o pior primeiro.
 *
 * A ordem do fluxo é a ordem do processo, e é a certa para ler o desenho. Numa
 * lista de monitoramento a pergunta é outra — "o que está ruim agora" —, e uma
 * etapa vermelha na posição 14 de 18 não pode exigir rolagem.
 *
 * `SEM_DADO` fica **no fim**, e não junto do verde: ele não é uma nota boa nem
 * ruim, é a ausência de nota. Dentro de cada grupo, a ordem do processo se
 * mantém — é o desempate que não inventa hierarquia nenhuma.
 */
const PESO_NA_LISTA: Record<Farol, number> = {
  VERMELHO: 0,
  AMARELO: 1,
  VERDE: 2,
  SEM_DADO: 3,
};

export function ordenarPorGravidade(
  etapas: readonly EstadoDaEtapa[],
): EstadoDaEtapa[] {
  return etapas
    .map((etapa, ordem) => ({ etapa, ordem }))
    .sort(
      (a, b) =>
        PESO_NA_LISTA[a.etapa.farol] - PESO_NA_LISTA[b.etapa.farol] ||
        a.ordem - b.ordem,
    )
    .map((c) => c.etapa);
}
