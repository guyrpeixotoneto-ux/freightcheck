import { db, encerrarPoolDoProcesso } from "@workspace/db";

import {
  conciliarIdentidadeDoCadastro,
  type ConciliacaoDoCadastro,
} from "../lib/identidade-do-cadastro";

/**
 * O BACKFILL DA IDENTIDADE DO CADASTRO — explícito, e repetível.
 *
 * **Por que um comando, e não a partida do servidor.** O passivo é finito e o
 * conserto dele é um ato de operação, com hora marcada e resultado lido por
 * alguém: rodando na partida, ele aconteceria em toda reinicialização, sem
 * ninguém olhando, e o relatório morreria no log de deployment. Um comando é
 * decidido, é conferível antes de escrever, e pode ser repetido quando um lote
 * novo de cadastro antigo aparecer.
 *
 * **Por que não uma migration com a regra em SQL.** Seria uma segunda versão da
 * mesma regra — a que escreve a identidade e a que a lê (`resolverUnidade`)
 * precisam ser a mesma, e é assim que elas divergem. Este comando chama
 * exatamente a função que as rotas chamam, com os mesmos critérios.
 *
 * **Simula por padrão.** Escrever é o que exige o `--aplicar`. Um comando de
 * correção que escreve por omissão é o tipo de coisa que entra num script de
 * deploy sem ninguém ter lido o que ele faria.
 *
 *     pnpm --filter @workspace/api-server run conciliar-cadastro
 *     pnpm --filter @workspace/api-server run conciliar-cadastro -- --aplicar
 *
 * Sai com código 0 quando concluiu — inclusive sem nada a fazer, que é o estado
 * normal depois da primeira passada. Sai 1 quando o banco não respondeu.
 */

const APLICAR = process.argv.includes("--aplicar");

function relatar(r: ConciliacaoDoCadastro): void {
  const encontrados = r.associadas.length + r.ambiguas.length + r.semSinal.length;

  console.log("");
  console.log(APLICAR ? "CONCILIAÇÃO — aplicada" : "CONCILIAÇÃO — simulação (nada foi escrito)");
  console.log("");
  console.log(`  cadastros sem identidade encontrados : ${encontrados}`);
  console.log(
    `  ${APLICAR ? "conciliados                         " : "seriam conciliados                  "}: ${r.associadas.length}`,
  );
  console.log(`  ambíguos (nenhum foi escolhido)      : ${r.ambiguas.length}`);
  console.log(`  sem sinal determinístico             : ${r.semSinal.length}`);

  if (r.associadas.length > 0) {
    console.log("");
    console.log(APLICAR ? "  Conciliados:" : "  Seriam conciliados:");
    for (const a of r.associadas) {
      console.log(
        `    ${a.nome} [${a.canal ?? "sem canal"}] · código ${a.codigo} → ${a.unidade.nome} (${a.unidade.cnpj}) · por ${a.como}`,
      );
    }
  }

  /*
    O ambíguo é o único que pede alguém: os dois sinais determinísticos apontam
    para unidades diferentes, e escolher um deles poria o contrato de uma
    unidade a responder pelo fechamento de outra.
  */
  if (r.ambiguas.length > 0) {
    console.log("");
    console.log("  Ambíguos — precisam de decisão humana:");
    for (const a of r.ambiguas) {
      const candidatas = a.candidatas.map((c) => `${c.nome} (${c.cnpj})`).join(" ou ");
      const porque =
        a.motivo === "SINAIS_DISCORDANTES"
          ? "a grafia afirmada e o CNPJ do código apontam para unidades diferentes"
          : "mais de um cadastro reivindica esta unidade — escrever os dois faria o " +
            "contrato dela parar de responder (UNIDADE_AMBIGUA)";
      console.log(`    ${a.nome} [${a.canal ?? "sem canal"}] · código ${a.codigo} → ${candidatas}`);
      console.log(`      ${porque}`);
    }
  }

  /*
    O sem sinal não é pendência: é o cadastro registrado pelo nome, sem CNPJ e
    sem ninguém ter afirmado a grafia. Ele é listado para que o relatório não se
    leia como "cobri tudo" tendo deixado estes de fora — e o gesto que os
    resolve é associar a competência ou informar o código, não este comando.
  */
  if (r.semSinal.length > 0) {
    console.log("");
    console.log("  Sem sinal determinístico — este comando não os alcança:");
    for (const a of r.semSinal) {
      console.log(`    ${a.nome} [${a.canal ?? "sem canal"}] · código ${a.codigo}`);
    }
  }

  console.log("");
  if (!APLICAR && r.associadas.length > 0) {
    console.log("  Para escrever: repita com --aplicar.");
    console.log("");
  }
}

async function main(): Promise<void> {
  const relatorio = await conciliarIdentidadeDoCadastro(db, undefined, {
    simular: !APLICAR,
  });
  relatar(relatorio);
}

main()
  .then(() => encerrarPoolDoProcesso())
  .then(() => process.exit(0))
  .catch(async (err: unknown) => {
    console.error("");
    console.error("A conciliação não pôde ser feita:");
    console.error(err instanceof Error ? err.message : String(err));
    console.error("");
    await encerrarPoolDoProcesso().catch(() => {});
    process.exit(1);
  });
