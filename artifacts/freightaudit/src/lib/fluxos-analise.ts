import type { Catalogo, Conexao, Etapa, FluxoCompleto } from "@/lib/fluxos";
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
    texto(etapa.falhas) !== "" ||
    texto(etapa.gargalos) !== "" ||
    texto(etapa.informacoes) !== "" ||
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
}

export interface CartaoDaJornada {
  /**
   * O que o cartão desenha — e é só o assunto da lente.
   *
   * A lente já teve campos de apoio: o objetivo e a regra na Documentação, o
   * retorno e o status nas Falhas, a troca de área e o prazo nos Gargalos, as
   * setas do grafo nas Informações. Eram campos de outra pergunta, e o efeito
   * era o mesmo em todas: a coluna que a pessoa foi ali ler — os documentos, as
   * falhas, os gargalos — aparecia no meio de texto que ela não pediu, e o
   * fluxo documental deixava de ser legível de cima a baixo.
   *
   * Agora cada lente mostra o campo que lhe dá nome, e nada mais: com o que
   * está cadastrado, ou com a ausência dita ("sem documentos cadastrados").
   * As duas perguntas continuam respondidas no mesmo cartão — o que existe e
   * onde falta —, e o resto da etapa continua a um clique, no painel.
   */
  campos: CampoDaJornada[];
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

/**
 * O CARTÃO DA JORNADA — o que cada lente mostra da mesma etapa.
 *
 * Uma função pura sobre a linha que a Lista já monta: a lente não busca dado,
 * não reordena o processo e não esconde etapa. Trocar de lente troca **o
 * conteúdo de dentro do cartão**, e nada mais — a sequência, a numeração e o
 * clique que abre o painel continuam idênticos, que é o que mantém a Jornada
 * sendo uma jornada em vez de virar cinco telas parecidas.
 *
 * O que não estiver cadastrado é dito com todas as letras ("sem documentos
 * cadastrados"), nunca preenchido com estimativa — a mesma regra do SLA. Numa
 * lente, um cartão vazio é a informação: é ali que o levantamento parou.
 *
 * E a lente é **focada de verdade**: só o campo que lhe dá nome. Ler a jornada
 * da documentação é ler os documentos do processo de ponta a ponta, e ver de
 * relance em que etapas eles faltam — sem objetivo, sem regra, sem prazo no
 * meio. O mesmo vale para as falhas, os gargalos e as informações. A Operação
 * é a única com três linhas, porque as três são o assunto dela: quem responde,
 * em que sistema, em quanto tempo.
 */
export function cartaoDaJornada(linha: LinhaDaEtapa, lente: LenteDaJornada): CartaoDaJornada {
  const etapa = linha.etapa;

  const campos: CampoDaJornada[] = ((): CampoDaJornada[] => {
    switch (lente) {
      case "documentacao":
        return [
          {
            chave: "documentos",
            rotulo: "Documentos",
            icone: "FileText",
            valores: itensDaEspecie(etapa, "DOCUMENTO"),
            vazio: "sem documentos cadastrados",
          },
        ];

      case "falhas":
        return [
          {
            /*
              O texto e a lista são as duas formas de dizer o que dá errado, e
              a lente mostra as duas na mesma linha: a lista nomeia falhas
              contáveis uma a uma, o texto descreve o que não cabe num nome —
              "quando a tarifa vem sem tabela, o faturamento refaz o cálculo à
              mão". As duas são a falha da etapa, e é a falha que a lente lê.
            */
            chave: "falhas",
            rotulo: "Falhas possíveis",
            icone: "AlertTriangle",
            valores: [...itensDaEspecie(etapa, "FALHA"), ...[etapa.falhas].filter(naoVazio)],
            vazio: "sem falhas registradas",
          },
        ];

      case "gargalos":
        return [
          {
            chave: "gargalos",
            rotulo: "Gargalos",
            icone: "Hourglass",
            valores: [...itensDaEspecie(etapa, "GARGALO"), ...[etapa.gargalos].filter(naoVazio)],
            vazio: "sem gargalos apontados",
          },
        ];

      case "informacoes":
        return [
          /*
            O que a etapa **consulta** é a lente inteira: é o campo "Dados" do
            editor — o relatório, a tela, a planilha, o e-mail que quem executa
            a etapa vai olhar para conseguir fazê-la.

            O que saiu daqui foi o campo Observações da etapa. Ele é o caderno
            de quem levantou o processo ("A VALIDAR: quem confere"), não o dado
            que a etapa consulta, e no cartão ocupava a linha do dado
            respondendo outra pergunta: quem abre a lente de Dados e lê uma
            observação acha que a etapa tem dado mapeado quando ela não tem.
            Sem dado, a linha diz isso com todas as letras.

            Pelo mesmo motivo saíram os indicadores — o que a etapa mede é
            outra pergunta que não a do dado que ela consulta — e as setas do
            grafo, que já estão desenhadas entre os cartões. A lente ficou de
            uma linha só, como as de falhas, gargalos e documentação: o campo
            que lhe dá nome, lido de relance ao longo do caminho inteiro.
          */
          {
            chave: "consulta",
            rotulo: "Dados",
            icone: "Search",
            valores: [etapa.informacoesConsultadas].filter(naoVazio),
            vazio: "sem dados mapeados",
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
          },
          {
            chave: "sistema",
            rotulo: "Sistema",
            icone: "Server",
            valores: [linha.sistema].filter(naoVazio),
            vazio: "sem sistema",
          },
          {
            chave: "prazo",
            rotulo: "Prazo",
            icone: "Timer",
            valores: [linha.sla].filter(naoVazio),
            vazio: "sem prazo definido",
          },
        ];
    }
  })();

  return {
    campos,
    achados: campos.reduce((total, campo) => total + campo.valores.length, 0),
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
      /*
        Área escolhida do cadastro não se digita aqui — pela mesma razão da
        regra logo abaixo: `area` passa a ser **projeção** do departamento (ver
        a `0079`), então gravar texto nesta célula seria escrever numa coluna
        que a próxima leitura sobrescreve. A pessoa veria a edição "não pegar",
        que é o defeito que esta função inteira existe para não deixar acontecer.
      */
      if (etapa.departamentoId) {
        return {
          editavel: false,
          valor: coluna(etapa.area),
          motivo:
            "Esta área vem do departamento escolhido na etapa. Abra a etapa para trocá-lo.",
        };
      }
      return { editavel: true, valor: coluna(etapa.area) };
    case "responsavel":
    case "sistema": {
      const especie = campo === "responsavel" ? "RESPONSAVEL" : "SISTEMA";
      const propria = coluna(campo === "responsavel" ? etapa.responsavel : etapa.sistemaPrincipal);
      /* O responsável escolhido do cadastro, pela mesma razão da área acima. */
      if (campo === "responsavel" && (etapa.cargoId || etapa.pessoaId)) {
        return {
          editavel: false,
          valor: propria,
          motivo:
            "Este responsável vem do cargo ou da pessoa escolhida na etapa. Abra a etapa para trocá-los.",
        };
      }
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

// ---------------------------------------------------------------------------
// O painel editável — os campos que se corrigem sem abrir o editor da etapa
// ---------------------------------------------------------------------------

/**
 * OS CAMPOS DE TEXTO QUE O PAINEL GRAVA SOZINHO.
 *
 * São exatamente as colunas de texto livre da etapa: as que o painel já mostra
 * uma a uma, cada uma na sua seção. Corrigir uma frase do objetivo era abrir um
 * formulário de seis abas, achar a aba, corrigir, salvar e esperar o diálogo
 * fechar por cima do desenho — cinco gestos para trocar uma palavra que já
 * estava à vista.
 *
 * O que **não** entra aqui é o que não é coluna de texto: as listas (sistemas,
 * responsáveis, documentos, prazos, indicadores, ações) têm caminho próprio no
 * servidor e uma ordem para manter, e o tipo e o status são escolhas de
 * catálogo. Essas continuam no editor da etapa — que continua existindo, e
 * continua abrindo pelo mesmo botão.
 */
export type CampoDeTextoDaEtapa =
  | "nome"
  | "area"
  | "responsavel"
  | "sistemaPrincipal"
  | "descricao"
  | "objetivo"
  | "regras"
  | "informacoesConsultadas"
  | "falhas"
  | "gargalos"
  | "informacoes"
  | "chaveMonitoramento";

/**
 * TIPO E STATUS TAMBÉM SE TROCAM NO PAINEL — e por que eles são outra coisa.
 *
 * Não são texto: são escolha de catálogo, com uma lista fechada de valores que
 * o servidor conhece. Por isso não abrem um `input` com Salvar e Cancelar — um
 * menu com as opções do catálogo grava na escolha, que é um gesto só, e é
 * desfeito escolhendo de novo. Pedir "Salvar" depois de escolher "Início" numa
 * lista de três seria um clique que não decide nada.
 *
 * Continuam sendo o mesmo campo da mesma etapa, gravados pelo mesmo caminho —
 * daí o tipo em união, e não um segundo `onSalvar` na assinatura do painel.
 */
export type CampoDeEscolhaDaEtapa = "tipo" | "status";

/**
 * OS VÍNCULOS DE CADASTRO DA ETAPA — a terceira família de campo do painel.
 *
 * Não são texto (não abrem `input`) e não são escolha de catálogo (a lista não
 * é fixa nem vem do servidor de fluxos): são referência ao cadastro da casa, e
 * a lista de opções muda conforme alguém cadastra um departamento novo.
 *
 * Gravam pelo mesmo caminho dos outros — o corpo inteiro da etapa com um campo
 * trocado —, e por isso o valor que a tela manda é o `id` puro, ou `""` para
 * desligar o vínculo. Ver `idDeCadastro`, em `lib/fluxos/validacao.ts`, que lê
 * `""` como "nenhum".
 */
export type CampoDeVinculoDaEtapa = "departamentoId" | "cargoId" | "pessoaId";

/** Os três, na ordem em que o cabeçalho os mostra: área, função, pessoa. */
export const VINCULOS_DA_ETAPA: {
  campo: CampoDeVinculoDaEtapa;
  rotulo: string;
  /** O que a badge mostra quando ninguém escolheu. */
  vazio: string;
  fonte: keyof OpcoesDeResponsavel;
}[] = [
  {
    campo: "departamentoId",
    rotulo: "Departamento",
    vazio: "+ departamento",
    fonte: "departamentos",
  },
  { campo: "cargoId", rotulo: "Cargo", vazio: "+ cargo", fonte: "cargos" },
  { campo: "pessoaId", rotulo: "Pessoa", vazio: "+ pessoa", fonte: "pessoas" },
];

export type CampoDaEtapaNoPainel =
  | CampoDeTextoDaEtapa
  | CampoDeEscolhaDaEtapa
  | CampoDeVinculoDaEtapa;

export interface CampoDoPainel {
  campo: CampoDeTextoDaEtapa;
  /** O mesmo título que a seção do painel já usa — não há dois nomes. */
  rotulo: string;
  /** Texto livre de várias linhas, ou uma linha só. */
  multilinha: boolean;
  /** Aparece no rodapé da lista de "o que falta preencher"? */
  ajuda?: string;
}

/**
 * A ordem é a ordem do painel, e é ela que a lista de campos vazios segue.
 */
export const CAMPOS_DO_PAINEL: CampoDoPainel[] = [
  { campo: "nome", rotulo: "Nome da etapa", multilinha: false },
  { campo: "area", rotulo: "Área", multilinha: false },
  { campo: "responsavel", rotulo: "Responsável", multilinha: false },
  { campo: "descricao", rotulo: "O que acontece aqui", multilinha: true },
  { campo: "objetivo", rotulo: "Objetivo da etapa", multilinha: true },
  { campo: "sistemaPrincipal", rotulo: "Sistema principal", multilinha: false },
  { campo: "regras", rotulo: "Regras de negócio", multilinha: true },
  { campo: "informacoesConsultadas", rotulo: "Dados", multilinha: true },
  /*
    As três entram na ordem em que se investiga uma etapa: o que dá errado, o
    que trava mesmo sem dar errado, e o que é preciso saber para executá-la.
  */
  { campo: "falhas", rotulo: "Falhas", multilinha: true },
  { campo: "gargalos", rotulo: "Gargalos", multilinha: true },
  { campo: "informacoes", rotulo: "Observações", multilinha: true },
  { campo: "chaveMonitoramento", rotulo: "Chave de monitoramento", multilinha: false },
];

/** O valor gravado de um campo de texto, já normalizado para a tela. */
export function valorDoCampo(etapa: Etapa, campo: CampoDeTextoDaEtapa): string {
  switch (campo) {
    case "nome":
      return etapa.nome;
    case "area":
      return etapa.area ?? "";
    case "responsavel":
      return etapa.responsavel ?? "";
    case "sistemaPrincipal":
      return etapa.sistemaPrincipal ?? "";
    case "descricao":
      return etapa.descricao ?? "";
    case "objetivo":
      return etapa.objetivo ?? "";
    case "regras":
      return etapa.regras ?? "";
    case "informacoesConsultadas":
      return etapa.informacoesConsultadas ?? "";
    case "falhas":
      return etapa.falhas ?? "";
    case "gargalos":
      return etapa.gargalos ?? "";
    case "informacoes":
      return etapa.informacoes ?? "";
    case "chaveMonitoramento":
      return etapa.chaveMonitoramento ?? "";
  }
}

/**
 * OS CAMPOS QUE AINDA ESTÃO EM BRANCO — e por que eles precisam de uma lista.
 *
 * O painel esconde seção vazia de propósito: num painel de oito seções, sete
 * avisos de "nada cadastrado" afogam o que existe. Só que uma seção escondida
 * também não tem onde ser clicada, e a edição no lugar deixaria de alcançar
 * exatamente o que falta — que é o que mais importa preencher.
 *
 * A saída é uma lista só, no fim e uma única vez: um botão curto por campo em
 * branco, que abre o editor daquele campo ali mesmo. Quem cadastra tudo vê a
 * lista encolher até sumir; quem só lê nunca a vê, porque ela é de quem edita.
 *
 * Três campos nunca entram: nome, área e responsável já são o cabeçalho do
 * painel, e lá cada um é o seu próprio alvo de clique mesmo em branco. Repeti-los
 * na lista daria dois convites para o mesmo campo, em dois lugares da tela.
 */
const FORA_DA_LISTA: CampoDeTextoDaEtapa[] = ["nome", "area", "responsavel"];

export function camposVaziosDoPainel(etapa: Etapa): CampoDoPainel[] {
  return CAMPOS_DO_PAINEL.filter(
    (c) => !FORA_DA_LISTA.includes(c.campo) && valorDoCampo(etapa, c.campo).trim() === "",
  );
}


// ---------------------------------------------------------------------------
// As listas da etapa, editáveis no painel
// ---------------------------------------------------------------------------

/**
 * AS LISTAS TAMBÉM SE EDITAM NO PAINEL — e por que elas precisam de um modelo.
 *
 * Sistemas, documentos, responsáveis, prazos, falhas, indicadores e consultas
 * são sete listas de formas diferentes: uma tem link, outra tem "obrigatório",
 * a de indicadores tem unidade e sentido, a de consultas tem rota. Escrever
 * sete blocos de JSX no painel seria escrever sete vezes o mesmo formulário — e
 * a oitava espécie que o catálogo do servidor ganhar não apareceria em lugar
 * nenhum.
 *
 * Aqui a diferença entre elas é **dado**: `campos` descreve a linha, e o painel
 * desenha o que o dado disser. É a mesma decisão que `ListaEditavel` já tinha
 * tomado no editor da etapa — e a razão de este módulo devolver a descrição em
 * vez de componentes é que assim ela é testável sem DOM, que é como o resto
 * deste arquivo é provado.
 *
 * As espécies saem do catálogo do servidor, então acrescentar uma lá continua
 * não exigindo nada da interface.
 */
export interface CampoDaLinhaDoPainel {
  campo: string;
  rotulo: string;
  tipo: "texto" | "booleano" | "escolha";
  placeholder?: string;
  opcoes?: { valor: string; rotulo: string }[];
}

/**
 * O VALOR DE "NENHUM" NUMA ESCOLHA — e por que ele não é a string vazia.
 *
 * Escolher departamento é opcional, então a lista precisa de uma opção que
 * desfaça a escolha. O `Select` do Radix, porém, reserva `""` para "nada
 * selecionado" e recusa um item com esse valor — um `SelectItem value=""` sobe
 * como erro em tempo de execução, não como campo que não funciona.
 *
 * Daí este sentinela: ele é o que a opção carrega na tela, e `corpoDasLinhas` o
 * traduz de volta para "sem vínculo" antes de mandar ao servidor. A tradução
 * mora aqui, e não no componente, porque é ela que os testes deste arquivo
 * conferem sem DOM.
 */
export const SEM_VINCULO = "__sem_vinculo__";

/** Um cadastro que pode ser escolhido como responsável — do menor ao maior. */
export interface OpcaoDeCadastro {
  id: string;
  nome: string;
}

/**
 * O que a tela oferece para escolher no lugar de digitar o responsável.
 *
 * Vem de três consultas que já existiam — `/cadastro/departamentos`,
 * `/cadastro/cargos` e `/users` —, e chega até aqui como dado para que a
 * montagem das listas continue sendo função pura e testável sem servidor.
 * Ausente (o padrão), a lista de responsáveis segue exatamente como era: só
 * nome e descrição, digitados.
 */
export interface OpcoesDeResponsavel {
  departamentos: OpcaoDeCadastro[];
  cargos: OpcaoDeCadastro[];
  pessoas: OpcaoDeCadastro[];
}

export interface ListaDoPainel {
  /** Identifica a lista de ponta a ponta — é o que a gravação recebe. */
  chave: string;
  natureza: "itens" | "indicadores" | "acoes";
  /** Só as listas de item têm espécie; é ela que dá o caminho no servidor. */
  especie?: string;
  titulo: string;
  icone?: string;
  rotuloDeAdicionar: string;
  campos: CampoDaLinhaDoPainel[];
  /** O que a linha precisa ter para valer a gravação. */
  campoObrigatorio: string;
  /**
   * O que **também** faz a linha valer, quando `campoObrigatorio` está em
   * branco.
   *
   * Existe por causa do responsável escolhido do cadastro: quem seleciona
   * "Faturamento" na lista não digita nada, e uma linha sem `nome` seria
   * descartada na gravação — o campo pareceria não funcionar. Com o vínculo
   * preenchido a linha vale, e quem põe o nome é o servidor, com o nome que
   * está no cadastro (ver `validarItem`, em `lib/fluxos`).
   */
  camposQueBastam?: string[];
}

export type ValoresDaLinha = Record<string, string | boolean>;

/**
 * OS TRÊS CAMPOS DE VÍNCULO DA LISTA DE RESPONSÁVEIS.
 *
 * Só a espécie `RESPONSAVEL` os ganha, e a ordem é a da pergunta que se faz na
 * vida real: **de que departamento é isto**, depois **que função executa**,
 * depois — se importar dizer — **quem**. Departamento vem antes porque é o que
 * estreita a resposta seguinte, e porque é ele que a raia do fluxograma lê.
 *
 * A pessoa é o último e é opcional de propósito: um processo sobrevive a quem o
 * executa, e uma etapa cujo responsável fosse só uma conta viraria etapa órfã
 * no dia do desligamento. Ver a `0079`.
 *
 * Sem cadastro carregado, os três somem e a lista volta a ser o que era — nome
 * e descrição, digitados. É o que mantém esta tela funcionando numa casa que
 * ainda não cadastrou departamento nenhum.
 */
function camposDoResponsavel(opcoes: OpcoesDeResponsavel | undefined): CampoDaLinhaDoPainel[] {
  if (!opcoes) return [];
  const escolha = (
    campo: string,
    rotulo: string,
    vazio: string,
    lista: OpcaoDeCadastro[],
  ): CampoDaLinhaDoPainel[] =>
    lista.length === 0
      ? []
      : [
          {
            campo,
            rotulo,
            tipo: "escolha",
            opcoes: [
              { valor: SEM_VINCULO, rotulo: vazio },
              ...lista.map((o) => ({ valor: o.id, rotulo: o.nome })),
            ],
          },
        ];

  return [
    ...escolha("departamentoId", "Departamento", "Sem departamento", opcoes.departamentos),
    ...escolha("cargoId", "Cargo", "Sem cargo", opcoes.cargos),
    ...escolha("pessoaId", "Pessoa", "Sem pessoa", opcoes.pessoas),
  ];
}

export function listasDoPainel(
  catalogo: Catalogo | undefined,
  opcoes?: OpcoesDeResponsavel,
): ListaDoPainel[] {
  if (!catalogo) return [];

  const dasEspecies = catalogo.especiesDeItem.map((especie) => {
    const vinculos = especie.valor === "RESPONSAVEL" ? camposDoResponsavel(opcoes) : [];
    return {
      chave: `itens:${especie.valor}`,
      natureza: "itens" as const,
      especie: especie.valor,
      titulo: especie.titulo,
      icone: especie.icone,
      rotuloDeAdicionar: especie.rotulo,
      campoObrigatorio: "nome",
      camposQueBastam: vinculos.map((c) => c.campo),
      campos: [
        ...vinculos,
        {
          campo: "nome",
          rotulo: "Nome",
          tipo: "texto" as const,
          /*
            Com vínculo escolhido o nome deixa de ser obrigatório, e o
            placeholder é o único lugar onde a tela diz isso. Sem os selects
            (casa sem cadastro), o rótulo volta a ser só "Nome".
          */
          ...(vinculos.length > 0
            ? { placeholder: "Nome — ou deixe em branco e escolha acima" }
            : {}),
        },
        { campo: "descricao", rotulo: "Descrição", tipo: "texto" as const },
        ...(especie.usaLink
          ? [{ campo: "link", rotulo: "Link", tipo: "texto" as const, placeholder: "https://" }]
          : []),
        ...(especie.usaObrigatorio
          ? [{ campo: "obrigatorio", rotulo: "Obrigatório", tipo: "booleano" as const }]
          : []),
      ],
    };
  });

  return [
    ...dasEspecies,
    {
      chave: "indicadores",
      natureza: "indicadores",
      titulo: "Indicadores",
      icone: "Gauge",
      rotuloDeAdicionar: "indicador",
      campoObrigatorio: "nome",
      campos: [
        { campo: "nome", rotulo: "Nome", tipo: "texto" },
        { campo: "unidade", rotulo: "Unidade", tipo: "texto", placeholder: "%" },
        {
          campo: "sentido",
          rotulo: "Sentido",
          tipo: "escolha",
          opcoes: catalogo.sentidosDoIndicador.map((s) => ({ valor: s.valor, rotulo: s.rotulo })),
        },
        { campo: "descricao", rotulo: "Descrição", tipo: "texto" },
        { campo: "origem", rotulo: "Fonte prevista", tipo: "texto" },
      ],
    },
    {
      chave: "acoes",
      natureza: "acoes",
      titulo: "Consultar no FreightCheck",
      rotuloDeAdicionar: "consulta",
      campoObrigatorio: "titulo",
      campos: [
        { campo: "titulo", rotulo: "Título", tipo: "texto" },
        { campo: "rota", rotulo: "Rota", tipo: "texto", placeholder: "/alteracoes" },
        { campo: "descricao", rotulo: "Descrição", tipo: "texto" },
      ],
    },
  ];
}

export function listaDoPainelPorChave(
  catalogo: Catalogo | undefined,
  chave: string,
  opcoes?: OpcoesDeResponsavel,
): ListaDoPainel | undefined {
  return listasDoPainel(catalogo, opcoes).find((l) => l.chave === chave);
}

/** As linhas gravadas de uma lista, na ordem em que o painel as mostra. */
export function linhasDaListaDoPainel(etapa: Etapa, lista: ListaDoPainel): ValoresDaLinha[] {
  const texto = (v: string | null | undefined) => v ?? "";

  if (lista.natureza === "itens") {
    return etapa.itens
      .filter((i) => i.especie === lista.especie)
      .sort((a, b) => a.ordem - b.ordem)
      .map((i) => ({
        nome: i.nome,
        descricao: texto(i.descricao),
        link: texto(i.link),
        obrigatorio: i.obrigatorio === true,
        /*
          Os vínculos voltam como `SEM_VINCULO` quando são nulos, e não como
          `""`: é o valor que o `Select` mostra na opção "Sem departamento", e
          `corpoDasLinhas` desfaz a tradução na volta. Um `""` aqui deixaria o
          campo abrir em branco, como se a linha estivesse pela metade.
        */
        departamentoId: i.departamentoId ?? SEM_VINCULO,
        cargoId: i.cargoId ?? SEM_VINCULO,
        pessoaId: i.pessoaId ?? SEM_VINCULO,
      }));
  }

  if (lista.natureza === "indicadores") {
    return [...etapa.indicadores]
      .sort((a, b) => a.ordem - b.ordem)
      .map((i) => ({
        nome: i.nome,
        descricao: texto(i.descricao),
        unidade: texto(i.unidade),
        sentido: i.sentido,
        origem: texto(i.origem),
      }));
  }

  return [...etapa.acoes]
    .sort((a, b) => a.ordem - b.ordem)
    .map((a) => ({ titulo: a.titulo, descricao: texto(a.descricao), rota: a.rota }));
}

export function linhaNovaDoPainel(lista: ListaDoPainel): ValoresDaLinha {
  const vazia: ValoresDaLinha = {};
  for (const campo of lista.campos) {
    if (campo.tipo === "booleano") vazia[campo.campo] = false;
    else if (campo.tipo === "escolha") vazia[campo.campo] = campo.opcoes?.[0]?.valor ?? "";
    else vazia[campo.campo] = "";
  }
  return vazia;
}

/**
 * O corpo que a rota da lista espera — com a ordem posta pela posição.
 *
 * As três rotas são substituição da lista inteira, e é por isso que a `ordem`
 * sai do índice: a lista que chega **é** a ordem. Linha sem o campo obrigatório
 * não vai; ela existe na tela enquanto está sendo digitada, e some da gravação
 * em vez de virar um item sem nome que ninguém consegue identificar depois.
 */
export function corpoDasLinhas(lista: ListaDoPainel, linhas: ValoresDaLinha[]): unknown[] {
  const texto = (linha: ValoresDaLinha, campo: string) => String(linha[campo] ?? "").trim();

  /** O `SEM_VINCULO` da tela vira `null` na ida — ver a constante. */
  const vinculo = (linha: ValoresDaLinha, campo: string) => {
    const valor = texto(linha, campo);
    return valor === "" || valor === SEM_VINCULO ? null : valor;
  };

  return linhas
    .filter(
      (linha) =>
        texto(linha, lista.campoObrigatorio) !== "" ||
        (lista.camposQueBastam ?? []).some((campo) => vinculo(linha, campo) !== null),
    )
    .map((linha, ordem) => {
      if (lista.natureza === "itens") {
        return {
          nome: texto(linha, "nome"),
          descricao: texto(linha, "descricao"),
          link: texto(linha, "link"),
          obrigatorio: linha.obrigatorio === true,
          /*
            Os vínculos entram **só** na espécie que os tem. Mandá-los como três
            `null` em documento, sistema e falha não mudaria nada no servidor e
            mudaria o corpo de todas as outras listas — ruído que a rota ignora
            e que quem lê a requisição teria de aprender a ignorar também.
          */
          ...(lista.camposQueBastam?.length
            ? {
                departamentoId: vinculo(linha, "departamentoId"),
                cargoId: vinculo(linha, "cargoId"),
                pessoaId: vinculo(linha, "pessoaId"),
              }
            : {}),
          ordem,
        };
      }
      if (lista.natureza === "indicadores") {
        return {
          nome: texto(linha, "nome"),
          descricao: texto(linha, "descricao"),
          unidade: texto(linha, "unidade"),
          sentido: texto(linha, "sentido") || "NEUTRO",
          origem: texto(linha, "origem"),
          ordem,
        };
      }
      return {
        titulo: texto(linha, "titulo"),
        descricao: texto(linha, "descricao"),
        rota: texto(linha, "rota"),
        ordem,
      };
    });
}

/**
 * As listas que ainda não têm nenhuma linha — o convite do rodapé, de novo.
 *
 * Vale aqui a mesma regra dos campos de texto: seção vazia não aparece, e o que
 * não aparece precisa de um lugar onde ser criado. A lista de "Ainda em branco"
 * junta as duas coisas, campos e listas, porque para quem está preenchendo a
 * etapa a diferença entre "um campo de texto" e "uma lista com uma linha" não
 * existe — o que existe é "isto aqui ainda não foi dito".
 */
export function listasVaziasDoPainel(
  etapa: Etapa,
  catalogo: Catalogo | undefined,
  opcoes?: OpcoesDeResponsavel,
): ListaDoPainel[] {
  return listasDoPainel(catalogo, opcoes).filter(
    (lista) => linhasDaListaDoPainel(etapa, lista).length === 0,
  );
}
