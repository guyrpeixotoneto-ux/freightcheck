import type { Catalogo, Conexao, Etapa, EspecieNoCatalogo, FluxoCompleto } from "@/lib/fluxos";
import { resumoDoFluxo } from "@/lib/fluxos";
import {
  nomeDePlanilha,
  pastaComoBlob,
  type Linha,
  type Pasta,
  type Planilha,
} from "@/lib/xlsx-minimo";
import type { OpcoesDaExportacao } from "@/lib/fluxos-exportar";

/**
 * O MODELO EM EXCEL — uma aba por etapa, com os campos do painel lateral.
 *
 * O levantamento de um processo raramente começa na tela. Começa numa reunião
 * com quem executa, e o que sai dela é anotação: o que acontece aqui, quem
 * responde, em que sistema, o que costuma dar errado. Digitar isso etapa a
 * etapa no diálogo de edição, com a pessoa entrevistada esperando, é o que faz
 * o levantamento não acontecer.
 *
 * Este arquivo escreve o formulário que falta: **uma aba por etapa**, e dentro
 * de cada aba exatamente os campos que o painel lateral mostra e o editor
 * grava — identificação, os cinco textos livres, as listas de material do
 * catálogo, indicadores, consultas e a chave de monitoramento. Quem já tem
 * conteúdo cadastrado o recebe preenchido; o que falta vem em branco, com o
 * rótulo do lado.
 *
 * ---------------------------------------------------------------------------
 * O formato é um contrato, e ele mora aqui
 * ---------------------------------------------------------------------------
 *
 * A planilha preenchida **volta** (`lib/fluxos-modelo-leitura.ts`), e quem lê
 * reconhece cada campo pelo rótulo escrito na coluna A. Isso faz dos rótulos um
 * contrato entre a ida e a volta: mudar "Objetivo da etapa" no escritor e
 * esquecer o leitor é perder um campo em silêncio na importação.
 *
 * Por isso os rótulos, as seções e as colunas das tabelas são **constantes
 * exportadas** deste módulo, e o leitor importa daqui. Não há duas listas para
 * manter sincronizadas: há uma, e os dois lados a leem.
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
 * Toda a montagem é função pura sobre `FluxoCompleto` + `Catalogo`, testada sem
 * navegador, como o resto da exportação.
 */

/** Quantas linhas em branco cada lista ganha para quem for acrescentar itens. */
const LINHAS_EM_BRANCO = 3;

const ROTULO = "rotulo" as const;
const SECAO = "secao" as const;
const AJUDA = "ajuda" as const;
const CABECALHO = "cabecalho" as const;

// ---------------------------------------------------------------------------
// O contrato: rótulos, seções e colunas
// ---------------------------------------------------------------------------

/** As chaves de `Etapa` que o modelo carrega — as mesmas que o editor grava. */
export type ChaveDeCampo =
  | "nome"
  | "tipo"
  | "status"
  | "area"
  | "responsavel"
  | "sistemaPrincipal"
  | "descricao"
  | "objetivo"
  | "regras"
  | "informacoesConsultadas"
  | "informacoes"
  | "observacoes"
  | "chaveMonitoramento";

export interface CampoDoModelo {
  chave: ChaveDeCampo;
  rotulo: string;
  ajuda?: string;
  /**
   * A lista do catálogo que dá os valores aceitos, quando o campo é escolha.
   * A planilha escreve o rótulo ("Processo"), e a volta traduz para o valor
   * ("PROCESSO") — o banco nunca vê o texto que a pessoa leu.
   */
  dominio?: "tiposDeEtapa" | "statusDaEtapa";
}

export interface SecaoDeCampos {
  titulo: string;
  campos: CampoDoModelo[];
}

/*
  Os títulos das seções são distintos de todo rótulo de campo, e isso é
  requisito e não coincidência: o leitor decide onde uma tabela começa e termina
  por esses títulos, e um título igual a um rótulo tornaria a fronteira ambígua.
*/
export const SECOES_DE_CAMPOS: SecaoDeCampos[] = [
  {
    titulo: "Identificação",
    campos: [
      { chave: "nome", rotulo: "Nome da etapa" },
      {
        chave: "tipo",
        rotulo: "Tipo",
        ajuda: "valores aceitos na aba Como preencher",
        dominio: "tiposDeEtapa",
      },
      {
        chave: "status",
        rotulo: "Status",
        ajuda: "valores aceitos na aba Como preencher",
        dominio: "statusDaEtapa",
      },
      { chave: "area", rotulo: "Área" },
      { chave: "responsavel", rotulo: "Responsável" },
      { chave: "sistemaPrincipal", rotulo: "Sistema principal" },
    ],
  },
  {
    titulo: "O trabalho da etapa",
    campos: [
      { chave: "descricao", rotulo: "O que acontece aqui" },
      { chave: "objetivo", rotulo: "Objetivo da etapa" },
      { chave: "regras", rotulo: "Regras de negócio" },
      {
        chave: "informacoesConsultadas",
        rotulo: "Dados",
        ajuda: "onde quem executa vai olhar: relatório, tela, planilha, e-mail",
      },
    ],
  },
  {
    titulo: "Monitoramento",
    campos: [
      {
        chave: "chaveMonitoramento",
        rotulo: "Chave de monitoramento",
        ajuda: "opcional, como cte.autorizacao_sefaz",
      },
    ],
  },
];

export const CAMPOS_DA_ETAPA: CampoDoModelo[] = SECOES_DE_CAMPOS.flatMap((s) => s.campos);

/**
 * ---------------------------------------------------------------------------
 * O que a ida não escreve mais, e a volta continua entendendo
 * ---------------------------------------------------------------------------
 *
 * Os rótulos são o contrato entre a ida e a volta, e renomear um campo quebra
 * as planilhas que já saíram: o arquivo que voltou da reunião traz o nome de
 * antes na coluna A, e o leitor que só conhece o nome de hoje o ignora em
 * silêncio — a pior forma de perder um levantamento.
 *
 * Por isso a volta lê duas listas. `CAMPOS_DA_ETAPA` é o que a ida escreve
 * hoje; estas duas são só de leitura:
 *
 * - `CAMPOS_SO_DE_LEITURA` — campos que a planilha nova não oferece, mas que a
 *   volta grava quando o arquivo antigo os traz. `observacoes` é o depósito de
 *   antes do recorte da migration `0072`: a tela não o mostra e não o escreve,
 *   então oferecê-lo como campo editável na planilha era prometer uma edição
 *   que não aparece em lugar nenhum. Ele continua sendo lido — e com o rótulo
 *   dizendo "texto antigo", porque confundi-lo com `informacoes`, que o painel
 *   chama de "Observações", seria escrever num campo pelo nome de outro.
 * - `ROTULOS_ANTIGOS` — o nome de antes de cada campo renomeado, apontando para
 *   a chave que ele sempre gravou.
 *
 * O caminho é de mão única: nada aqui volta para a exportação. Arquivo novo sai
 * só com os nomes novos.
 */
export const CAMPOS_SO_DE_LEITURA: CampoDoModelo[] = [
  { chave: "informacoes", rotulo: "Observações" },
  { chave: "observacoes", rotulo: "Observações (texto antigo)" },
];

/** Um rótulo que já saiu numa planilha, e o campo que ele sempre gravou. */
export interface RotuloAntigo {
  rotulo: string;
  chave: ChaveDeCampo;
}

export const ROTULOS_ANTIGOS: RotuloAntigo[] = [
  { rotulo: "Informações que consulta", chave: "informacoesConsultadas" },
  { rotulo: "Informações", chave: "informacoes" },
  { rotulo: "Observações", chave: "observacoes" },
];

/** Uma coluna de tabela: o rótulo que sai na planilha, e o campo que ele grava. */
export interface ColunaDoModelo {
  chave: string;
  rotulo: string;
}

export const TITULO_DOS_INDICADORES = "Indicadores";
export const TITULO_DAS_ACOES = "Consultar no FreightCheck";
export const TITULO_DAS_LIGACOES = "Ligações (apenas leitura)";

export const COLUNAS_DO_INDICADOR: ColunaDoModelo[] = [
  { chave: "nome", rotulo: "Nome" },
  { chave: "descricao", rotulo: "Descrição" },
  { chave: "unidade", rotulo: "Unidade" },
  { chave: "sentido", rotulo: "Sentido" },
  { chave: "origem", rotulo: "Fonte prevista" },
];

export const COLUNAS_DA_ACAO: ColunaDoModelo[] = [
  { chave: "titulo", rotulo: "Título" },
  { chave: "descricao", rotulo: "Descrição" },
  { chave: "rota", rotulo: "Rota" },
];

/** As colunas de uma espécie de item — as mesmas que o editor mostra. */
export function colunasDaEspecie(especie: EspecieNoCatalogo): ColunaDoModelo[] {
  return [
    { chave: "nome", rotulo: "Nome" },
    { chave: "descricao", rotulo: "Descrição" },
    ...(especie.usaLink ? [{ chave: "link", rotulo: "Link" }] : []),
    ...(especie.usaObrigatorio ? [{ chave: "obrigatorio", rotulo: "Obrigatório (sim/não)" }] : []),
  ];
}

/** O prefixo do rodapé de cada aba — é por ele que a volta reconhece a etapa. */
export const MARCA_DO_ID = "id da etapa:";

// ---------------------------------------------------------------------------
// A montagem
// ---------------------------------------------------------------------------

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
 * sistema numa etapa que já tem dois precisa inventar onde escrever, e escreve
 * embaixo do próximo título — que é como um modelo vira um arquivo que ninguém
 * consegue transcrever depois.
 */
function tabela(colunas: ColunaDoModelo[], linhas: string[][]): Linha[] {
  const cabecalho: Linha = colunas.map((c) => ({ valor: c.rotulo, estilo: CABECALHO }));
  const vazias: Linha[] = Array.from({ length: LINHAS_EM_BRANCO }, () => colunas.map(() => ""));
  return [cabecalho, ...linhas.map((l) => l as Linha), ...vazias];
}

function rotuloDe(entradas: { valor: string; rotulo: string }[], valor: string): string {
  return entradas.find((e) => e.valor === valor)?.rotulo ?? valor;
}

/** O que vai na célula de um campo — o rótulo do catálogo quando é escolha. */
export function valorDoCampo(
  etapa: Etapa,
  campoDoModelo: CampoDoModelo,
  catalogo: Catalogo | undefined,
): string {
  const cru = etapa[campoDoModelo.chave] ?? "";
  if (!campoDoModelo.dominio) return String(cru);
  return rotuloDe(catalogo?.[campoDoModelo.dominio] ?? [], String(cru));
}

/** `01`, `02` … — o mesmo número que o cartão do fluxograma mostra. */
export function numeroDaEtapa(indice: number): string {
  return String(indice + 1).padStart(2, "0");
}

/**
 * O nome da aba de uma etapa: `01 Emissão do documento`.
 *
 * O número na frente é o que mantém as abas na ordem do processo mesmo quando o
 * Excel corta o nome, e é o que deixa a barra de abas legível: são dois
 * caracteres que respondem "onde estou no fluxo" sem ler o resto. Na volta ele
 * é o segundo caminho de reconhecimento, quando o rodapé com o id sumiu.
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

/** A aba de uma etapa — os campos do painel lateral, na ordem em que ele os mostra. */
export function abaDaEtapa(
  etapa: Etapa,
  indice: number,
  completo: FluxoCompleto,
  catalogo: Catalogo | undefined,
): Planilha {
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
  ];

  /* Identificação e os textos livres. O Monitoramento vem depois das listas. */
  for (const bloco of SECOES_DE_CAMPOS.slice(0, 2)) {
    linhas.push(...secao(bloco.titulo));
    for (const c of bloco.campos) linhas.push(campo(c.rotulo, valorDoCampo(etapa, c, catalogo), c.ajuda));
  }

  for (const especie of especies) {
    const colunas = colunasDaEspecie(especie);
    const itens = etapa.itens
      .filter((i) => i.especie === especie.valor)
      .sort((a, b) => a.ordem - b.ordem)
      .map((item) =>
        colunas.map((coluna) => {
          if (coluna.chave === "nome") return item.nome;
          if (coluna.chave === "descricao") return item.descricao ?? "";
          if (coluna.chave === "link") return item.link ?? "";
          return item.obrigatorio === true ? "sim" : "não";
        }),
      );
    linhas.push(...secao(especie.titulo, especie.descricao), ...tabela(colunas, itens));
  }

  linhas.push(
    ...secao(
      TITULO_DOS_INDICADORES,
      "Cadastrados agora, calculados quando o Modo Monitoramento existir.",
    ),
    ...tabela(
      COLUNAS_DO_INDICADOR,
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

    ...secao(TITULO_DAS_ACOES, "A rota é um caminho interno, como /alteracoes."),
    ...tabela(
      COLUNAS_DA_ACAO,
      etapa.acoes
        .slice()
        .sort((a, b) => a.ordem - b.ordem)
        .map((a) => [a.titulo, a.descricao ?? "", a.rota]),
    ),
  );

  const monitoramento = SECOES_DE_CAMPOS[2];
  linhas.push(...secao(monitoramento.titulo));
  for (const c of monitoramento.campos) {
    linhas.push(campo(c.rotulo, valorDoCampo(etapa, c, catalogo), c.ajuda));
  }

  const ligacoesDaEtapa = ligacoes(etapa, completo, catalogo);
  if (ligacoesDaEtapa.length > 0) {
    /*
      As ligações vêm por último e são leitura, não preenchimento: elas existem
      para quem está com a planilha na mão saber em que ponto do processo esta
      aba cai. Mudar a seta é gesto de canvas, e a volta ignora esta seção.
    */
    linhas.push(
      ...secao(TITULO_DAS_LIGACOES, "As setas que chegam e saem desta etapa no fluxograma."),
      ["Sentido", "Etapa", "Tipo", "Condição"].map((c) => ({ valor: c, estilo: CABECALHO })),
      ...ligacoesDaEtapa.map((l) => l as Linha),
    );
  }

  linhas.push([], [{ valor: `${MARCA_DO_ID} ${etapa.id}`, estilo: AJUDA }]);

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

/** A aba de instruções — as regras da volta, e os valores que o catálogo aceita. */
export function abaDeInstrucoes(catalogo: Catalogo | undefined): Planilha {
  /* Referência, e não formulário: aqui não entram linhas em branco. */
  const lista = (entradas: { valor: string; rotulo: string; descricao: string }[]): Linha[] => [
    [
      { valor: "Valor", estilo: CABECALHO },
      { valor: "O que significa", estilo: CABECALHO },
    ],
    ...entradas.map((e): Linha => [e.rotulo, e.descricao]),
  ];

  const orientacao = (texto: string): Linha => [{ valor: texto, estilo: AJUDA }];

  return {
    nome: "Como preencher",
    larguras: [30, 62],
    linhas: [
      [{ valor: "Como preencher este modelo", estilo: "titulo" }],
      [],
      orientacao(
        "Cada aba é uma etapa do processo, na ordem do fluxograma. Dentro da aba, os campos são os mesmos do painel lateral da etapa no FreightCheck: preencha a coluna ao lado do rótulo, e acrescente linhas nas tabelas quando faltar espaço.",
      ),
      orientacao(
        "O que estiver cadastrado já vem preenchido. O que vier em branco é o que falta levantar — é para isso que este arquivo existe.",
      ),
      [],
      [{ valor: "Quando esta planilha voltar para o FreightCheck", estilo: SECAO }],
      orientacao(
        "O arquivo preenchido volta pelo botão Importar modelo, na barra do fluxo. Antes de gravar qualquer coisa, a tela mostra campo a campo o que vai mudar, e nada é gravado sem confirmação.",
      ),
      orientacao(
        "Campo deixado em branco não apaga o que está cadastrado: em branco quer dizer 'não levantei', e não 'está vazio'. Para trocar um valor, escreva o novo por cima.",
      ),
      orientacao(
        "Tabela sem nenhuma linha preenchida também não apaga a lista. Tabela com linhas substitui a lista inteira pelo que estiver escrito — é assim que se tira um item: apague a linha dele e deixe as outras.",
      ),
      orientacao(
        "Não renomeie as abas nem os rótulos da coluna A, e não apague a linha 'id da etapa' do rodapé: são eles que dizem a que etapa cada aba corresponde. Aba nova não cria etapa nova — para isso existe Nova etapa, no produto.",
      ),
      orientacao(
        "A seção Ligações é apenas leitura: as setas do fluxograma se mudam no canvas, e o que estiver escrito nela é ignorado.",
      ),

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
