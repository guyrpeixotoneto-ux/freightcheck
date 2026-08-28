import {
  conferirCobertura,
  monitorarFluxo,
  registroDeColetores,
  type Coletor,
  type EstadoDaEtapa,
  type FluxoCompleto,
  type Monitoramento,
  type RegistroDeColetores,
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
 * O PAINEL DE OBSERVAÇÃO — o estado do monitoramento de um fluxo, no terminal.
 *
 * Não é a tela. É a ferramenta para olhar de frente o que a arquitetura devolve
 * **antes** de existir tela, e antes de escrever o segundo coletor: uma linha
 * por etapa, com a chave, o coletor que responde por ela (ou a falta dele), o
 * farol, o valor, a idade da leitura, quanto falta para vencer e o motivo de
 * cada apagado.
 *
 * **Ele não decide nada.** Tudo o que imprime sai de `monitorarFluxo` e de
 * `conferirCobertura`, sem uma regra própria — se o painel parecer errado, o
 * erro está no motor ou no coletor, e é lá que se conserta. Foi por isso que o
 * motor não ganhou um campo sequer para deixar esta saída mais bonita.
 *
 * As duas contas ficam separadas no cabeçalho, e a separação é o ponto: um
 * fluxo com uma etapa verde e dezessete sem coletor **não** é um fluxo verde, e
 * nenhuma linha daqui vai dizer que é. Ver `resumoDoFluxo`, em `farol.ts`.
 *
 *     DATABASE_URL=postgresql://… pnpm --filter @workspace/coletores exec tsx src/painel-cli.ts
 */

const LARGURA = 135;

function duracao(segundos: number): string {
  const abs = Math.abs(segundos);
  if (abs < 60) return `${segundos}s`;
  if (abs < 3600) return `${Math.round(segundos / 60)}min`;
  if (abs < 86400) return `${(segundos / 3600).toFixed(1)}h`;
  return `${(segundos / 86400).toFixed(1)}d`;
}

function coluna(texto: string, largura: number): string {
  const limpo = texto ?? "";
  /* O corte deixa lugar para o espaço: colunas coladas viram uma só palavra. */
  const cabe = largura - 1;
  return (limpo.length > cabe ? `${limpo.slice(0, cabe - 1)}…` : limpo).padEnd(
    largura,
    " ",
  );
}

/** A vida que resta à leitura — o que o motor calcula, relido para a tela. */
function vencimento(estado: EstadoDaEtapa): string {
  if (!estado.leitura || estado.idadeEmSegundos === null) return "—";
  const validade = estado.leitura.validadeEmSegundos ?? 3600;
  const resta = validade - estado.idadeEmSegundos;
  return resta >= 0 ? `em ${duracao(resta)}` : `venceu há ${duracao(-resta)}`;
}

/**
 * O motivo, com o detalhe da falha quando existe.
 *
 * `EstadoDaEtapa.motivo` diz `coletor_falhou`; **qual** falha foi — erro do
 * coletor ou tempo esgotado — mora em `Monitoramento.falhas`, porque é do
 * coletor e não da etapa. O painel junta os dois na hora de imprimir, e essa
 * junção é de apresentação: nenhum campo novo foi pedido ao motor para isso.
 */
function motivo(estado: EstadoDaEtapa, resultado: Monitoramento): string {
  if (estado.motivo === null) return "—";
  if (estado.motivo !== "coletor_falhou") return estado.motivo;
  const falha = resultado.falhas.find(
    (f) => estado.chave && f.chaves.includes(estado.chave),
  );
  return falha ? `coletor_falhou / ${falha.motivo}` : "coletor_falhou";
}

export function painel(
  completo: FluxoCompleto,
  registro: RegistroDeColetores,
  resultado: Monitoramento,
): string {
  const cobertura = conferirCobertura(completo, registro);
  const { resumo } = resultado;
  const linhas: string[] = [];
  const regra = "─".repeat(LARGURA);

  linhas.push("═".repeat(LARGURA));
  linhas.push(
    `FLUXO   ${completo.fluxo.nome}  ·  ${completo.etapas.length} etapas`,
  );
  linhas.push(`APURADO ${resultado.apuradoEm}`);
  linhas.push("═".repeat(LARGURA));
  linhas.push(
    `Monitoramento: ${resumo.medidas}/${resumo.etapas} etapas com leitura`,
  );
  linhas.push(
    `Cobertura:     ${cobertura.etapasCobertas}/${cobertura.etapas} etapas com coletor registrado` +
      `  ·  ${cobertura.etapasComChave} com chave  ·  ${cobertura.semColetor.length} chaves sem coletor`,
  );
  linhas.push(
    `Faróis:        VERDE ${resumo.porFarol.VERDE}  ·  AMARELO ${resumo.porFarol.AMARELO}` +
      `  ·  VERMELHO ${resumo.porFarol.VERMELHO}  ·  SEM_DADO ${resumo.porFarol.SEM_DADO}`,
  );
  /*
    Nunca "fluxo verde". O pior aceso é uma conta sobre as etapas medidas, e o
    número de etapas sem dado vem grudado nele, na mesma linha, porque é a
    ressalva sem a qual a primeira metade da frase engana.
  */
  linhas.push(
    resumo.pior === null
      ? `Pior aceso:    — (nenhuma etapa medida; ${resumo.semDado} sem dado)`
      : `Pior aceso:    ${resumo.pior} sobre ${resumo.medidas} etapa(s) medida(s)` +
          `  ·  ${resumo.semDado} etapa(s) sem dado, fora desta conta`,
  );
  if (resultado.falhas.length) {
    for (const falha of resultado.falhas) {
      linhas.push(
        `Falha:         ${falha.coletor} — ${falha.motivo}: ${falha.mensagem}`,
      );
    }
  }
  linhas.push(regra);
  linhas.push(
    coluna("#", 4) +
      coluna("ETAPA", 29) +
      coluna("CHAVE", 26) +
      coluna("COLETOR", 25) +
      coluna("FAROL", 10) +
      coluna("VALOR", 8) +
      coluna("IDADE", 7) +
      coluna("MOTIVO", 33),
  );
  linhas.push(regra);

  const donoDaChave = new Map(
    cobertura.chaves.map((c) => [c.chave, c.coletor]),
  );
  for (const [i, estado] of resultado.etapas.entries()) {
    const leitura = estado.leitura;
    const dono = estado.chave ? (donoDaChave.get(estado.chave) ?? null) : null;
    linhas.push(
      coluna(String(i + 1), 4) +
        coluna(estado.etapaNome, 29) +
        coluna(estado.chave ?? "— sem chave —", 26) +
        coluna(dono ?? "—", 25) +
        coluna(estado.farol, 10) +
        coluna(
          leitura?.valor != null
            ? `${leitura.valor}${leitura.unidade ?? ""}`
            : "—",
          8,
        ) +
        coluna(
          estado.idadeEmSegundos !== null
            ? duracao(estado.idadeEmSegundos)
            : "—",
          7,
        ) +
        coluna(motivo(estado, resultado), 33),
    );
  }
  linhas.push(regra);

  /* O detalhe só de quem tem leitura — inclusive a preservada de quem venceu. */
  const comLeitura = resultado.etapas.filter((e) => e.leitura !== null);
  if (comLeitura.length === 0) {
    linhas.push("Nenhuma leitura publicada nesta apuração.");
  }
  for (const estado of comLeitura) {
    const l = estado.leitura!;
    linhas.push("");
    linhas.push(`▸ ${estado.etapaNome}  [${estado.chave}]`);
    linhas.push(
      `    farol         ${estado.farol}` +
        (estado.vencida ? `   (última leitura preservada: ${l.farol})` : ""),
    );
    linhas.push(
      `    valor         ${l.valor != null ? `${l.valor} ${l.unidade ?? ""}`.trim() : "—"}`,
    );
    linhas.push(`    texto         ${l.texto ?? "—"}`);
    linhas.push(`    medidoEm      ${l.medidoEm}`);
    linhas.push(
      `    idade         ${estado.idadeEmSegundos !== null ? duracao(estado.idadeEmSegundos) : "—"}`,
    );
    linhas.push(
      `    validade      ${l.validadeEmSegundos != null ? duracao(l.validadeEmSegundos) : "padrão do motor (1h)"}`,
    );
    linhas.push(`    vence         ${vencimento(estado)}`);
  }

  /* As não monitoradas, agrupadas pelo motivo — a lista de trabalho que falta. */
  const semChave = resultado.etapas.filter((e) => e.motivo === "sem_chave");
  const semColetor = resultado.etapas.filter((e) => e.motivo === "sem_coletor");
  const semResposta = resultado.etapas.filter(
    (e) => e.motivo === "sem_resposta",
  );
  linhas.push("");
  linhas.push(
    `NÃO MONITORADAS: ${semColetor.length} sem coletor  ·  ${semResposta.length} sem resposta do coletor  ·  ${semChave.length} sem chave`,
  );
  if (semColetor.length) {
    linhas.push(
      `  sem coletor:   ${semColetor.map((e) => e.chave).join(", ")}`,
    );
  }
  if (semResposta.length) {
    linhas.push(
      `  sem resposta:  ${semResposta.map((e) => e.chave).join(", ")}`,
    );
  }
  return linhas.join("\n");
}

async function main(): Promise<void> {
  const banco = await abrirBancoDeProva("painel");
  try {
    const { db } = banco;
    const empresa = await criarEmpresa(
      db,
      "Horizonte Logística",
      "11111111000191",
    );
    const completo = await cadastrarFluxoDoCte(db, empresa);
    const registro = registroDeColetores(coletorDeAutorizacaoSefaz(db));

    await gravarExtrato(db, {
      empresaId: empresa,
      chave: "2026-08-Q1",
      inicio: "2026-08-01",
      enviadoEm: new Date("2026-08-16T09:00:00Z"),
      controles: [CHAVE_DE_ACESSO, CHAVE_DE_ACESSO, CHAVE_DE_ACESSO],
    });

    const cenario = async (
      titulo: string,
      apurar: () => Promise<Monitoramento>,
      registroDoCenario: RegistroDeColetores = registro,
      fluxoDoCenario: FluxoCompleto = completo,
    ) => {
      console.log("");
      console.log(`### ${titulo}`);
      console.log(painel(fluxoDoCenario, registroDoCenario, await apurar()));
    };

    /*
      O primeiro cenário é o registro **vazio**: nenhum coletor ligado, que é o
      estado em que todo fluxo nasce. Serve para ver a função sem nenhum dado no
      meio — o motor lê as chaves que o desenho declara, não encontra quem
      responda por elas, e apaga as dezoito com motivo. Nenhuma vira verde, e o
      resumo se recusa a ter um "pior".
    */
    const semColetorNenhum = registroDeColetores();
    await cenario(
      "0. SEM COLETOR NENHUM — o estado em que todo fluxo nasce",
      () =>
        monitorarFluxo(semColetorNenhum, empresa, completo, {
          agora: new Date("2026-08-17T09:00:00Z"),
        }),
      semColetorNenhum,
    );

    await cenario("1. LEITURA VÁLIDA — um dia depois do envio do extrato", () =>
      monitorarFluxo(registro, empresa, completo, {
        agora: new Date("2026-08-17T09:00:00Z"),
      }),
    );

    await cenario(
      "2. LEITURA VENCIDA — dezoito dias depois, sem extrato novo",
      () =>
        monitorarFluxo(registro, empresa, completo, {
          agora: new Date("2026-09-03T09:00:00Z"),
        }),
    );

    const quebrado: Coletor = {
      nome: "extrato-fiscal-03.08.15",
      prefixos: [CHAVE],
      ler: async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
      },
    };
    const registroQuebrado = registroDeColetores(quebrado);
    await cenario(
      "3. COLETOR FALHA",
      () =>
        monitorarFluxo(registroQuebrado, empresa, completo, {
          agora: new Date("2026-08-17T09:00:00Z"),
        }),
      registroQuebrado,
    );

    const real = coletorDeAutorizacaoSefaz(db);
    const lento: Coletor = {
      ...real,
      ler: async (pedido) => {
        await new Promise((r) => setTimeout(r, 200));
        return real.ler(pedido);
      },
    };
    const registroLento = registroDeColetores(lento);
    await cenario(
      "4. TEMPO ESGOTADO — limite de 20ms sobre uma consulta de 200ms",
      () =>
        monitorarFluxo(registroLento, empresa, completo, {
          agora: new Date("2026-08-17T09:00:00Z"),
          tempoLimiteEmMs: 20,
        }),
      registroLento,
    );

    const outra = await criarEmpresa(
      db,
      "Transportes Sem Extrato",
      "22222222000172",
    );
    const fluxoDaOutra = await cadastrarFluxoDoCte(db, outra);
    await cenario(
      "5. OUTRA EMPRESA — o mesmo registro, e nenhum extrato dela",
      () =>
        monitorarFluxo(registro, outra, fluxoDaOutra, {
          agora: new Date("2026-08-17T09:00:00Z"),
        }),
      registro,
      fluxoDaOutra,
    );

    /*
      A repetição, com o relógio andando e o banco parado: a idade cresce, a
      leitura é a mesma, e nada de novo aparece. É o que se espera de uma
      apuração que não guarda estado — cada chamada é uma fotografia.
    */
    console.log("");
    console.log(
      "### 7. DUAS APURAÇÕES SEGUIDAS — a idade anda, a leitura não muda",
    );
    const primeira = await monitorarFluxo(registro, empresa, completo, {
      agora: new Date("2026-08-17T09:00:00Z"),
    });
    const segunda = await monitorarFluxo(registro, empresa, completo, {
      agora: new Date("2026-08-17T15:00:00Z"),
    });
    const daPrimeira = primeira.etapas.find((e) => e.chave === CHAVE)!;
    const daSegunda = segunda.etapas.find((e) => e.chave === CHAVE)!;
    console.log(
      [
        `apuradoEm       ${primeira.apuradoEm}  →  ${segunda.apuradoEm}`,
        `farol           ${daPrimeira.farol}  →  ${daSegunda.farol}`,
        `medidoEm        ${daPrimeira.leitura?.medidoEm}  →  ${daSegunda.leitura?.medidoEm}`,
        `idade           ${duracao(daPrimeira.idadeEmSegundos!)}  →  ${duracao(daSegunda.idadeEmSegundos!)}`,
        `vence           ${vencimento(daPrimeira)}  →  ${vencimento(daSegunda)}`,
        `resumo          ${JSON.stringify(primeira.resumo.porFarol)}  →  ${JSON.stringify(segunda.resumo.porFarol)}`,
        `leitura idêntica  ${JSON.stringify(daPrimeira.leitura) === JSON.stringify(daSegunda.leitura)}`,
      ].join("\n"),
    );
  } finally {
    await banco.fechar();
  }
}

await main();
