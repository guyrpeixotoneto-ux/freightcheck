import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  attributeSemanticsTable,
  attributeTable,
  curationEventTable,
  semanticMeaningTable,
  taxonomyNodeTable,
} from "@workspace/db";
import { saveMeaning } from "./meaning";

/**
 * A curadoria em planilha: exportar o que falta, preencher no Excel, trazer de
 * volta.
 *
 * ---------------------------------------------------------------------------
 * Por que existe
 * ---------------------------------------------------------------------------
 * A tela cura uma coluna por vez, e isso é certo para o ato caro — confirmar
 * interpretação é assinar que um número pode entrar em soma financeira, e
 * assinar 121 vezes seguidas é como se assina sem ler. Mas o ato **barato** —
 * dizer como a coluna se chama, o que ela é e como a fonte a calcula — é
 * conhecimento que quem opera já tem escrito em algum lugar, e cobrá-lo em 121
 * idas e voltas de tela é o que manteve esses campos vazios.
 *
 * Então esta é a metade barata, em lote. O que ela **não** faz é o que mais
 * importa nela:
 *
 * - **Não confirma nada.** Nenhum caminho daqui escreve `semantics_status`,
 *   `confirmed_by` ou `confirmed_at`. Uma planilha preenchida em casa não
 *   destrava cálculo financeiro; quem destrava continua sendo a tela, com
 *   justificativa assinada por quem está logado.
 * - **Não cria atributo.** Coluna nasce da importação, de célula com valor.
 *   Um código que a base não tem sai na prévia como linha ignorada — nunca
 *   como atributo novo, que apareceria na fila sem valor nenhum para curar e
 *   sem como ser curado.
 * - **Não toca `source_name`.** É por ele que a importação encontra a coluna na
 *   planilha do Freightec. O "nome gerencial" da planilha é apelido de leitura,
 *   exatamente como na tela.
 *
 * ---------------------------------------------------------------------------
 * As duas colunas que não são prosa
 * ---------------------------------------------------------------------------
 * "O que este valor representa" e "Categoria" são as duas perguntas do card de
 * confirmação, e elas entram aqui como **proposta**: gravam `meaning_id` e
 * `taxonomy_node_id` e param aí. É o que `runProposalPass` já faz quando o
 * motor lê os valores — a diferença é que agora a proposta é de uma pessoa, o
 * que a torna melhor, não mais poderosa. Quem abrir o atributo na tela encontra
 * as duas respostas prontas e uma justificativa a escrever.
 *
 * ---------------------------------------------------------------------------
 * Célula em branco não apaga
 * ---------------------------------------------------------------------------
 * A regra da planilha inteira. Quem preenche 12 linhas de 121 devolve 109
 * células vazias que significam "não mexi nisto", e lê-las como "apague" faria
 * um arquivo pela metade destruir o trabalho da tela. Limpar um campo continua
 * sendo ato de tela, onde se vê o que está sendo apagado.
 */

// ---------------------------------------------------------------------------
// O formato
// ---------------------------------------------------------------------------

/** Os campos que a planilha devolve preenchidos. */
export type CampoDoModelo =
  | "displayName"
  | "definition"
  | "calculationBasis"
  | "significado"
  | "categoria";

export interface ColunaDoModelo {
  chave: CampoDoModelo | "code" | "sourceName" | "status" | "valores" | "tambemEm";
  rotulo: string;
  largura: number;
  /** Falso nas colunas de identificação: elas saem preenchidas e são lidas. */
  preenchivel: boolean;
  ajuda: string;
}

/**
 * As colunas, na ordem em que se lê a linha.
 *
 * A identificação vem primeiro porque é o que responde "de que coluna estamos
 * falando" — e `Código` é a chave: a volta casa por ele, nunca pelo nome
 * digitado. `Também existe em` é o que evita a pergunta que esta planilha
 * inevitavelmente provoca: `seguro` aparece no cavalo e na carreta, são dois
 * atributos por desenho, e sem esta coluna quem preenche descobre o irmão
 * quando já escreveu a descrição duas vezes com palavras diferentes.
 */
export const COLUNAS_DO_MODELO: ColunaDoModelo[] = [
  {
    chave: "code",
    rotulo: "Código",
    largura: 34,
    preenchivel: false,
    ajuda: "A chave. Não edite — é por ela que o preenchimento volta para o atributo certo.",
  },
  {
    chave: "sourceName",
    rotulo: "Coluna de origem",
    largura: 30,
    preenchivel: false,
    ajuda: "O cabeçalho como veio do Freightec. Nunca é renomeado.",
  },
  {
    chave: "status",
    rotulo: "Status",
    largura: 14,
    preenchivel: false,
    ajuda: "Confirmado, Presumido ou Desconhecido. Esta planilha não altera o status.",
  },
  {
    chave: "valores",
    rotulo: "Valores",
    largura: 10,
    preenchivel: false,
    ajuda: "Quantos fatos importados a coluna tem. Serve para priorizar.",
  },
  {
    chave: "tambemEm",
    rotulo: "Também existe em",
    largura: 18,
    preenchivel: false,
    ajuda:
      "Outros equipamentos com uma coluna de mesmo nome de origem. São atributos separados: preencher aqui não preenche lá.",
  },
  {
    chave: "displayName",
    rotulo: "Nome gerencial",
    largura: 30,
    preenchivel: true,
    ajuda: "Apelido de leitura. Em branco, as telas mostram o nome de origem.",
  },
  {
    chave: "definition",
    rotulo: "O que é",
    largura: 52,
    preenchivel: true,
    ajuda: "A descrição que você daria a alguém que nunca viu esta planilha.",
  },
  {
    chave: "calculationBasis",
    rotulo: "Fórmula de cálculo",
    largura: 40,
    preenchivel: true,
    ajuda: "Como a fonte produz o número, quando se sabe. Ex.: 1,000% do valor da nota.",
  },
  {
    chave: "significado",
    rotulo: "O que este valor representa",
    largura: 32,
    preenchivel: true,
    ajuda:
      "Escolha da lista. Entra como proposta — não confirma o atributo nem o põe em cálculo financeiro.",
  },
  {
    chave: "categoria",
    rotulo: "Categoria",
    largura: 34,
    preenchivel: true,
    ajuda: "Escolha da lista. Também entra como proposta.",
  },
];

/** Uma linha do modelo, como o servidor a escreve no arquivo. */
export interface LinhaDoModelo {
  code: string;
  sourceName: string;
  entityType: string;
  status: string;
  valores: number;
  tambemEm: string;
  displayName: string;
  definition: string;
  calculationBasis: string;
  significado: string;
  categoria: string;
}

/**
 * O atributo como a base o tem, para o modelo e para a conferência.
 *
 * O significado e a categoria entram por **código**, e não pelo texto que a
 * tela mostra. A diferença apareceu na primeira volta do arquivo: a fila
 * devolve o caminho técnico da taxonomia (`remuneracao/custo_variavel/cv_pneus`)
 * e o catálogo fala `Custo Variável › Pneus` — exportar um e conferir contra o
 * outro fazia a planilha recusar a categoria que ela mesma tinha escrito. Pelo
 * código, os dois lados falam a mesma língua, e renomear uma categoria deixa de
 * inventar mudança em toda coluna que a usa.
 */
export interface AtributoDoModelo {
  code: string;
  sourceName: string;
  entityType: string;
  semanticsStatus: string;
  valueCount: number;
  displayName: string | null;
  definition: string | null;
  calculationBasis: string | null;
  meaningCode: string | null;
  taxonomyCode: string | null;
}

const STATUS_LEGIVEL: Record<string, string> = {
  CONFIRMED: "Confirmado",
  PRESUMED: "Presumido",
  UNKNOWN: "Desconhecido",
};

/**
 * As linhas do arquivo, já com o que a base sabe escrito nas colunas de
 * preenchimento.
 *
 * Sair preenchida é o ponto: a planilha é um round-trip, e uma exportação com
 * as colunas em branco faria quem a devolvesse apagar — se a leitura fosse
 * destrutiva — ou reescrever à mão o que já estava lá. Sai o que está gravado,
 * e o que voltar diferente é a mudança.
 */
export function montarLinhas(
  atributos: AtributoDoModelo[],
  catalogos: CatalogosDoModelo,
): LinhaDoModelo[] {
  const porNomeDeOrigem = new Map<string, Set<string>>();
  for (const a of atributos) {
    const chave = a.sourceName.trim().toLowerCase();
    const tipos = porNomeDeOrigem.get(chave) ?? new Set<string>();
    tipos.add(a.entityType);
    porNomeDeOrigem.set(chave, tipos);
  }

  // O texto que a célula mostra sai do catálogo, que é de onde a lista suspensa
  // também sai: o arquivo abre com a opção já selecionada, e não com um texto
  // parecido com uma das opções.
  const significadoPorCodigo = new Map(
    catalogos.significados.map((s) => [s.code, s.label]),
  );
  const categoriaPorCodigo = new Map(
    catalogos.categorias.map((c) => [c.code, c.caminho]),
  );

  return atributos.map((a) => ({
    code: a.code,
    sourceName: a.sourceName,
    entityType: a.entityType,
    status: STATUS_LEGIVEL[a.semanticsStatus] ?? a.semanticsStatus,
    valores: a.valueCount,
    tambemEm: [...(porNomeDeOrigem.get(a.sourceName.trim().toLowerCase()) ?? [])]
      .filter((tipo) => tipo !== a.entityType)
      .sort()
      .join(", "),
    displayName: a.displayName ?? "",
    definition: a.definition ?? "",
    calculationBasis: a.calculationBasis ?? "",
    significado: (a.meaningCode && significadoPorCodigo.get(a.meaningCode)) || "",
    categoria: (a.taxonomyCode && categoriaPorCodigo.get(a.taxonomyCode)) || "",
  }));
}

// ---------------------------------------------------------------------------
// A conferência
// ---------------------------------------------------------------------------

/** Uma linha como voltou do Excel. Todo campo é texto; em branco é "não mexi". */
export interface LinhaPreenchida {
  /** A aba e a linha física, para a prévia apontar onde está o problema. */
  aba: string;
  linha: number;
  code: string;
  displayName?: string;
  definition?: string;
  calculationBasis?: string;
  significado?: string;
  categoria?: string;
}

export interface CatalogosDoModelo {
  significados: { code: string; label: string }[];
  categorias: { code: string; caminho: string }[];
}

export interface MudancaDeCampo {
  campo: CampoDoModelo;
  de: string | null;
  para: string;
  /** O código do catálogo, quando o campo é significado ou categoria. */
  codigo?: string;
}

export type DesfechoDaLinha =
  /** Tem o que gravar. */
  | "MUDA"
  /** Voltou igual ao que já está na base. */
  | "IGUAL"
  /** A linha não tem código — provavelmente uma linha inventada à mão. */
  | "SEM_CODIGO"
  /** O código não existe nesta base. */
  | "SEM_ATRIBUTO";

export interface LinhaConferida {
  aba: string;
  linha: number;
  code: string;
  desfecho: DesfechoDaLinha;
  mudancas: MudancaDeCampo[];
  /**
   * O que não deu para entender **nesta linha**, célula a célula.
   *
   * Célula, e não linha, e a diferença apareceu na primeira volta de um arquivo
   * real: alguém escreveu "Lucro" na categoria — que não existe no catálogo — e
   * a recusa levava junto o nome gerencial, a descrição e a fórmula da mesma
   * linha, que estavam certos e escritos à mão. Perder três campos bons por
   * causa de um erro de digitação no quarto é a diferença entre uma planilha
   * que ajuda e uma que faz a pessoa preencher tudo de novo.
   *
   * O que a prévia mostra, então, são as duas coisas: o que vai ser gravado
   * desta linha e o que dela ficou de fora, com o motivo.
   */
  problemas: string[];
}

export interface ConferenciaDoModelo {
  linhas: LinhaConferida[];
  resumo: {
    /** Linhas que gravam alguma coisa. */
    mudam: number;
    /** Quantos campos ao todo. É o número que a prévia mostra em destaque. */
    campos: number;
    iguais: number;
    /** Linhas que não casaram com atributo nenhum. */
    ignoradas: number;
    /** Células que a conferência não entendeu, em qualquer linha. */
    naoEntendidas: number;
  };
}

/** Comparação de texto que perdoa acento, caixa e espaço repetido. */
function dobrar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * O texto do que já estava lá, para a prévia mostrar "de → para".
 *
 * Vem do catálogo, e não do atributo: o que a base guarda é o código, e a
 * prévia que dissesse `cv_pneus → Custo Variável › Pneus` faria a pessoa
 * conferir uma troca que não é a que ela fez.
 */
function rotuloDe<C extends { code: string }, K extends keyof C>(
  codigo: string | null,
  catalogo: C[],
  campo: K,
): string | null {
  if (codigo === null) return null;
  const item = catalogo.find((c) => c.code === codigo);
  return item ? String(item[campo]) : codigo;
}

/** Em branco não é valor: é a ausência de resposta, e ela não apaga nada. */
function preenchido(valor: string | undefined): string | null {
  const texto = valor?.trim() ?? "";
  return texto === "" ? null : texto;
}

/**
 * A categoria pelo caminho inteiro ou só pela folha.
 *
 * `Custo Variável › Manutenção` é o que a lista oferece, e é o que volta de uma
 * célula com validação. Mas quem digita escreve "Manutenção" — e recusar isso
 * seria recusar a resposta certa por causa da pontuação de um separador que a
 * pessoa não escolheu. Só quando a folha é única: duas categorias de mesmo
 * nome em galhos diferentes são uma pergunta de verdade, e adivinhar qual
 * classificaria a coluna no lugar errado sem ninguém perceber.
 */
function acharCategoria(
  texto: string,
  categorias: { code: string; caminho: string }[],
): { code: string; caminho: string } | "AMBIGUA" | null {
  const alvo = dobrar(texto);
  const porCaminho = categorias.find((c) => dobrar(c.caminho) === alvo);
  if (porCaminho) return porCaminho;

  const folha = (caminho: string) => dobrar(caminho.split("›").at(-1) ?? caminho);
  const porFolha = categorias.filter((c) => folha(c.caminho) === alvo);
  if (porFolha.length === 1) return porFolha[0];
  if (porFolha.length > 1) return "AMBIGUA";
  return null;
}

/**
 * O que a planilha preenchida muda, sem gravar nada.
 *
 * É a prévia inteira, e ela é obrigatória por uma razão prática: um arquivo que
 * passou por três pessoas e um "salvar como CSV" chega com colunas trocadas, e
 * a diferença entre "121 linhas, 4 campos mudam" e "121 linhas, 480 campos
 * mudam" é a diferença entre aplicar e conferir o arquivo de novo.
 */
export function conferirPreenchimento(
  linhas: LinhaPreenchida[],
  base: AtributoDoModelo[],
  catalogos: CatalogosDoModelo,
): ConferenciaDoModelo {
  const porCodigo = new Map(base.map((a) => [a.code.trim().toLowerCase(), a]));

  const conferidas = linhas.map((linha): LinhaConferida => {
    const molde = { aba: linha.aba, linha: linha.linha, code: linha.code.trim() };

    if (molde.code === "") {
      return {
        ...molde,
        desfecho: "SEM_CODIGO",
        mudancas: [],
        problemas: [
          "Linha sem código. A coluna Código é a chave do preenchimento e não pode ser apagada nem inventada.",
        ],
      };
    }

    const atributo = porCodigo.get(molde.code.toLowerCase());
    if (!atributo) {
      return {
        ...molde,
        desfecho: "SEM_ATRIBUTO",
        mudancas: [],
        problemas: [
          `"${molde.code}" não existe nesta base. Atributo nasce da importação da planilha do ` +
            "Freightec, de coluna com valor — esta planilha descreve o que já existe, e não cria coluna.",
        ],
      };
    }

    const mudancas: MudancaDeCampo[] = [];
    const problemas: string[] = [];
    const texto = (campo: "displayName" | "definition" | "calculationBasis") => {
      const valor = preenchido(linha[campo]);
      if (valor === null) return;
      if ((atributo[campo] ?? "").trim() === valor) return;
      mudancas.push({ campo, de: atributo[campo], para: valor });
    };
    texto("displayName");
    texto("definition");
    texto("calculationBasis");

    const significado = preenchido(linha.significado);
    if (significado !== null) {
      const achado = catalogos.significados.find(
        (s) => dobrar(s.label) === dobrar(significado),
      );
      if (!achado) {
        problemas.push(
          `"O que este valor representa": "${significado}" não está no catálogo de significados. ` +
            "Escolha um item da lista da célula, ou cadastre o significado novo na tela de Curadoria " +
            "antes de reenviar. O resto desta linha entra normalmente.",
        );
      } else if (achado.code !== atributo.meaningCode) {
        mudancas.push({
          campo: "significado",
          de: rotuloDe(atributo.meaningCode, catalogos.significados, "label"),
          para: achado.label,
          codigo: achado.code,
        });
      }
    }

    const categoria = preenchido(linha.categoria);
    if (categoria !== null) {
      const achada = acharCategoria(categoria, catalogos.categorias);
      if (achada === null) {
        problemas.push(
          `"Categoria": "${categoria}" não está no catálogo. Escolha um item da lista da célula, ou ` +
            "cadastre a categoria nova na tela de Curadoria antes de reenviar. O resto desta linha " +
            "entra normalmente.",
        );
      } else if (achada === "AMBIGUA") {
        problemas.push(
          `"Categoria": há mais de uma categoria chamada "${categoria}". Escreva o caminho inteiro, ` +
            "como aparece na lista. O resto desta linha entra normalmente.",
        );
      } else if (achada.code !== atributo.taxonomyCode) {
        mudancas.push({
          campo: "categoria",
          de: rotuloDe(atributo.taxonomyCode, catalogos.categorias, "caminho"),
          para: achada.caminho,
          codigo: achada.code,
        });
      }
    }

    return {
      ...molde,
      desfecho: mudancas.length > 0 ? "MUDA" : "IGUAL",
      mudancas,
      problemas,
    };
  });

  return {
    linhas: conferidas,
    resumo: {
      mudam: conferidas.filter((l) => l.desfecho === "MUDA").length,
      campos: conferidas.reduce((soma, l) => soma + l.mudancas.length, 0),
      iguais: conferidas.filter((l) => l.desfecho === "IGUAL").length,
      ignoradas: conferidas.filter(
        (l) => l.desfecho !== "MUDA" && l.desfecho !== "IGUAL",
      ).length,
      naoEntendidas: conferidas
        .filter((l) => l.desfecho === "MUDA" || l.desfecho === "IGUAL")
        .reduce((soma, l) => soma + l.problemas.length, 0),
    },
  };
}

// ---------------------------------------------------------------------------
// A gravação
// ---------------------------------------------------------------------------

export interface AplicacaoDoModelo {
  gravadas: number;
  campos: number;
  /** O que o servidor não conseguiu gravar, linha a linha. */
  recusadas: { code: string; motivo: string }[];
}

/**
 * Gravar o que a conferência aprovou.
 *
 * Só as linhas `MUDA` — as outras já foram explicadas na prévia, e reprocessá-las
 * aqui produziria evento de curadoria para escrita que não escreveu nada.
 *
 * A prosa vai por {@link saveMeaning}, que é a mesma função da tela: um caminho
 * a mais para gravar nome e definição seria um segundo lugar para a regra do
 * "não mexe no status" ser esquecida.
 */
export async function aplicarPreenchimento(
  db: Database,
  entrada: { linhas: LinhaConferida[]; actor: string },
): Promise<AplicacaoDoModelo> {
  if (!entrada.actor?.trim()) {
    throw new Error("Aplicar a planilha exige um responsável identificado.");
  }

  const recusadas: AplicacaoDoModelo["recusadas"] = [];
  let gravadas = 0;
  let campos = 0;

  for (const linha of entrada.linhas.filter((l) => l.desfecho === "MUDA")) {
    const de = (campo: CampoDoModelo) =>
      linha.mudancas.find((m) => m.campo === campo);
    try {
      const prosa = (["displayName", "definition", "calculationBasis"] as const).filter(
        (campo) => de(campo) !== undefined,
      );
      if (prosa.length > 0) {
        const resultado = await saveMeaning(db, {
          code: linha.code,
          actor: entrada.actor,
          ...Object.fromEntries(prosa.map((campo) => [campo, de(campo)!.para])),
        });
        /*
          A fórmula recusada por falta de semântica versionada não derruba a
          linha: o nome e a definição do mesmo envio foram gravados, e é a mesma
          resposta que a tela dá. Ela sai na lista de recusadas para que o
          arquivo inteiro não pareça ter entrado.
        */
        if (resultado.notWritten) {
          recusadas.push({ code: linha.code, motivo: resultado.notWritten.message });
        }
      }

      const significado = de("significado");
      const categoria = de("categoria");
      if (significado || categoria) {
        await proporSignificadoECategoria(db, {
          code: linha.code,
          meaningCode: significado?.codigo ?? null,
          taxonomyCode: categoria?.codigo ?? null,
          actor: entrada.actor,
        });
      }

      gravadas++;
      campos += linha.mudancas.length;
    } catch (err) {
      recusadas.push({
        code: linha.code,
        motivo: err instanceof Error ? err.message : "Erro desconhecido",
      });
    }
  }

  return { gravadas, campos, recusadas };
}

/**
 * O significado e a categoria escritos como proposta — e nada além disso.
 *
 * `semantics_status`, `confirmed_by` e `confirmed_at` não estão no update, e é
 * a razão de esta função existir em vez de `confirmAttribute`: quem preenche
 * uma planilha responde às duas perguntas de negócio, mas não assina que o
 * número pode entrar em soma financeira. É o mesmo par de campos que
 * `runProposalPass` escreve quando o motor lê os valores; o que muda é a
 * autoria da proposta.
 *
 * Unidade, agregação e natureza monetária continuam sem ser escritas daqui: são
 * derivadas do significado no momento da confirmação, e antecipá-las aqui poria
 * na versão em vigor um número técnico que ninguém confirmou.
 */
async function proporSignificadoECategoria(
  db: Database,
  entrada: {
    code: string;
    meaningCode: string | null;
    taxonomyCode: string | null;
    actor: string;
  },
): Promise<void> {
  const [atributo] = await db
    .select()
    .from(attributeTable)
    .where(eq(attributeTable.code, entrada.code));
  if (!atributo) throw new Error(`Atributo "${entrada.code}" não encontrado.`);

  const campos: { meaningId?: string; taxonomyNodeId?: string } = {};
  const eventos: { field: string; valueBefore: string | null; valueAfter: string }[] =
    [];

  if (entrada.meaningCode) {
    const [significado] = await db
      .select()
      .from(semanticMeaningTable)
      .where(eq(semanticMeaningTable.code, entrada.meaningCode));
    if (!significado) {
      throw new Error(`Significado "${entrada.meaningCode}" não está cadastrado.`);
    }
    campos.meaningId = significado.id;
    eventos.push({
      field: "meaning_id",
      valueBefore: atributo.meaningId,
      valueAfter: significado.code,
    });
  }

  if (entrada.taxonomyCode) {
    const [no] = await db
      .select()
      .from(taxonomyNodeTable)
      .where(eq(taxonomyNodeTable.code, entrada.taxonomyCode));
    if (!no) throw new Error(`Categoria "${entrada.taxonomyCode}" não está cadastrada.`);
    campos.taxonomyNodeId = no.id;
    eventos.push({
      field: "taxonomy_node_id",
      valueBefore: atributo.taxonomyNodeId,
      valueAfter: no.code,
    });
  }

  if (eventos.length === 0) return;

  await db.transaction(async (tx) => {
    await tx.update(attributeTable).set(campos).where(eq(attributeTable.id, atributo.id));

    // A proposta vale para o presente, e o presente é a versão em vigor — a
    // mesma regra da passagem de propostas. Sem isto, `projectCurrentVersion`
    // devolveria o significado antigo na próxima vez que rodasse.
    await tx
      .update(attributeSemanticsTable)
      .set(campos)
      .where(
        and(
          eq(attributeSemanticsTable.attributeId, atributo.id),
          isNull(attributeSemanticsTable.effectiveUntil),
        ),
      );

    await tx.insert(curationEventTable).values(
      eventos.map((evento) => ({
        targetKind: "ATTRIBUTE",
        targetId: atributo.id,
        targetLabel: atributo.code,
        field: evento.field,
        valueBefore: evento.valueBefore,
        valueAfter: evento.valueAfter,
        actor: entrada.actor,
        // Sem `reason`, como toda escrita que não é confirmação: o valor novo é
        // o conteúdo, e a origem está no `changeKind`.
        detail: { changeKind: "PLANILHA_DE_ATRIBUTOS" },
      })),
    );
  });
}
