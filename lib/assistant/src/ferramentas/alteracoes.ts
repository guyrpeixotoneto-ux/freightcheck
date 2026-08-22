/**
 * ALTERAÇÕES — a capacidade, com três níveis de zoom.
 *
 * **O que ela substitui.** Hoje a pergunta "o que mudou?" dispara
 * `resumoDaVigencia` e recebe três agregados; "liste as alterações" dispara a
 * mesma coisa e recebe os mesmos três; "o que mudou nos cavalos?" também — e as
 * respostas saem byte a byte idênticas, sem filtro de equipamento nenhum. Não é
 * defeito de redação: as três perguntas recebem o mesmo material, e nenhum
 * redator distingue o que chega igual.
 *
 * **O eixo é `nivel`, e é ele que dissolve as perguntas específicas.** O mesmo
 * dado existe em três resoluções, e o produto sempre soube produzir as três — a
 * tela de Alterações mostra as três. O que faltava era o assistente poder pedir
 * a que a pergunta queria:
 *
 * - `total`  — a vigência em números: quantas alterações, quantos ativos, quanto
 *              de impacto apurado, quanto ficou sem preço.
 * - `grupos` — cada grupo de alteração com o par antes→depois dominante, quantos
 *              veículos, que natureza, que impacto. É o que "liste" pede.
 * - `linhas` — dentro de um grupo, veículo a veículo, com a placa e os dois
 *              valores. É onde uma investigação termina.
 *
 * Os demais argumentos são filtros que compõem livremente com o nível. Nenhum
 * deles existe para uma pergunta: `equipamento` existe porque a frota tem
 * cavalo e carreta, `ordenarPor` porque "o que mais pesou" e "o que atinge mais
 * gente" são ordens diferentes sobre o mesmo conjunto.
 *
 * **O que ela não faz.** Não calcula. `getGroupedView` e `buildCockpit` são os
 * mesmos que a tela usa, e o impacto sai deles somado por periodicidade e nunca
 * entre elas. Esta ferramenta escolhe recorte, filtra, ordena e corta — e é de
 * propósito que a lista de verbos pare aí.
 */

import { buildCockpit, getGroupVehicles, getGroupedView } from "@workspace/comparison";
import { impactoEmTexto, numerosDoResumoDeImpacto, rotuloDoPeriodo } from "../formato";
import type { Evidencia } from "../ferramentas";
import type { ContextoDaFerramenta, Ferramenta, SaidaDaFerramenta } from "./registro";

const LIMITE_PADRAO = 20;

/** O par antes→depois, dito uma vez, do jeito que a tela o diz. */
function comoMudou(grupo: {
  dominantPattern: { before: string | null; after: string | null; vehicles: number } | null;
  patterns: number;
}): string | null {
  const p = grupo.dominantPattern;
  if (!p) return null;
  const par = `${p.before ?? "—"} → ${p.after ?? "—"}`;
  return grupo.patterns > 1 ? `${par} (em ${p.vehicles} ativos; ${grupo.patterns} pares distintos)` : par;
}

/**
 * Os dois lados do par, como **número** — e não só dentro da frase.
 *
 * **O defeito que isto fecha.** `comoMudou` devolve `"2.19 → 0"`, texto cru do
 * banco, e esse texto ia para `fatos[].valor`. A trava registra o que encontra
 * numa string exatamente como está escrito: autorizava `2.19` e nada mais. O
 * modelo, escrevendo para um leitor brasileiro, escreve `2,19` — e era recusado.
 *
 * Medido na bateria real: sete das nove perguntas perderam grounding por isto, e
 * três respostas certas foram descartadas inteiras. Nenhuma delas continha
 * invenção; continham o mesmo número que a ferramenta havia mostrado, escrito
 * como uma pessoa o escreve.
 *
 * **Por que aqui e não na trava.** Um número em `numeros[]` já ganha as
 * variantes pt-BR pelo mecanismo que existe desde sempre — `toLocaleString` com
 * e sem casas decimais. O que faltava não era a trava reconhecer formato: era o
 * par antes→depois nunca ter entrado em `numeros[]`, porque ele nascia frase.
 * O conserto é pôr o número onde os outros números já estão.
 *
 * `Number()` recusa o que não é numérico sem reclamar — um par que trocou de
 * formato (`"1.234"` → `"texto"`) simplesmente não contribui, que é o correto:
 * não há grandeza ali para autorizar.
 */
function numerosDoPar(grupo: {
  dominantPattern: { before: string | null; after: string | null } | null;
}): number[] {
  const p = grupo.dominantPattern;
  if (!p) return [];
  return [p.before, p.after]
    .map((v) => (v === null || v.trim() === "" ? Number.NaN : Number(v)))
    .filter((n) => Number.isFinite(n));
}

export const alteracoes: Ferramenta = {
  nome: "alteracoes",
  descricao:
    "O que mudou entre uma vigência e a anterior, no recorte em que a conversa está. " +
    "Três níveis de detalhe sobre o mesmo dado: `total` devolve os números da vigência; " +
    "`grupos` devolve cada grupo de alteração com o par antes→depois, quantos ativos atinge, " +
    "a natureza e o impacto apurado; `linhas` desce ao veículo, com placa e os dois valores. " +
    "Use `grupos` quando a pergunta pedir para ver o que mudou, e `linhas` para investigar um " +
    "grupo específico. O impacto vem somado dentro de cada periodicidade e nunca entre elas; " +
    "quando a semântica de um atributo não está confirmada, o impacto vem nulo e a alteração " +
    "continua listada.",
  argumentos: {
    nivel: {
      tipo: "texto",
      descricao:
        "A resolução da resposta: 'total' (números da vigência), 'grupos' (cada grupo de " +
        "alteração) ou 'linhas' (veículo a veículo dentro de um grupo).",
      opcoes: ["total", "grupos", "linhas"] as const,
      obrigatorio: true,
    },
    vigencia: {
      tipo: "texto",
      descricao:
        "A vigência, em AAAA-MM-DD, como devolvida pela ferramenta de recortes. " +
        "Omita para a mais recente.",
    },
    atributo: {
      tipo: "texto",
      descricao:
        "O código do atributo, quando quiser um grupo só — obrigatório no nível 'linhas'. " +
        "Vem no campo `atributo` de cada grupo.",
    },
    equipamento: {
      tipo: "texto",
      descricao: "Restringe a um tipo de ativo.",
      opcoes: ["CAVALO", "CARRETA"] as const,
    },
    natureza: {
      tipo: "texto",
      descricao:
        "Restringe a um tipo de mudança: ZEROING (valor zerado), TYPE_CHANGE (trocou de " +
        "formato), APPEARED, DISAPPEARED, NUMERIC, TEXT.",
    },
    ordenarPor: {
      tipo: "texto",
      descricao:
        "'impacto' põe na frente o que mais mexeu em dinheiro; 'criticidade' usa a mesma " +
        "ordem da fila de investigação da tela (abrangência, magnitude, se há dinheiro " +
        "apurado, se houve troca de formato); 'veiculos' põe na frente o que atinge mais " +
        "ativos; 'alteracoes', o que tem mais linhas. Padrão: criticidade.",
      opcoes: ["impacto", "criticidade", "veiculos", "alteracoes"] as const,
    },
    apartirDe: {
      tipo: "inteiro",
      descricao:
        "Pular os primeiros N itens da ordem — para continuar uma lista já mostrada, em vez " +
        "de repetir o começo dela. O resultado diz `apartirDe` e `restantes`, que é o que " +
        "permite saber se ainda há página seguinte.",
      minimo: 0,
      maximo: 5000,
    },
    limite: {
      tipo: "inteiro",
      descricao: `Quantos itens devolver. Padrão ${LIMITE_PADRAO}, teto 100.`,
      minimo: 1,
      maximo: 100,
    },
    somenteComImpacto: {
      tipo: "booleano",
      descricao:
        "Só o que tem impacto apurado em dinheiro. Cuidado: o que fica de fora não é " +
        "irrelevante — é o que ainda não tem semântica confirmada.",
    },
  },

  async executar(ctx: ContextoDaFerramenta, args): Promise<SaidaDaFerramenta> {
    const nivel = args.nivel as "total" | "grupos" | "linhas";
    /*
      O filtro do fio é o padrão; o argumento explícito vence.

      `??` e não `||`: `equipamento` pode chegar `null` do estado quando ninguém
      recortou, e `null` aqui quer dizer "a frota inteira" — que é diferente de
      "não informado". Trocar por `||` faria uma conversa sem recorte de
      equipamento herdar o de outra.
    */
    const equipamentoEfetivo =
      (args.equipamento as string | undefined) ?? ctx.filtros?.equipamento ?? undefined;
    const apartirDe = Math.max(
      0,
      (args.apartirDe as number | undefined) ?? ctx.filtros?.apartirDe ?? 0,
    );
    const vigencia = (args.vigencia as string | undefined) ?? ctx.periodo;

    const visao = await getGroupedView(ctx.db, vigencia, ctx.recorte);
    if (!visao) {
      return {
        conteudo: {
          erro:
            "Não há comparação disponível neste recorte. Pode não haver vigência anterior " +
            "importada, ou o recorte pode estar vazio.",
        },
        evidencias: [],
      };
    }

    /*
      "Nunca comparada" sai como falha declarada, e não como zero.

      Devolver `{changes: 0, grupos: []}` aqui daria ao modelo material para
      escrever "nada mudou nesta vigência" — uma frase fluente, com fonte ao
      lado, sobre uma comparação que não existe. É o defeito que o caminho
      determinístico já cometeu uma vez e que o do agente herdou por outro
      caminho; a diferença entre os dois estados é a diferença entre "siga em
      frente" e "falta rodar o cálculo", e nenhuma redação recupera o que a
      consulta não distinguiu.
    */
    if (visao.comparacao === "NAO_MATERIALIZADA") {
      return {
        conteudo: {
          erro:
            `A vigência ${visao.periodLabel} ainda não foi comparada com a anterior neste ` +
            "recorte — o estado derivado não está materializado. Isto **não** significa que " +
            "nada mudou: significa que ninguém calculou. Não conclua ausência de alteração a " +
            "partir desta resposta; diga que a comparação está pendente.",
          vigencia: visao.periodLabel,
          contexto: visao.context.label,
        },
        evidencias: [],
      };
    }

    /*
      O recorte sai na evidência e no conteúdo, com unidade e canal por extenso.

      Não é enfeite: é a fronteira de isolamento aparecendo no material que o
      modelo lê. Uma resposta que não diz de que unidade está falando é uma
      resposta que pode estar falando de outra.
    */
    const recorte = {
      unidade: visao.context.scopes.map((s) => s.name).join(" · "),
      canal: visao.context.channel,
      contexto: visao.context.label,
      vigencia: visao.periodLabel,
    };

    // ---- total -------------------------------------------------------------
    if (nivel === "total") {
      const t = visao.totals;
      /*
        O agregado é da frota inteira, e ele diz isso quando há filtro em pé.

        `visao.totals` vem do motor somado sobre o conjunto; filtrá-lo aqui por
        equipamento seria **recalcular** o resumo dentro do Assistente, que é
        exatamente o que este arquivo não faz. O que se pode — e se deve — é não
        deixar o número passar por outra coisa: com "só cavalos" em pé, uma
        resposta que apresentasse 749 alterações como sendo dos cavalos estaria
        errada, e nada no material anterior a impedia.

        Quem quer o recorte por equipamento tem `grupos` e `linhas`, que filtram
        a lista que o motor devolve — sem refazer conta nenhuma.
      */
      const avisoDoFiltro = equipamentoEfetivo
        ? `Estes totais são da frota inteira do recorte, e **não** só de ${equipamentoEfetivo}: ` +
          "o motor os soma sobre o conjunto e este nível não os recompõe por equipamento. " +
          `Para o recorte de ${equipamentoEfetivo}, use nivel='grupos'.`
        : null;
      const evidencia: Evidencia = {
        ferramenta: "alteracoes:total",
        titulo: `O que mudou em ${visao.periodLabel}`,
        fatos: [
          { rotulo: "Alterações", valor: String(t.changes) },
          { rotulo: "Grupos de alteração", valor: String(t.groups) },
          { rotulo: "Veículos afetados", valor: String(t.vehiclesTouched) },
          { rotulo: "Só troca de formato", valor: String(t.formatOnlyChanges) },
          {
            rotulo: "Impacto apurado",
            valor: impactoEmTexto(visao.impact) ?? "não apurável",
            detalhe: `${visao.impact.notCalculable} alteração(ões) sem preço`,
          },
        ],
        /*
          Tudo o que o conteúdo abaixo mostra, e nada além disso.

          A lista era um subconjunto do que a ferramenta exibe, e a diferença
          eram justamente os dois blocos que mais precisam ser ditos: o que
          ficou fora da soma, e o acumulado. O modelo lia os dois, e a trava
          podava a frase em que ele os usasse — um resultado correto punido
          como se fosse invenção.

          O acumulado entra com todos os seus campos porque ele vai ao conteúdo
          com todos eles. Dá-lo ao modelo sem autorizá-lo é a pior das três
          opções: ele pode se confundir com o mês e não pode corrigir-se em voz
          alta. Ou sai do conteúdo, ou entra no lastro.
        */
        numeros: [
          t.changes, t.groups, t.vehiclesTouched, t.formatOnlyChanges,
          t.entitiesAdded, t.entitiesRemoved, t.unchanged, t.inconclusive,
          ...numerosDoResumoDeImpacto(visao.impact),
          ...numerosDoResumoDeImpacto(visao.accumulated),
          visao.accumulated.comparisons,
        ],
        origem: `getGroupedView · ${visao.periodLabel} · ${visao.context.label}`,
        recorte,
        tela: { label: "Alterações", href: "/alteracoes" },
      };

      return {
        conteudo: {
          recorte,
          ...(avisoDoFiltro ? { avisoDoFiltro } : {}),
          vigenciaAnterior: visao.series[0]?.previousPeriodLabel ?? null,
          completo: visao.complete,
          seriesFaltando: visao.missingSeries,
          totais: t,
          impacto: visao.impact,
          /*
            O acumulado vai junto e com nome próprio. Ele é a soma de todas as
            comparações já feitas, e confundi-lo com o desta vigência é o erro
            que o Painel já cometeu — R$ 735 mil de dezesseis transições sob o
            título de um mês só.
          */
          impactoAcumuladoDeTodasAsVigencias: visao.accumulated,
        },
        evidencias: [evidencia],
      };
    }

    // ---- grupos ------------------------------------------------------------
    if (nivel === "grupos") {
      const criticidade = new Map(
        buildCockpit(visao).priorities.map((p) => [p.key, p.rank] as const),
      );

      let grupos = visao.groups;
      /*
        O filtro casa `entityType`, e não `equipment`.

        São dois campos e eles não têm o mesmo valor: `equipment` é o rótulo de
        tela ("Cavalo") e `entityType` é o canônico ("CAVALO"). Filtrar pelo
        rótulo com o enum canônico não remove nada — devolve a lista inteira com
        cara de filtrada, que é precisamente o defeito que esta ferramenta
        existe para corrigir.
      */
      if (equipamentoEfetivo) grupos = grupos.filter((g) => g.entityType === equipamentoEfetivo);
      if (args.atributo) grupos = grupos.filter((g) => g.attributeCode === args.atributo);
      if (args.natureza) {
        const alvo = String(args.natureza).toUpperCase();
        grupos = grupos.filter((g) => g.natureCodes.includes(alvo));
      }
      if (args.somenteComImpacto) grupos = grupos.filter((g) => g.impact.amount !== null);

      const ordem = (args.ordenarPor as string | undefined) ?? "criticidade";
      const chave = (g: (typeof grupos)[number]): number => {
        if (ordem === "impacto") return Math.abs(g.impact.amount ?? 0);
        if (ordem === "veiculos") return g.vehicles;
        if (ordem === "alteracoes") return g.changes;
        // Criticidade é a posição na fila; sem posição, vai para o fim.
        return -(criticidade.get(g.key) ?? Number.MAX_SAFE_INTEGER);
      };
      const ordenados = [...grupos].sort((a, b) => chave(b) - chave(a));

      const limite = (args.limite as number | undefined) ?? ctx.filtros?.limite ?? LIMITE_PADRAO;
      const pagina = ordenados.slice(apartirDe, apartirDe + limite);

      const itens = pagina.map((g) => ({
        atributo: g.attributeCode,
        titulo: g.title,
        // O canônico, porque é ele que volta como argumento na chamada seguinte.
        equipamento: g.entityType,
        equipamentoRotulo: g.equipment,
        alteracoes: g.changes,
        veiculos: g.vehicles,
        frota: g.fleet,
        comoMudou: comoMudou(g),
        natureza: g.natures,
        unidade: g.unit,
        impacto: g.impact.amount,
        impactoPeriodicidade: g.impact.periodicity,
        impactoConfianca: g.impact.confidence,
        semantica: g.semanticsLabel,
        soFormato: g.formatOnly,
        selo: g.badgeLabel,
        classificacao: g.taxonomyName,
        posicaoNaFila: criticidade.get(g.key) ?? null,
        inconclusivo: g.inconclusiveReason,
      }));

      const evidencia: Evidencia = {
        ferramenta: "alteracoes:grupos",
        titulo: `Grupos de alteração em ${visao.periodLabel}`,
        fatos: pagina.map((g) => ({
          rotulo: g.title,
          valor: comoMudou(g) ?? `${g.changes} alteração(ões)`,
          detalhe:
            `${g.vehicles} de ${g.fleet} ativos` +
            (g.impact.amount !== null && g.impact.periodicity
              ? ` · ${g.impact.amount} ${g.impact.periodicity}`
              : " · sem preço"),
        })),
        /*
          O tamanho do conjunto e o corte entram no lastro, e não só na lista.

          `gruposNoTotal` existe no conteúdo para o modelo poder avisar que a
          lista foi cortada — e sem ele aqui, dizer "são 20 grupos, mostro os
          cinco maiores" era exatamente a frase que a trava derrubava. Autorizar
          o aviso é a condição para ele ser dado.

          `posicaoNaFila` pela mesma razão: é a ordem da fila de investigação, o
          motivo pelo qual `ordenarPor: "criticidade"` existe, e responder "este
          é o primeiro da fila" sem lastro para o "primeiro" é uma frase podada.
        */
        numeros: [
          grupos.length,
          pagina.length,
          /*
            O deslocamento e o que resta são mostrados ao modelo, e por isso
            precisam ser autorizados. É a regra que a auditoria de integridade
            fixa: o que a ferramenta exibe, ela autoriza — o conserto de um
            número visto e não lastreado é registrá-lo aqui, nunca abrir exceção
            na trava. Sem isto, "mostro 5 dos 20; faltam 15" é uma frase
            verdadeira que a trava poda.
          */
          apartirDe,
          Math.max(0, grupos.length - (apartirDe + pagina.length)),
          ...pagina.flatMap((g) =>
            [
              g.changes, g.vehicles, g.fleet, g.patterns,
              g.impact.amount, g.aggregate.totalBefore, g.aggregate.totalAfter,
              g.aggregate.deltaPercent, g.aggregate.minPercent, g.aggregate.maxPercent,
              criticidade.get(g.key) ?? null,
              // O par antes→depois — ver `numerosDoPar`. Ele já ia no texto do
              // fato; aqui ele passa a ir como grandeza, que é o que autoriza a
              // forma em que uma pessoa o escreve.
              ...numerosDoPar(g),
            ].filter((n): n is number => typeof n === "number"),
          ),
        ],
        origem: `getGroupedView.groups · ${visao.periodLabel} · ${visao.context.label}`,
        recorte,
        tela: { label: "Alterações", href: "/alteracoes" },
      };

      return {
        conteudo: {
          recorte,
          /*
            O corte é dito, e não silencioso.

            Uma lista truncada sem aviso lê-se como a lista inteira, e o modelo
            concluiria "foram estes cinco grupos" sobre uma vigência de
            quarenta. Dizer quantos ficaram de fora é o que permite a ele pedir
            a página seguinte ou avisar quem perguntou.
          */
          gruposNoTotal: grupos.length,
          mostrando: pagina.length,
          apartirDe,
          /*
            Quantos ficaram **depois** desta página. É o que permite ao modelo
            oferecer a continuação em vez de adivinhar se ela existe — e o que
            impede "mostre os 5 seguintes" de prometer uma página vazia.
          */
          restantes: Math.max(0, grupos.length - (apartirDe + pagina.length)),
          ordenadoPor: ordem,
          grupos: itens,
        },
        evidencias: [evidencia],
      };
    }

    // ---- linhas ------------------------------------------------------------
    const atributo = args.atributo as string | undefined;
    if (!atributo) {
      return {
        conteudo: {
          erro:
            "O nível 'linhas' precisa do argumento `atributo`. Chame antes com " +
            "nivel='grupos' e use o campo `atributo` do grupo que quiser abrir.",
        },
        evidencias: [],
      };
    }

    const grupo = visao.groups.find(
      (g) =>
        g.attributeCode === atributo &&
        (!equipamentoEfetivo || g.entityType === equipamentoEfetivo),
    );
    if (!grupo) {
      return {
        conteudo: {
          erro: `Nenhum grupo de alteração para o atributo "${atributo}" nesta vigência e recorte.`,
          atributosComAlteracao: visao.groups.map((g) => g.attributeCode).filter(Boolean).slice(0, 40),
        },
        evidencias: [],
      };
    }

    const veiculos = await getGroupVehicles(ctx.db, {
      period: visao.period,
      attributeCode: atributo,
      entityType: grupo.entityType ?? grupo.equipment,
      scopeHash: visao.context.scopeHash,
      channel: visao.context.channel,
    });

    const limite = (args.limite as number | undefined) ?? ctx.filtros?.limite ?? LIMITE_PADRAO;
    const pagina = veiculos.slice(apartirDe, apartirDe + limite);

    const evidencia: Evidencia = {
      ferramenta: "alteracoes:linhas",
      titulo: `${grupo.title} — veículo a veículo em ${visao.periodLabel}`,
      fatos: pagina.map((v) => ({
        rotulo: v.plate ?? "(sem placa)",
        valor: `${v.valueBefore ?? "—"} → ${v.valueAfter ?? "—"}`,
        detalhe:
          v.impactAmount !== null && v.impactPeriodicity
            ? `${v.impactAmount} ${v.impactPeriodicity}`
            : "sem preço",
      })),
      /*
        O mesmo que no nível acima: o corte é dito, então o corte é lastreado.
        `variacaoPercentual` entra porque ela vai ao conteúdo linha a linha —
        ela sai do motor de comparação, não desta ferramenta, e é a resposta
        direta a "quanto caiu neste veículo".
      */
      numeros: [
        veiculos.length,
        pagina.length,
        // Mesma regra do nível acima: o que o conteúdo mostra, a evidência autoriza.
        apartirDe,
        Math.max(0, veiculos.length - (apartirDe + pagina.length)),
        ...veiculos.flatMap((v) =>
          [v.numericBefore, v.numericAfter, v.impactAmount, v.deltaPercent].filter(
            (n): n is number => typeof n === "number",
          ),
        ),
      ],
      /*
        As placas da página, declaradas como identificadores.

        É a lista que o modelo de fato recebeu em `conteudo.linhas` — nem uma a
        mais. Autorizar `veiculos` inteiro (que pode ter dezenas fora do corte)
        deixaria o modelo citar um caminhão que ele não viu, e o corte existe
        justamente para ele não ver.
      */
      identificadores: pagina
        .map((v) => v.plate)
        .filter((p): p is string => typeof p === "string" && p.length > 0),
      origem: `getGroupVehicles(${atributo}, ${grupo.entityType}) · ${rotuloDoPeriodo(visao.period)}`,
      recorte,
      tela: { label: "Alterações", href: "/alteracoes" },
    };

    return {
      conteudo: {
        recorte,
        grupo: {
          atributo,
          titulo: grupo.title,
          equipamento: grupo.entityType,
          unidade: grupo.unit,
          semantica: grupo.semanticsLabel,
        },
        linhasNoTotal: veiculos.length,
        mostrando: pagina.length,
        apartirDe,
        restantes: Math.max(0, veiculos.length - (apartirDe + pagina.length)),
        linhas: pagina.map((v) => ({
          placa: v.plate,
          antes: v.valueBefore,
          depois: v.valueAfter,
          antesNumerico: v.numericBefore,
          depoisNumerico: v.numericAfter,
          variacaoPercentual: v.deltaPercent,
          impacto: v.impactAmount,
          impactoPeriodicidade: v.impactPeriodicity,
          impactoConfianca: v.impactConfidence,
          /*
            Fora da soma não é "sem impacto".

            O ativo cujo dinheiro já está contado noutro lugar — nas parcelas de
            uma composição, ou na linha do equipamento vinculado — sai do total
            para não contar duas vezes, e continua listado com o valor. Omitir
            esta bandeira faria o modelo somar à mão o que o motor
            deliberadamente não somou.

            O motivo vai junto: "fora da soma" sem dizer **onde** o dinheiro foi
            contado é a mesma frase que fez o produto ter seis respostas para a
            mesma pergunta.
          */
          foraDaSoma: v.foraDoTotal !== null,
          foraDaSomaMotivo: v.foraDoTotal?.motivo ?? null,
          foraDaSomaExplicacao: v.foraDoTotal?.explicacao ?? null,
          inconclusivo: v.inconclusiveReason,
        })),
      },
      evidencias: [evidencia],
    };
  },
};
