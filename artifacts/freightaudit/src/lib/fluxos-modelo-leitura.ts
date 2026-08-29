import type { Catalogo, Etapa, FluxoCompleto } from "@/lib/fluxos";
import type { PastaLida, PlanilhaLida } from "@/lib/xlsx-leitura";
import {
  CAMPOS_DA_ETAPA,
  CAMPOS_SO_DE_LEITURA,
  COLUNAS_DA_ACAO,
  COLUNAS_DO_INDICADOR,
  MARCA_DO_ID,
  ROTULOS_ANTIGOS,
  SECOES_DE_CAMPOS,
  TITULO_DAS_ACOES,
  TITULO_DAS_LIGACOES,
  TITULO_DOS_INDICADORES,
  colunasDaEspecie,
  valorDoCampo,
  type ChaveDeCampo,
  type ColunaDoModelo,
  type CampoDoModelo,
} from "@/lib/fluxos-modelo";

/**
 * A VOLTA DO MODELO — a planilha preenchida virando mudança na etapa.
 *
 * A ida (`lib/fluxos-modelo.ts`) resolveu metade do problema: dá para levantar
 * o processo numa reunião, com a planilha aberta, longe da tela. Sem a volta, a
 * outra metade continuava sendo digitar quinze abas à mão no diálogo de edição
 * — e um levantamento que exige ser digitado duas vezes é um levantamento que
 * fica na pasta de downloads.
 *
 * Este arquivo lê a matriz de texto que `lib/xlsx-leitura.ts` entrega e produz
 * um **plano**: que etapa cada aba é, que campo mudou, de quê para quê. O plano
 * não grava nada. Quem grava é a tela, depois de mostrá-lo e de a pessoa
 * confirmar — uma importação que escreve antes de dizer o que vai escrever é
 * uma importação que ninguém usa duas vezes.
 *
 * ---------------------------------------------------------------------------
 * As três regras que evitam apagar o que ninguém mandou apagar
 * ---------------------------------------------------------------------------
 *
 * Um arquivo que voltou de uma reunião passou por mãos, versões e cópias. As
 * regras da leitura assumem isso:
 *
 * - **Campo em branco não apaga.** Em branco quer dizer "não levantei", e não
 *   "está vazio". Trocar um valor é escrever o novo por cima; a alternativa —
 *   branco apaga — transformaria uma aba que ninguém preencheu numa etapa
 *   zerada.
 * - **Tabela sem linha preenchida não apaga a lista.** Uma tabela com linhas
 *   substitui a lista inteira, que é como se tira um item: apagando a linha
 *   dele e deixando as outras.
 * - **Aba não reconhecida não vira etapa nova.** Ela é relatada e ignorada.
 *   Criar etapa exige posição no canvas e ligação com o resto, e nada disso
 *   está na planilha: o que nasceria seria um cartão solto num canto.
 *
 * ---------------------------------------------------------------------------
 * Como uma aba é reconhecida
 * ---------------------------------------------------------------------------
 *
 * Pelo `id da etapa` no rodapé, que a ida escreve e a volta lê. É o único
 * caminho que sobrevive a renomear a etapa dos dois lados. Quando o rodapé
 * sumiu — alguém copiou as abas para uma pasta nova —, sobram o número da aba e
 * o nome, nessa ordem, e o plano **diz por qual dos três reconheceu**: quem
 * confirma precisa saber se a ligação foi certeza ou palpite.
 *
 * Tudo aqui é função pura sobre a matriz lida, e é testado com o que a própria
 * exportação escreveu — ida e volta no mesmo teste, que é a única forma de o
 * contrato dos rótulos não se romper em silêncio.
 */

// ---------------------------------------------------------------------------
// Comparação de texto
// ---------------------------------------------------------------------------

/** Sem acento, sem caixa e sem espaço sobrando — como um humano compara. */
export function chaveDoTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const VERDADEIROS = new Set(["sim", "s", "x", "true", "verdadeiro", "1"]);

// ---------------------------------------------------------------------------
// O que uma aba entrega
// ---------------------------------------------------------------------------

export interface ItemLido {
  nome: string;
  descricao: string;
  link: string;
  obrigatorio: boolean;
}

export interface IndicadorLido {
  nome: string;
  descricao: string;
  unidade: string;
  sentido: string;
  origem: string;
}

export interface AcaoLida {
  titulo: string;
  descricao: string;
  rota: string;
}

export interface AbaLida {
  aba: string;
  /** O `01` do começo do nome da aba, quando existe. */
  numero: number | null;
  idDeclarado: string | null;
  campos: Partial<Record<ChaveDeCampo, string>>;
  /** Só as espécies cuja tabela veio com pelo menos uma linha preenchida. */
  itens: Record<string, ItemLido[]>;
  /** `null` quando a seção não veio preenchida — e aí a lista não é tocada. */
  indicadores: IndicadorLido[] | null;
  acoes: AcaoLida[] | null;
  avisos: string[];
}

type Secao =
  | { especie: "campos" }
  | { especie: "itens"; valor: string; colunas: ColunaDoModelo[] }
  | { especie: "indicadores"; colunas: ColunaDoModelo[] }
  | { especie: "acoes"; colunas: ColunaDoModelo[] }
  | { especie: "ignorar" };

/** Os títulos que dividem a aba, do catálogo e das constantes da ida. */
function secoesConhecidas(catalogo: Catalogo | undefined): Map<string, Secao> {
  const mapa = new Map<string, Secao>();
  for (const bloco of SECOES_DE_CAMPOS) mapa.set(chaveDoTexto(bloco.titulo), { especie: "campos" });
  for (const especie of catalogo?.especiesDeItem ?? []) {
    mapa.set(chaveDoTexto(especie.titulo), {
      especie: "itens",
      valor: especie.valor,
      colunas: colunasDaEspecie(especie),
    });
  }
  mapa.set(chaveDoTexto(TITULO_DOS_INDICADORES), {
    especie: "indicadores",
    colunas: COLUNAS_DO_INDICADOR,
  });
  mapa.set(chaveDoTexto(TITULO_DAS_ACOES), { especie: "acoes", colunas: COLUNAS_DA_ACAO });
  mapa.set(chaveDoTexto(TITULO_DAS_LIGACOES), { especie: "ignorar" });
  return mapa;
}

/**
 * Os campos que a volta grava: os da planilha de hoje, mais os que só ela
 * conhece (ver `CAMPOS_SO_DE_LEITURA`, em `lib/fluxos-modelo.ts`).
 */
const CAMPOS_LIDOS: CampoDoModelo[] = [...CAMPOS_DA_ETAPA, ...CAMPOS_SO_DE_LEITURA];

/**
 * Rótulo na coluna A → campo.
 *
 * Reconhece o que a ida escreve hoje e, depois, os rótulos das planilhas
 * antigas. A ordem importa e é esta: o nome de hoje ganha sempre. "Observações"
 * é o caso que exige o cuidado — hoje é como o painel chama `informacoes`, mas
 * na planilha ele nunca foi isso: era o rótulo do campo legado `observacoes`, e
 * é o que ele continua significando aqui, porque só planilha antiga o traz. O
 * rótulo dos campos em `CAMPOS_SO_DE_LEITURA` não entra na busca: ele é o nome
 * pelo qual o plano mostra a mudança, e não um nome aceito na coluna A.
 */
const CAMPO_POR_ROTULO = ((): Map<string, CampoDoModelo> => {
  const mapa = new Map<string, CampoDoModelo>(
    CAMPOS_DA_ETAPA.map((c) => [chaveDoTexto(c.rotulo), c]),
  );
  for (const antigo of ROTULOS_ANTIGOS) {
    const chave = chaveDoTexto(antigo.rotulo);
    if (mapa.has(chave)) continue;
    const campo = CAMPOS_LIDOS.find((c) => c.chave === antigo.chave);
    if (campo) mapa.set(chave, campo);
  }
  return mapa;
})();

/** `01 Emissão do documento` → `1`. Sem número na frente, `null`. */
export function numeroDaAba(nome: string): number | null {
  const achado = /^\s*(\d{1,3})\b/.exec(nome);
  if (!achado) return null;
  const numero = Number(achado[1]);
  return numero > 0 ? numero : null;
}

/** O nome da aba sem o número — o que sobra para comparar com o nome da etapa. */
export function nomeSemNumero(nome: string): string {
  return nome.replace(/^\s*\d{1,3}\s*[-·.]?\s*/, "").trim();
}

/**
 * Uma aba lida: os campos preenchidos, as listas com linha, e o id do rodapé.
 *
 * A leitura é por **rótulo**, e não por posição: quem inseriu uma linha no meio
 * da aba, ou apagou as linhas em branco que sobraram, continua sendo entendido.
 * Contar linhas seria transformar qualquer edição inocente da planilha em campo
 * gravado no lugar errado — o defeito que não dá erro nenhum e só aparece
 * quando alguém percebe que a etapa 7 ficou com o texto da 6.
 */
export function lerAbaDaEtapa(
  planilha: PlanilhaLida,
  catalogo: Catalogo | undefined,
): AbaLida {
  const secoes = secoesConhecidas(catalogo);
  const sentidos = catalogo?.sentidosDoIndicador ?? [];

  const lida: AbaLida = {
    aba: planilha.nome,
    numero: numeroDaAba(planilha.nome),
    idDeclarado: null,
    campos: {},
    itens: {},
    indicadores: null,
    acoes: null,
    avisos: [],
  };

  let secao: Secao = { especie: "campos" };
  let colunas: (string | null)[] | null = null;
  const linhasDaTabela: Record<string, string>[] = [];

  const fecharTabela = () => {
    if (colunas === null) return;
    const linhas = linhasDaTabela.splice(0, linhasDaTabela.length);
    colunas = null;
    if (linhas.length === 0) return; /* tabela vazia não apaga lista */

    if (secao.especie === "itens") {
      lida.itens[secao.valor] = linhas.map((l) => ({
        nome: l.nome ?? "",
        descricao: l.descricao ?? "",
        link: l.link ?? "",
        obrigatorio: VERDADEIROS.has(chaveDoTexto(l.obrigatorio ?? "")),
      }));
    } else if (secao.especie === "indicadores") {
      lida.indicadores = linhas.map((l) => {
        const escrito = (l.sentido ?? "").trim();
        const achado =
          sentidos.find((s) => chaveDoTexto(s.rotulo) === chaveDoTexto(escrito)) ??
          sentidos.find((s) => chaveDoTexto(s.valor) === chaveDoTexto(escrito));
        if (escrito !== "" && !achado) {
          lida.avisos.push(`Sentido "${escrito}" não existe no catálogo — ficou como está.`);
        }
        return {
          nome: l.nome ?? "",
          descricao: l.descricao ?? "",
          unidade: l.unidade ?? "",
          sentido: achado?.valor ?? "",
          origem: l.origem ?? "",
        };
      });
    } else if (secao.especie === "acoes") {
      lida.acoes = linhas.map((l) => ({
        titulo: l.titulo ?? "",
        descricao: l.descricao ?? "",
        rota: (l.rota ?? "").trim(),
      }));
    }
  };

  for (const linha of planilha.linhas) {
    const primeira = (linha[0] ?? "").trim();
    const segunda = (linha[1] ?? "").trim();
    if (linha.every((c) => (c ?? "").trim() === "")) continue;

    if (primeira.toLowerCase().startsWith(MARCA_DO_ID)) {
      lida.idDeclarado = primeira.slice(MARCA_DO_ID.length).trim() || null;
      continue;
    }

    const nova = segunda === "" ? secoes.get(chaveDoTexto(primeira)) : undefined;
    if (nova) {
      fecharTabela();
      secao = nova;
      continue;
    }

    if (secao.especie === "ignorar") continue;

    if (secao.especie === "campos") {
      const campo = CAMPO_POR_ROTULO.get(chaveDoTexto(primeira));
      /* Em branco é "não levantei": o campo simplesmente não entra no plano. */
      if (campo && segunda !== "") lida.campos[campo.chave] = segunda;
      continue;
    }

    /* Daqui para baixo, é tabela: primeiro o cabeçalho, depois as linhas. */
    if (colunas === null) {
      const esperadas = secao.colunas;
      const mapeadas = linha.map((celula) => {
        const chave = chaveDoTexto(celula ?? "");
        return esperadas.find((c) => chaveDoTexto(c.rotulo) === chave)?.chave ?? null;
      });
      /*
        O cabeçalho é reconhecido pelos próprios rótulos, e não pela posição da
        linha: é o que faz uma coluna arrastada, ou uma coluna a mais que alguém
        acrescentou, não desalinhar a leitura inteira.
      */
      if (mapeadas.filter((m) => m !== null).length >= 2) colunas = mapeadas;
      continue;
    }

    const registro: Record<string, string> = {};
    colunas.forEach((chave, i) => {
      if (chave) registro[chave] = (linha[i] ?? "").trim();
    });
    /* Sem nome (ou sem título) não é item — é o mesmo corte que o editor faz. */
    const identidade = (registro.nome ?? registro.titulo ?? "").trim();
    if (identidade !== "") linhasDaTabela.push(registro);
  }
  fecharTabela();

  return lida;
}

// ---------------------------------------------------------------------------
// O plano
// ---------------------------------------------------------------------------

export interface MudancaDeCampo {
  rotulo: string;
  de: string;
  para: string;
}

export interface ListaParaGravar {
  /** O que a tela mostra: "Sistemas", "Indicadores", "Consultar no FreightCheck". */
  titulo: string;
  alvo: "itens" | "indicadores" | "acoes";
  /** A espécie, quando o alvo é `itens`. */
  especie?: string;
  de: number;
  para: number;
  linhas: unknown[];
}

export interface MudancaDaEtapa {
  etapaId: string;
  nome: string;
  aba: string;
  reconhecidaPor: "id" | "numero" | "nome";
  campos: MudancaDeCampo[];
  /** O corpo do `PUT` da etapa — o que está gravado, com o que mudou por cima. */
  corpo: Record<string, unknown>;
  listas: ListaParaGravar[];
  avisos: string[];
}

export interface PlanoDeImportacao {
  mudancas: MudancaDaEtapa[];
  /** As abas que casaram com uma etapa e não trouxeram novidade. */
  semMudanca: string[];
  naoReconhecidas: string[];
  avisos: string[];
}

/** As abas que a capa e as instruções ocupam — não são etapa. */
const ABAS_DE_SERVICO = new Set([chaveDoTexto("Fluxo"), chaveDoTexto("Como preencher")]);

function comparavel(lista: unknown[]): string {
  return JSON.stringify(lista);
}

function itensGravados(etapa: Etapa, especie: string, colunas: ColunaDoModelo[]) {
  const usaLink = colunas.some((c) => c.chave === "link");
  const usaObrigatorio = colunas.some((c) => c.chave === "obrigatorio");
  return etapa.itens
    .filter((i) => i.especie === especie)
    .sort((a, b) => a.ordem - b.ordem)
    .map((i, ordem) => ({
      nome: i.nome,
      descricao: i.descricao ?? "",
      ordem,
      ...(usaLink ? { link: i.link ?? "" } : {}),
      ...(usaObrigatorio ? { obrigatorio: i.obrigatorio === true } : {}),
    }));
}

/**
 * O que a planilha muda em cada etapa — sem gravar nada.
 *
 * O plano é o produto deste módulo, e ele é feito para ser **lido por gente**
 * antes de virar escrita: campo a campo, de quê para quê, com o que não foi
 * reconhecido dito em voz alta em vez de descartado em silêncio.
 */
export function planoDeImportacao(
  pasta: PastaLida,
  completo: FluxoCompleto,
  catalogo: Catalogo | undefined,
): PlanoDeImportacao {
  const plano: PlanoDeImportacao = {
    mudancas: [],
    semMudanca: [],
    naoReconhecidas: [],
    avisos: [],
  };

  const porId = new Map(completo.etapas.map((e) => [e.id, e]));
  const porNome = new Map(completo.etapas.map((e) => [chaveDoTexto(e.nome), e]));
  const jaUsadas = new Set<string>();

  for (const planilha of pasta.planilhas) {
    if (ABAS_DE_SERVICO.has(chaveDoTexto(planilha.nome))) continue;

    const lida = lerAbaDaEtapa(planilha, catalogo);

    let etapa: Etapa | undefined;
    let reconhecidaPor: MudancaDaEtapa["reconhecidaPor"] = "id";
    if (lida.idDeclarado && porId.has(lida.idDeclarado)) {
      etapa = porId.get(lida.idDeclarado);
    } else if (lida.numero !== null && completo.etapas[lida.numero - 1]) {
      etapa = completo.etapas[lida.numero - 1];
      reconhecidaPor = "numero";
    } else {
      const alvo = porNome.get(chaveDoTexto(nomeSemNumero(planilha.nome)));
      if (alvo) {
        etapa = alvo;
        reconhecidaPor = "nome";
      }
    }

    if (!etapa) {
      plano.naoReconhecidas.push(planilha.nome);
      continue;
    }
    if (jaUsadas.has(etapa.id)) {
      plano.naoReconhecidas.push(planilha.nome);
      plano.avisos.push(
        `Duas abas apontam para a etapa "${etapa.nome}". A segunda, "${planilha.nome}", foi ignorada.`,
      );
      continue;
    }
    jaUsadas.add(etapa.id);

    const avisos = [...lida.avisos];
    const campos: MudancaDeCampo[] = [];
    const corpo: Record<string, unknown> = {
      nome: etapa.nome,
      tipo: etapa.tipo,
      status: etapa.status,
      area: etapa.area ?? "",
      responsavel: etapa.responsavel ?? "",
      sistemaPrincipal: etapa.sistemaPrincipal ?? "",
      descricao: etapa.descricao ?? "",
      objetivo: etapa.objetivo ?? "",
      regras: etapa.regras ?? "",
      informacoesConsultadas: etapa.informacoesConsultadas ?? "",
      /*
        Falhas, gargalos e informações não são campos da planilha — e é por isso
        mesmo que precisam estar aqui. A rota de etapa é substituição: o que
        não vai no corpo volta nulo, e uma importação de "Sistema principal"
        apagaria o levantamento de falhas que ninguém mandou apagar. É a mesma
        razão pela qual `observacoes`, que a tela não mostra, viaja junto.
      */
      falhas: etapa.falhas ?? "",
      gargalos: etapa.gargalos ?? "",
      informacoes: etapa.informacoes ?? "",
      observacoes: etapa.observacoes ?? "",
      chaveMonitoramento: etapa.chaveMonitoramento ?? "",
      /* A posição é preservada: importar texto não move o cartão. */
      ordem: etapa.ordem,
      posX: etapa.posX,
      posY: etapa.posY,
    };

    for (const campo of CAMPOS_LIDOS) {
      const escrito = lida.campos[campo.chave];
      if (escrito === undefined) continue;

      let valor = escrito;
      if (campo.dominio) {
        const entradas = catalogo?.[campo.dominio] ?? [];
        const achado =
          entradas.find((e) => chaveDoTexto(e.rotulo) === chaveDoTexto(escrito)) ??
          entradas.find((e) => chaveDoTexto(e.valor) === chaveDoTexto(escrito));
        if (!achado) {
          avisos.push(`${campo.rotulo}: "${escrito}" não existe no catálogo — ficou como está.`);
          continue;
        }
        valor = achado.valor;
      }

      const atual = String(etapa[campo.chave] ?? "");
      if (valor === atual) continue;
      campos.push({
        rotulo: campo.rotulo,
        de: valorDoCampo(etapa, campo, catalogo),
        para: escrito,
      });
      corpo[campo.chave] = valor;
    }

    const listas: ListaParaGravar[] = [];

    for (const especie of catalogo?.especiesDeItem ?? []) {
      const lidos = lida.itens[especie.valor];
      if (!lidos) continue;
      const colunas = colunasDaEspecie(especie);
      const usaLink = colunas.some((c) => c.chave === "link");
      const usaObrigatorio = colunas.some((c) => c.chave === "obrigatorio");
      const novas = lidos.map((item, ordem) => ({
        nome: item.nome,
        descricao: item.descricao,
        ordem,
        ...(usaLink ? { link: item.link } : {}),
        ...(usaObrigatorio ? { obrigatorio: item.obrigatorio } : {}),
      }));
      const atuais = itensGravados(etapa, especie.valor, colunas);
      if (comparavel(novas) === comparavel(atuais)) continue;
      listas.push({
        titulo: especie.titulo,
        alvo: "itens",
        especie: especie.valor,
        de: atuais.length,
        para: novas.length,
        linhas: novas,
      });
    }

    if (lida.indicadores) {
      const novos = lida.indicadores.map((i, ordem) => ({
        nome: i.nome,
        descricao: i.descricao,
        unidade: i.unidade,
        sentido: i.sentido === "" ? "NEUTRO" : i.sentido,
        origem: i.origem,
        ordem,
      }));
      const atuais = etapa.indicadores
        .slice()
        .sort((a, b) => a.ordem - b.ordem)
        .map((i, ordem) => ({
          nome: i.nome,
          descricao: i.descricao ?? "",
          unidade: i.unidade ?? "",
          sentido: i.sentido,
          origem: i.origem ?? "",
          ordem,
        }));
      if (comparavel(novos) !== comparavel(atuais)) {
        listas.push({
          titulo: TITULO_DOS_INDICADORES,
          alvo: "indicadores",
          de: atuais.length,
          para: novos.length,
          linhas: novos,
        });
      }
    }

    if (lida.acoes) {
      const novas = lida.acoes.map((a, ordem) => ({
        titulo: a.titulo,
        descricao: a.descricao,
        rota: a.rota,
        ordem,
      }));
      const atuais = etapa.acoes
        .slice()
        .sort((a, b) => a.ordem - b.ordem)
        .map((a, ordem) => ({
          titulo: a.titulo,
          descricao: a.descricao ?? "",
          rota: a.rota,
          ordem,
        }));
      if (comparavel(novas) !== comparavel(atuais)) {
        listas.push({
          titulo: TITULO_DAS_ACOES,
          alvo: "acoes",
          de: atuais.length,
          para: novas.length,
          linhas: novas,
        });
      }
    }

    if (campos.length === 0 && listas.length === 0) {
      plano.semMudanca.push(planilha.nome);
      /* Um aviso sobre uma aba que não muda nada continua sendo notícia. */
      plano.avisos.push(...avisos);
      continue;
    }

    plano.mudancas.push({
      etapaId: etapa.id,
      nome: etapa.nome,
      aba: planilha.nome,
      reconhecidaPor,
      campos,
      corpo,
      listas,
      avisos,
    });
  }

  return plano;
}

/** Quantas escritas o plano vai fazer — o que a tela promete antes de gravar. */
export function tamanhoDoPlano(plano: PlanoDeImportacao): {
  etapas: number;
  campos: number;
  listas: number;
} {
  return {
    etapas: plano.mudancas.length,
    campos: plano.mudancas.reduce((soma, m) => soma + m.campos.length, 0),
    listas: plano.mudancas.reduce((soma, m) => soma + m.listas.length, 0),
  };
}
