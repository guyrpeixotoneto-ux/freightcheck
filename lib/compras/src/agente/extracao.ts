/**
 * O que a pergunta traz de número — lido por regra, não por modelo.
 *
 * "Quanto posso pagar nesse pneu, se a proposta é R$ 3.080 e são 80 unidades?"
 * carrega três dados: o item, o preço e a quantidade. Quem os extrai é este
 * arquivo, com expressões regulares e um dicionário — e não o modelo de
 * linguagem.
 *
 * **Por que não pedir ao modelo.** Porque esses três números entram direto na
 * conta, e um modelo que lê "R$ 3.080" como 3,08 erra com a mesma fluência com
 * que acerta. A extração por regra falha de outro jeito: ela **não encontra**,
 * e não encontrar é um estado que a resposta sabe tratar — ela pergunta. Um
 * preço extraído errado vira um teto estourado que ninguém confere.
 *
 * O que se perde: a pergunta escrita de um jeito que o dicionário não cobre sai
 * sem item, e o agente pede que se escolha na lista. É o custo aceito, e a
 * lista está sempre a um clique.
 */

import { CATALOGO, produtoDe, type ProdutoDeCompra } from "../catalogo";

/**
 * Como as pessoas chamam cada item do catálogo.
 *
 * O `rotulo` do catálogo entra sozinho (ver {@link termosDoProduto}); esta
 * tabela é para o que o catálogo **não** diz — a palavra que quem compra usa.
 * Ninguém digita "Manutenção — R$/km": digita "peça", "oficina", "revisão".
 *
 * Os termos são comparados sobre o texto normalizado — sem acento, em caixa
 * baixa — e por palavra inteira, o que evita o casamento que mais assombra
 * listas assim: "pneu" dentro de "pneumático" é bem-vindo, mas "epi" dentro de
 * "equipamento" não é. Ver {@link contem}.
 */
const APELIDOS: Record<string, string[]> = {
  pneu: ["pneu", "pneus", "borracha", "recapagem", "recapadora", "rodizio", "banda"],
  "manutencao-contrato": ["contrato de manutencao", "manutencao contratada", "contrato"],
  "manutencao-avulsa": [
    "manutencao",
    "peca",
    "pecas",
    "oficina",
    "revisao",
    "conserto",
    "reparo",
  ],
  combustivel: ["combustivel", "diesel", "s10", "arla", "abastecimento", "posto"],
  "ipva-licenciamento": ["ipva", "licenciamento", "emplacamento"],
  seguro: ["seguro", "apolice", "seguradora"],
  aquisicao: ["aquisicao", "caminhao novo", "cavalo novo", "carreta nova", "nota de compra"],
  uniformes: ["uniforme", "uniformes", "camisa", "calca", "calcado", "epi", "enxoval"],
  telefonia: ["telefonia", "celular", "aparelho", "linha", "plano de dados", "chip"],
  "frota-leve": ["frota leve", "carro de apoio", "moto", "van", "veiculo leve"],
  beneficios: ["beneficio", "beneficios", "vale refeicao", "plano de saude", "seguro de vida"],
  "vale-transporte": ["vale transporte", "vt", "passagem", "recarga"],
};

/** Sem acento, em caixa baixa, com pontuação virada em espaço. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Todos os termos que apontam para um produto: o rótulo dele mais os apelidos. */
export function termosDoProduto(produto: ProdutoDeCompra): string[] {
  const doRotulo = normalizar(produto.rotulo)
    .split(" ")
    /*
      Palavras de duas letras fora: "de", "e", "km" casariam com meia pergunta.
      O rótulo inteiro entra junto, então "frota leve" continua encontrável.
    */
    .filter((p) => p.length > 2);
  return [normalizar(produto.rotulo), ...doRotulo, ...(APELIDOS[produto.chave] ?? [])];
}

/** Casamento por palavra inteira — "epi" não casa dentro de "equipamento". */
function contem(textoNormalizado: string, termo: string): boolean {
  const alvo = normalizar(termo);
  if (alvo === "") return false;
  return new RegExp(`(^| )${alvo.replace(/ /g, " ")}( |$)`).test(textoNormalizado);
}

/**
 * O produto de que a pergunta fala, ou `null`.
 *
 * Quando mais de um casa, ganha o termo **mais longo** — "contrato de
 * manutenção" vence "manutenção", que é o que a pessoa quis dizer. Empate entre
 * termos do mesmo tamanho devolve o primeiro do catálogo, que é a ordem em que
 * a tela os lista.
 */
export function itemDaPergunta(pergunta: string): ProdutoDeCompra | null {
  const texto = normalizar(pergunta);
  let melhor: { produto: ProdutoDeCompra; peso: number } | null = null;

  for (const produto of CATALOGO) {
    for (const termo of termosDoProduto(produto)) {
      if (!contem(texto, termo)) continue;
      const peso = normalizar(termo).length;
      if (melhor === null || peso > melhor.peso) melhor = { produto, peso };
    }
  }
  return melhor?.produto ?? null;
}

/**
 * Os valores em reais que a pergunta traz, na ordem em que aparecem.
 *
 * Aceita as duas grafias que convivem numa mesa de compras: a brasileira
 * (`R$ 3.080,00`) e a que sai de planilha (`3080.00`). A distinção é feita pela
 * **posição do último separador**: se ele é vírgula, é decimal brasileiro; se é
 * ponto com exatamente duas casas depois e nenhuma vírgula no número, é decimal
 * de planilha; caso contrário o ponto é separador de milhar. É a única leitura
 * que não transforma "3.080" em três reais e oito centavos.
 *
 * Só entra número precedido de `R$` ou seguido de uma palavra de dinheiro —
 * "reais", "por unidade", "cada". Um "80" solto é quantidade, não preço, e essa
 * confusão custaria um teto calculado sobre oitenta reais.
 */
export function precosDaPergunta(pergunta: string): number[] {
  const achados: number[] = [];
  const padrao =
    /(?:r\$\s*)([\d.,]+)|([\d.,]+)\s*(?:reais|reais\/|\/\s*unidade|por\s+unidade|cada)/gi;

  for (const casa of pergunta.matchAll(padrao)) {
    const bruto = (casa[1] ?? casa[2] ?? "").trim();
    const valor = comoNumero(bruto);
    if (valor !== null && valor > 0) achados.push(valor);
  }
  return achados;
}

/** De "3.080,50", "3080.50" ou "3080" para 3080,5 — ou `null`. */
export function comoNumero(bruto: string): number | null {
  const limpo = bruto.replace(/\s/g, "");
  if (limpo === "" || !/[\d]/.test(limpo)) return null;

  const temVirgula = limpo.includes(",");
  const temPonto = limpo.includes(".");

  let normalizado: string;
  if (temVirgula) {
    /* Brasileiro: ponto é milhar, vírgula é decimal. */
    normalizado = limpo.replace(/\./g, "").replace(",", ".");
  } else if (temPonto) {
    const depois = limpo.slice(limpo.lastIndexOf(".") + 1);
    /* Ponto com duas casas é decimal de planilha; qualquer outra coisa é milhar. */
    normalizado = depois.length === 2 ? limpo : limpo.replace(/\./g, "");
  } else {
    normalizado = limpo;
  }

  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

/**
 * Quantas unidades o pedido compra, quando a pergunta diz.
 *
 * Exige a palavra da contagem depois do número — "80 unidades", "80 pneus",
 * "compra de 80". Sem ela, o número fica de fora: numa frase com "R$ 3.080" e
 * "80 unidades" o preço já foi consumido pela leitura de dinheiro, e o que
 * sobra pode ser um ano, um CNPJ ou uma placa.
 */
export function quantidadeDaPergunta(pergunta: string): number | null {
  const texto = normalizar(pergunta);
  const padrao =
    /(\d[\d ]*)\s*(?:unidades|unidade|un|pecas|peca|itens|item|pneus|pneu|jogos|jogo)\b/;
  const casa = texto.match(padrao);
  if (casa?.[1]) {
    const n = Number(casa[1].replace(/\s/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  const dePedido = texto.match(/\b(?:compra|pedido|comprar|adquirir)\s+(?:de\s+)?(\d+)\b/);
  if (dePedido?.[1]) {
    const n = Number(dePedido[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** A placa que a pergunta cita — três letras e quatro caracteres, Mercosul incluída. */
export function placaDaPergunta(pergunta: string): string | null {
  const casa = pergunta
    .toUpperCase()
    .match(/\b([A-Z]{3}[ -]?\d[A-Z0-9]\d{2})\b/);
  return casa?.[1] ? casa[1].replace(/[ -]/g, "") : null;
}

/** Tudo o que a pergunta entregou, num objeto só. */
export interface LeituraDaPergunta {
  item: ProdutoDeCompra | null;
  precos: number[];
  quantidade: number | null;
  placa: string | null;
}

export function lerPergunta(pergunta: string): LeituraDaPergunta {
  return {
    item: itemDaPergunta(pergunta),
    precos: precosDaPergunta(pergunta),
    quantidade: quantidadeDaPergunta(pergunta),
    placa: placaDaPergunta(pergunta),
  };
}

/** O produto pedido por chave, quando a tela já sabe qual é. */
export function itemPorChave(chave: string | null | undefined): ProdutoDeCompra | null {
  return chave ? (produtoDe(chave) ?? null) : null;
}
