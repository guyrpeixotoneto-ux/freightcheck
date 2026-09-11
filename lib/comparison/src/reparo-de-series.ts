import { and, eq, isNull, sql } from "drizzle-orm";
import {
  type Database,
  reparoDeDadosTable,
  ticketImportTable,
} from "@workspace/db";
import {
  derivarSerieDoEnvio,
  processarEnvioDeChamados,
  recalcularSerie,
  type OrigemDaSerie,
} from "./monitoramento-de-chamados";

/**
 * O REPARO DA SÉRIE INDETERMINADA — o backfill que a partida roda uma vez.
 *
 * ---------------------------------------------------------------------------
 * O que ele conserta, e por que não se conserta sozinho
 * ---------------------------------------------------------------------------
 *
 * A série de um envio é a unidade dele, e ela é decidida **uma vez**, quando o
 * arquivo é lido. Isso é proposital — uma partição que mudasse sozinha faria
 * movimentações antigas passarem a pertencer a outra fila sem que nada tivesse
 * acontecido — e tem uma consequência que só aparece depois: melhorar a
 * derivação não alcança nada que já esteja no banco.
 *
 * Foi o que houve, e está medido: `Chamados Agosto Camaçari.xlsx`, 2.349
 * chamados lidos em 04/09/2026, coluna `Unidade` vazia em todas as linhas,
 * série nula. A derivação aprendeu a ler `payload` e a achar a unidade dentro do
 * nome do arquivo; o envio continuou exatamente onde estava. E um acervo em que
 * **nenhum** envio nomeia unidade não recorta: o Monitoramento soma todas as
 * unidades embaixo do nome da que está aberta na lateral, avisando na tira que é
 * isso que está fazendo. Quem tinha PERNAMBUCO aberto via 2.349 chamados de
 * Camaçari.
 *
 * ---------------------------------------------------------------------------
 * As sete garantias, e onde cada uma está escrita
 * ---------------------------------------------------------------------------
 *
 * 1. **Só o indeterminado.** O recorte é `status = 'READ' AND serie IS NULL`, em
 *    SQL, em `enviosIndeterminados`. Não é uma checagem em código que alguém
 *    pode contornar: um envio com série simplesmente não entra na lista.
 *
 * 2. **Série estabelecida nunca é recalculada.** Além do recorte, a decisão de
 *    redecidir é de `processarEnvioDeChamados`, e a trava dele é a mesma:
 *    redecide enquanto a série for nula, e nunca depois. As duas concordam de
 *    propósito — a segunda é a que continua valendo se alguém um dia afrouxar a
 *    primeira.
 *
 * 3. **Nenhum chamado é tocado.** Este módulo não lê arquivo, não apaga e não
 *    reimporta: escreve `ticket_import.serie`/`serie_origem` e recalcula a
 *    camada derivada (`ticket_import_comparacao`, `ticket_movement_*`), que é
 *    derivada justamente para poder ser refeita. `ticket` e `ticket_change`
 *    ficam como estão, byte a byte.
 *
 * 4. **Idempotente, e uma vez só.** Idempotente porque rodar de novo sobre o
 *    mesmo envio dá o mesmo resultado — a derivação é uma função do que está no
 *    banco. Uma vez só porque o nome do reparo vira linha em `reparo_de_dados`:
 *    quem encontra a linha não roda. Ver o cabeçalho daquela tabela para o
 *    porquê de o registro ser necessário mesmo com a idempotência.
 *
 * 5. **Uma instância só, entre várias.** `pg_advisory_xact_lock(REPARO_LOCK)`
 *    na transação que **reivindica** o reparo — a chave seguinte às de
 *    `runMigrations` e da reconvergência. Em autoscale várias instâncias sobem
 *    juntas; a que ganha grava a linha do registro dentro da mesma transação em
 *    que travou, e as outras, ao entrarem, já a encontram e saem sem trabalho.
 *
 *    É `xact_lock` e não `pg_advisory_lock` de sessão de propósito. Um lock de
 *    sessão é preso a **uma conexão**, e aqui quem fala com o banco é um pool:
 *    o `SELECT` que trava e o que destrava podem sair em conexões diferentes, e
 *    aí o `unlock` não solta nada, a conexão volta para o pool com o lock preso
 *    e a partida seguinte espera para sempre. O lock de transação é solto pelo
 *    próprio `COMMIT`, na conexão certa, inclusive quando a transação morre —
 *    não há caminho em que ele vaze. (`migrate.ts` usa o de sessão com
 *    segurança porque abre `pool.connect()` e fala por aquele cliente; este
 *    módulo recebe um `Database` e não tem essa conexão para segurar.)
 *
 * 6. **Transação por importação.** Cada envio é reparado dentro da sua própria
 *    transação: a série e o recálculo das comparações entram juntos ou não
 *    entram. Um envio que falha é desfeito inteiro e contado em `falhas`, e os
 *    outros seguem — o pior desfecho é um envio como estava antes, nunca um
 *    envio meio reparado.
 *
 * 7. **Nenhuma unidade por proximidade.** Quando a derivação não acha unidade
 *    do cadastro, ela cai no texto do nome do arquivo — uma série que separa
 *    este envio dos outros e **não** se vincula a unidade nenhuma. Quando nem
 *    isso há, a série continua nula e o envio é contado em `ignorados`, que é
 *    diferente de `falhas`: continuar indeterminado é a resposta certa para um
 *    arquivo que não diz de onde veio. As recusas que impedem o casamento de
 *    virar palpite estão em `nome-de-unidade.ts`.
 *
 * E a oitava, que é do chamador: **falhar aqui não impede a partida.** Quem
 * chama envolve em `try/catch` e segue — ver `index.ts`, no api-server, junto
 * dos outros dois backfills de partida. Um reparo que não rodou deixa o produto
 * exatamente como estava, e o botão "Recalcular a série" continua no cartão do
 * envio para o caso de exceção.
 */

/**
 * A chave da trava. Fixa e arbitrária, como as outras duas — só precisa ser a
 * mesma em todas as instâncias. `8_675_309` é a da fila e `8_675_310` a da
 * reconvergência (ver `migrate.ts` e `reconvergencia.ts`); esta é a próxima.
 */
const REPARO_LOCK = 8_675_311;

/**
 * O nome versionado deste reparo.
 *
 * O prefixo é o da migration que criou o registro, e não o da que criou a
 * coluna: o que ele versiona é **esta passada**, para que um segundo reparo
 * sobre o mesmo dado possa existir com outro nome sem que este precise mudar.
 */
export const REPARO_DA_SERIE = "0095_serie_indeterminada";

/** O que aconteceu com um envio — uma linha do `detalhe` gravado. */
export interface EnvioReparado {
  ticketImportId: string;
  filename: string;
  /** A série antes. Sempre `null` aqui, e explícita para o registro se ler só. */
  de: string | null;
  para: string | null;
  origem: OrigemDaSerie | null;
  erro?: string;
}

export interface RelatorioDoReparo {
  nome: string;
  /**
   * Rodou agora, ou já havia rodado antes.
   *
   * `false` com `encontrados: 0` é a partida normal de um banco já reparado: a
   * linha existe, nada foi lido, nada foi escrito.
   */
  rodou: boolean;
  encontrados: number;
  corrigidos: number;
  ignorados: number;
  falhas: number;
  envios: EnvioReparado[];
}

/** Os envios lidos cuja série é nula — o recorte inteiro, e nada além. */
async function enviosIndeterminados(
  db: Database,
): Promise<{ id: string; filename: string }[]> {
  return await db
    .select({ id: ticketImportTable.id, filename: ticketImportTable.filename })
    .from(ticketImportTable)
    .where(
      and(eq(ticketImportTable.status, "READ"), isNull(ticketImportTable.serie)),
    )
    .orderBy(ticketImportTable.receivedAt);
}

/**
 * O que o reparo faria, sem escrever nada.
 *
 * Existe para responder **antes** do deploy a pergunta que se faz antes de
 * mexer em dado de produção: quantos envios, quais, e em que cada um viraria.
 * Roda a derivação de verdade — é a mesma função que o reparo chama —, e só não
 * grava: nem a série, nem as comparações, nem a linha do registro.
 *
 * Não pega o lock, porque não escreve. Duas pessoas podem contar ao mesmo tempo.
 */
export async function simularReparoDaSerie(
  db: Database,
): Promise<RelatorioDoReparo> {
  const pendentes = await enviosIndeterminados(db);
  const envios: EnvioReparado[] = [];

  for (const envio of pendentes) {
    try {
      const derivada = await derivarSerieDoEnvio(db, envio.id);
      envios.push({
        ticketImportId: envio.id,
        filename: envio.filename,
        de: null,
        para: derivada.serie,
        origem: derivada.origem,
      });
    } catch (err) {
      envios.push({
        ticketImportId: envio.id,
        filename: envio.filename,
        de: null,
        para: null,
        origem: null,
        erro: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    nome: REPARO_DA_SERIE,
    rodou: false,
    encontrados: envios.length,
    corrigidos: envios.filter((e) => e.erro === undefined && e.para !== null).length,
    ignorados: envios.filter((e) => e.erro === undefined && e.para === null).length,
    falhas: envios.filter((e) => e.erro !== undefined).length,
    envios,
  };
}

/**
 * Reivindicar o reparo — a transação curta que decide quem trabalha.
 *
 * Trava, pergunta e grava a linha do registro **na mesma transação**. É isso, e
 * só isso, que faz a execução ser única: se a pergunta viesse antes da trava,
 * duas instâncias que sobem juntas leriam "não aplicado" antes de qualquer uma
 * escrever, e as duas rodariam — disputando as mesmas linhas de
 * `ticket_import_comparacao` até uma morrer em deadlock, o que transformaria um
 * reparo bem-sucedido numa falha de partida ruidosa.
 *
 * A linha nasce zerada e é atualizada com o saldo quando a passada termina.
 * Reivindicar antes de trabalhar tem um preço nomeado: se o processo morrer no
 * meio da passada, a linha fica dizendo "já rodou" com saldo zero, e o reparo
 * não volta sozinho. A alternativa — gravar só no fim — tem o preço inverso e
 * pior, que é duas instâncias trabalhando em cima uma da outra. O saldo zerado
 * é visível (é o que o log e a tabela mostram), os envios continuam
 * indeterminados e reparáveis, e o botão "Recalcular a série" continua no
 * cartão de cada um.
 */
async function reivindicar(db: Database): Promise<boolean> {
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${REPARO_LOCK})`);
    const [linha] = await tx
      .select({ nome: reparoDeDadosTable.nome })
      .from(reparoDeDadosTable)
      .where(eq(reparoDeDadosTable.nome, REPARO_DA_SERIE));
    if (linha !== undefined) return false;
    await tx.insert(reparoDeDadosTable).values({ nome: REPARO_DA_SERIE });
    return true;
  });
}

/** O relatório de quem chegou depois: a linha já existia, nada foi feito. */
const JA_RODOU: RelatorioDoReparo = {
  nome: REPARO_DA_SERIE,
  rodou: false,
  encontrados: 0,
  corrigidos: 0,
  ignorados: 0,
  falhas: 0,
  envios: [],
};

/**
 * Reparar as séries indeterminadas — uma vez, sob trava, transação por envio.
 *
 * Devolve o relatório e grava o saldo. Não lança por causa de um envio: a falha
 * de um é contida na transação dele e vira `falhas` no relatório. Lança apenas
 * quando o próprio registro é inalcançável — e aí quem chama decide, o que na
 * partida quer dizer "loga e segue".
 */
export async function repararSeriesIndeterminadas(
  db: Database,
): Promise<RelatorioDoReparo> {
  if (!(await reivindicar(db))) return JA_RODOU;

  const pendentes = await enviosIndeterminados(db);
  const envios: EnvioReparado[] = [];

  for (const envio of pendentes) {
    try {
      /*
        A transação é por envio, e não uma só para a passada inteira.

        Uma transação única daria atomicidade total e um preço que não se paga
        num backfill: um envio defeituoso desfaria o reparo de todos os outros,
        e a passada seguinte reencontraria o mesmo defeito. Por envio, o pior
        caso é um envio como estava antes — e ele fica nomeado no `detalhe`, com
        o erro, para alguém olhar.
      */
      const serie = await db.transaction(async (tx) => {
        const executor = tx as unknown as Database;
        const r = await processarEnvioDeChamados(executor, envio.id);
        /*
          A cadeia inteira, e não só este envio: ele entrou numa série, e o
          "anterior" dos que já estavam nela mudou. Sem isto, a régua de dias
          daqueles envios continuaria gravada contra uma base que não é mais a
          deles. `recalcularSerie` é idempotente, e reprocessar este envio
          dentro dela não muda nada.
        */
        if (r.serie !== null) await recalcularSerie(executor, r.serie);
        return r.serie;
      });

      const [gravado] = await db
        .select({ origem: ticketImportTable.serieOrigem })
        .from(ticketImportTable)
        .where(eq(ticketImportTable.id, envio.id));

      envios.push({
        ticketImportId: envio.id,
        filename: envio.filename,
        de: null,
        para: serie,
        origem: (gravado?.origem as OrigemDaSerie | null) ?? null,
      });
    } catch (err) {
      envios.push({
        ticketImportId: envio.id,
        filename: envio.filename,
        de: null,
        para: null,
        origem: null,
        erro: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const relatorio: RelatorioDoReparo = {
    nome: REPARO_DA_SERIE,
    rodou: true,
    encontrados: envios.length,
    corrigidos: envios.filter((e) => e.erro === undefined && e.para !== null).length,
    ignorados: envios.filter((e) => e.erro === undefined && e.para === null).length,
    falhas: envios.filter((e) => e.erro !== undefined).length,
    envios,
  };

  /*
    O saldo entra na linha que a reivindicação já criou — inclusive quando houve
    falhas, e inclusive quando não corrigiu ninguém.

    Não registrar diante de falha faria o reparo reencontrar os mesmos envios em
    toda partida, e o envio que falha aqui é justamente o que tende a falhar de
    novo: seria um laço infinito de trabalho inútil com o mesmo saldo. O que a
    falha exige é **aparecer**, e ela aparece em três lugares — no saldo, no
    `detalhe` com a mensagem, e no log da partida —, com o botão "Recalcular a
    série" no cartão daquele envio para quem quiser tentar à mão.
  */
  await db
    .update(reparoDeDadosTable)
    .set({
      encontrados: relatorio.encontrados,
      corrigidos: relatorio.corrigidos,
      ignorados: relatorio.ignorados,
      falhas: relatorio.falhas,
      detalhe: relatorio.envios,
    })
    .where(eq(reparoDeDadosTable.nome, REPARO_DA_SERIE));

  return relatorio;
}
