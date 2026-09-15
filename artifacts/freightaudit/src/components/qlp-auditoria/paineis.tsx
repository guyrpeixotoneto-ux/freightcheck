import { Briefcase, CircleCheck, Info, Scale, TriangleAlert, Users } from "lucide-react";
import { CartaoDeIndicador } from "@/components/ui/cartao-de-indicador";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import {
  escreverConta,
  escreverCobertura,
  escreverDiferenca,
  escreverQuantidade,
  type AuditoriaDoQuadro,
} from "@/lib/qlp-auditoria";

/**
 * Os painéis da auditoria do quadro — os mesmos para os dois quadros.
 *
 * O administrativo e o operacional têm colunas diferentes e contas diferentes,
 * mas a **forma** da pergunta é a mesma: a tabela declara uma conta, e a
 * conferência diz em quantos cargos ela fecha. Dois conjuntos de componentes
 * seriam duas chances de a mesma leitura ser escrita de dois jeitos.
 */

/**
 * Os indicadores do topo.
 *
 * **Cargos e efetivo são dois números diferentes, e essa é a primeira coisa que
 * a tela ensina.** Cada linha do quadro é um cargo, não uma pessoa; quem diz
 * quantas pessoas há é a coluna de quantidade. Um quadro de 30 cargos pode
 * remunerar 96 posições, e trocar um número pelo outro é o erro mais fácil de
 * cometer aqui.
 *
 * **Não há cartão de custo da estrutura**, e a ausência é deliberada: os
 * atributos do QLP chegam sem semântica confirmada, e agregar dinheiro sem
 * curadoria seria adivinhação. É o mesmo portão da tela do quadro. O que esta
 * tela faz sem curadoria nenhuma é conferir a multiplicação que a própria
 * planilha declara — aritmética não depende de semântica.
 */
export function CartoesDaAuditoria({ dados }: { dados: AuditoriaDoQuadro }) {
  const { resumo } = dados;

  return (
    <div
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
      aria-label="Indicadores da auditoria do quadro"
    >
      <CartaoDeIndicador
        rotulo="Cargos no quadro"
        valor={formatNumber(resumo.cargos, 0)}
        nota="linhas desta vigência"
        ajuda="Cada linha é um cargo, e não uma pessoa. Quem diz quantas pessoas há é o efetivo, no cartão ao lado."
        icone={Briefcase}
      />
      <CartaoDeIndicador
        rotulo="Efetivo remunerado"
        valor={escreverQuantidade(resumo.efetivo)}
        nota={
          resumo.efetivo === null
            ? "o quadro não declarou a quantidade"
            : "posições que o quadro remunera"
        }
        ajuda={
          "A única soma que esta tela faz, e ela é de gente, não de dinheiro: somar " +
          "quantidade não depende da curadoria de semântica monetária. O custo da " +
          "estrutura continua travado, como na aba do quadro."
        }
        icone={Users}
      />
      <CartaoDeIndicador
        rotulo="Cargos com as contas fechando"
        valor={formatNumber(resumo.conferem, 0)}
        nota={`${escreverCobertura(resumo.conferem, resumo.cargos)} dos cargos`}
        icone={CircleCheck}
        corDoIcone="bg-success/10 text-success"
      />
      <CartaoDeIndicador
        destaque
        rotulo="Cargos com conta que não fecha"
        valor={formatNumber(resumo.divergem, 0)}
        nota={
          resumo.divergem === 0
            ? "toda conta declarada fecha nesta vigência"
            : "ao menos uma conta do cargo não fecha"
        }
        corDoValor={resumo.divergem > 0 ? "text-warning-foreground" : undefined}
        ajuda={
          "Não fechar não é o mesmo que estar errado: é a coluna de resultado discordando " +
          "das colunas que, segundo o próprio dicionário, a produzem. O que a tela entrega " +
          "é a pergunta, com o tamanho dela."
        }
        icone={TriangleAlert}
        corDoIcone="bg-warning/15 text-warning-foreground"
      />
      <CartaoDeIndicador
        rotulo="Sem base para conferir"
        valor={formatNumber(resumo.semBase, 0)}
        nota="faltou parcela ou resultado"
        ajuda="Uma parcela ausente não vira zero: sem ela a conta não é feita, e falta base é uma resposta diferente de divergir."
        icone={Info}
      />
    </div>
  );
}

/**
 * O painel das contas — a leitura própria desta tela.
 *
 * ---------------------------------------------------------------------------
 * O que ele responde que nenhuma soma responderia
 * ---------------------------------------------------------------------------
 * O QLP é a rubrica em que **nada soma**: os atributos chegam sem semântica
 * confirmada, e a tela do quadro trava efetivo e custo por isso. Mas a tabela
 * declara contas sobre si mesma — `quantidade × valor = despesa` no
 * administrativo, a cadeia dos subtotais no operacional — e conferir uma
 * multiplicação não depende de semântica nenhuma, só de aritmética.
 *
 * É por isso que esta tela existe numa rubrica travada: ela não diz quanto custa
 * a estrutura, diz se o quadro fecha as contas que ele mesmo publica.
 *
 * **A fonte de cada conta viaja no ⓘ**, e não é enfeite: nenhuma delas foi
 * deduzida da aparência dos nomes. Quem lê um veredito de divergência precisa
 * poder conferir contra o que o dicionário declarou.
 */
export function PainelDasContas({
  contas,
  contaAberta,
  onConta,
}: {
  contas: AuditoriaDoQuadro["contas"];
  contaAberta: string;
  onConta: (conta: string) => void;
}) {
  return (
    <section className="superficie flex min-w-0 flex-col gap-3 p-4">
      <div>
        <h3 className="text-sm font-bold">
          As contas que o quadro declara sobre si mesmo
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Cada linha é uma conta publicada no dicionário da tabela. A conferência recalcula o
          resultado a partir das parcelas e compara com a coluna que o declara — e clicar numa
          conta filtra a tabela abaixo pelos cargos em que ela não fecha.
        </p>
      </div>

      {contas.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nenhuma conta a conferir neste quadro.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[46rem] border-collapse text-sm">
            <caption className="sr-only">
              Contas declaradas pelo quadro e em quantos cargos cada uma fecha.
            </caption>
            <thead>
              <tr className="border-b bg-muted/60 text-[0.65rem] uppercase tracking-[0.07em] text-muted-foreground">
                <th scope="col" className="px-3 py-2 text-left font-bold">Conta</th>
                <th scope="col" className="px-3 py-2 text-left font-bold">Forma</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Cargos</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Fecham</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Não fecham</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Sem base</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Maior diferença</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Soma das diferenças</th>
              </tr>
            </thead>
            <tbody>
              {contas.map((c) => (
                <tr
                  key={c.conta}
                  className={cn(
                    "cursor-pointer border-b last:border-0 hover:bg-muted/50",
                    contaAberta === c.conta && "bg-brand/5",
                  )}
                  onClick={() => onConta(contaAberta === c.conta ? "TODAS" : c.conta)}
                  tabIndex={0}
                  role="button"
                  aria-label={`Filtrar pelos cargos em que ${c.rotulo} não fecha`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onConta(contaAberta === c.conta ? "TODAS" : c.conta);
                    }
                  }}
                >
                  <td className="px-3 py-1.5">
                    <span className="flex items-center gap-1.5 font-semibold">
                      {c.rotulo}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-label={`De onde vem esta conta: ${c.fonte}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <Info className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-sm text-xs">{c.fonte}</TooltipContent>
                      </Tooltip>
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">
                    {c.forma === "PRODUTO" ? "quantidade × valor" : "soma das parcelas"}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {formatNumber(c.linhas, 0)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums text-success">
                    {formatNumber(c.conferem, 0)}
                  </td>
                  {/*
                    Zero fica em travessão, e não em "0": numa coluna que quase
                    sempre está vazia, o zero repetido rouba o olho do número que
                    importa ao lado.
                  */}
                  <td
                    className={cn(
                      "px-3 py-1.5 text-right font-mono tabular-nums",
                      c.divergem > 0 ? "text-warning-foreground" : "text-muted-foreground",
                    )}
                  >
                    {c.divergem > 0 ? formatNumber(c.divergem, 0) : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                    {c.semBase > 0 ? formatNumber(c.semBase, 0) : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {escreverDiferenca(c.maiorDiferenca)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {c.divergem > 0 ? escreverDiferenca(c.somaDasDiferencas) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[0.7rem] text-muted-foreground">
        A folga é de meio por cento, com piso de um centavo: as colunas chegam arredondadas a
        centavos, e um produto de dois valores arredondados carrega no máximo a soma dos erros
        relativos dos dois.{" "}
        <strong className="font-semibold">A soma das diferenças vai com sinal</strong> — dois
        cargos que erram para lados opostos não somam um erro maior, e o que se quer saber é o
        quanto o quadro declarado se afasta do que ele mesmo calcula.{" "}
        <strong className="font-semibold">Uma conta que não fecha não é um erro provado:</strong>{" "}
        é a coluna de resultado discordando das que a produzem, e a pergunta é para quem publica
        a tabela.
      </p>
    </section>
  );
}

/**
 * A régua do quadro administrativo — o efetivo contra o de referência.
 *
 * Não é uma invenção da tela: o dicionário diz que a diferença entre benchmark e
 * realizado é o que vira não conformidade, e o Book registra a consequência
 * financeira dela no bloco DESCONTO QLP ADM, da auditoria bimestral.
 *
 * **A tela não calcula desconto nenhum.** A regra que transforma diferença em
 * dinheiro não está em fonte alguma deste repositório; o que ela mostra é a
 * diferença, que é o insumo dessa conversa.
 */
export function PainelDoBenchmark({
  benchmark,
}: {
  benchmark: NonNullable<AuditoriaDoQuadro["benchmark"]>;
}) {
  return (
    <section className="superficie flex min-w-0 flex-col gap-3 p-4">
      <div className="flex items-start gap-2">
        <Scale className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" aria-hidden="true" />
        <div>
          <h3 className="text-sm font-bold">O quadro contra a referência</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            A régua da auditoria bimestral do QLP ADM: quantas posições o padrão prevê para cada
            cargo, contra as que o quadro remunera.
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-[0.7rem] text-muted-foreground">Cargos com referência</dt>
          <dd className="font-mono tabular-nums">{formatNumber(benchmark.linhas, 0)}</dd>
        </div>
        <div>
          <dt className="text-[0.7rem] text-muted-foreground">Acima da referência</dt>
          <dd
            className={cn(
              "font-mono tabular-nums",
              benchmark.acimaDaReferencia > 0 && "text-warning-foreground",
            )}
          >
            {formatNumber(benchmark.acimaDaReferencia, 0)}
          </dd>
        </div>
        <div>
          <dt className="text-[0.7rem] text-muted-foreground">Abaixo da referência</dt>
          <dd className="font-mono tabular-nums">
            {formatNumber(benchmark.abaixoDaReferencia, 0)}
          </dd>
        </div>
        <div>
          <dt className="text-[0.7rem] text-muted-foreground">Posições de diferença</dt>
          <dd className="font-mono font-semibold tabular-nums">
            {benchmark.posicoesDeDiferenca > 0 ? "+" : ""}
            {escreverQuantidade(benchmark.posicoesDeDiferenca)}
          </dd>
        </div>
        <div>
          <dt className="text-[0.7rem] text-muted-foreground">Salário acima do de referência</dt>
          <dd className="font-mono tabular-nums">{formatNumber(benchmark.salarioAcima, 0)}</dd>
        </div>
        <div className="sm:col-span-3">
          <dt className="text-[0.7rem] text-muted-foreground">
            Maior distância entre salário e referência
          </dt>
          <dd className="font-mono tabular-nums">
            {escreverDiferenca(benchmark.maiorDistanciaDeSalario)}
          </dd>
        </div>
      </dl>

      <p className="text-[0.7rem] text-muted-foreground">
        <strong className="font-semibold">A tela não calcula desconto.</strong> A regra que
        transforma diferença em dinheiro está no bloco DESCONTO QLP ADM do Book, e não em coluna
        nenhuma deste acervo — o que está aqui é a diferença, que é o insumo daquela conversa.
        Posições de diferença somam com sinal: dois cargos, um acima e um abaixo, não são um
        quadro fora do padrão.
      </p>
    </section>
  );
}

/**
 * A leitura própria do quadro operacional — o abono acordado contra o aplicado.
 *
 * O dicionário da tabela de equipe explica por que estas duas colunas existem:
 * quando a janela do abono se encerra, o aplicado deixa de acompanhar o
 * acordado e o total cai sozinho. *"É o tipo de movimento que, sem estas duas
 * colunas à vista, vira um chamado procurando erro onde há regra."*
 *
 * Este painel é essa vista. Ele mostra **regra, não achado** — e é justamente
 * por isso que precisa estar visível.
 */
export function PainelDoAbono({
  abono,
}: {
  abono: NonNullable<AuditoriaDoQuadro["abono"]>;
}) {
  return (
    <section className="superficie flex min-w-0 flex-col gap-3 p-4">
      <div>
        <h3 className="text-sm font-bold">O abono acordado contra o aplicado</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Quando a janela de duração se encerra, o abono aplicado deixa de acompanhar o
          acordado e o total do cargo cai sozinho. É regra, e não erro — mas sem estas duas
          colunas à vista a queda vira um chamado procurando defeito.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-[0.7rem] text-muted-foreground">Cargos com abono acordado</dt>
          <dd className="font-mono tabular-nums">{formatNumber(abono.comAbono, 0)}</dd>
        </div>
        <div>
          <dt className="text-[0.7rem] text-muted-foreground">Aplicado menor que o acordado</dt>
          <dd
            className={cn(
              "font-mono tabular-nums",
              abono.aplicadoMenor > 0 && "text-warning-foreground",
            )}
          >
            {formatNumber(abono.aplicadoMenor, 0)}
          </dd>
        </div>
        <div>
          <dt className="text-[0.7rem] text-muted-foreground">Janela encerrada</dt>
          <dd className="font-mono tabular-nums">{formatNumber(abono.janelaEncerrada, 0)}</dd>
        </div>
        <div>
          <dt className="text-[0.7rem] text-muted-foreground">Acordado e não aplicado</dt>
          <dd className="font-mono font-semibold tabular-nums">
            {escreverConta(abono.naoAplicado)}
          </dd>
        </div>
      </dl>
    </section>
  );
}
