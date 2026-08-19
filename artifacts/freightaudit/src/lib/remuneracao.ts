import { fetchJson } from "@/lib/api";

/**
 * O cliente do módulo Remuneração.
 *
 * Os tipos espelham o que `@workspace/remuneracao` produz, e são reescritos em
 * vez de importados pela mesma razão de `lib/fechamento.ts`: o bundle da
 * interface não deve carregar o motor. A montagem do cadastro roda no servidor,
 * sobre o que o acervo guardou, e a tela só a lê — um tipo duplicado é o preço
 * de a interface não poder, nem por acidente, medir alíquota por conta própria.
 */

export type Medida = "DINHEIRO" | "PERCENTUAL" | "QUANTIDADE";
export type Preenchimento = "INFORMADO" | "AUTOMATICO";
export type EstadoDaLinha = "APURADO" | "EM_CONJUNTO" | "SEM_LASTRO";

export interface Procedencia {
  fonte: string;
  colunas: string[];
  regra: string;
  registros: number;
}

export interface Ausencia {
  motivo: string;
  destrava: string;
  hoje?: { href: string; label: string; porque: string };
}

export interface Conjunto {
  rotulo: string;
  linhas: string[];
  valor: number;
  medida: Medida;
  procedencia: Procedencia;
}

export interface LinhaApurada {
  chave: string;
  rotulo: string;
  medida: Medida;
  preenchimento: Preenchimento;
  estado: EstadoDaLinha;
  valor: number | null;
  procedencia: Procedencia | null;
  ausencia: Ausencia | null;
  conjunto: Conjunto | null;
}

export interface BlocoApurado {
  titulo: string;
  resumo: string;
  linhas: LinhaApurada[];
}

export interface CadastroDaUnidade {
  blocos: BlocoApurado[];
  resumo: { linhas: number; apuradas: number; emConjunto: number; semLastro: number };
  contexto: {
    scopeHash: string;
    channel: string | null;
    label: string;
    unidade: string | null;
    scopes: { scopeType: string; code: string; name: string | null }[];
  };
  effectiveDate: string;
  periodLabel: string;
  vigencias: { effectiveDate: string; periodLabel: string }[];
  material: { cavalos: number; trechos: number; trechosEntregues: boolean };
}

export interface UnidadeDoCadastro {
  scopeHash: string;
  canal: string | null;
  label: string;
  scopes: { scopeType: string; code: string; name: string | null }[];
  vigenciaMaisRecente: string;
  vigencias: string[];
}

export function listarUnidadesDoCadastro(): Promise<UnidadeDoCadastro[]> {
  return fetchJson<UnidadeDoCadastro[]>("/remuneracao/unidades");
}

export function lerCadastro(pedido: {
  scopeHash?: string;
  canal?: string | null;
  period?: string;
}): Promise<CadastroDaUnidade> {
  const query = new URLSearchParams();
  if (pedido.scopeHash) query.set("scopeHash", pedido.scopeHash);
  if (pedido.canal !== undefined && pedido.canal !== null) query.set("canal", pedido.canal);
  if (pedido.period) query.set("period", pedido.period);
  const sufixo = query.toString();
  return fetchJson<CadastroDaUnidade>(`/remuneracao/cadastro${sufixo ? `?${sufixo}` : ""}`);
}

/**
 * O valor de uma linha, escrito conforme o que ela mede.
 *
 * Percentual com quatro casas porque é assim que ele entra na conta do
 * gross-up: 72,91% arredondado para 72,9% muda o valor de um documento de
 * R$ 8.697,88 em oito reais, e oito reais por rota por quinzena é a ordem de
 * grandeza das diferenças que este produto existe para achar. Dinheiro com
 * duas, que é o que o real tem.
 *
 * `null` nunca chega aqui como zero: a tela não chama esta função para linha
 * sem valor — quem não tem número mostra o motivo, e é outra coisa na tela.
 */
export function escreverValor(valor: number, medida: Medida): string {
  if (medida === "QUANTIDADE") {
    return valor.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  }
  if (medida === "PERCENTUAL") {
    return `${valor.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    })}%`;
  }
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** A legenda da planilha, em palavra que quem a usa reconhece. */
export const NOME_DO_PREENCHIMENTO: Record<Preenchimento, string> = {
  INFORMADO: "Preencher informações",
  AUTOMATICO: "Preenchimento automático",
};
