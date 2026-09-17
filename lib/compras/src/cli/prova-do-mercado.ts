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
  buscaDisponivel,
  buscaIndisponivel,
  buscaPorModelo,
  pesquisarMercado,
  temFaixa,
  temFiltragemDinamica,
  type OfertaAnalisada,
  type PesquisaDeMercado,
} from "../mercado";

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

  const pesquisa = await pesquisarMercado(busca, {
    item: argumento("item", "pneu")!,
    descricao: argumento("descricao", "Pneu 295/80 R22.5 rodoviário"),
    quantidade: Number(argumento("quantidade", "40")),
    regiao: argumento("regiao", "Camaçari/BA"),
    precoAtual: Number(argumento("preco-atual", "0")) || null,
    remuneracaoUnitaria: Number(argumento("remuneracao", "0")) || null,
    tetoEconomico: Number(argumento("teto", "0")) || null,
  });

  relatarPesquisa(pesquisa);

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
