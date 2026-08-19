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

/**
 * O que aconteceu com a linha entre uma quinzena e a outra.
 *
 * Os quatro últimos são sobre o **acervo**, não sobre o dinheiro — ver
 * `lib/remuneracao/src/comparacao.ts`. A tela os desenha diferente por isso: um
 * "+100%" que descreve uma coluna que passou a ser importada seria o número
 * mais perigoso que este módulo poderia mostrar.
 */
export type Movimento =
  | "IGUAL"
  | "SUBIU"
  | "DESCEU"
  | "GANHOU_LASTRO"
  | "PERDEU_LASTRO"
  | "SEM_COMPARACAO";

export interface Variacao {
  absoluta: number;
  /** Nulo quando a base é zero — dividir por zero não é "infinito%". */
  percentual: number | null;
}

export interface LinhaComparada {
  chave: string;
  rotulo: string;
  medida: Medida;
  preenchimento: Preenchimento;
  esquerda: LinhaApurada;
  direita: LinhaApurada;
  movimento: Movimento;
  variacao: Variacao | null;
}

export interface BlocoComparado {
  titulo: string;
  resumo: string;
  linhas: LinhaComparada[];
}

export interface PontaDaComparacao {
  effectiveDate: string;
  periodLabel: string;
  material: { cavalos: number; trechos: number; trechosEntregues: boolean };
}

export interface ComparacaoDeCadastros {
  blocos: BlocoComparado[];
  resumo: {
    linhas: number;
    iguais: number;
    mudaram: number;
    ganharamLastro: number;
    perderamLastro: number;
    semComparacao: number;
  };
  contexto: CadastroDaUnidade["contexto"];
  esquerda: PontaDaComparacao;
  direita: PontaDaComparacao;
  vigencias: { effectiveDate: string; periodLabel: string }[];
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

/** As duas quinzenas lado a lado. Sem `de`/`ate`, as duas mais recentes. */
export function lerComparacao(pedido: {
  scopeHash?: string;
  canal?: string | null;
  de?: string;
  ate?: string;
}): Promise<ComparacaoDeCadastros> {
  const query = new URLSearchParams();
  if (pedido.scopeHash) query.set("scopeHash", pedido.scopeHash);
  if (pedido.canal !== undefined && pedido.canal !== null) query.set("canal", pedido.canal);
  if (pedido.de) query.set("de", pedido.de);
  if (pedido.ate) query.set("ate", pedido.ate);
  const sufixo = query.toString();
  return fetchJson<ComparacaoDeCadastros>(
    `/remuneracao/comparacao${sufixo ? `?${sufixo}` : ""}`,
  );
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

/**
 * A variação escrita, com o sinal explícito.
 *
 * Pontos percentuais em linha de percentual, e não "%": a fatia dentro do
 * município que vai de 3,16% para 2,38% caiu **0,78 ponto**, e escrever "−0,78%"
 * ali seria confundir a diferença com a razão entre as duas — que é −24,7%. As
 * duas aparecem na tela, e por isso precisam ser distinguíveis.
 */
export function escreverVariacao(variacao: Variacao, medida: Medida): string {
  const sinal = variacao.absoluta > 0 ? "+" : "−";
  const magnitude = Math.abs(variacao.absoluta);

  if (medida === "PERCENTUAL") {
    const pontos = magnitude.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
    return `${sinal}${pontos} ${magnitude === 1 ? "ponto" : "pontos"}`;
  }
  return `${sinal}${escreverValor(magnitude, medida)}`;
}

/** A legenda da planilha, em palavra que quem a usa reconhece. */
export const NOME_DO_PREENCHIMENTO: Record<Preenchimento, string> = {
  INFORMADO: "Preencher informações",
  AUTOMATICO: "Preenchimento automático",
};

/**
 * O que cada movimento significa, numa frase.
 *
 * `IGUAL`, `SUBIU` e `DESCEU` não têm frase: o número das duas colunas já as
 * diz, e uma legenda repetindo "subiu" ao lado de uma seta para cima só ocupa
 * espaço.
 *
 * `SEM_COMPARACAO` também não tem, e por outra razão: ela é a maioria das
 * linhas hoje, e a mesma frase escrita em cada uma apareceu vinte e sete vezes
 * idênticas na mesma tela, empurrando para baixo as três que tinham número. O
 * que ela diria a tabela agora diz uma vez por bloco.
 *
 * Ficam as duas que são notícia — cobertura que apareceu e cobertura que sumiu.
 * Nenhuma das duas é sobre dinheiro, e as duas seriam lidas como se fossem.
 */
export const EXPLICACAO_DO_MOVIMENTO: Partial<Record<Movimento, string>> = {
  GANHOU_LASTRO:
    "Não é aumento: o acervo passou a sustentar esta linha nesta quinzena. Comparar com a " +
    "anterior seria comparar com um valor que nunca existiu.",
  PERDEU_LASTRO:
    "A quinzena anterior sustentava esta linha e esta não sustenta. Não é queda — é cobertura " +
    "que se perdeu, e vale conferir o que mudou na importação.",
};
