import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  CODIGOS_DO_DETALHE,
  CODIGOS_DO_DETALHE_DE_IPVA,
  CODIGOS_DO_DETALHE_DE_IMPOSTOS,
  CODIGOS_DO_DETALHE_DE_LUCRO_FIXO,
  MODULOS_DO_MONITOR,
  SITUACOES_DO_IMPACTO,
  computeChangeSet,
  consolidar,
  getChangeSetForPair,
  impactoDoModulo,
  linhasDeFiname,
  linhasDeImpostos,
  linhasDeIpva,
  linhasDeLucroFixo,
  listChanges,
  listComparableSnapshots,
  normalizarLinhas,
  operacaoDoSnapshot,
  resumirModulo,
  type LinhaDeRubrica,
  type LinhaDoMonitor,
  type ModuloDoMonitor,
  type ParDoMonitor,
  type ResumoDoMonitor,
  type SituacaoDoImpacto,
} from "@workspace/comparison";
import { classificarFalha } from "../lib/classificar-falha";
import {
  candidatasDoPar,
  TETO_DE_CANDIDATAS_MS,
  type BaldeDoImpacto,
} from "../lib/candidatas-do-par";
import { exigirOperacaoDoRecurso, operacaoDaConsulta } from "../lib/operacao";
import { comTetoDeRota } from "../lib/timeout-de-rota";

/**
 * MONITOR CUSTO FIXO — os quatro recortes de rubrica numa resposta só.
 *
 * ---------------------------------------------------------------------------
 * Por que esta rota também é curta
 * ---------------------------------------------------------------------------
 * Pela mesma razão que a de FINAME: ela não compara e não soma. O motor compara,
 * `listChanges` lê, os quatro recortes traduzem, `monitor-custo-fixo.ts` compõe
 * — e aqui só se costura. Uma rota que fizesse conta própria seria a quinta
 * régua da mesma pergunta.
 *
 * **Uma leitura, e não quatro.** Os quatro módulos leem a mesma família de dados
 * (equipamento) e, portanto, o mesmo `change_set`: pedir quatro vezes as mesmas
 * linhas ao banco daria a mesma resposta quatro vezes mais devagar. O recorte é
 * a união dos quatro catálogos, e cada `linhasDeX` filtra o que é dele —
 * inclusive as colunas que dois módulos mostram (o PIS/COFINS aparece no FINAME
 * como conferência e em Impostos como rubrica), porque **mostrar nos dois é
 * certo; somar nos dois é que não era**, e isso já foi corrigido na origem:
 * `docs/ACHADO-DUPLA-CONTAGEM-CUSTO-FIXO.md`.
 *
 * ---------------------------------------------------------------------------
 * O que os filtros fazem com o dinheiro
 * ---------------------------------------------------------------------------
 * Eles **recortam as linhas**, e o impacto é então pedido de novo ao módulo,
 * sobre o recorte. Não há subtração de totais em lugar nenhum: filtrar por
 * Cavalo é a mesma coisa que a aba Cavalo da Auditoria de FINAME já faz
 * (`routes/finame.ts`, `porTipo`), e pela mesma razão — o número de uma aba tem
 * de ser calculado pela mesma função que calcula o total, ou as duas divergem.
 *
 * Sem filtro nenhum, a resposta de cada módulo é, campo a campo, a da auditoria
 * dele para o mesmo par. É isso que o teste de reconciliação afere.
 *
 * ---------------------------------------------------------------------------
 * O par pertence ao módulo
 * ---------------------------------------------------------------------------
 * Hoje os quatro leem a mesma família e compartilham o par, e mesmo assim ele
 * viaja **dentro de cada resumo de módulo**. Publicá-lo como campo único do
 * consolidado transformaria uma coincidência de hoje em contrato — e quebraria
 * no dia em que o QLP entrar, que é de outra família e tem vigências próprias.
 */
const router: IRouter = Router();

/**
 * O recorte que se pede ao motor: a união dos quatro catálogos.
 *
 * `Set` porque eles se sobrepõem de propósito — a base de compra está nos três
 * de ativo, e é a mesma coluna.
 */
const CODIGOS_DO_MONITOR = [
  ...new Set([
    ...CODIGOS_DO_DETALHE,
    ...CODIGOS_DO_DETALHE_DE_IPVA,
    ...CODIGOS_DO_DETALHE_DE_IMPOSTOS,
    ...CODIGOS_DO_DETALHE_DE_LUCRO_FIXO,
  ]),
];

/** A fábrica de linhas de cada módulo — a mesma que a tela dele usa. */
const LINHAS_DO_MODULO: Record<
  ModuloDoMonitor,
  (linhas: Parameters<typeof linhasDeFiname>[0]) => LinhaDeRubrica[]
> = {
  FINAME: (rows) => linhasDeFiname(rows),
  IPVA: (rows) => linhasDeIpva(rows),
  IMPOSTOS: (rows) => linhasDeImpostos(rows),
  LUCRO_FIXO: (rows) => linhasDeLucroFixo(rows),
};

/** Um parâmetro de consulta que pode vir repetido, normalizado em lista. */
function lista(valor: unknown): string[] {
  if (typeof valor === "string") {
    return valor
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v !== "");
  }
  if (Array.isArray(valor)) return valor.flatMap((v) => lista(v));
  return [];
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;
}

/**
 * Os filtros, já validados contra o que existe.
 *
 * **Valor inválido não esvazia a tela.** Um `modulo=CAFE` na URL — de um link
 * velho, de um typo, de alguém experimentando — cai no padrão (todos os
 * módulos), e a tela avisa que ignorou. Recortar por um valor que não existe
 * daria zero linhas, correto e inexplicável, que é o defeito que
 * `lib/recorte.ts` descreve do outro lado.
 */
export interface FiltrosDoMonitor {
  modulos: ModuloDoMonitor[];
  equipamento: string | null;
  situacoes: SituacaoDoImpacto[];
  periodicidades: string[];
  busca: string | null;
}

const EQUIPAMENTOS = ["CAVALO", "CARRETA"];

export function parseFiltros(query: Record<string, unknown>): {
  filtros: FiltrosDoMonitor;
  ignorados: string[];
} {
  const ignorados: string[] = [];

  const pedidos = lista(query.modulo).map((m) => m.toUpperCase());
  const modulos = pedidos.filter((m): m is ModuloDoMonitor =>
    (MODULOS_DO_MONITOR as readonly string[]).includes(m),
  );
  for (const m of pedidos) {
    if (!(MODULOS_DO_MONITOR as readonly string[]).includes(m)) {
      ignorados.push(`módulo "${m}"`);
    }
  }

  const equipamentoPedido = texto(query.equipamento)?.toUpperCase() ?? null;
  const equipamento =
    equipamentoPedido && EQUIPAMENTOS.includes(equipamentoPedido)
      ? equipamentoPedido
      : null;
  if (equipamentoPedido && !equipamento && equipamentoPedido !== "TODOS") {
    ignorados.push(`equipamento "${equipamentoPedido}"`);
  }

  const situacoesPedidas = lista(query.situacao).map((s) => s.toUpperCase());
  const situacoes = situacoesPedidas.filter((s): s is SituacaoDoImpacto =>
    (SITUACOES_DO_IMPACTO as readonly string[]).includes(s),
  );
  for (const s of situacoesPedidas) {
    if (!(SITUACOES_DO_IMPACTO as readonly string[]).includes(s)) {
      ignorados.push(`situação "${s}"`);
    }
  }

  return {
    filtros: {
      modulos: modulos.length > 0 ? modulos : [...MODULOS_DO_MONITOR],
      equipamento,
      situacoes,
      periodicidades: lista(query.periodicidade).map((p) => p.toUpperCase()),
      busca: texto(query.busca),
    },
    ignorados,
  };
}

/**
 * O filtro de equipamento **não pode apagar o que não é veículo**.
 *
 * Hoje os quatro módulos são de placa e a distinção não muda nada em tela. Ela
 * está aqui porque o Monitor foi desenhado para receber o QLP, que é de cargo:
 * um filtro "Cavalo" que recortasse por `entityType` sem olhar o tipo da
 * entidade faria as linhas de QLP sumirem sem uma palavra — o dado existiria, a
 * tela estaria vazia, e ninguém saberia por quê. Quem não é veículo passa.
 */
export function passaNoEquipamento(l: LinhaDoMonitor, equipamento: string | null): boolean {
  if (equipamento === null) return true;
  if (l.entidade.tipo !== "VEICULO") return true;
  return l.entidade.entityType.trim().toUpperCase() === equipamento;
}

export function passaNaBusca(l: LinhaDoMonitor, busca: string | null): boolean {
  if (busca === null) return true;
  const alvo = busca.toLowerCase();
  return (
    (l.entidade.rotulo ?? "").toLowerCase().includes(alvo) ||
    l.variavel.rotulo.toLowerCase().includes(alvo) ||
    (l.variavel.attributeCode ?? "").toLowerCase().includes(alvo) ||
    l.origem.rotulo.toLowerCase().includes(alvo)
  );
}

export function passaNaSituacao(l: LinhaDoMonitor, situacoes: SituacaoDoImpacto[]): boolean {
  return situacoes.length === 0 || situacoes.includes(l.impacto.situacao);
}

/**
 * O filtro de periodicidade, e a recusa que ele carrega.
 *
 * Periodicidade só existe em linha **valorada** — é o balde do dinheiro. Quando
 * ele está ligado, o que não tem periodicidade sai, e isso é deliberado: quem
 * filtra por "mensal" está perguntando pelo dinheiro do mês, não pela lista
 * inteira. O cartão de "sem valoração" encolhe junto, e é por isso que ele
 * encolhe — não é dado sumindo.
 */
export function passaNaPeriodicidade(l: LinhaDoMonitor, periodicidades: string[]): boolean {
  if (periodicidades.length === 0) return true;
  return (
    l.impacto.periodicidade !== null &&
    periodicidades.includes(l.impacto.periodicidade)
  );
}

/**
 * O consolidado de um par, sobre linhas que já foram lidas.
 *
 * Isto era o corpo do laço de `/consolidado`, e virou função no dia em que a
 * segunda rota precisou do mesmo número: `/candidatos` responde, por candidata,
 * **o que a tela mostraria** se aquele par fosse escolhido. Duas cópias do laço
 * divergiriam no primeiro filtro novo — e a divergência apareceria do pior
 * jeito possível, com o menu prometendo um número e a tela publicando outro
 * logo depois do clique.
 *
 * Não lê banco e não compara: recebe as linhas do motor e devolve o que a tela
 * publica. Toda a regra que ela aplica — recorte antes do impacto, impacto
 * pedido ao módulo — continua exatamente onde estava.
 */
export function consolidadoDosModulos(
  rows: Parameters<typeof linhasDeFiname>[0],
  filtros: FiltrosDoMonitor,
  par: ParDoMonitor,
  changeSetId: string | null,
): { resumo: ResumoDoMonitor; linhas: LinhaDoMonitor[] } {
  const resumos = [];
  const linhas: LinhaDoMonitor[] = [];

  for (const modulo of filtros.modulos) {
    /* A tradução é a do módulo: ele devolve `null` para o que não é dele. */
    const daRubrica = LINHAS_DO_MODULO[modulo](rows);
    const normalizadas = normalizarLinhas(modulo, daRubrica, par, changeSetId);

    /*
      O recorte acontece **antes** do impacto, e é por isso que o cartão e a
      tabela nunca se contradizem: o número que o cartão publica é o que o
      módulo calculou sobre exatamente estas linhas.
    */
    const visiveis = normalizadas.filter(
      (l) =>
        passaNoEquipamento(l, filtros.equipamento) &&
        passaNaSituacao(l, filtros.situacoes) &&
        passaNaPeriodicidade(l, filtros.periodicidades) &&
        passaNaBusca(l, filtros.busca),
    );
    const visiveisPorId = new Set(visiveis.map((l) => l.id));
    const rubricaVisivel = daRubrica.filter((_, i) => visiveisPorId.has(normalizadas[i]!.id));

    const impacto = impactoDoModulo(modulo, rubricaVisivel);
    resumos.push(resumirModulo(modulo, visiveis, impacto, par));
    linhas.push(...visiveis);
  }

  return { resumo: consolidar(resumos), linhas };
}

/**
 * Os baldes do consolidado como o menu do seletor os lê — **com a natureza**.
 *
 * É o único recorte do produto que mistura custo e receita, e por isso o único
 * em que `BaldeDoImpacto.natureza` não é `null`. Somar os dois lados num número
 * por periodicidade seria publicar o "impacto líquido" que `CartoesDoMonitor`
 * recusa em letra grande — e publicá-lo justamente no lugar onde não há espaço
 * para a ressalva.
 *
 * `resultado` (receita − custo) também não serve aqui: ele é uma terceira
 * linha, lida com as duas primeiras à vista, e sozinho no menu trocaria o sinal
 * do custo sem avisar — um custo que caiu apareceria como número positivo ao
 * lado de um número de FINAME em que positivo quer dizer custo que subiu.
 *
 * Os zerados saem na lista: quem os filtra é `numerosDaLinha`, do lado do
 * cliente, que é onde a regra de "zero não é ausência" mora inteira.
 */
export function baldesDoMonitor(resumo: ResumoDoMonitor): BaldeDoImpacto[] {
  return resumo.baldes.flatMap((b) => [
    { periodicidade: b.periodicidade, natureza: "CUSTO" as const, valor: b.custo.liquido },
    { periodicidade: b.periodicidade, natureza: "RECEITA" as const, valor: b.receita.liquido },
  ]);
}

/**
 * `GET /monitor-custo-fixo/consolidado?base=<snapshotId>&comparada=<snapshotId>`
 *
 * Mais os filtros: `modulo`, `equipamento`, `situacao`, `periodicidade`,
 * `busca` — todos repetíveis ou separados por vírgula, todos opcionais, e
 * nenhum deles capaz de esvaziar a tela por um valor inválido.
 */
router.get("/monitor-custo-fixo/consolidado", async (req, res, next): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  const base = typeof query.base === "string" ? query.base : "";
  const comparada = typeof query.comparada === "string" ? query.comparada : "";
  if (!base || !comparada) {
    res.status(400).json({ error: "Informe base e comparada." });
    return;
  }
  for (const id of [base, comparada]) {
    await exigirOperacaoDoRecurso(req, "vigência", id, () => operacaoDoSnapshot(db, id));
  }

  const { filtros, ignorados } = parseFiltros(query);

  try {
    /*
      Reaproveita a comparação já calculada; só manda calcular quando ela não
      existe. É o mesmo caminho das quatro auditorias e o de Comparar — e é o
      que faz as cinco telas responderem o mesmo número para o mesmo par.
    */
    const resumo =
      (await getChangeSetForPair(db, base, comparada)) ??
      (await computeChangeSet(db, base, comparada, { computedBy: "api:monitor-custo-fixo" }));

    const { rows } = await listChanges(db, resumo.id, {
      attributeCodes: CODIGOS_DO_MONITOR,
      limit: 5000,
    });

    const vigencias = await listComparableSnapshots(db, {
      operacao: operacaoDaConsulta(query),
    });
    const snapshotA = vigencias.find((v) => v.id === base);
    const snapshotB = vigencias.find((v) => v.id === comparada);
    const par: ParDoMonitor = {
      baseId: base,
      comparadaId: comparada,
      baseRotulo: snapshotA?.sourceLabel ?? null,
      comparadaRotulo: snapshotB?.sourceLabel ?? null,
      baseData: snapshotA?.effectiveDate ?? null,
      comparadaData: snapshotB?.effectiveDate ?? null,
    };

    const consolidado = consolidadoDosModulos(rows, filtros, par, resumo.id);

    res.json({
      changeSetId: resumo.id,
      par,
      resumo: consolidado.resumo,
      linhas: consolidado.linhas,
      filtros: {
        modulos: filtros.modulos,
        equipamento: filtros.equipamento,
        situacoes: filtros.situacoes,
        periodicidades: filtros.periodicidades,
        busca: filtros.busca,
      },
      /*
        O que a resposta ignorou, dito por extenso. Um filtro inválido que
        sumisse em silêncio deixaria a tela mostrando mais linhas do que o
        usuário pediu, sem explicação — e o contrário, se ele recortasse, seria
        uma tela vazia sem explicação.
      */
      ignorados,
    });
  } catch (err) {
    const desfecho = classificarFalha(err);
    if (desfecho.tipo !== "REGRA") {
      next(err);
      return;
    }
    req.log.warn({ err }, "Consolidado do Monitor Custo Fixo recusado");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

/**
 * O que cada candidata a "De" produz contra o "Para" escolhido, no Monitor.
 *
 * `GET /monitor-custo-fixo/candidatos?para=<snapshotId>` — mais os mesmos
 * filtros de `/consolidado`, todos opcionais.
 *
 * ---------------------------------------------------------------------------
 * Por que os filtros vêm junto
 * ---------------------------------------------------------------------------
 * Porque o menu e a tela respondem à mesma pergunta, e ela é a pergunta
 * **filtrada**. Quem está com "IPVA" e "Aumentos" ligados e vê a tela vazia
 * está perguntando *qual outra vigência teria movido o IPVA para cima* — e um
 * menu que respondesse pelo recorte inteiro devolveria "457 alterações" ao lado
 * de uma vigência que, escolhida, mostraria zero. O número do menu tem de ser o
 * número que o clique entrega, e é por isso que os dois passam pela mesma
 * função (`consolidadoDosModulos`).
 *
 * Um filtro inválido cai no padrão aqui pela mesma razão que lá: `parseFiltros`
 * é um só, e um `modulo=CAFE` num endereço velho não pode esvaziar o menu.
 *
 * O orçamento, o reaproveitamento do que já foi comparado e o recorte por
 * unidade e cobertura são os de `lib/candidatas-do-par.ts` — os mesmos das
 * quatro auditorias, e não uma segunda régua para a tela que as consolida.
 */
router.get("/monitor-custo-fixo/candidatos", async (req, res, next): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  const para = typeof query.para === "string" ? query.para : "";
  if (!para) {
    res.status(400).json({ error: "Informe a vigência de destino." });
    return;
  }
  await exigirOperacaoDoRecurso(req, "vigência", para, () => operacaoDoSnapshot(db, para));
  const operacao = operacaoDaConsulta(query);
  const { filtros, ignorados } = parseFiltros(query);

  try {
    await comTetoDeRota(TETO_DE_CANDIDATAS_MS, async (dbComTeto) => {
      const resposta = await candidatasDoPar(
        dbComTeto,
        para,
        {
          attributeCodes: CODIGOS_DO_MONITOR,
          numeros: (rows, calculado) => {
            /*
              O par carimbado nas linhas, com os identificadores de verdade e
              sem os rótulos: `normalizarLinhas` os carrega até a tela, e desta
              rota não sai linha nenhuma — só a contagem e o dinheiro. Inventar
              um rótulo aqui seria escrever na resposta um nome de vigência que
              ninguém leu do acervo.
            */
            const par: ParDoMonitor = {
              baseId: calculado.baseId,
              comparadaId: calculado.comparadaId,
              baseRotulo: null,
              comparadaRotulo: null,
              baseData: null,
              comparadaData: null,
            };
            const { resumo } = consolidadoDosModulos(
              rows,
              filtros,
              par,
              calculado.changeSetId,
            );
            return {
              alteracoes: resumo.alteracoes,
              impacto: { baldes: baldesDoMonitor(resumo) },
            };
          },
        },
        { operacao, computedBy: "api:monitor-custo-fixo-candidatos" },
      );

      if ("naoEncontrada" in resposta) {
        res.status(404).json({ error: "Essa vigência não existe." });
        return;
      }
      /* O que o recorte ignorou vai junto, pela razão de `/consolidado`: um
         filtro inválido que sumisse em silêncio deixaria o menu respondendo
         por um recorte mais largo do que o pedido, sem dizer. */
      res.json({ ...resposta, ignorados });
    });
  } catch (err) {
    const desfecho = classificarFalha(err);
    if (desfecho.tipo !== "REGRA") {
      next(err);
      return;
    }
    req.log.warn({ err }, "Candidatas do Monitor Custo Fixo recusadas");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

export default router;
