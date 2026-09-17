/**
 * A PROVA DA PESQUISA REAL — o comando que mostra que a busca saiu para a
 * internet, e não de uma fixture.
 *
 * A suíte prova a cadeia inteira contra páginas escritas à mão, e ela não
 * substitui esta prova: uma fixture não abre conexão, não gasta token e não
 * carimba data. Este comando faz a pesquisa de verdade, com um item do acervo,
 * e imprime tudo o que a torna conferível — a consulta, o modelo que respondeu,
 * as páginas abertas com URL e hora, cada oferta aceita e cada uma recusada com
 * o motivo, a derivação do preço-alvo, a confiança fator a fator, e o que
 * custou.
 *
 * **Ele recusa passar por prova quando não foi uma.** No fim, três asserções:
 * o buscador tem de ser o de rede (não `fixture`, não `indisponivel`), a
 * medição tem de trazer o modelo que respondeu, e tem de haver token gasto.
 * Falhando qualquer uma, o comando sai com código 1 dizendo qual — é o que
 * impede alguém (inclusive um agente com pressa) de apresentar uma execução
 * degradada como aceite.
 *
 * **A chave nunca é impressa.** O relatório diz se ela existe e quantos
 * caracteres tem, que é o suficiente para diagnosticar "não configurada" e
 * "configurada vazia" sem expor nada.
 *
 *   pnpm --filter @workspace/compras exec tsx src/cli/prova-do-mercado.ts
 *   ... --item pneu --descricao "Pneu 295/80 R22.5" --quantidade 40 --regiao Camaçari
 */

import {
  buscasPorPesquisa,
  localDoUsuario,
  buscaDisponivel,
  buscaIndisponivel,
  buscaPorModelo,
  pesquisarMercado,
  temFaixa,
  temFiltragemDinamica,
  type OfertaAnalisada,
  type PesquisaDeMercado,
} from "../mercado";

/** O mesmo teto de `busca-por-modelo.ts`, só para o batimento saber o que dizer. */
const TETO_MS = (() => {
  const bruto = Number(process.env["COMPRAS_BUSCA_TIMEOUT_MS"]);
  return Number.isFinite(bruto) && bruto > 0 ? bruto : 300_000;
})();

const MODELO =
  process.env.COMPRAS_MODELO_BUSCA?.trim() ||
  process.env.COMPRAS_MODELO?.trim() ||
  "claude-opus-5";

/** Preço em reais, para o relatório. Nulo vira travessão, nunca zero. */
const brl = (v: number | null | undefined): string =>
  v === null || v === undefined
    ? "—"
    : new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(v);

const pct = (v: number | null | undefined): string =>
  v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`;

function argumento(nome: string, padrao: string | null): string | null {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : padrao;
}

/**
 * A execução anterior, medida — não estimada.
 *
 * Números da primeira pesquisa real deste agente, em 17/09/2026, com quatro
 * buscas por consulta: pneu 295/80 R22.5, 40 unidades, Camaçari/BA. Ficam aqui
 * por extenso porque a comparação precisa de um ponto fixo e auditável; um
 * arquivo de estado se perde entre ambientes, e um número lembrado de cabeça
 * não é medição.
 *
 * Quando o corte de buscas for aprovado, esta constante passa a ser a linha de
 * base nova — e a troca é uma decisão registrada em commit, não um efeito
 * colateral de rodar o comando.
 */
const ANTERIOR = {
  quando: "2026-09-17, com 4 buscas por consulta",
  custoUsd: 2.1995,
  tokensEntrada: 378_733,
  tokensSaida: 12_235,
  latenciaMs: 269_626,
  paginas: 4,
  buscas: 4,
  fetches: 6,
  aceitas: 17,
  exatas: 16,
  compativeis: 1,
  dominios: 2,
  menor: 1709.9,
  maior: 2839.46,
  mediana: 2129.9,
  alvoPiso: 1709.9,
  alvoTeto: 2129.9,
  confianca: "MEDIA",
  pontos: 70,
};

/** O custo em tokens, pela tabela do Opus 5. Busca de servidor é cobrada à parte. */
function custoEmTokens(entrada: number, saida: number): number {
  return (entrada / 1e6) * 5 + (saida / 1e6) * 25;
}

function delta(agora: number, antes: number, casas = 0): string {
  if (antes === 0) return agora === 0 ? "=" : "novo";
  const variacao = ((agora - antes) / antes) * 100;
  const sinal = variacao > 0 ? "+" : "";
  return `${sinal}${variacao.toFixed(casas)}%`;
}

function titulo(texto: string): void {
  console.log(`\n${"─".repeat(78)}\n${texto}\n${"─".repeat(78)}`);
}

/**
 * A presença da credencial, sem o valor.
 *
 * O comprimento entra porque ele separa dois estados que a mesma mensagem
 * esconderia: variável ausente e variável definida como string vazia — o
 * segundo é o erro de configuração mais comum, e o mais difícil de enxergar.
 */
function relatarCredencial(): void {
  titulo("1. CREDENCIAL (presença, nunca o valor)");
  for (const nome of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) {
    const valor = process.env[nome];
    console.log(
      valor === undefined
        ? `   ${nome}: ausente`
        : valor.trim() === ""
          ? `   ${nome}: DEFINIDA MAS VAZIA — é o mesmo que ausente para o SDK`
          : `   ${nome}: presente (${valor.length} caracteres, valor não exibido)`,
    );
  }
  console.log(`   Busca habilitada: ${buscaDisponivel() ? "sim" : "não"}`);
}

function relatarModelo(): void {
  titulo("2. MODELO E FERRAMENTAS DE SERVIDOR");
  const moderno = temFiltragemDinamica(MODELO);
  console.log(`   Modelo configurado: ${MODELO}`);
  console.log(
    `   Variantes: ${
      moderno
        ? "web_search_20260209 + web_fetch_20260209 (filtragem dinâmica)"
        : "web_search_20250305 + web_fetch_20250910 (básicas)"
    }`,
  );
  console.log(`   Cabeçalho beta: nenhum — as duas ferramentas são GA`);
  console.log(
    `   Teto de tempo : ${Math.round(TETO_MS / 1000)}s (COMPRAS_BUSCA_TIMEOUT_MS)`,
  );
  console.log(
    `   Buscas        : ${buscasPorPesquisa()} por pesquisa (COMPRAS_BUSCAS_POR_PESQUISA)`,
  );
  const local = localDoUsuario(argumento("regiao", "Camaçari/BA"));
  console.log(
    `   Âncora geo    : ${[local.city, local.region, local.country].filter(Boolean).join(" / ")}` +
      ` — sem ela a busca abriu a eBay americana para um pedido em Camaçari`,
  );
}

function relatarOferta(o: OfertaAnalisada, i: number): void {
  const p = o.oferta.proveniencia;
  const selo = o.entrouNaConta ? "ACEITA " : "RECUSADA";
  console.log(
    `\n   [${i + 1}] ${selo} · ${o.match.classe} · ${o.frescor}` +
      (o.fonteDuvidosa ? " · ⚠ FONTE TENTOU INSTRUIR O AGENTE" : ""),
  );
  console.log(
    `       Fornecedor : ${o.oferta.fornecedor ?? "(não declarado)"}`,
  );
  console.log(`       Produto    : ${o.oferta.produto ?? "(não declarado)"}`);
  console.log(
    `       Anunciado  : ${brl(o.oferta.preco)} ${o.oferta.unidadeDoPreco.toLowerCase()}`,
  );
  console.log(
    `       Comparável : ${brl(o.custo.custoTotal)} /un — ${o.custo.conta}`,
  );
  console.log(`       Fonte      : ${p.url}`);
  console.log(
    `       Capturado  : ${p.capturadoEm}${p.idadeDaPagina ? ` (página declara ${p.idadeDaPagina})` : ""}`,
  );
  console.log(`       Match      : ${o.match.porque}`);
  if (!o.entrouNaConta) console.log(`       Fora porque: ${o.foraPorque}`);
}

function relatarPesquisa(r: PesquisaDeMercado): void {
  titulo("3. CONSULTA EXECUTADA");
  console.log(`   Item        : ${r.especificacao.titulo}`);
  console.log(
    `   Atributos   : ${
      r.especificacao.atributos
        .map((a) => `${a.tipo}=${a.canonico}`)
        .join(", ") || "(nenhum)"
    }`,
  );
  console.log(
    `   Quantidade  : ${r.especificacao.quantidade ?? "(não informada)"}`,
  );
  console.log(
    `   Região      : ${r.especificacao.regiao ?? "(não informada)"}`,
  );
  console.log(`   Consulta    : ${r.especificacao.consulta}`);
  console.log(`   Buscador    : ${r.buscador}`);

  titulo("4. PÁGINAS ABERTAS");
  if (r.paginas.length === 0) console.log("   (nenhuma)");
  for (const p of r.paginas) {
    console.log(
      `   · ${p.url}\n     capturada em ${p.capturadoEm} — ${p.frescor}`,
    );
  }

  titulo("5. OFERTAS");
  if (r.ofertas.length === 0)
    console.log("   (nenhuma oferta sobreviveu à conferência)");
  r.ofertas.forEach(relatarOferta);

  if (r.descartadas.length > 0) {
    titulo("6. DESCARTADAS NA CONFERÊNCIA DE FONTE");
    for (const d of r.descartadas) {
      console.log(
        `   · ${d.url}\n     ${d.motivo} — preço afirmado ${brl(d.preco)}`,
      );
    }
  }

  titulo("7. LEITURA DE MERCADO E PREÇO-ALVO");
  if (r.leitura) {
    console.log(`   Ofertas na conta : ${r.leitura.ofertas}`);
    console.log(
      `   Faixa            : ${brl(r.leitura.menor)} – ${brl(r.leitura.maior)}`,
    );
    console.log(`   Mediana          : ${brl(r.leitura.mediana)}`);
    console.log(`   Dispersão        : ${pct(r.leitura.dispersao)}`);
    console.log(`   Melhor comparável: ${brl(r.melhor?.custo.custoTotal)}`);
  } else {
    console.log("   (sem leitura de mercado — nenhuma oferta comparável)");
  }

  if (temFaixa(r.alvo)) {
    console.log(
      `\n   PREÇO-ALVO: ${brl(r.alvo.piso)} – ${brl(r.alvo.teto)} por unidade`,
    );
    console.log(`   Derivação : ${r.alvo.derivacao}`);
    for (const e of r.alvo.evidencias) {
      console.log(`     - ${e.tipo} ${brl(e.valor)}: ${e.efeito}`);
    }
  } else {
    console.log(
      `\n   PREÇO-ALVO: não recomendado.\n   Motivo    : ${r.alvo.porque}`,
    );
  }

  titulo("8. ECONOMIA E MARGEM (medidas distintas)");
  console.log(
    r.economia
      ? `   Economia: ${brl(r.economia.economiaUnitaria)}/un · ${brl(r.economia.economiaTotal)} no pedido` +
          ` (contra ${brl(r.economia.precoAtual)} pagos hoje)`
      : "   Economia: não calculável — falta preço atual ou faixa-alvo.",
  );
  console.log(
    r.margem
      ? `   Margem  : ${brl(r.margem.margemUnitaria)}/un · ${brl(r.margem.margemTotal)} no pedido` +
          ` (remuneração ${brl(r.margem.remuneracaoUnitaria)} − custo ${brl(r.margem.custoDeCompra)})`
      : "   Margem  : não calculável — falta remuneração apurada ou custo comparável.",
  );

  titulo("9. CONFIANÇA");
  console.log(`   ${r.confianca.confianca} (${r.confianca.pontos}/100)`);
  for (const f of r.confianca.fatores) {
    console.log(
      `     - ${f.fator}: ${f.observado}${f.penalidade > 0 ? ` (−${f.penalidade})` : ""}`,
    );
  }

  titulo("10. CUSTO E LATÊNCIA");
  const m = r.medicao;
  console.log(
    `   Modelo servido  : ${m.modelo ?? "(nenhum — não houve chamada)"}`,
  );
  console.log(`   Latência        : ${m.latenciaMs} ms`);
  console.log(`   Tokens entrada  : ${m.tokensEntrada}`);
  console.log(`   Tokens saída    : ${m.tokensSaida}`);
  console.log(`   web_search      : ${m.buscasServidor} execução(ões)`);
  console.log(`   web_fetch       : ${m.fetchesServidor} execução(ões)`);
  /*
    O custo é estimado a partir da tabela pública do modelo, e sai marcado como
    estimativa: a fatura é da Anthropic, e o que este processo conhece é a
    contagem de tokens que a resposta declarou. Busca de servidor tem cobrança
    própria, por uso, que não aparece em `usage` — por isso o "no mínimo".
  */
  const custo = (m.tokensEntrada / 1e6) * 5 + (m.tokensSaida / 1e6) * 25;
  console.log(
    `   Custo estimado  : US$ ${custo.toFixed(4)} em tokens (tabela do Opus 5: $5/$25 por MTok).`,
  );
  console.log(
    `                     No mínimo isso — o uso de web_search/web_fetch é cobrado à parte e não vem em usage.`,
  );

  if (r.errosDeFerramenta.length > 0) {
    titulo("ERROS DAS FERRAMENTAS DE SERVIDOR");
    for (const e of r.errosDeFerramenta)
      console.log(`   · ${e.ferramenta} → ${e.codigo}`);
  }
  if (r.indisponivel !== null) {
    titulo("INDISPONIBILIDADE");
    console.log(`   ${r.indisponivel}`);
  }
}

/**
 * As três asserções que separam uma prova de uma execução degradada.
 *
 * Elas existem porque o relatório acima é bonito mesmo quando nada aconteceu:
 * sem chave, ele imprime dez seções, todas honestas, e nenhuma delas é a prova
 * que se pediu. Sair com código 1 é o que torna o aceite verificável por quem
 * não leu o texto inteiro.
 */
function conferirQueFoiReal(r: PesquisaDeMercado): string[] {
  const falhas: string[] = [];
  if (r.buscador !== "web_search+web_fetch") {
    falhas.push(`o buscador foi "${r.buscador}", e não o de rede`);
  }
  if (r.medicao.modelo === null) falhas.push("nenhum modelo respondeu");
  if (r.medicao.tokensEntrada === 0 && r.medicao.tokensSaida === 0) {
    falhas.push("nenhum token foi consumido");
  }
  if (r.paginas.length === 0) falhas.push("nenhuma página foi aberta");
  return falhas;
}

/**
 * O antes e o depois, com os cinco critérios de aceite julgados em código.
 *
 * Comparar duas execuções a olho, lendo dois blocos de terminal, é como se
 * perde uma regressão: o número que piorou está na décima linha de um relatório
 * que já disse "PESQUISA REAL CONFIRMADA" no fim. Aqui cada critério tem um
 * teste, e o bloco diz APROVADA ou REPROVADA com o que falhou nomeado.
 */
function relatarComparacao(r: PesquisaDeMercado): void {
  if (r.medicao.modelo === null) return;

  const m = r.medicao;
  const naConta = r.ofertas.filter((o) => o.entrouNaConta);
  const exatas = naConta.filter((o) => o.match.classe === "EXATO").length;
  const compativeis = naConta.filter(
    (o) => o.match.classe === "COMPATIVEL",
  ).length;
  const custo = custoEmTokens(m.tokensEntrada, m.tokensSaida);
  const duplicadas = r.descartadas.filter(
    (d) => d.motivo === "OFERTA_DUPLICADA",
  ).length;

  titulo(`11. COMPARAÇÃO COM A EXECUÇÃO ANTERIOR (${ANTERIOR.quando})`);
  const linha = (rotulo: string, agora: string, antes: string, d: string) =>
    console.log(
      `   ${rotulo.padEnd(26)} ${agora.padStart(14)}   ${antes.padStart(14)}   ${d.padStart(8)}`,
    );

  linha("", "AGORA", "ANTES", "Δ");
  linha(
    "Custo em tokens (US$)",
    custo.toFixed(4),
    ANTERIOR.custoUsd.toFixed(4),
    delta(custo, ANTERIOR.custoUsd),
  );
  linha(
    "Tokens de entrada",
    String(m.tokensEntrada),
    String(ANTERIOR.tokensEntrada),
    delta(m.tokensEntrada, ANTERIOR.tokensEntrada),
  );
  linha(
    "Tokens de saída",
    String(m.tokensSaida),
    String(ANTERIOR.tokensSaida),
    delta(m.tokensSaida, ANTERIOR.tokensSaida),
  );
  linha(
    "Latência (s)",
    (m.latenciaMs / 1000).toFixed(1),
    (ANTERIOR.latenciaMs / 1000).toFixed(1),
    delta(m.latenciaMs, ANTERIOR.latenciaMs),
  );
  linha(
    "Buscas executadas",
    String(m.buscasServidor),
    String(ANTERIOR.buscas),
    delta(m.buscasServidor, ANTERIOR.buscas),
  );
  linha(
    "Fetches executados",
    String(m.fetchesServidor),
    String(ANTERIOR.fetches),
    delta(m.fetchesServidor, ANTERIOR.fetches),
  );
  linha(
    "Páginas abertas",
    String(r.paginas.length),
    String(ANTERIOR.paginas),
    delta(r.paginas.length, ANTERIOR.paginas),
  );
  linha(
    "Ofertas aceitas",
    String(naConta.length),
    String(ANTERIOR.aceitas),
    delta(naConta.length, ANTERIOR.aceitas),
  );
  linha(
    "  das quais EXATO",
    String(exatas),
    String(ANTERIOR.exatas),
    delta(exatas, ANTERIOR.exatas),
  );
  linha(
    "  das quais COMPATIVEL",
    String(compativeis),
    String(ANTERIOR.compativeis),
    delta(compativeis, ANTERIOR.compativeis),
  );
  linha(
    "Domínios distintos",
    String(r.concentracao.porDominio.length),
    String(ANTERIOR.dominios),
    delta(r.concentracao.porDominio.length, ANTERIOR.dominios),
  );
  linha(
    "Mediana (R$)",
    r.leitura ? r.leitura.mediana.toFixed(2) : "—",
    ANTERIOR.mediana.toFixed(2),
    r.leitura ? delta(r.leitura.mediana, ANTERIOR.mediana, 1) : "—",
  );
  linha(
    "Alvo — piso (R$)",
    temFaixa(r.alvo) ? r.alvo.piso.toFixed(2) : "—",
    ANTERIOR.alvoPiso.toFixed(2),
    temFaixa(r.alvo) ? delta(r.alvo.piso, ANTERIOR.alvoPiso, 1) : "—",
  );
  linha(
    "Alvo — teto (R$)",
    temFaixa(r.alvo) ? r.alvo.teto.toFixed(2) : "—",
    ANTERIOR.alvoTeto.toFixed(2),
    temFaixa(r.alvo) ? delta(r.alvo.teto, ANTERIOR.alvoTeto, 1) : "—",
  );
  linha(
    "Confiança",
    `${r.confianca.confianca} ${r.confianca.pontos}`,
    `${ANTERIOR.confianca} ${ANTERIOR.pontos}`,
    delta(r.confianca.pontos, ANTERIOR.pontos),
  );

  titulo("12. OS TRÊS NÍVEIS DE ORIGEM (não se somam)");
  console.log("   Domínio da página — de onde o preço foi lido:");
  for (const d of r.concentracao.porDominio)
    console.log(`     · ${d.chave}: ${d.ofertas} oferta(s)`);
  console.log("\n   Fornecedor / marketplace — com quem se compraria:");
  for (const f of r.concentracao.porFornecedor)
    console.log(`     · ${f.chave}: ${f.ofertas} oferta(s)`);
  console.log("\n   Vendedor real — quem entrega, quando identificável:");
  if (r.concentracao.porVendedor.length === 0)
    console.log(
      "     (nenhuma oferta declarou vendedor distinto do fornecedor)",
    );
  for (const v of r.concentracao.porVendedor)
    console.log(`     · ${v.chave}: ${v.ofertas} oferta(s)`);
  console.log(
    `\n   Concentração: o maior domínio responde por ${(r.concentracao.fatiaDoMaiorDominio * 100).toFixed(0)}% das ofertas;` +
      ` o maior fornecedor, ${(r.concentracao.fatiaDoMaiorFornecedor * 100).toFixed(0)}%.`,
  );
  console.log(
    `   ${r.concentracao.semVendedor} oferta(s) não declararam vendedor.` +
      " Um agregador com N anúncios é UMA página — não N fontes independentes.",
  );

  titulo("13. CRITÉRIOS DE ACEITE DA OTIMIZAÇÃO");
  const criterios: { nome: string; passou: boolean; nota: string }[] = [
    {
      nome: "1. Custo cai de forma material (≥25%)",
      passou: custo <= ANTERIOR.custoUsd * 0.75,
      nota: `US$ ${custo.toFixed(4)} contra US$ ${ANTERIOR.custoUsd.toFixed(4)} (${delta(custo, ANTERIOR.custoUsd)})`,
    },
    {
      nome: "2. Sem regressão na medida 295/80 R22.5",
      passou:
        exatas >= ANTERIOR.exatas ||
        (naConta.length > 0 &&
          exatas / naConta.length >= ANTERIOR.exatas / ANTERIOR.aceitas),
      nota: `${exatas} de ${naConta.length} EXATO agora; ${ANTERIOR.exatas} de ${ANTERIOR.aceitas} antes`,
    },
    {
      nome: "3. Nenhuma duplicidade reapareceu",
      passou: duplicadas === 0,
      nota:
        duplicadas === 0
          ? "nenhuma oferta duplicada descartada"
          : `${duplicadas} oferta(s) duplicada(s) barradas`,
    },
    {
      nome: "4. Faixa e preço-alvo defensáveis",
      passou:
        temFaixa(r.alvo) &&
        r.leitura !== null &&
        naConta.length >= 5 &&
        r.alvo.piso > 0 &&
        r.alvo.teto >= r.alvo.piso,
      nota: temFaixa(r.alvo)
        ? `faixa sobre ${naConta.length} ofertas, piso ${r.alvo.piso.toFixed(2)} e teto ${r.alvo.teto.toFixed(2)}`
        : "sem faixa derivada",
    },
    {
      nome: "5. Sem concentração excessiva (maior domínio <80%)",
      passou:
        r.concentracao.fatiaDoMaiorDominio < 0.8 &&
        r.concentracao.porDominio.length >= 2,
      nota:
        `maior domínio com ${(r.concentracao.fatiaDoMaiorDominio * 100).toFixed(0)}%` +
        ` em ${r.concentracao.porDominio.length} domínio(s)`,
    },
  ];

  for (const c of criterios) {
    console.log(
      `   ${c.passou ? "PASSOU " : "FALHOU "} ${c.nome}\n            ${c.nota}`,
    );
  }

  const reprovados = criterios.filter((c) => !c.passou);
  console.log(
    reprovados.length === 0
      ? "\n   OTIMIZAÇÃO APROVADA pelos cinco critérios."
      : `\n   OTIMIZAÇÃO REPROVADA — ${reprovados.length} critério(s) falharam. Não promova o corte.`,
  );
}

async function principal(): Promise<void> {
  console.log(
    "PROVA DA PESQUISA DE MERCADO — Agente de Compras / FreightCheck",
  );
  relatarCredencial();
  relatarModelo();

  const busca = buscaDisponivel()
    ? buscaPorModelo()
    : buscaIndisponivel(
        "Nenhuma credencial no ambiente: a pesquisa de mercado não foi executada.",
      );

  /*
    O comando fica mudo justamente na parte lenta, e isso é defeito dele.

    As seções 1 e 2 saem na hora; a 3 só sai depois que a busca volta — e uma
    busca de verdade abre meia dúzia de páginas e leva de meio minuto a três.
    Quem roda vê o cursor parado e conclui que travou. O batimento abaixo
    escreve em stderr, para não sujar a saída que alguém vai colar num relato,
    e é apagado quando a busca termina.
  */
  const inicio = Date.now();
  const batimento = buscaDisponivel()
    ? setInterval(() => {
        const s = Math.round((Date.now() - inicio) / 1000);
        process.stderr.write(
          `\r   … pesquisando o mercado há ${s}s (teto de ${Math.round(TETO_MS / 1000)}s)   `,
        );
      }, 5000)
    : null;
  if (buscaDisponivel()) {
    console.log(
      "\n   Chamando o modelo com web_search + web_fetch. Medido numa pesquisa real:\n" +
        "   270 segundos com quatro buscas e seis páginas. Com as duas buscas de hoje,\n" +
        "   espere algo bem abaixo disso — mas conte em minutos, não em segundos.",
    );
  }

  const pesquisa = await pesquisarMercado(busca, {
    item: argumento("item", "pneu")!,
    descricao: argumento("descricao", "Pneu 295/80 R22.5 rodoviário"),
    quantidade: Number(argumento("quantidade", "40")),
    regiao: argumento("regiao", "Camaçari/BA"),
    /*
      Menos páginas é a válvula para o teto de tempo, e ela é a primeira a se
      abrir: cada página é um download real, e seis delas são a maior parte dos
      minutos que esta chamada leva. Três já produzem mediana e faixa — o que
      se perde é pluralidade de fontes, e a confiança cai dizendo isso, que é o
      comportamento certo.
    */
    maximoDePaginas: Number(argumento("paginas", "0")) || undefined,
    precoAtual: Number(argumento("preco-atual", "0")) || null,
    remuneracaoUnitaria: Number(argumento("remuneracao", "0")) || null,
    tetoEconomico: Number(argumento("teto", "0")) || null,
  });

  if (batimento !== null) {
    clearInterval(batimento);
    process.stderr.write("\r" + " ".repeat(70) + "\r");
  }

  relatarPesquisa(pesquisa);

  relatarComparacao(pesquisa);

  titulo("VEREDITO");
  const falhas = conferirQueFoiReal(pesquisa);
  if (falhas.length === 0) {
    console.log(
      "   PESQUISA REAL CONFIRMADA — rede, modelo, páginas e tokens.",
    );
    process.exit(0);
  }
  console.log("   NÃO É UMA PESQUISA REAL. O que faltou:");
  for (const f of falhas) console.log(`     - ${f}`);
  console.log(
    "\n   Isto não é defeito do agente: sem credencial ele degrada de propósito,\n" +
      "   sem inventar cotação. Configure ANTHROPIC_API_KEY e rode de novo.",
  );
  process.exit(1);
}

void principal();
