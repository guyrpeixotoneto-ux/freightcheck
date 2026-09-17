import { VARIAVEIS_DE_FINAME } from "./finame";
import { CONTAS_DO_QUADRO, VARIAVEIS_DO_QUADRO } from "./qlp";

/**
 * O total que não se justifica sozinho — porque ele é a conta das suas
 * parcelas.
 *
 * ---------------------------------------------------------------------------
 * O problema
 * ---------------------------------------------------------------------------
 * A Parcela FINAME **é** juros mais amortização. Quem justifica as quatro
 * variáveis de um contrato escrevia a fórmula da parcela, a dos juros e a da
 * amortização — e a primeira era, necessariamente, a soma das outras duas. Ou
 * se escrevia a mesma coisa três vezes, ou se escrevia uma frase genérica na
 * parcela ("acompanha o contrato"), que é exatamente o que a justificativa
 * estruturada veio acabar.
 *
 * Pior: a justificativa da parcela podia **contradizer** as das parcelas — um
 * "conforme" no total com uma exceção nos juros — e nada no produto notava.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo faz, e o que ele não inventa
 * ---------------------------------------------------------------------------
 * Ele não declara composição nenhuma: lê a que os catálogos **já** declaram, e
 * a devolve por código de atributo, que é o que a alteração carrega.
 *
 * - `VARIAVEIS_DE_FINAME`, pelo campo `parcelas` — hoje só a parcela, que se
 *   abre em juros e amortização nos dois tipos, mais o aluguel na carreta, onde
 *   ele é a terceira parcela (`docs/ACHADO-ALUGUEL.md`);
 * - `CONTAS_DO_QUADRO` (QLP), pelo par `resultado`/`parcelas` — os seis trios
 *   do administrativo (quantidade × valor = despesa) e os três degraus da
 *   cadeia de subtotais do operacional.
 *
 * O que **não** entra, e por quê: `finame_total` (`carreta.finame`) é marcado
 * como total composto, mas o catálogo não diz de que colunas ele se compõe.
 * Deduzir as parcelas de um total pelo nome é a única forma de este arquivo
 * errar, e é a que ele não tem: sem `parcelas` declaradas, não há total
 * derivado — a alteração é justificada à mão, como qualquer outra.
 *
 * Nada aqui toca o banco, para que o navegador possa importar: é a mesma razão
 * de `justificativa-estruturada.ts` — a fila precisa saber, na hora de montar
 * as etapas, quais alterações são total de outras que estão na mesma lista.
 */
export interface TotalDerivado {
  /** O código do atributo que é o total. */
  resultado: string;
  /** Os códigos das alterações que o produzem. */
  parcelas: readonly string[];
  /** Como as parcelas produzem o total — é o sinal que entra na fórmula. */
  forma: "SOMA" | "PRODUTO";
}

function daFiname(): TotalDerivado[] {
  const porChave = new Map(VARIAVEIS_DE_FINAME.map((v) => [v.chave, v]));
  const totais: TotalDerivado[] = [];
  for (const variavel of VARIAVEIS_DE_FINAME) {
    if (!variavel.parcelas?.length) continue;
    /*
      Uma entrada por tipo de equipamento: cavalo e carreta têm códigos
      diferentes para a mesma variável, e é o código que a alteração carrega.

      ---------------------------------------------------------------------
      A parcela que não se aplica, e a parcela que falta
      ---------------------------------------------------------------------
      A regra antiga era uma só — "o tipo que não declarar o código de alguma
      parcela fica de fora, porque meia composição não é composição" —, e ela
      estava certa enquanto as parcelas existiam nos dois tipos.

      O aluguel do implemento quebrou esse pressuposto: ele é a terceira parcela
      da parcela FINAME **da carreta**, e no cavalo ele não existe — a identidade
      de lá é amortização + juros + lucro fixo (`composition.ts`). Tratado como
      parcela faltando, ele derrubava a composição do cavalo inteira, e a
      justificativa da parcela do cavalo voltava a ser escrita à mão.

      Então a leitura passa a distinguir dois casos que se pareciam:

      - a chave **não existe no catálogo** — é erro de escrita, e derruba a
        composição, como antes;
      - a variável existe e **não declara código para este tipo** — ela não se
        aplica ali, e a composição daquele tipo é a das parcelas que se aplicam.

      A salvaguarda que sobra é a que importa: uma composição precisa de pelo
      menos duas parcelas. Com uma só, o "total" seria um apelido da parcela.
    */
    for (const tipo of ["CAVALO", "CARRETA"] as const) {
      const resultado = variavel.codigo[tipo];
      if (!resultado) continue;

      const declaradas = variavel.parcelas.map((chave) => porChave.get(chave));
      if (declaradas.some((v) => v === undefined)) continue;

      const parcelas = declaradas
        .map((v) => v!.codigo[tipo])
        .filter((codigo): codigo is string => !!codigo);
      if (parcelas.length < 2) continue;

      totais.push({ resultado, parcelas, forma: "SOMA" });
    }
  }
  return totais;
}

function doQlp(): TotalDerivado[] {
  return Object.values(CONTAS_DO_QUADRO)
    .flat()
    .filter((conta) => conta.parcelas.length > 0)
    .map((conta) => ({
      resultado: conta.resultado,
      parcelas: conta.parcelas,
      forma: conta.forma,
    }));
}

/*
  Montado uma vez: os catálogos são constantes de módulo, e refazer o índice a
  cada alteração da fila seria refazer a mesma tabela por linha de tela.
*/
const POR_CODIGO: ReadonlyMap<string, TotalDerivado> = new Map(
  [...daFiname(), ...doQlp()].map((total) => [total.resultado, total]),
);

/** A composição declarada deste atributo, ou `null` quando ele não é total de nada. */
export function totalDerivado(attributeCode: string | null | undefined): TotalDerivado | null {
  if (!attributeCode) return null;
  return POR_CODIGO.get(attributeCode) ?? null;
}

/*
  O nome de tela de cada código, também lido dos catálogos.

  Ele é necessário porque `change.attribute_name` **não** é o nome de tela: é o
  nome com que a coluna entrou na importação — `finameCavalo`,
  `jurosFinameCavalo`. Uma fórmula derivada escrita com ele sairia
  "finameCavalo = jurosFinameCavalo + amortizacaoCavalo", que é o nome do dado
  cru numa frase que a auditoria vai ler. As tabelas destas rubricas já mostram
  "Parcela FINAME" — é o rótulo do catálogo, e é ele que a frase usa.
*/
const ROTULO_POR_CODIGO: ReadonlyMap<string, string> = new Map([
  ...VARIAVEIS_DE_FINAME.flatMap((v) =>
    (["CAVALO", "CARRETA"] as const)
      .map((tipo) => v.codigo[tipo])
      .filter((codigo): codigo is string => !!codigo)
      .map((codigo) => [codigo, v.rotulo] as const),
  ),
  ...Object.values(VARIAVEIS_DO_QUADRO)
    .flat()
    .map((v) => [v.codigo, v.rotulo] as const),
]);

/**
 * Como esta variável se chama na tela — `null` quando o catálogo não a nomeia.
 *
 * Quem chama decide o que fazer com o `null`: a tela cai no nome que a
 * alteração carrega, que é o que ela já mostra ao lado.
 */
export function rotuloDaVariavel(attributeCode: string | null | undefined): string | null {
  if (!attributeCode) return null;
  return ROTULO_POR_CODIGO.get(attributeCode) ?? null;
}

/**
 * A fórmula que se escreve sozinha — "Parcela FINAME = Juros FINAME +
 * Amortização".
 */
export function formulaDoTotalDerivado(
  rotuloDoTotal: string,
  forma: TotalDerivado["forma"],
  rotulosDasParcelas: readonly string[],
): string {
  return `${rotuloDoTotal} = ${rotulosDasParcelas.join(forma === "SOMA" ? " + " : " × ")}`;
}

/** A regra de um total: ele não tem regra própria — tem a das parcelas. */
export function regraDoTotalDerivado(rotulosDasParcelas: readonly string[]): string {
  return (
    `Este valor é um total calculado: ele só pode mudar quando ` +
    `${rotulosDasParcelas.join(" ou ")} mudam. A condição de alteração é a de cada ` +
    `parcela, justificada em separado.`
  );
}

/**
 * Separa o que a fila de justificar pergunta do que ela deduz.
 *
 * A regra é a da lista que se tem em mãos, e não a do acervo: um total só sai
 * da fila quando **alguma parcela dele está sendo justificada junto**, na mesma
 * entidade. Quem abre a Parcela FINAME sozinha — clicando na célula dela na
 * tabela — continua sendo perguntado, porque ali não há de onde deduzir nada, e
 * uma caixa que se recusasse a perguntar deixaria a alteração sem explicação
 * nenhuma.
 *
 * A entidade entra na chave porque a seleção do Painel atravessa placas: a
 * amortização de uma carreta não explica a parcela de outra.
 */
export function separarTotaisDerivados<
  T extends { entityLabel: string | null; attributeCode: string | null },
>(alvos: readonly T[]): { fila: T[]; derivados: { total: T; parcelas: T[] }[] } {
  const porEntidadeECodigo = new Map<string, T>();
  for (const a of alvos) porEntidadeECodigo.set(`${a.entityLabel}|${a.attributeCode}`, a);

  const fila: T[] = [];
  const derivados: { total: T; parcelas: T[] }[] = [];
  for (const alvo of alvos) {
    const composicao = totalDerivado(alvo.attributeCode);
    const parcelas = (composicao?.parcelas ?? [])
      .map((codigo) => porEntidadeECodigo.get(`${alvo.entityLabel}|${codigo}`))
      .filter((p): p is T => !!p);
    if (parcelas.length > 0) derivados.push({ total: alvo, parcelas });
    else fila.push(alvo);
  }
  return { fila, derivados };
}
