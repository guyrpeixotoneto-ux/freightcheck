import type { Conexao, Etapa, FluxoCompleto } from "@/lib/fluxos";
import {
  numeracaoDoFluxo,
  ordemDeLeitura,
  raiaDaEtapa,
  type LenteDaJornada,
} from "@/lib/fluxos-visoes";

/**
 * A CAMADA ANALÍTICA — o que o processo cadastrado já denuncia sobre si mesmo.
 *
 * A visualização de Gargalos não é um módulo novo nem um dado novo: é o mesmo
 * fluxograma com esta leitura por cima. Cada sinal abaixo é uma **contagem do
 * que está cadastrado** — uma falha registrada, um retorno que chega, uma etapa
 * sem responsável. Nenhum é estimativa, nenhum é média inventada e nenhum
 * depende de dado de execução, que este produto ainda não coleta.
 *
 * É por isso que existe a severidade `sem-avaliacao`: uma etapa em que só o nome
 * foi preenchido não é uma etapa saudável, é uma etapa sobre a qual não se sabe
 * nada — e dizer "normal" ali seria exatamente a mentira que o módulo recusa. A
 * tela mostra "Dados insuficientes", que é a informação verdadeira e, no fim, a
 * mais acionável: quem lê descobre o que falta cadastrar.
 *
 * O que **não** está aqui, e não está de propósito: atraso, SLA estourado,
 * tempo médio, volume. Todos dependem de execução medida, que é o Modo
 * Monitoramento. Quando ele existir, entra como mais uma família de sinais
 * nesta mesma função — sem mexer em nenhuma visualização.
 */

export type Severidade = "critico" | "atencao" | "normal" | "sem-avaliacao";

export interface SinalDaEtapa {
  chave: string;
  /** A frase que o painel mostra: "2 retornos chegam a esta etapa". */
  rotulo: string;
  peso: "critico" | "atencao";
}

export interface DiagnosticoDaEtapa {
  etapaId: string;
  severidade: Severidade;
  sinais: SinalDaEtapa[];
}

export interface AnaliseDoFluxo {
  porEtapa: Map<string, DiagnosticoDaEtapa>;
  /** Quantas etapas em cada severidade — o cabeçalho da visualização. */
  contagem: Record<Severidade, number>;
  /** Os sinais mais frequentes, do mais comum para o menos. */
  frequencia: { chave: string; rotulo: string; etapas: number }[];
}

export const SEVERIDADES: readonly {
  valor: Severidade;
  rotulo: string;
  /** Classes do tema para o ponto e para a borda do cartão. */
  ponto: string;
  cartao: string;
  /** A cor literal, para o SVG do canvas — mesma exceção de `montarCanvas`. */
  cor: string;
}[] = [
  {
    valor: "critico",
    rotulo: "Crítico",
    ponto: "bg-rose-500",
    cartao: "border-rose-300 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/60",
    cor: "#f43f5e",
  },
  {
    valor: "atencao",
    rotulo: "Atenção",
    ponto: "bg-amber-500",
    cartao: "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/60",
    cor: "#f59e0b",
  },
  {
    valor: "normal",
    rotulo: "Normal",
    ponto: "bg-emerald-500",
    cartao: "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/40",
    cor: "#10b981",
  },
  {
    valor: "sem-avaliacao",
    rotulo: "Sem avaliação",
    ponto: "bg-muted-foreground/40",
    cartao: "border-dashed border-border bg-muted/40",
    cor: "#94a3b8",
  },
];

export const severidadeNoCatalogo = (valor: Severidade) =>
  SEVERIDADES.find((s) => s.valor === valor) ?? SEVERIDADES[3];

const texto = (v: string | null | undefined) => (v ?? "").trim();
const plural = (n: number, um: string, muitos: string) => `${n} ${n === 1 ? um : muitos}`;

/** Os prazos cadastrados na etapa — a espécie `PRAZO` do catálogo. */
export function prazosDaEtapa(etapa: Etapa): string[] {
  return etapa.itens
    .filter((i) => i.especie === "PRAZO" && texto(i.nome) !== "")
    .sort((a, b) => a.ordem - b.ordem)
    .map((i) => i.nome);
}

/**
 * O SLA da etapa como a Lista e a Jornada o mostram — ou `null`.
 *
 * Nulo aqui quer dizer "ninguém cadastrou", e a tela escreve isso com todas as
 * letras. Não existe prazo padrão, prazo herdado nem prazo estimado: um número
 * inventado numa coluna de SLA vira decisão de gente de verdade.
 */
export function slaDaEtapa(etapa: Etapa): string | null {
  const prazos = prazosDaEtapa(etapa);
  return prazos.length === 0 ? null : prazos.join(" · ");
}

/** Os sistemas da etapa — a coluna principal mais os itens da espécie. */
export function sistemasDaEtapa(etapa: Etapa): string[] {
  const lista = [
    ...(texto(etapa.sistemaPrincipal) === "" ? [] : [texto(etapa.sistemaPrincipal)]),
    ...etapa.itens.filter((i) => i.especie === "SISTEMA").map((i) => i.nome),
  ];
  return [...new Set(lista)];
}

/** Quem responde pela etapa — a coluna mais os itens da espécie. */
export function responsaveisDaEtapa(etapa: Etapa): string[] {
  const lista = [
    ...(texto(etapa.responsavel) === "" ? [] : [texto(etapa.responsavel)]),
    ...etapa.itens.filter((i) => i.especie === "RESPONSAVEL").map((i) => i.nome),
  ];
  return [...new Set(lista)];
}

/** A etapa tem alguma coisa cadastrada além do nome e do tipo? */
function temSubstancia(etapa: Etapa): boolean {
  return (
    texto(etapa.area) !== "" ||
    texto(etapa.responsavel) !== "" ||
    texto(etapa.sistemaPrincipal) !== "" ||
    texto(etapa.descricao) !== "" ||
    texto(etapa.objetivo) !== "" ||
    texto(etapa.regras) !== "" ||
    texto(etapa.informacoesConsultadas) !== "" ||
    texto(etapa.observacoes) !== "" ||
    etapa.itens.length > 0 ||
    etapa.indicadores.length > 0
  );
}

/**
 * O diagnóstico de uma etapa — os sinais, e o pior deles.
 *
 * A vizinhança entra por parâmetro (as conexões que chegam e as que saem, e a
 * área dos vizinhos) porque retorno, exceção e handoff são propriedades do
 * **grafo**, não da linha da etapa: uma etapa é gargalo por causa do que
 * acontece em volta dela.
 */
export function diagnosticarEtapa(
  etapa: Etapa,
  vizinhanca: {
    entram: Conexao[];
    saem: Conexao[];
    /** As raias (por área) dos vizinhos imediatos, para contar handoffs. */
    raiasVizinhas: string[];
  },
): DiagnosticoDaEtapa {
  const sinais: SinalDaEtapa[] = [];

  const falhas = etapa.itens.filter((i) => i.especie === "FALHA").length;
  if (falhas > 0) {
    sinais.push({
      chave: "problema",
      rotulo: plural(falhas, "falha registrada", "falhas registradas"),
      peso: "critico",
    });
  }

  const gargalos = etapa.itens.filter((i) => i.especie === "GARGALO").length;
  if (gargalos > 0) {
    sinais.push({
      chave: "gargalo",
      rotulo: plural(gargalos, "gargalo apontado", "gargalos apontados"),
      peso: "critico",
    });
  }

  if (etapa.status === "ATENCAO") {
    sinais.push({
      chave: "status",
      rotulo: "Etapa marcada como atenção",
      peso: "critico",
    });
  }

  const retornos = vizinhanca.entram.filter((c) => c.tipo === "RETRABALHO").length;
  if (retornos > 0) {
    sinais.push({
      chave: "retorno",
      rotulo: `${plural(retornos, "retorno chega", "retornos chegam")} a esta etapa`,
      peso: "critico",
    });
  }

  const excecoes = [...vizinhanca.entram, ...vizinhanca.saem].filter(
    (c) => c.tipo === "EXCECAO",
  ).length;
  if (excecoes > 0) {
    sinais.push({
      chave: "excecao",
      rotulo: plural(excecoes, "exceção ligada à etapa", "exceções ligadas à etapa"),
      peso: "atencao",
    });
  }

  if (responsaveisDaEtapa(etapa).length === 0 && texto(etapa.area) === "") {
    sinais.push({ chave: "sem-responsavel", rotulo: "Sem responsável definido", peso: "atencao" });
  }

  if (sistemasDaEtapa(etapa).length === 0) {
    sinais.push({ chave: "sem-sistema", rotulo: "Sem sistema definido", peso: "atencao" });
  }

  if (prazosDaEtapa(etapa).length === 0) {
    sinais.push({ chave: "sem-prazo", rotulo: "Sem prazo (SLA) definido", peso: "atencao" });
  }

  const documentado =
    texto(etapa.descricao) !== "" ||
    texto(etapa.objetivo) !== "" ||
    texto(etapa.regras) !== "" ||
    etapa.itens.some((i) => i.especie === "DOCUMENTO");
  if (!documentado) {
    sinais.push({ chave: "sem-documentacao", rotulo: "Sem documentação da etapa", peso: "atencao" });
  }

  /*
    Handoff: a etapa troca de mão com mais de uma outra área. Duas trocas é o
    limiar porque uma troca é o normal de qualquer processo que anda — o que
    custa é a etapa que recebe de um lado e entrega para outro toda vez.
  */
  const propria = texto(etapa.area);
  const outras = new Set(vizinhanca.raiasVizinhas.filter((r) => r !== "" && r !== propria));
  if (outras.size >= 2) {
    sinais.push({
      chave: "handoffs",
      rotulo: `${plural(outras.size, "área diferente", "áreas diferentes")} em volta desta etapa`,
      peso: "atencao",
    });
  }

  const severidade: Severidade = !temSubstancia(etapa)
    ? "sem-avaliacao"
    : sinais.some((s) => s.peso === "critico")
      ? "critico"
      : sinais.some((s) => s.peso === "atencao")
        ? "atencao"
        : "normal";

  return { etapaId: etapa.id, severidade, sinais };
}

/**
 * O fluxo inteiro analisado numa passada.
 *
 * Uma passada, e não uma por cartão: a vizinhança de cada etapa é montada uma
 * vez em índices, e o custo fica linear no número de conexões. Num processo de
 * duzentas e cinquenta etapas, a diferença entre isto e um `filter` por cartão é
 * a diferença entre trocar de visualização na hora e travar a aba.
 */
export function analisarFluxo(completo: FluxoCompleto): AnaliseDoFluxo {
  const porId = new Map(completo.etapas.map((e) => [e.id, e]));
  const entram = new Map<string, Conexao[]>();
  const saem = new Map<string, Conexao[]>();
  for (const etapa of completo.etapas) {
    entram.set(etapa.id, []);
    saem.set(etapa.id, []);
  }
  for (const conexao of completo.conexoes) {
    if (!porId.has(conexao.origemEtapaId) || !porId.has(conexao.destinoEtapaId)) continue;
    entram.get(conexao.destinoEtapaId)!.push(conexao);
    saem.get(conexao.origemEtapaId)!.push(conexao);
  }

  const porEtapa = new Map<string, DiagnosticoDaEtapa>();
  const contagem: Record<Severidade, number> = {
    critico: 0,
    atencao: 0,
    normal: 0,
    "sem-avaliacao": 0,
  };
  const frequencia = new Map<string, { chave: string; rotulo: string; etapas: number }>();

  for (const etapa of completo.etapas) {
    const daEntrada = entram.get(etapa.id) ?? [];
    const daSaida = saem.get(etapa.id) ?? [];
    const raiasVizinhas = [
      ...daEntrada.map((c) => porId.get(c.origemEtapaId)),
      ...daSaida.map((c) => porId.get(c.destinoEtapaId)),
    ]
      .filter((e): e is Etapa => e !== undefined)
      .map((e) => raiaDaEtapa(e, "area"));

    const diagnostico = diagnosticarEtapa(etapa, {
      entram: daEntrada,
      saem: daSaida,
      raiasVizinhas,
    });
    porEtapa.set(etapa.id, diagnostico);
    contagem[diagnostico.severidade] += 1;
    for (const sinal of diagnostico.sinais) {
      const atual = frequencia.get(sinal.chave);
      if (atual) atual.etapas += 1;
      else frequencia.set(sinal.chave, { chave: sinal.chave, rotulo: sinal.rotulo, etapas: 1 });
    }
  }

  return {
    porEtapa,
    contagem,
    frequencia: [...frequencia.values()].sort((a, b) => b.etapas - a.etapas),
  };
}

// ---------------------------------------------------------------------------
// A Lista — a mesma etapa, como linha de tabela
// ---------------------------------------------------------------------------

export interface LinhaDaEtapa {
  etapa: Etapa;
  numero: number;
  area: string | null;
  responsavel: string | null;
  sistema: string | null;
  sla: string | null;
  entradas: string[];
  saidas: string[];
  diagnostico: DiagnosticoDaEtapa;
}

/**
 * As linhas da Lista — a projeção tabular do mesmo fluxo.
 *
 * "Entrada" e "saída" são lidas do grafo (de onde vem, para onde vai), e não de
 * um campo: o processo já sabe disso, e um par de colunas cadastradas à mão
 * seria uma segunda verdade sobre a mesma coisa — que é o que o módulo inteiro
 * existe para não ter.
 */
function acrescentar(indice: Map<string, string[]>, chave: string, valor: string): void {
  const atual = indice.get(chave);
  if (atual) atual.push(valor);
  else indice.set(chave, [valor]);
}

export function linhasDaLista(completo: FluxoCompleto): LinhaDaEtapa[] {
  const numeros = numeracaoDoFluxo(completo);
  const analise = analisarFluxo(completo);
  const porId = new Map(completo.etapas.map((e) => [e.id, e]));

  const entradas = new Map<string, string[]>();
  const saidas = new Map<string, string[]>();
  for (const conexao of completo.conexoes) {
    const origem = porId.get(conexao.origemEtapaId);
    const destino = porId.get(conexao.destinoEtapaId);
    if (!origem || !destino) continue;
    acrescentar(entradas, destino.id, origem.nome);
    acrescentar(saidas, origem.id, destino.nome);
  }

  return ordemDeLeitura(completo).map((etapa) => ({
    etapa,
    numero: numeros.get(etapa.id) ?? 0,
    area: texto(etapa.area) === "" ? null : texto(etapa.area),
    responsavel: responsaveisDaEtapa(etapa)[0] ?? null,
    sistema: sistemasDaEtapa(etapa)[0] ?? null,
    sla: slaDaEtapa(etapa),
    entradas: entradas.get(etapa.id) ?? [],
    saidas: saidas.get(etapa.id) ?? [],
    diagnostico: analise.porEtapa.get(etapa.id) ?? {
      etapaId: etapa.id,
      severidade: "sem-avaliacao",
      sinais: [],
    },
  }));
}

export interface FiltrosDaLista {
  busca?: string;
  area?: string | null;
  responsavel?: string | null;
  sistema?: string | null;
  tipo?: string | null;
  status?: string | null;
  /** Recortes rápidos de auditoria — combinam entre si por "e". */
  comProblema?: boolean;
  comRetorno?: boolean;
  semResponsavel?: boolean;
  semSla?: boolean;
}

const temSinal = (linha: LinhaDaEtapa, chave: string) =>
  linha.diagnostico.sinais.some((s) => s.chave === chave);

/** O recorte da Lista — e o mesmo recorte que a visualização de Gargalos usa. */
export function filtrarLinhas(linhas: LinhaDaEtapa[], filtros: FiltrosDaLista): LinhaDaEtapa[] {
  const busca = (filtros.busca ?? "").trim().toLowerCase();
  return linhas.filter((linha) => {
    if (filtros.area && linha.area !== filtros.area) return false;
    if (filtros.responsavel && linha.responsavel !== filtros.responsavel) return false;
    if (filtros.sistema && linha.sistema !== filtros.sistema) return false;
    if (filtros.tipo && linha.etapa.tipo !== filtros.tipo) return false;
    if (filtros.status && linha.etapa.status !== filtros.status) return false;
    if (filtros.comProblema && !(temSinal(linha, "problema") || temSinal(linha, "gargalo")))
      return false;
    if (filtros.comRetorno && !temSinal(linha, "retorno")) return false;
    if (filtros.semResponsavel && !temSinal(linha, "sem-responsavel")) return false;
    if (filtros.semSla && !temSinal(linha, "sem-prazo")) return false;
    if (busca === "") return true;
    return [
      linha.etapa.nome,
      linha.etapa.descricao ?? "",
      linha.area ?? "",
      linha.responsavel ?? "",
      linha.sistema ?? "",
      linha.etapa.objetivo ?? "",
    ]
      .join(" ")
      .toLowerCase()
      .includes(busca);
  });
}

export type ColunaDaLista = "numero" | "nome" | "tipo" | "area" | "responsavel" | "sistema" | "sla";

/**
 * A ordenação da Lista.
 *
 * O padrão é `numero`, que é a ordem do processo — e é a única ordenação que
 * conta uma história. As outras existem para auditoria: "todas as etapas do
 * Fiscal juntas" é uma pergunta de quem está conferindo, não de quem está
 * lendo o fluxo.
 *
 * Vazio vai sempre para o fim, nos dois sentidos: quem ordena por responsável
 * quer ver quem responde, não a lista dos brancos primeiro.
 */
export function ordenarLinhas(
  linhas: LinhaDaEtapa[],
  coluna: ColunaDaLista,
  crescente: boolean,
): LinhaDaEtapa[] {
  const valor = (linha: LinhaDaEtapa): string | number => {
    switch (coluna) {
      case "numero":
        return linha.numero;
      case "nome":
        return linha.etapa.nome;
      case "tipo":
        return linha.etapa.tipo;
      case "area":
        return linha.area ?? "";
      case "responsavel":
        return linha.responsavel ?? "";
      case "sistema":
        return linha.sistema ?? "";
      case "sla":
        return linha.sla ?? "";
    }
  };

  const sinal = crescente ? 1 : -1;
  return [...linhas].sort((a, b) => {
    const x = valor(a);
    const y = valor(b);
    if (typeof x === "number" && typeof y === "number") return (x - y) * sinal;
    const sx = String(x);
    const sy = String(y);
    if (sx === "" && sy !== "") return 1;
    if (sy === "" && sx !== "") return -1;
    return sx.localeCompare(sy, "pt-BR") * sinal || a.numero - b.numero;
  });
}

/** Os valores presentes numa coluna, para montar o filtro — sem repetição. */
export function valoresDaColuna(
  linhas: LinhaDaEtapa[],
  coluna: "area" | "responsavel" | "sistema" | "tipo" | "status",
): string[] {
  const de = (linha: LinhaDaEtapa) => {
    if (coluna === "tipo") return linha.etapa.tipo;
    if (coluna === "status") return linha.etapa.status;
    return linha[coluna] ?? "";
  };
  return [...new Set(linhas.map(de).filter((v) => v !== ""))].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );
}

// ---------------------------------------------------------------------------
// A Jornada — a mesma etapa, lida por uma lente de cada vez
// ---------------------------------------------------------------------------

export interface CampoDaJornada {
  chave: string;
  /** O rótulo do campo — some do visual e fica para o leitor de tela. */
  rotulo: string;
  /** O nome do ícone `lucide-react`. */
  icone: string;
  valores: string[];
  /** O que a etapa mostra quando ninguém cadastrou nada aqui. */
  vazio: string;
  /**
   * O campo conta como "conteúdo desta lente"?
   *
   * Falso no que sai do grafo (de onde vem, para onde vai): esses campos estão
   * sempre preenchidos em qualquer etapa ligada, e contá-los faria o resumo
   * dizer "15 de 15 etapas têm informações" num fluxo em que ninguém cadastrou
   * indicador nenhum — o oposto do que o número existe para revelar.
   */
  conta: boolean;
  /**
   * O campo é **o assunto** da lente, e não o apoio dele?
   *
   * É o que decide o que o cartão desenha quando o campo está vazio. O assunto
   * aparece sempre — a jornada da documentação mostra "sem documentos
   * cadastrados" em toda etapa que não tem documento, porque é exatamente essa
   * a pergunta que alguém foi ali fazer, e a etapa sem documento é a resposta.
   * O apoio (o objetivo, a regra, o retorno que chega, a troca de área) só
   * aparece quando existe: são linhas que enriquecem a leitura quando estão
   * preenchidas e viram ruído repetido quando não estão.
   */
  essencial: boolean;
}

export interface CartaoDaJornada {
  campos: CampoDaJornada[];
  /**
   * O que o cartão desenha: o assunto da lente sempre, o apoio só quando existe.
   *
   * Quem troca para "Documentação" quer duas coisas ao mesmo tempo, e elas só
   * parecem contraditórias: ler a documentação que existe, e ver onde ela não
   * existe. O assunto da lente resolve as duas — a linha dos documentos aparece
   * em toda etapa, com os documentos ou com "sem documentos cadastrados", e é a
   * coluna que se lê de cima a baixo. O que fica de fora é o apoio vazio: "sem
   * regras registradas" repetido em quinze cartões não é a resposta de ninguém.
   *
   * `campos` continua inteiro para quem precisar da lente completa — a Lista,
   * um export, um teste.
   */
  visiveis: CampoDaJornada[];
  /** Quantos itens a lente achou nesta etapa — zero quer dizer "não cadastrado". */
  achados: number;
}

const naoVazio = (v: string | null | undefined): v is string => texto(v) !== "";

/** Os itens de uma espécie, na ordem cadastrada. */
function itensDaEspecie(etapa: Etapa, especie: string): string[] {
  return etapa.itens
    .filter((i) => i.especie === especie && texto(i.nome) !== "")
    .sort((a, b) => a.ordem - b.ordem)
    .map((i) => (i.obrigatorio ? `${i.nome} (obrigatório)` : i.nome));
}

/** A frase de um sinal do diagnóstico, quando ele existe na etapa. */
function sinalComoTexto(linha: LinhaDaEtapa, chave: string): string[] {
  const sinal = linha.diagnostico.sinais.find((s) => s.chave === chave);
  return sinal ? [sinal.rotulo] : [];
}

/**
 * O CARTÃO DA JORNADA — o que cada lente mostra da mesma etapa.
 *
 * Uma função pura sobre a linha que a Lista já monta: a lente não busca dado,
 * não reordena o processo e não esconde etapa. Trocar de lente troca **as três
 * linhas de dentro do cartão**, e nada mais — a sequência, a numeração e o
 * clique que abre o painel continuam idênticos, que é o que mantém a Jornada
 * sendo uma jornada em vez de virar cinco telas parecidas.
 *
 * O que não estiver cadastrado é dito com todas as letras ("sem documentação
 * registrada"), nunca preenchido com estimativa — a mesma regra do SLA. Numa
 * lente, um cartão vazio é a informação: é ali que o levantamento parou.
 *
 * A lente é **focada**, e o foco tem um centro: o campo que dá nome à lente é o
 * assunto e aparece sempre — com o que está cadastrado ou com a ausência dita
 * ("sem documentos cadastrados") —, enquanto o apoio só aparece quando existe.
 * Ler a jornada da documentação passa a ser ler os documentos do processo de
 * ponta a ponta, e ver de relance em que etapas eles faltam.
 */
export function cartaoDaJornada(linha: LinhaDaEtapa, lente: LenteDaJornada): CartaoDaJornada {
  const etapa = linha.etapa;

  const campos: CampoDaJornada[] = ((): CampoDaJornada[] => {
    switch (lente) {
      case "documentacao":
        return [
          {
            chave: "objetivo",
            rotulo: "Objetivo",
            icone: "Target",
            valores: [etapa.objetivo, etapa.descricao].filter(naoVazio).slice(0, 1),
            vazio: "sem objetivo descrito",
            conta: true,
            essencial: false,
          },
          {
            chave: "regras",
            rotulo: "Regras",
            icone: "BookOpen",
            valores: [etapa.regras].filter(naoVazio),
            vazio: "sem regras registradas",
            conta: true,
            essencial: false,
          },
          {
            chave: "documentos",
            rotulo: "Documentos",
            icone: "FileText",
            valores: itensDaEspecie(etapa, "DOCUMENTO"),
            vazio: "sem documentos cadastrados",
            conta: true,
            essencial: true,
          },
        ];

      case "falhas":
        return [
          {
            chave: "falhas",
            rotulo: "Falhas possíveis",
            icone: "AlertTriangle",
            valores: itensDaEspecie(etapa, "FALHA"),
            vazio: "sem falhas registradas",
            conta: true,
            essencial: true,
          },
          {
            chave: "retorno",
            rotulo: "Retornos",
            icone: "Undo2",
            valores: sinalComoTexto(linha, "retorno"),
            vazio: "nenhum retrabalho chega aqui",
            conta: true,
            essencial: false,
          },
          {
            chave: "status",
            rotulo: "Status",
            icone: "Flag",
            valores: sinalComoTexto(linha, "status"),
            vazio: "etapa não marcada como atenção",
            conta: true,
            essencial: false,
          },
        ];

      case "gargalos":
        return [
          {
            chave: "gargalos",
            rotulo: "Gargalos",
            icone: "Hourglass",
            valores: itensDaEspecie(etapa, "GARGALO"),
            vazio: "sem gargalos apontados",
            conta: true,
            essencial: true,
          },
          {
            chave: "handoffs",
            rotulo: "Trocas de área",
            icone: "Shuffle",
            valores: sinalComoTexto(linha, "handoffs"),
            vazio: "sem troca de área em volta",
            conta: true,
            essencial: false,
          },
          {
            chave: "prazo",
            rotulo: "Prazo",
            icone: "Timer",
            valores: linha.sla === null ? [] : [linha.sla],
            vazio: "sem prazo definido",
            conta: false,
            essencial: false,
          },
        ];

      case "informacoes":
        return [
          /*
            O que a etapa **consulta** abre a lente, e não o que o grafo já diz.
            É o campo "Informações que consulta" do editor — o relatório, a tela,
            a planilha, o e-mail que quem executa a etapa vai olhar para
            conseguir fazê-la. Era o único campo da etapa que nenhuma lente
            mostrava, e é a pergunta que a lente das Informações existe para
            responder; "vem de / segue para" as setas entre os cartões já
            contam, e por isso descem para o apoio.
          */
          {
            chave: "consulta",
            rotulo: "Consulta",
            icone: "Search",
            valores: [etapa.informacoesConsultadas].filter(naoVazio),
            vazio: "sem informações consultadas",
            conta: true,
            essencial: true,
          },
          {
            chave: "indicadores",
            rotulo: "Indicadores",
            icone: "Activity",
            valores: etapa.indicadores
              .slice()
              .sort((a, b) => a.ordem - b.ordem)
              .map((i) => (naoVazio(i.unidade) ? `${i.nome} (${i.unidade})` : i.nome)),
            vazio: "a etapa não mede nada",
            conta: true,
            essencial: true,
          },
          {
            chave: "entradas",
            rotulo: "Vem de",
            icone: "ArrowDownLeft",
            valores: linha.entradas,
            vazio: "início do processo",
            conta: false,
            essencial: false,
          },
          {
            chave: "saidas",
            rotulo: "Segue para",
            icone: "ArrowUpRight",
            valores: linha.saidas,
            vazio: "fim do processo",
            conta: false,
            essencial: false,
          },
        ];

      case "operacao":
      default:
        return [
          {
            chave: "responsavel",
            rotulo: "Responsável",
            icone: "Users",
            valores: [[linha.area, linha.responsavel].filter(naoVazio).join(" · ")].filter(naoVazio),
            vazio: "sem responsável",
            conta: true,
            essencial: true,
          },
          {
            chave: "sistema",
            rotulo: "Sistema",
            icone: "Server",
            valores: [linha.sistema].filter(naoVazio),
            vazio: "sem sistema",
            conta: true,
            essencial: true,
          },
          {
            chave: "prazo",
            rotulo: "Prazo",
            icone: "Timer",
            valores: [linha.sla].filter(naoVazio),
            vazio: "sem prazo definido",
            conta: true,
            essencial: true,
          },
        ];
    }
  })();

  const achados = campos
    .filter((c) => c.conta)
    .reduce((total, campo) => total + campo.valores.length, 0);

  return {
    campos,
    visiveis: campos.filter((c) => c.essencial || c.valores.length > 0),
    achados,
  };
}

export interface ResumoDaLente {
  /** Quantas etapas têm alguma coisa cadastrada nesta lente. */
  etapas: number;
  total: number;
  /** Quantos itens ao todo — falhas, documentos, indicadores. */
  achados: number;
}

/**
 * A linha do cabeçalho da Jornada: "documentação em 4 de 15 etapas".
 *
 * É a pergunta que a lente responde antes de qualquer cartão ser lido — e, num
 * fluxo recém-levantado, costuma ser a informação mais útil da tela: mostra em
 * quantas etapas o levantamento de fato chegou.
 */
export function resumoDaLente(linhas: LinhaDaEtapa[], lente: LenteDaJornada): ResumoDaLente {
  let etapas = 0;
  let achados = 0;
  for (const linha of linhas) {
    const cartao = cartaoDaJornada(linha, lente);
    if (cartao.achados > 0) etapas += 1;
    achados += cartao.achados;
  }
  return { etapas, total: linhas.length, achados };
}

// ---------------------------------------------------------------------------
// A Lista editável — quais células aceitam edição direta, e quais não aceitam
// ---------------------------------------------------------------------------

/** Os campos que a Lista sabe gravar sem abrir o editor da etapa. */
export type CampoEditavelNaLista = "nome" | "tipo" | "area" | "responsavel" | "sistema" | "sla";

/**
 * POR QUE NEM TODA CÉLULA DA LISTA É EDITÁVEL.
 *
 * Quatro colunas da tabela são colunas da etapa (`nome`, `tipo`, `area`) ou
 * derivam de uma coluna quando a lista da espécie está vazia (`responsavel`,
 * `sistema`, `sla`). Nessas, editar a célula é gravar o campo, e o que aparece
 * depois é exatamente o que foi digitado.
 *
 * As outras não são campos: `entrada` e `saída` saem do grafo — quem quiser
 * mudá-las cria ou apaga uma conexão, e um `<input>` ali prometeria uma
 * gravação que não existe. Os `sinais` são calculados a partir de tudo o mais.
 *
 * Sobra o caso que exige cuidado: `responsavel`, `sistema` e `sla` mostram o
 * **primeiro** valor de uma lista que pode ter vários (a coluna da etapa mais
 * os itens da espécie). Quando o valor à vista vem de um item — ou quando há
 * mais de um —, editar a célula gravaria a coluna e a tabela continuaria
 * mostrando o item: a pessoa veria a edição "não pegar". Nesse caso a célula
 * fica de leitura, com o motivo escrito no `title`, e o caminho é o painel da
 * etapa, onde a lista inteira aparece.
 */
export function edicaoNaLista(
  etapa: Etapa,
  campo: CampoEditavelNaLista,
): { editavel: boolean; valor: string; motivo?: string } {
  const coluna = (v: string | null | undefined) => (v ?? "").trim();

  switch (campo) {
    case "nome":
      return { editavel: true, valor: etapa.nome };
    case "tipo":
      return { editavel: true, valor: etapa.tipo };
    case "area":
      return { editavel: true, valor: coluna(etapa.area) };
    case "responsavel":
    case "sistema": {
      const especie = campo === "responsavel" ? "RESPONSAVEL" : "SISTEMA";
      const propria = coluna(campo === "responsavel" ? etapa.responsavel : etapa.sistemaPrincipal);
      const itens = etapa.itens.filter((i) => i.especie === especie && coluna(i.nome) !== "");
      if (itens.length > 0 && propria === "") {
        return {
          editavel: false,
          valor: "",
          motivo:
            campo === "responsavel"
              ? "Este responsável vem da lista de responsáveis da etapa. Abra a etapa para editá-la."
              : "Este sistema vem da lista de sistemas da etapa. Abra a etapa para editá-la.",
        };
      }
      return { editavel: true, valor: propria };
    }
    case "sla": {
      const prazos = prazosDaEtapa(etapa);
      if (prazos.length > 1) {
        return {
          editavel: false,
          valor: "",
          motivo: "Esta etapa tem mais de um prazo cadastrado. Abra a etapa para editá-los.",
        };
      }
      return { editavel: true, valor: prazos[0] ?? "" };
    }
  }
}

// ---------------------------------------------------------------------------
// A linha nova da Lista — cadastrar etapa na própria tabela
// ---------------------------------------------------------------------------

/**
 * O QUE A LINHA NOVA PEDE — e por que é exatamente o que a tabela mostra.
 *
 * Um fluxo recém-criado abre vazio, e o único caminho para sair do zero era
 * abrir o editor da etapa (um formulário de seis abas) uma vez por etapa, ou
 * colar a lista inteira e depois voltar em cada uma para dizer área,
 * responsável e prazo. A Lista já é a tela onde essas colunas se preenchem em
 * série; faltava poder **criar** a linha ali, e não só corrigi-la.
 *
 * Os campos são os mesmos seis que a célula edita (`CampoEditavelNaLista`), e a
 * coincidência não é feliz — é a regra: a linha nova só pode oferecer o que a
 * tabela sabe gravar depois, senão cadastrar pela Lista e conferir pela Lista
 * seriam dois conjuntos de campos diferentes. Entrada e saída continuam de
 * fora, porque saem do grafo; os sinais, porque são calculados.
 */
export interface EtapaNovaNaLista {
  nome: string;
  tipo: string;
  area: string;
  responsavel: string;
  sistema: string;
  sla: string;
}

/**
 * O tipo que a linha nova já vem marcando.
 *
 * A primeira etapa de um fluxo vazio é o começo do processo — em quinze fluxos
 * cadastrados, é sempre. Depois que já existe um início, o padrão vira
 * "Processo", que é o que a esmagadora maioria das etapas seguintes é. Quem
 * discordar troca no seletor da própria linha; o padrão só evita o gesto na
 * vez em que ele seria certo.
 */
export function tipoSugeridoNaLista(etapas: Etapa[]): string {
  return etapas.some((e) => e.tipo === "INICIO") ? "PROCESSO" : "INICIO";
}

export function etapaNovaVazia(etapas: Etapa[]): EtapaNovaNaLista {
  return {
    nome: "",
    tipo: tipoSugeridoNaLista(etapas),
    area: "",
    responsavel: "",
    sistema: "",
    sla: "",
  };
}

/**
 * Só o nome é obrigatório — e é o único que poderia ser.
 *
 * Área, responsável, sistema e prazo em branco são justamente o que a coluna de
 * sinais existe para apontar depois: exigi-los aqui transformaria "anotar as
 * treze etapas da reunião" em treze cadastros completos, que é o gesto que a
 * Lista veio encurtar. Uma etapa sem nome, essa sim, não é etapa nenhuma.
 */
export function podeCriarEtapaNaLista(nova: EtapaNovaNaLista): boolean {
  return nova.nome.trim() !== "" && nova.tipo.trim() !== "";
}
