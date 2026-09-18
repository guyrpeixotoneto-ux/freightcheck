import type { UseQueryOptions } from "@tanstack/react-query";
import type { TipoDaLinhaDoTempo } from "@workspace/comparison/tipos";
import { fetchJsonOrNull } from "@/lib/api";
import type { Movimentos, RangeOverview } from "@/lib/analise";

/**
 * A leitura de `/changes/range` da Linha do Tempo — a pergunta, num lugar só.
 *
 * Três consumidores fazem exatamente esta pergunta ao abrir a tela: o cartão de
 * impacto, o gráfico de alterações e o prefetch da própria página. Enquanto a
 * chave era montada em cada um deles, "a mesma pergunta" era uma coincidência
 * que dependia de os três repetirem a mesma ordem de parâmetros — e uma letra
 * fora do lugar em qualquer um deles vira uma segunda requisição cara, sem
 * ninguém notar, porque as duas respondem certo.
 *
 * Aqui a coincidência vira função: quem quiser o intervalo pede por este
 * caminho, e o React Query enxerga uma pergunta só — um cache, uma requisição
 * em voo.
 */
export function consultaDoIntervalo(
  consulta: URLSearchParams,
  de: string,
  ate: string,
  /**
   * O tipo, quando a aba "Cavalo, Carreta e Trecho" está aberta.
   *
   * Ele entra na consulta e, por consequência, na chave — que é o que se quer:
   * a leitura de cavalo e a de carreta são perguntas diferentes sobre o mesmo
   * intervalo, e compartilhar cache entre elas mostraria uma no lugar da outra.
   * Quem não passa nada continua fazendo a pergunta da aba Geral, com a chave
   * que ela sempre teve.
   */
  tipo?: TipoDaLinhaDoTempo | null,
  /**
   * O recorte por parâmetro, quando alguém chegou por um link que o nomeia.
   *
   * São `parameterKey`s (`FAMÍLIA|parâmetro`), e é o servidor que os produz —
   * ver `parametrosDoHistorico`, no domínio. A tela nunca os monta: mandar
   * código de atributo aqui abriria a leitura vazia sem erro nenhum, que é
   * exatamente o defeito que a Evolução anual do FINAME já teve.
   *
   * Ele entra na chave junto com o resto: o histórico do FINAME e o histórico
   * inteiro são perguntas diferentes sobre o mesmo intervalo, e compartilhar
   * cache entre elas mostraria uma no lugar da outra.
   */
  parametros?: readonly string[] | null,
): URLSearchParams {
  const query = new URLSearchParams(consulta);
  query.delete("period");
  query.set("from", de);
  query.set("to", ate);
  if (tipo) query.set("tipo", tipo);
  if (parametros && parametros.length > 0) {
    query.set("parameters", [...parametros].join(","));
  }
  return query;
}

export function opcoesDoIntervalo(
  consulta: URLSearchParams,
  de: string,
  ate: string,
  tipo?: TipoDaLinhaDoTempo | null,
  parametros?: readonly string[] | null,
): Pick<
  UseQueryOptions<Movimentos | null>,
  "queryKey" | "queryFn" | "staleTime"
> {
  const query = consultaDoIntervalo(consulta, de, ate, tipo, parametros);
  return {
    queryKey: ["changes-range", query.toString()],
    queryFn: () => fetchJsonOrNull<Movimentos>(`/changes/range?${query}`),
    staleTime: 60_000,
  };
}

/**
 * A mesma pergunta entre todas as unidades — `/changes/range/overview`.
 *
 * Vale por três telas: o ranking "Onde está o impacto?" da Linha do Tempo, o
 * gráfico de impacto por vigência do Dashboard em Visão Geral e a coluna de
 * alterações do seletor de vigência. As três liam o mesmo intervalo com chaves
 * próprias — e a de menu, por ser a última a montar, pagava sozinha uma
 * varredura do histórico que a tela já tinha feito. Com a chave num lugar só,
 * quem abre o menu encontra a contagem pronta, como no seletor da unidade.
 *
 * O intervalo aqui não herda `scopeHash` nem canal de propósito: "todas as
 * unidades" é a própria pergunta, e só as pontas a recortam.
 */
export function opcoesDoIntervaloGeral(
  de: string | null,
  ate: string | null,
): Pick<
  UseQueryOptions<RangeOverview | null>,
  "queryKey" | "queryFn" | "staleTime"
> {
  const query = new URLSearchParams();
  if (de) query.set("from", de);
  if (ate) query.set("to", ate);
  return {
    queryKey: ["linha-do-tempo-overview", query.toString()],
    queryFn: () => fetchJsonOrNull<RangeOverview>(`/changes/range/overview?${query}`),
    staleTime: 60_000,
  };
}
