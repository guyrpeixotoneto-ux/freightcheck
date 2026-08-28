import {
  monitorarFluxo,
  registroDeColetores,
  type Coletor,
  type Monitoramento,
} from "@workspace/fluxos";
import { CHAVE, coletorDeAutorizacaoSefaz } from "./cte-autorizacao-sefaz";
import {
  abrirBancoDeProva,
  cadastrarFluxoDoCte,
  criarEmpresa,
  gravarExtrato,
  CHAVE_DE_ACESSO,
} from "./banco-de-prova";

/**
 * A PROVA DO PRIMEIRO COLETOR — a `Leitura` e o `EstadoDaEtapa` crus.
 *
 * Ela imprime o objeto que o motor devolve, campo a campo, sem formatação
 * nenhuma: é a evidência de que a régua de cores do coletor está onde os
 * comentários dizem que está. Quem quer **ler** o estado do fluxo inteiro usa
 * `painel-cli.ts`, que desenha a mesma apuração como tabela.
 *
 *     DATABASE_URL=postgresql://… pnpm --filter @workspace/coletores exec tsx src/prova-cli.ts
 */

async function main(): Promise<void> {
  const banco = await abrirBancoDeProva("prova_coletor");
  try {
    const { db } = banco;
    const empresa = await criarEmpresa(
      db,
      "Horizonte Logística",
      "11111111000191",
    );
    const completo = await cadastrarFluxoDoCte(db, empresa);
    const etapa = completo.etapas.find((e) => e.chaveMonitoramento === CHAVE);
    if (!etapa) throw new Error("o fluxo não tem a etapa da SEFAZ");

    console.log("═".repeat(78));
    console.log("1. A ETAPA");
    console.log("═".repeat(78));
    console.log(
      `fluxo   ${completo.fluxo.nome} (${completo.etapas.length} etapas)`,
    );
    console.log(
      `etapa   ${etapa.ordem}. ${etapa.nome} — ${etapa.tipo}, ${etapa.area}`,
    );
    console.log(`chave   ${etapa.chaveMonitoramento}`);
    console.log(`id      ${etapa.id}`);

    const registro = registroDeColetores(coletorDeAutorizacaoSefaz(db));

    const mostrar = async (
      titulo: string,
      apurar: () => Promise<Monitoramento>,
    ) => {
      const resultado = await apurar();
      /* Pela chave, e não pelo id: no cenário do isolamento o fluxo é o da
         outra empresa, e o id da etapa é outro. */
      const alvo = resultado.etapas.find((e) => e.chave === CHAVE)!;
      console.log("");
      console.log("═".repeat(78));
      console.log(titulo);
      console.log("═".repeat(78));
      console.log(
        "Leitura      ",
        recuar(JSON.stringify(alvo.leitura, null, 2)),
      );
      console.log(
        "EstadoDaEtapa",
        recuar(
          JSON.stringify(
            {
              etapaNome: alvo.etapaNome,
              chave: alvo.chave,
              farol: alvo.farol,
              motivo: alvo.motivo,
              vencida: alvo.vencida,
              idadeEmSegundos: alvo.idadeEmSegundos,
            },
            null,
            2,
          ),
        ),
      );
      console.log("Resumo       ", JSON.stringify(resultado.resumo));
      if (resultado.falhas.length)
        console.log("Falhas       ", JSON.stringify(resultado.falhas));
    };

    await gravarExtrato(db, {
      empresaId: empresa,
      chave: "2026-08-Q1",
      inicio: "2026-08-01",
      enviadoEm: new Date("2026-08-16T09:00:00Z"),
      controles: [CHAVE_DE_ACESSO, CHAVE_DE_ACESSO, CHAVE_DE_ACESSO],
    });

    await mostrar(
      "2. LEITURA VÁLIDA — extrato íntegro, um dia depois do envio",
      () =>
        monitorarFluxo(registro, empresa, completo, {
          agora: new Date("2026-08-17T09:00:00Z"),
        }),
    );

    await gravarExtrato(db, {
      empresaId: empresa,
      chave: "2026-08-Q2",
      inicio: "2026-08-16",
      enviadoEm: new Date("2026-08-31T09:00:00Z"),
      controles: [CHAVE_DE_ACESSO, null, "123", CHAVE_DE_ACESSO],
    });

    await mostrar("3. AMARELO — dois documentos sem chave de acesso", () =>
      monitorarFluxo(registro, empresa, completo, {
        agora: new Date("2026-09-01T09:00:00Z"),
      }),
    );

    await mostrar("4. VENCIDA — dezoito dias depois, sem extrato novo", () =>
      monitorarFluxo(registro, empresa, completo, {
        agora: new Date("2026-09-18T09:00:00Z"),
      }),
    );

    const outra = await criarEmpresa(
      db,
      "Transportes Sem Extrato",
      "22222222000172",
    );
    const fluxoDaOutra = await cadastrarFluxoDoCte(db, outra);
    await mostrar(
      "5. ISOLAMENTO — outra empresa, o mesmo registro, nenhum extrato dela",
      () =>
        monitorarFluxo(registro, outra, fluxoDaOutra, {
          agora: new Date("2026-08-17T09:00:00Z"),
        }),
    );

    const quebrado: Coletor = {
      nome: "extrato-fiscal-03.08.15",
      prefixos: [CHAVE],
      ler: async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
      },
    };
    await mostrar(
      "6. FALHA — o coletor quebrado apaga o farol e se identifica",
      () =>
        monitorarFluxo(registroDeColetores(quebrado), empresa, completo, {
          agora: new Date("2026-08-17T09:00:00Z"),
        }),
    );

    await mostrar(
      "7. TEMPO ESGOTADO — a consulta lenta não trava a tela",
      () => {
        const real = coletorDeAutorizacaoSefaz(db);
        const lento: Coletor = {
          ...real,
          ler: async (pedido) => {
            await new Promise((r) => setTimeout(r, 200));
            return real.ler(pedido);
          },
        };
        return monitorarFluxo(registroDeColetores(lento), empresa, completo, {
          agora: new Date("2026-08-17T09:00:00Z"),
          tempoLimiteEmMs: 20,
        });
      },
    );
  } finally {
    await banco.fechar();
  }
}

function recuar(json: string): string {
  return json.replace(/\n/g, "\n              ");
}

await main();
