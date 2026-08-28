import type { Catalogo, Conexao, Etapa, EspecieNoCatalogo, FluxoCompleto } from "@/lib/fluxos";
import { resumoDoFluxo } from "@/lib/fluxos";
import { nomeDePlanilha, pastaComoBlob, type Linha, type Pasta, type Planilha } from "@/lib/xlsx-minimo";
import type { OpcoesDaExportacao } from "@/lib/fluxos-exportar";

/**
 * O MODELO EM EXCEL — uma aba por etapa, com os campos do painel lateral.
 *
 * O levantamento de um processo raramente começa na tela. Começa numa reunião
 * com quem executa, e o que sai dela é anotação: o que acontece aqui, quem
 * responde, em que sistema, o que costuma dar errado. Digitar isso etapa a
 * etapa no diálogo de edição, com a pessoa entrevistada esperando, é o que
 * faz o levantamento não acontecer.
 *
 * Este arquivo escreve o formulário que falta: **uma aba por etapa**, e dentro
 * de cada aba exatamente os campos que o painel lateral mostra e o editor
 * grava — identificação, os cinco textos livres, as listas de material do
 * catálogo, indicadores, consultas e a chave de monitoramento. Quem já tem
 * conteúdo cadastrado o recebe preenchido; o que falta vem em branco, com o
 * rótulo do lado.
 *
 * ---------------------------------------------------------------------------
 * O catálogo é a autoridade — aqui também
 * ---------------------------------------------------------------------------
 *
 * As listas de material **não** estão escritas neste arquivo. Elas saem de
 * `catalogo.especiesDeItem`, com o mesmo título, a mesma descrição e as mesmas
 * colunas (`usaLink`, `usaObrigatorio`) que o editor usa. Uma espécie nova no
 * servidor aparece no modelo sem que ninguém toque aqui — que é a única forma
 * de o modelo não envelhecer em silêncio enquanto o produto anda.
 *
 * Pela mesma razão, os valores aceitos de Tipo, Status e Sentido são impressos
 * na aba "Como preencher" a partir do catálogo, e não de uma lista fixa: quem
 * preenche a planilha precisa saber o que escrever, e o `.xlsx` mínimo deste
 * pacote não escreve validação de lista (ver `lib/xlsx-minimo.ts`).
 *
 * ---------------------------------------------------------------------------
 * O que este modelo é, e o que ele não é
 * ---------------------------------------------------------------------------
 *
 * É uma **saída**: um formulário para preencher fora do produto e transcrever
 * depois. Não existe caminho de volta — a planilha preenchida não é importada,
 * e prometer isso com um botão de exportar seria prometer uma importação que
 * não foi escrita. É por isso que a aba de cada etapa carrega o `id` dela no
 * rodapé: no dia em que a volta existir, ela terá por onde reconhecer a etapa,
 * e enquanto não existir o `id` é o que liga a linha da planilha ao cartão da
 * tela numa conferência à mão.
 *
 * Toda a montagem é função pura sobre `FluxoCompleto` + `Catalogo`, testada
 * sem navegador, como o resto da exportação.
 */

/** Quantas linhas em branco cada lista ganha para quem for acrescentar itens. */
const LINHAS_EM_BRANCO = 3;

const ROTULO = "rotulo" as const;
const SECAO = "secao" as const;
const AJUDA = "ajuda" as const;
const CABECALHO = "cabecalho" as const;

/** Um título de seção, com a linha em branco que o separa do que veio antes. */
function secao(titulo: string, ajuda?: string): Linha[] {
  const linhas: Linha[] = [[], [{ valor: titulo, estilo: SECAO }]];
  if (ajuda && ajuda.trim() !== "") linhas.push([{ valor: ajuda, estilo: AJUDA }]);
  return linhas;
}

/** `Rótulo | valor` — o par que responde por todo campo de uma coluna só. */
function campo(rotulo: string, valor: string | null | undefined, ajuda?: string): Linha {
  const linha: Linha = [{ valor: rotulo, estilo: ROTULO }, valor ?? ""];
  if (ajuda) linha.push({ valor: ajuda, estilo: AJUDA });
  return linha;
}

/**
 * Uma tabela: cabeçalho, o que já existe, e espaço para o que vier.
 *
 * As linhas em branco não são enfeite. Sem elas, quem for acrescentar um
 * sistema numa etapa que já tem dois precisa inventar onde escrever, e
 * escreve embaixo do próximo título — que é como um modelo vira um arquivo que
 * ninguém consegue transcrever depois.
 */
function tabela(colunas: string[], linhas: string[][]): Linha[] {
  const cabecalho: Linha = colunas.map((c) => ({ valor: c, estilo: CABECALHO }));
  const vazias: Linha[] = Array.from({ length: LINHAS_EM_BRANCO }, () =>
    colunas.map(() => ""),
  );
  return [cabecalho, ...linhas.map((l) => l as Linha), ...vazias];
}

function rotuloDe(entradas: { valor: string; rotulo: string }[], valor: string): string {
  return entradas.find((e) => e.valor === valor)?.rotulo ?? valor;
}

/** `01`, `02` … — o mesmo número que o cartão do fluxograma mostra. */
export function numeroDaEtapa(indice: number): string {
  return String(indice + 1).padStart(2, "0");
}

/**
 * O nome da aba de uma etapa: `01 Emissão do documento`.
 *
 * O número na frente é o que mantém as abas na ordem do processo mesmo quando
 * o Excel corta o nome, e é o que deixa a barra de abas legível: são dois
 * caracteres que respondem "onde estou no fluxo" sem ler o resto.
 */
export function nomeDaAbaDaEtapa(etapa: { nome: string }, indice: number, usados: string[]): string {
  const cru = `${numeroDaEtapa(indice)} ${etapa.nome.trim() === "" ? "Etapa" : etapa.nome.trim()}`;
  return nomeDePlanilha(cru, usados);
}

/** As ligações de uma etapa, em texto — de onde ela vem e para onde ela vai. */
function ligacoes(
  etapa: Etapa,
  completo: FluxoCompleto,
  catalogo: Catalogo | undefined,
): string[][] {
  const nomes = new Map(completo.etapas.map((e) => [e.id, e.nome]));
  const tipos = catalogo?.tiposDeConexao ?? [];
  const linha = (conexao: Conexao, sentido: string, outroId: string) => [
    sentido,
    nomes.get(outroId) ?? "(etapa fora deste fluxo)",
    rotuloDe(tipos, conexao.tipo),
    conexao.rotulo ?? "",
  ];

  return [
    ...completo.conexoes
      .filter((c) => c.destinoEtapaId === etapa.id)
      .map((c) => linha(c, "Vem de", c.origemEtapaId)),
    ...completo.conexoes
      .filter((c) => c.origemEtapaId === etapa.id)
      .map((c) => linha(c, "Vai para", c.destinoEtapaId)),
  ];
}

/** As colunas de uma espécie de item — as mesmas que o editor mostra. */
function colunasDaEspecie(especie: EspecieNoCatalogo): string[] {
  return [
    "Nome",
    "Descrição",
    ...(especie.usaLink ? ["Link"] : []),
    ...(especie.usaObrigatorio ? ["Obrigatório (sim/não)"] : []),
  ];
}

/** A aba de uma etapa — os campos do painel lateral, na ordem em que ele os mostra. */
export function abaDaEtapa(
  etapa: Etapa,
  indice: number,
  completo: FluxoCompleto,
  catalogo: Catalogo | undefined,
): Planilha {
  const tipos = catalogo?.tiposDeEtapa ?? [];
  const status = catalogo?.statusDaEtapa ?? [];
  const especies = catalogo?.especiesDeItem ?? [];
  const sentidos = catalogo?.sentidosDoIndicador ?? [];

  const linhas: Linha[] = [
    [{ valor: `${numeroDaEtapa(indice)} · ${etapa.nome}`, estilo: "titulo" }],
    [
      {
        valor:
          "Preencha a coluna B. Os campos abaixo são os mesmos do painel lateral desta etapa no FreightCheck.",
        estilo: AJUDA,
      },
    ],

    ...secao("Identificação"),
    campo("Nome da etapa", etapa.nome),
    campo("Tipo", rotuloDe(tipos, etapa.tipo), "valores aceitos na aba Como preencher"),
    campo("Status", rotuloDe(status, etapa.status), "valores aceitos na aba Como preencher"),
    campo("Área", etapa.area),
    campo("Responsável", etapa.responsavel),
    campo("Sistema principal", etapa.sistemaPrincipal),

    ...secao("O que acontece aqui"),
    campo("O que acontece aqui", etapa.descricao),
    campo("Objetivo da etapa", etapa.objetivo),
    campo("Regras de negócio", etapa.regras),
    campo(
      "Informações que consulta",
      etapa.informacoesConsultadas,
      "onde quem executa vai olhar: relatório, tela, planilha, e-mail",
    ),
    campo("Observações", etapa.observacoes),
  ];

  for (const especie of especies) {
    const itens = etapa.itens
      .filter((i) => i.especie === especie.valor)
      .sort((a, b) => a.ordem - b.ordem)
      .map((i) => [
        i.nome,
        i.descricao ?? "",
        ...(especie.usaLink ? [i.link ?? ""] : []),
        ...(especie.usaObrigatorio ? [i.obrigatorio === true ? "sim" : "não"] : []),
      ]);
    linhas.push(...secao(especie.titulo, especie.descricao), ...tabela(colunasDaEspecie(especie), itens));
  }

  linhas.push(
    ...secao("Indicadores", "Cadastrados agora, calculados quando o Modo Monitoramento existir."),
    ...tabela(
      ["Nome", "Descrição", "Unidade", "Sentido", "Fonte prevista"],
      etapa.indicadores
        .slice()
        .sort((a, b) => a.ordem - b.ordem)
        .map((i) => [
          i.nome,
          i.descricao ?? "",
          i.unidade ?? "",
          rotuloDe(sentidos, i.sentido),
          i.origem ?? "",
        ]),
    ),

    ...secao("Consultar no FreightCheck", "A rota é um caminho interno, como /alteracoes."),
    ...tabela(
      ["Título", "Descrição", "Rota"],
      etapa.acoes
        .slice()
        .sort((a, b) => a.ordem - b.ordem)
        .map((a) => [a.titulo, a.descricao ?? "", a.rota]),
    ),

    ...secao("Monitoramento"),
    campo("Chave de monitoramento", etapa.chaveMonitoramento, "opcional, como cte.autorizacao_sefaz"),
  );

  const ligacoesDaEtapa = ligacoes(etapa, completo, catalogo);
  if (ligacoesDaEtapa.length > 0) {
    /*
      As ligações vêm por último e são leitura, não preenchimento: elas existem
      para quem está com a planilha na mão saber em que ponto do processo esta
      aba cai. Mudar a seta é gesto de canvas, e escrever aqui não muda nada.
    */
    linhas.push(
      ...secao("Ligações (apenas leitura)", "As setas que chegam e saem desta etapa no fluxograma."),
      ["Sentido", "Etapa", "Tipo", "Condição"].map((c) => ({ valor: c, estilo: CABECALHO })),
      ...ligacoesDaEtapa.map((l) => l as Linha),
    );
  }

  linhas.push([], [{ valor: `id da etapa: ${etapa.id}`, estilo: AJUDA }]);

  return {
    nome: `${numeroDaEtapa(indice)} ${etapa.nome}`,
    larguras: [30, 52, 34, 22, 18],
    congelarLinhas: 2,
    linhas,
  };
}

/** A capa: o que é este processo, e o índice das abas que vêm depois. */
export function abaDoFluxo(
  completo: FluxoCompleto,
  catalogo: Catalogo | undefined,
  nomesDasAbas: string[],
  opcoes: OpcoesDaExportacao,
): Planilha {
  const { fluxo, etapas } = completo;
  const tipos = catalogo?.tiposDeEtapa ?? [];
  const statusDoFluxo = catalogo?.statusDoFluxo ?? [];
  const statusDaEtapa = catalogo?.statusDaEtapa ?? [];
  const data = (opcoes.exportadoEm ?? "").split("T")[0] ?? "";

  return {
    nome: "Fluxo",
    larguras: [30, 52, 22, 22, 26, 26],
    congelarLinhas: 2,
    linhas: [
      [{ valor: fluxo.nome, estilo: "titulo" }],
      [
        {
          valor: `Modelo de levantamento · ${resumoDoFluxo(completo)}${
            data === "" ? "" : ` · exportado em ${data}`
          }`,
          estilo: AJUDA,
        },
      ],

      ...secao("O processo"),
      campo("Nome", fluxo.nome),
      campo("Categoria", fluxo.categoria),
      campo("Status", rotuloDe(statusDoFluxo, fluxo.status)),
      campo("Dono", fluxo.dono),
      campo("Objetivo", fluxo.objetivo),
      campo("Descrição", fluxo.descricao),
      ...(opcoes.empresa ? [campo("Empresa", opcoes.empresa)] : []),

      ...secao("Etapas", "Uma aba por etapa, na ordem do processo."),
      ["Nº", "Etapa", "Aba", "Tipo", "Área / Responsável", "Sistema principal"].map((c) => ({
        valor: c,
        estilo: CABECALHO,
      })),
      ...etapas.map((etapa, i): Linha => {
        const marca =
          etapa.status === "ATIVO" ? "" : ` (${rotuloDe(statusDaEtapa, etapa.status)})`;
        return [
          numeroDaEtapa(i),
          `${etapa.nome}${marca}`,
          nomesDasAbas[i] ?? "",
          rotuloDe(tipos, etapa.tipo),
          [etapa.area, etapa.responsavel].filter(Boolean).join(" · "),
          etapa.sistemaPrincipal ?? "",
        ];
      }),
    ],
  };
}

/** A aba de instruções — e, principalmente, os valores que o catálogo aceita. */
export function abaDeInstrucoes(catalogo: Catalogo | undefined): Planilha {
  /* Referência, e não formulário: aqui não entram linhas em branco. */
  const lista = (entradas: { valor: string; rotulo: string; descricao: string }[]): Linha[] => [
    [
      { valor: "Valor", estilo: CABECALHO },
      { valor: "O que significa", estilo: CABECALHO },
    ],
    ...entradas.map((e): Linha => [e.rotulo, e.descricao]),
  ];

  return {
    nome: "Como preencher",
    larguras: [30, 62],
    linhas: [
      [{ valor: "Como preencher este modelo", estilo: "titulo" }],
      [],
      [
        {
          valor:
            "Cada aba é uma etapa do processo, na ordem do fluxograma. Dentro da aba, os campos são os mesmos do painel lateral da etapa no FreightCheck: preencha a coluna ao lado do rótulo, e acrescente linhas nas tabelas quando faltar espaço.",
          estilo: AJUDA,
        },
      ],
      [
        {
          valor:
            "O que estiver cadastrado já vem preenchido. O que vier em branco é o que falta levantar — é para isso que este arquivo existe.",
          estilo: AJUDA,
        },
      ],
      [
        {
          valor:
            "A planilha preenchida não volta sozinha para o produto: hoje a transcrição é manual, pelo botão Editar etapa. O id no rodapé de cada aba é o que liga a aba ao cartão da tela numa conferência.",
          estilo: AJUDA,
        },
      ],

      ...secao("Tipos de etapa"),
      ...lista(catalogo?.tiposDeEtapa ?? []),

      ...secao("Status da etapa"),
      ...lista(catalogo?.statusDaEtapa ?? []),

      ...secao("Sentido do indicador"),
      ...lista(catalogo?.sentidosDoIndicador ?? []),

      ...secao("Tipos de ligação"),
      ...lista(catalogo?.tiposDeConexao ?? []),
    ],
  };
}

/**
 * O modelo inteiro — capa, instruções e uma aba por etapa.
 *
 * A ordem das etapas é a do fluxo (`completo.etapas` já chega ordenado do
 * servidor), e é ela que numera as abas. Um fluxo sem etapas ainda produz
 * arquivo: capa e instruções, pela mesma razão que a exportação em SVG desenha
 * a folha vazia — "não tem etapa" é uma resposta, "a exportação quebrou" não.
 */
export function modeloDoFluxo(
  completo: FluxoCompleto,
  catalogo: Catalogo | undefined,
  opcoes: OpcoesDaExportacao = {},
): Pasta {
  /*
    Os nomes das abas são resolvidos aqui, e não dentro do escritor, porque a
    capa precisa **citar** o nome final de cada aba: um índice que aponta para
    "03 Solicitação de emissão — S" quando a aba se chama outra coisa é um
    índice que atrapalha. O escritor sanea de novo, e o segundo saneamento é
    idempotente sobre o que já saiu daqui.
  */
  const usados: string[] = ["Fluxo", "Como preencher"];
  const nomesDasAbas = completo.etapas.map((etapa, i) => {
    const nome = nomeDaAbaDaEtapa(etapa, i, usados);
    usados.push(nome);
    return nome;
  });

  return {
    planilhas: [
      abaDoFluxo(completo, catalogo, nomesDasAbas, opcoes),
      abaDeInstrucoes(catalogo),
      ...completo.etapas.map((etapa, i) => ({
        ...abaDaEtapa(etapa, i, completo, catalogo),
        nome: nomesDasAbas[i],
      })),
    ],
  };
}

/** O modelo virando arquivo. */
export function fluxoComoModeloExcel(
  completo: FluxoCompleto,
  catalogo: Catalogo | undefined,
  opcoes: OpcoesDaExportacao = {},
): Blob {
  return pastaComoBlob(modeloDoFluxo(completo, catalogo, opcoes));
}
