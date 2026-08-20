import { and, eq, inArray, sql } from "drizzle-orm";
import { remuneracaoPlanilhaTable, type Database } from "@workspace/db";
import { LINHAS_DO_CADASTRO } from "./catalogo";
import {
  conferirCelula,
  LinhaDaPlanilhaInvalida,
  type CelulaDaPlanilha,
  type PlanilhaDeclarada,
  type ValorDeclarado,
} from "./informado";

/**
 * A planilha informada, do lado do banco.
 *
 * A outra metade de `leitura.ts`: aquela lê o que o acervo da Auditoria
 * sustenta, esta lê e grava o que **alguém digitou** da aba de Excel. As duas
 * são lidas juntas por `montarCadastro`, e nunca se misturam num campo só — ver
 * `informado.ts` para por que essa separação é o ponto inteiro.
 *
 * **Por que a escrita é da vigência inteira, e não de uma célula.** Quem
 * cadastra a planilha tem a aba aberta ao lado e digita as trinta linhas de uma
 * vez; trinta requisições produziriam trinta estados intermediários em que o
 * `Total Custo Frota Fixa sem imposto` some por faltar uma parcela que a pessoa
 * ainda vai digitar. Uma escrita, uma transação: ou a planilha daquela vigência
 * fica como quem digitou a deixou, ou nada muda.
 *
 * **A escrita é um `merge`, e não um `replace`.** O corpo diz o que mudou;
 * as chaves ausentes ficam como estavam, e é `valor: null` que apaga uma linha.
 * A diferença aparece no uso: a tela salva o bloco que a pessoa está editando,
 * e um `replace` apagaria em silêncio as outras vinte e cinco linhas que ela
 * preencheu na semana passada.
 */

/** O que a tela manda ao salvar — a planilha de uma unidade numa vigência. */
export interface EscritaDaPlanilha {
  scopeHash: string;
  canal: string | null;
  effectiveDate: string;
  /** As células que mudaram. `valor: null` apaga a linha. */
  celulas: { chave: unknown; valor: unknown; observacao?: unknown }[];
  autor?: { id: string | null; nome: string | null };
}

/** O que a planilha guarda para uma linha, já pronto para a tela. */
export interface LinhaDaPlanilha extends ValorDeclarado {
  chave: string;
  /** O rótulo do catálogo — a tela não precisa cruzar duas listas para exibir. */
  rotulo: string;
}

export interface PlanilhaDaVigencia {
  scopeHash: string;
  canal: string | null;
  effectiveDate: string;
  linhas: LinhaDaPlanilha[];
  /** Quando a planilha desta vigência foi mexida pela última vez. */
  atualizadaEm: string | null;
}

export { LinhaDaPlanilhaInvalida };

/** Erro de recusa: a escrita não trouxe célula nenhuma. Rota traduz em 400. */
export class PlanilhaVazia extends Error {
  constructor() {
    super(
      "A escrita não trouxe nenhuma linha. Salvar uma planilha vazia não apaga a que está " +
        "gravada — para apagar uma linha, mande-a com valor nulo.",
    );
    this.name = "PlanilhaVazia";
  }
}

/** `null` e `''` são a mesma série — ver o cabeçalho de `schema/remuneracao.ts`. */
function canalGravado(canal: string | null): string {
  return canal ?? "";
}

const ROTULO = new Map(LINHAS_DO_CADASTRO.map((l) => [l.chave, l.rotulo]));

/**
 * A chave que junta a linha lida de volta à unidade e à vigência.
 *
 * A mesma forma de `chaveDoAlvo` em `leitura.ts`, com a data no fim: a leitura
 * em lote da lista de unidades traz vigências diferentes na mesma consulta, e
 * sem a data as planilhas de duas quinzenas cairiam no mesmo balde.
 */
function chaveDaCelula(scopeHash: string, canal: string, effectiveDate: string): string {
  return `${scopeHash}|${canal}|${effectiveDate}`;
}

interface LinhaLida extends Record<string, unknown> {
  scope_hash: string;
  canal: string;
  effective_date: string;
  chave: string;
  valor: string;
  observacao: string | null;
  autor_nome: string | null;
  atualizada_em: string | Date;
}

function comoDeclarado(linha: LinhaLida): ValorDeclarado {
  return {
    valor: Number(linha.valor),
    observacao: linha.observacao,
    autor: linha.autor_nome,
    informadoEm:
      linha.atualizada_em instanceof Date
        ? linha.atualizada_em.toISOString()
        : String(linha.atualizada_em),
  };
}

/**
 * As planilhas de vários pares (unidade, vigência), numa consulta só.
 *
 * O formato em lote é o de `leitura.ts` e existe pela mesma razão: a lista de
 * unidades monta o cadastro de todas de uma vez, e uma consulta por unidade
 * daria trinta idas ao banco para desenhar uma tela de lista.
 *
 * A chave do mapa devolvido carrega a **data**, e não só a unidade: dois alvos
 * da mesma unidade em vigências diferentes aparecem na comparação de duas
 * quinzenas, e juntá-los faria a planilha de uma responder pela outra.
 */
export async function lerPlanilhasEmLote(
  db: Database,
  alvos: { scopeHash: string; canal: string | null; effectiveDate: string }[],
): Promise<Map<string, PlanilhaDeclarada>> {
  if (alvos.length === 0) return new Map();

  const { rows } = await db.execute<LinhaLida>(sql`
    SELECT p.scope_hash,
           p.canal,
           p.effective_date::text AS effective_date,
           p.chave,
           p.valor::text          AS valor,
           p.observacao,
           p.autor_nome,
           p.atualizada_em
      FROM remuneracao_planilha p
     WHERE ${sql.join(
       alvos.map(
         (alvo) =>
           sql`(p.scope_hash = ${alvo.scopeHash}
                AND p.canal = ${canalGravado(alvo.canal)}
                AND p.effective_date = ${alvo.effectiveDate}::date)`,
       ),
       sql` OR `,
     )}
  `);

  const planilhas = new Map<string, Map<string, ValorDeclarado>>();
  for (const linha of rows) {
    /*
      Uma chave que o catálogo não conhece é ignorada na leitura, e não vira
      linha órfã na tela. Acontece quando uma linha é aposentada do catálogo
      depois de alguém a ter preenchido: a escrita já a recusaria hoje, e o que
      ficou gravado ontem não pode derrubar a leitura de amanhã.
    */
    if (!ROTULO.has(linha.chave)) continue;
    const chave = chaveDaCelula(linha.scope_hash, linha.canal, linha.effective_date);
    const atual = planilhas.get(chave) ?? new Map<string, ValorDeclarado>();
    atual.set(linha.chave, comoDeclarado(linha));
    planilhas.set(chave, atual);
  }
  return planilhas;
}

/** Uma unidade e um canal que a planilha informada conhece. */
export interface CanalComPlanilha {
  scopeHash: string;
  /** `null` é a série sem canal — a leitura desfaz o `''` da coluna. */
  canal: string | null;
  /** As vigências em que esta planilha tem linha, da mais antiga à mais recente. */
  vigencias: string[];
}

/**
 * Os pares (unidade, canal) que a planilha informada conhece.
 *
 * Existe por uma razão só, e ela é a diferença entre a planilha ser útil e ser
 * invisível: **o canal da planilha não precisa existir no acervo.** Uma unidade
 * que só entregou a série `EMPURRADA` pode ter uma planilha de `ROTA` — a aba
 * de Excel da rota existe antes de o export dela chegar, e é justamente nesse
 * intervalo que digitá-la vale a pena.
 *
 * Sem esta leitura, aquela planilha ficaria gravada e sem tela: a lista de
 * unidades sai de `listContexts`, que só conhece o que foi importado, e o
 * canal de ROTA não apareceria em lugar nenhum. Ver `contextosDoModulo` em
 * `leitura.ts`, que soma as duas fontes.
 */
export async function canaisComPlanilha(db: Database): Promise<CanalComPlanilha[]> {
  const { rows } = await db.execute<{
    scope_hash: string;
    canal: string;
    vigencias: string[];
  }>(sql`
    SELECT p.scope_hash,
           p.canal,
           array_agg(DISTINCT p.effective_date::text ORDER BY p.effective_date::text)
             AS vigencias
      FROM remuneracao_planilha p
     GROUP BY p.scope_hash, p.canal
  `);

  return rows.map((linha) => ({
    scopeHash: linha.scope_hash,
    canal: linha.canal === "" ? null : linha.canal,
    vigencias: linha.vigencias ?? [],
  }));
}

/** A chave com que `lerPlanilhasEmLote` indexa um alvo. */
export function chaveDaPlanilha(
  scopeHash: string,
  canal: string | null,
  effectiveDate: string,
): string {
  return chaveDaCelula(scopeHash, canalGravado(canal), effectiveDate);
}

/**
 * A planilha de uma unidade numa vigência, como a tela de cadastro a edita.
 *
 * Devolve sempre — planilha nunca preenchida é `linhas: []`, e não um erro.
 * Quem cadastra pela primeira vez está exatamente nesse estado, e um 404 ali
 * diria que a unidade não existe.
 */
export async function lerPlanilha(
  db: Database,
  pedido: { scopeHash: string; canal: string | null; effectiveDate: string },
): Promise<PlanilhaDaVigencia> {
  const planilhas = await lerPlanilhasEmLote(db, [pedido]);
  const declarada =
    planilhas.get(chaveDaPlanilha(pedido.scopeHash, pedido.canal, pedido.effectiveDate)) ??
    new Map<string, ValorDeclarado>();

  /*
    A ordem é a do catálogo, que é a da planilha de Excel. Ordenar pelo que o
    banco devolveu daria uma lista cuja ordem muda a cada gravação, e quem
    confere lê esta tela ao lado da aba.
  */
  const linhas: LinhaDaPlanilha[] = LINHAS_DO_CADASTRO.filter((l) => declarada.has(l.chave)).map(
    (l) => ({ chave: l.chave, rotulo: l.rotulo, ...declarada.get(l.chave)! }),
  );

  return {
    ...pedido,
    linhas,
    atualizadaEm:
      linhas.length === 0
        ? null
        : linhas.map((l) => l.informadoEm).sort().at(-1)!,
  };
}

/**
 * Grava a planilha de uma vigência — o que o "Salvar" da tela de cadastro faz.
 *
 * Tudo numa transação: as trinta linhas de uma aba são um ato só. Gravar
 * metade delas deixaria o cadastro num estado que ninguém digitou — um total
 * somando parcelas de duas versões da planilha.
 *
 * O que cada célula sofre está em {@link conferirCelula}, e as recusas dela
 * sobem daqui sem tradução: uma chave fora do catálogo, um percentual em fração
 * ou uma quantidade quebrada param a escrita **inteira**, antes de qualquer
 * `INSERT`. Aceitar as boas e recusar as ruins deixaria a pessoa com uma
 * planilha meio gravada e uma mensagem de erro, sem saber qual metade valeu.
 */
export async function gravarPlanilha(
  db: Database,
  escrita: EscritaDaPlanilha,
): Promise<PlanilhaDaVigencia> {
  if (escrita.celulas.length === 0) throw new PlanilhaVazia();

  /*
    A conferência acontece toda antes da transação, e a última repetição de uma
    chave é a que vale — o mesmo que um formulário faria ao mandar o campo duas
    vezes. Recusar o corpo repetido seria rigor sem ganho: as duas células
    dizem o que a pessoa digitou por último.
  */
  const conferidas = new Map<string, CelulaDaPlanilha>();
  for (const celula of escrita.celulas) {
    const conferida = conferirCelula(celula);
    conferidas.set(conferida.chave, conferida);
  }

  const canal = canalGravado(escrita.canal);
  const apagar = [...conferidas.values()].filter((c) => c.valor === null).map((c) => c.chave);
  const gravar = [...conferidas.values()].filter(
    (c): c is CelulaDaPlanilha & { valor: number } => c.valor !== null,
  );

  await db.transaction(async (tx) => {
    if (apagar.length > 0) {
      await tx
        .delete(remuneracaoPlanilhaTable)
        .where(
          and(
            eq(remuneracaoPlanilhaTable.scopeHash, escrita.scopeHash),
            eq(remuneracaoPlanilhaTable.canal, canal),
            eq(remuneracaoPlanilhaTable.effectiveDate, escrita.effectiveDate),
            inArray(remuneracaoPlanilhaTable.chave, apagar),
          ),
        );
    }

    if (gravar.length > 0) {
      await tx
        .insert(remuneracaoPlanilhaTable)
        .values(
          gravar.map((celula) => ({
            scopeHash: escrita.scopeHash,
            canal,
            effectiveDate: escrita.effectiveDate,
            chave: celula.chave,
            valor: String(celula.valor),
            observacao: celula.observacao,
            autorId: escrita.autor?.id ?? null,
            autorNome: escrita.autor?.nome ?? null,
          })),
        )
        /*
          Reinformar uma linha é reescrevê-la, com o autor e a data de agora: a
          planilha guarda o que vale hoje, e quem responde por ele é quem o
          digitou por último. O histórico de quem mudou o quê é do `book`, e
          duplicar aqui uma segunda linha por edição faria a leitura ter de
          escolher entre duas — que é como nascem duas verdades.
        */
        .onConflictDoUpdate({
          target: [
            remuneracaoPlanilhaTable.scopeHash,
            remuneracaoPlanilhaTable.canal,
            remuneracaoPlanilhaTable.effectiveDate,
            remuneracaoPlanilhaTable.chave,
          ],
          set: {
            valor: sql`excluded.valor`,
            observacao: sql`excluded.observacao`,
            autorId: sql`excluded.autor_id`,
            autorNome: sql`excluded.autor_nome`,
            atualizadaEm: sql`now()`,
          },
        });
    }
  });

  return lerPlanilha(db, {
    scopeHash: escrita.scopeHash,
    canal: escrita.canal,
    effectiveDate: escrita.effectiveDate,
  });
}

/**
 * Copia a planilha de uma vigência para outra, da mesma unidade.
 *
 * Existe porque a alternativa é digitar trinta linhas de novo a cada quinzena,
 * e a maior parte delas não muda — as alíquotas e as parcelas por veículo
 * repetem de um bloco para o outro na própria aba de Excel. O que **não**
 * existe é herança automática: a cópia é um clique, com autor e data de quem
 * clicou, e o que ela produz é a planilha de agosto dizendo o que alguém
 * afirmou sobre agosto. Uma vigência que herdasse a anterior em silêncio faria
 * a planilha de julho responder por agosto sem que ninguém tivesse dito isso —
 * e responderia igual para sempre, inclusive depois de a operação mudar.
 *
 * Não sobrescreve o que a vigência de destino já tem: quem já corrigiu uma
 * linha lá não pode perdê-la para uma cópia feita depois.
 */
export async function copiarPlanilha(
  db: Database,
  pedido: {
    scopeHash: string;
    canal: string | null;
    de: string;
    para: string;
    autor?: { id: string | null; nome: string | null };
  },
): Promise<PlanilhaDaVigencia> {
  const origem = await lerPlanilha(db, {
    scopeHash: pedido.scopeHash,
    canal: pedido.canal,
    effectiveDate: pedido.de,
  });
  const destino = await lerPlanilha(db, {
    scopeHash: pedido.scopeHash,
    canal: pedido.canal,
    effectiveDate: pedido.para,
  });

  const jaTem = new Set(destino.linhas.map((l) => l.chave));
  const novas = origem.linhas.filter((l) => !jaTem.has(l.chave));
  if (novas.length === 0) return destino;

  return gravarPlanilha(db, {
    scopeHash: pedido.scopeHash,
    canal: pedido.canal,
    effectiveDate: pedido.para,
    celulas: novas.map((l) => ({
      chave: l.chave,
      valor: l.valor,
      observacao: l.observacao,
    })),
    ...(pedido.autor ? { autor: pedido.autor } : {}),
  });
}
