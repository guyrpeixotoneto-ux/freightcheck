import {
  MIGRATIONS_FOLDER,
  readMigrations,
  runMigrations,
  type MigrationReport,
  type RunOptions,
} from "./migrate";
import {
  reconvergirRegistradas,
  type RelatorioDeReconvergencia,
} from "./reconvergencia";

/**
 * A fila com o reparo do próprio chão — a porta que a partida e o operador
 * usam, para que os dois não tenham como discordar sobre quando reparar.
 *
 * ---------------------------------------------------------------------------
 * Por que existe
 * ---------------------------------------------------------------------------
 * Toda migration assume o que as anteriores criaram. É uma suposição legítima
 * — e ela deixou de valer no dia em que algo de fora da fila passou a remover
 * objeto de migration já registrada (o Provision do Publishing; ver
 * `./reconvergencia`). A partir daí, a fila pode parar num erro que não é
 * sobre a migration que falhou: a `0049` morreu com 42P01 sobre
 * `remuneracao_unidade`, que é da `0048`, que consta aplicada.
 *
 * O reparo é **reativo de propósito**. Num banco íntegro nada aqui roda: a
 * primeira passada não falha e a função devolve o relatório dela, sem uma
 * consulta a mais. Só depois de a fila parar é que se pergunta se o chão está
 * inteiro — e é a falha que dá a licença para perguntar.
 *
 * ---------------------------------------------------------------------------
 * O que ela **não** faz
 * ---------------------------------------------------------------------------
 * Não repete a fila em laço: uma segunda passada, e só. O reparo repõe de uma
 * vez tudo o que as registradas criam e o banco não tem, então uma segunda
 * falha no mesmo ponto é outra história — e vai para o relatório em vez de
 * virar tentativa.
 *
 * Não decide pelo SQLSTATE. Um erro de duplicata e um de tabela ausente
 * chegariam aqui iguais, e a diferença que importa não está no código do erro:
 * está em faltar, ou não, objeto de migration registrada. Quando não falta, o
 * reparo aplica zero comandos e a segunda passada nem acontece.
 *
 * Não devolve dado. O que volta é estrutura; as linhas que a tabela tinha
 * quando foi derrubada não voltam por aqui nem por lugar nenhum — por isso
 * `reparo` sai no desfecho, para o chamador poder gritar.
 */
export interface DesfechoDaFila {
  /** O relatório da fila — o da segunda passada, quando houve reparo. */
  report: MigrationReport;
  /**
   * O que foi reposto para a fila poder andar.
   *
   * Presente **só** quando a fila parou e o reparo rodou. Estrutura reposta é
   * o rastro de uma mutilação: significa que algo fora da fila derrubou objeto
   * de migration registrada, e que o conteúdo dele se perdeu junto.
   */
  reparo?: RelatorioDeReconvergencia;
}

export async function migrarComReparo(
  connectionString: string,
  migrationsFolder: string = MIGRATIONS_FOLDER,
  options: RunOptions = {},
): Promise<DesfechoDaFila> {
  const primeira = await runMigrations(
    connectionString,
    migrationsFolder,
    options,
  );
  if (!primeira.failure) return { report: primeira };

  const desfecho = await reconvergirRegistradas(
    connectionString,
    readMigrations(migrationsFolder),
  );
  if (!desfecho.rodou) return { report: primeira };

  /*
    Reparo que não repôs nada não destrava coisa alguma: repetir a fila daria o
    mesmo erro, e a segunda passada só faria o log contar duas vezes a mesma
    falha. O relatório vai junto mesmo assim — `semComando` e `falhas` são
    notícia, e some-las seria esconder o que o reparo não conseguiu.
  */
  if (desfecho.relatorio.aplicados.length === 0) {
    return { report: primeira, reparo: desfecho.relatorio };
  }

  return {
    report: await runMigrations(connectionString, migrationsFolder, options),
    reparo: desfecho.relatorio,
  };
}
