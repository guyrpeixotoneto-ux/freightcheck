import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api";

/**
 * O CADASTRO DA CASA, do lado da tela — cargos, negócios e departamentos.
 *
 * As três consultas moram aqui, e não dentro dos componentes que as usam, pela
 * regra que `lib/contextos.ts` documenta em detalhe: no React Query há **uma**
 * `Query` por chave, com **uma** `queryFn`. Duas telas declarando
 * `["cadastro","cargos"]` com funções diferentes não são duas consultas — são
 * uma consulta e um empate, e quem dispara primeiro dita o comportamento das
 * duas. E são três os lugares que perguntam por cargos: a seção de Cargos, o
 * formulário de conta e a lista de Usuários, que agrupa por eles.
 */

/** Um cargo do quadro, com quantas contas estão lotadas nele. */
export interface Cargo {
  id: string;
  nome: string;
  /** O departamento onde ele está lotado. `null` enquanto ninguém disse. */
  departamentoId: string | null;
  criadoEm: string;
  criadoPor: string | null;
  /** Contas com este cargo. É o número que explica a recusa de excluir. */
  contas: number;
}

/** Um departamento, com o que depende dele. */
export interface Departamento {
  id: string;
  nome: string;
  /** O departamento acima deste. `null` na raiz. */
  paiId: string | null;
  criadoEm: string;
  criadoPor: string | null;
  /** Cargos lotados neste departamento. */
  cargos: number;
  /** Departamentos dentro deste. */
  filhos: number;
}

/** Um negócio atendido pela operação. */
export interface Negocio {
  id: string;
  nome: string;
  criadoEm: string;
  criadoPor: string | null;
}

export const CHAVE_DOS_CARGOS = ["cadastro", "cargos"] as const;
export const CHAVE_DOS_DEPARTAMENTOS = ["cadastro", "departamentos"] as const;
export const CHAVE_DOS_NEGOCIOS = ["cadastro", "negocios"] as const;

export function useCargos(): UseQueryResult<Cargo[], Error> {
  return useQuery<Cargo[], Error>({
    queryKey: CHAVE_DOS_CARGOS,
    queryFn: () => fetchJson<Cargo[]>("/cadastro/cargos"),
  });
}

export function useDepartamentos(): UseQueryResult<Departamento[], Error> {
  return useQuery<Departamento[], Error>({
    queryKey: CHAVE_DOS_DEPARTAMENTOS,
    queryFn: () => fetchJson<Departamento[]>("/cadastro/departamentos"),
  });
}

export function useNegocios(): UseQueryResult<Negocio[], Error> {
  return useQuery<Negocio[], Error>({
    queryKey: CHAVE_DOS_NEGOCIOS,
    queryFn: () => fetchJson<Negocio[]>("/cadastro/negocios"),
  });
}

/**
 * As escritas do cadastro.
 *
 * O `Content-Type` é obrigatório em todas, e não é decoração: sem ele o `fetch`
 * manda `text/plain`, o `express.json()` do servidor não desserializa o corpo e
 * a rota recebe `req.body` vazio — o que chega à tela como "precisa de um nome"
 * com o nome preenchido na frente de quem digitou. Está documentado em
 * `components/unidades/cadastro-canonico.tsx`, onde o defeito aconteceu de
 * verdade, e é o que `lib/__tests__/corpo-json.test.ts` guarda.
 *
 * Ele é repetido literalmente em cada chamada, e não extraído para uma
 * constante, porque aquele teste lê o **objeto de opções** de cada `body:` — um
 * cabeçalho que chegue por variável é, para ele, indistinguível de não haver
 * cabeçalho nenhum. A repetição é o preço de a proteção continuar valendo aqui.
 */

export function criarCargo(pedido: {
  nome: string;
  departamentoId: string | null;
}): Promise<Cargo> {
  return fetchJson<Cargo>("/cadastro/cargos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pedido),
  });
}

export function editarCargo(
  id: string,
  pedido: { nome: string; departamentoId: string | null },
): Promise<Cargo> {
  return fetchJson<Cargo>(`/cadastro/cargos/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pedido),
  });
}

export function excluirCargo(id: string): Promise<unknown> {
  return fetchJson(`/cadastro/cargos/${id}`, { method: "DELETE" });
}

export function criarDepartamento(pedido: {
  nome: string;
  paiId: string | null;
}): Promise<Departamento> {
  return fetchJson<Departamento>("/cadastro/departamentos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pedido),
  });
}

export function editarDepartamento(
  id: string,
  pedido: { nome: string; paiId: string | null },
): Promise<Departamento> {
  return fetchJson<Departamento>(`/cadastro/departamentos/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pedido),
  });
}

export function excluirDepartamento(id: string): Promise<unknown> {
  return fetchJson(`/cadastro/departamentos/${id}`, { method: "DELETE" });
}

export function criarNegocio(pedido: { nome: string }): Promise<Negocio> {
  return fetchJson<Negocio>("/cadastro/negocios", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pedido),
  });
}

export function editarNegocio(id: string, pedido: { nome: string }): Promise<Negocio> {
  return fetchJson<Negocio>(`/cadastro/negocios/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pedido),
  });
}

export function excluirNegocio(id: string): Promise<unknown> {
  return fetchJson(`/cadastro/negocios/${id}`, { method: "DELETE" });
}

/**
 * Grava o cadastro de uma conta — nome, cargo, unidade, telefone e gestor.
 * Devolve a lista de contas atualizada.
 *
 * O e-mail não entra: ele é quem a pessoa é para o histórico, e o servidor não
 * o troca por ninguém (ver `routes/users.ts`). O papel também não — é acesso, e
 * tem rota própria pela mesma razão.
 */
export function definirCadastroDaConta(
  userId: string,
  pedido: {
    name: string;
    sobrenome: string;
    cargoId: string | null;
    unidadeId: string | null;
    telefone: string | null;
    gestorId: string | null;
  },
): Promise<unknown> {
  return fetchJson(`/users/${userId}/cadastro`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pedido),
  });
}

/**
 * O caminho de um departamento até a raiz, escrito como `Administrativo ›
 * Controladoria`.
 *
 * É função pura sobre a lista que a tela já tem — e não uma consulta a mais —
 * porque a lista inteira cabe numa resposta: uma empresa não tem dez mil
 * departamentos, e buscar o caminho de cada linha seria uma chamada por linha
 * para escrever um texto.
 *
 * Para com teto de saltos porque um ciclo gravado à mão no banco não pode
 * travar a tela num laço enquanto alguém o desfaz — a mesma proteção que
 * `caminhoAteRaiz` tem do lado do servidor.
 */
export function caminhoDoDepartamento(
  departamentos: Departamento[],
  id: string,
): string[] {
  const porId = new Map(departamentos.map((d) => [d.id, d]));
  const nomes: string[] = [];
  const vistos = new Set<string>();
  let atual: string | null = id;
  for (let salto = 0; atual !== null && salto < 64; salto += 1) {
    if (vistos.has(atual)) break;
    vistos.add(atual);
    const no: Departamento | undefined = porId.get(atual);
    if (!no) break;
    nomes.unshift(no.nome);
    atual = no.paiId;
  }
  return nomes;
}
