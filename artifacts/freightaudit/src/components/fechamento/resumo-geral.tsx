import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";
import { formatBrl } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  ConjuntoComparado,
  LinhaComparada,
  PainelComparado,
  QuadroComparado,
  TresColunas,
} from "@/lib/fechamento";

/**
 * A aba `Planilha` — o `RESUMO GERAL` no formato dele, com os números do sistema.
 *
 * **O que esta tela deixou de ser.** Ela era uma matriz de cinco colunas —
 * devido, demonstrado, diferença, planilha, diferença da planilha — sobre
 * rótulos em caixa alta. Cada coluna tinha razão de existir e o conjunto não
 * tinha: quem abre esta aba está com a `.xlsb` ao lado e quer ler o mesmo
 * documento, na mesma ordem, com os nossos números. A conferência entre as
 * fontes não sumiu; ela está na aba `Inconsistências`, que é onde uma lista de
 * discordâncias se lê, e no detalhe de cada linha, a um clique.
 *
 * **O que ela é.** Os quatro quadros do resumo, na ordem da planilha, com os
 * rótulos escritos como se escreve e três colunas: 1ª quinzena, 2ª quinzena e
 * total. Abaixo, o fecho — total geral da unidade, total geral SRTrans e a
 * diferença.
 *
 * **De onde sai o número de cada célula.** Do motor: cadastro mais relatórios
 * importados. É o **devido** — o que o contrato manda pagar —, e é
 * deliberadamente esse e não o demonstrado, porque a pergunta que esta aba
 * responde é *os arquivos que importei mais o cadastro que digitei chegam ao
 * resultado da planilha?*. O que o 03.08.20 demonstra e o que a `.xlsb` anexada
 * publica aparecem ao abrir a linha, ao lado da memória de cálculo.
 *
 * **A linha sem fonte operacional aparece vazia e diz o que falta.** Nunca
 * zero: um quadro que ninguém apurou e um quadro que valeu zero são afirmações
 * diferentes, e a planilha confunde as duas (célula vazia e `R$ -` têm a mesma
 * cara). Aqui não.
 *
 * **Nada é somado no navegador.** As três colunas, os totais de quadro e o
 * fecho vêm montados de `@workspace/fechamento`. Uma soma feita aqui seria uma
 * segunda opinião sobre remuneração.
 */

/** Uma coluna da tabela: como se chama e qual das três colunas ela lê. */
export interface ColunaDoResumo {
  rotulo: string;
  de: (valores: TresColunas) => number | null;
}

/** `null` é ausência e aparece como traço — nunca como `R$ 0,00`. */
function dinheiro(valor: number | null): string {
  return valor === null ? "—" : formatBrl(valor);
}

/**
 * O que a coluna `Auditar` diz de uma linha — e de onde ela tirou isso.
 *
 * Duas procedências, e a distinção importa para quem lê: `LINHA` é uma
 * divergência desta linha; `CONJUNTO` é uma divergência do grupo a que ela
 * pertence, e nesse caso **as outras linhas do grupo mostram a mesma marca**.
 * Não é repetição por descuido: o relatório não parte o número, e não se sabe de
 * qual das linhas do grupo a diferença vem. Marcar só uma delas seria escolher
 * uma culpada por sorteio.
 */
export interface Achado {
  onde: "LINHA" | "CONJUNTO";
  /** O rótulo curto da célula — o que se lê varrendo a coluna. */
  marca: string;
  /** A frase inteira, que aparece ao abrir a linha. */
  texto: string;
}

export function achadoDaLinha(
  linha: LinhaComparada,
  conjunto: ConjuntoComparado | null,
): Achado | null {
  if (linha.auditar) {
    /*
      Duas marcas, porque são dois problemas diferentes de quem confere. `Não
      bate` é uma conta a refazer; `Sem lastro` é um documento a procurar — e
      ninguém procura documento quando o que falta é conferir a conta.
    */
    const semLastro = linha.demonstrado.primeira === null && linha.demonstrado.segunda === null;
    return {
      onde: "LINHA",
      marca: semLastro ? "Sem lastro" : "Não bate",
      texto: linha.auditar,
    };
  }
  if (conjunto?.auditar) {
    return { onde: "CONJUNTO", marca: "Conjunto não bate", texto: conjunto.auditar };
  }
  return null;
}

/** A marca da coluna `Auditar`. Nada quando a linha se sustenta — que é o normal. */
function Auditar({ achado }: { achado: Achado | null }) {
  if (!achado) return <span className="text-muted-foreground/50">—</span>;
  return (
    <span
      className={cn(
        "inline-block rounded px-1.5 py-0.5 text-2xs font-medium whitespace-nowrap",
        "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
      )}
    >
      {achado.marca}
    </span>
  );
}

export function ResumoGeralDoCanal({
  painel,
  colunas,
  temPlanilha,
}: {
  painel: PainelComparado;
  colunas: ColunaDoResumo[];
  /**
   * A planilha anexada aparece no detalhe da linha?
   *
   * Vem de fora, de `temColunaDaPlanilha`, que é exportada e testada: a regra
   * pega o caso em que o servidor responde sem o campo `referencia` durante um
   * deploy, e `!== null` erraria nele. Duplicá-la aqui daria duas versões.
   */
  temPlanilha: boolean;
}) {
  /* Qual linha está aberta é estado desta tabela: há uma por canal na tela. */
  const [aberta, setAberta] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs tracking-wide text-muted-foreground">
              <th className="py-2 text-left font-medium">Linha</th>
              {colunas.map((c) => (
                <th key={c.rotulo} className="py-2 text-right font-medium min-w-32">
                  {c.rotulo}
                </th>
              ))}
              {/*
                A coluna que deve viver vazia. Ela fica na ponta, e não ao lado
                do nome, porque não é sobre o que a linha é — é sobre o que
                sobrou depois de conferir o número.
              */}
              <th className="py-2 pl-4 text-left font-medium">Auditar</th>
            </tr>
          </thead>
          <tbody>
            {painel.quadros.map((quadro) => (
              <Quadro
                key={quadro.quadro}
                quadro={quadro}
                colunas={colunas}
                temPlanilha={temPlanilha}
                aberta={aberta}
                onAbrir={(chave) => setAberta(aberta === chave ? null : chave)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <Fecho painel={painel} colunas={colunas} />
    </div>
  );
}

function Quadro({
  quadro,
  colunas,
  temPlanilha,
  aberta,
  onAbrir,
}: {
  quadro: QuadroComparado;
  colunas: ColunaDoResumo[];
  temPlanilha: boolean;
  aberta: string | null;
  onAbrir: (chave: string) => void;
}) {
  return (
    <Fragment>
      <tr className="border-b bg-muted/40">
        <td colSpan={colunas.length + 2} className="py-1.5 text-xs font-semibold">
          {quadro.titulo}
        </td>
      </tr>

      {/*
        O quadro reservado da planilha não tem linha, e a frase que explica isso
        vem escrita do domínio. Sem ela, o quadro apareceria como um título
        seguido de nada — que é como se lê um erro de carregamento.
      */}
      {quadro.reservado && (
        <tr className="border-b">
          <td
            colSpan={colunas.length + 2}
            className="py-2 pl-4 text-xs text-muted-foreground"
          >
            {quadro.reservado}
          </td>
        </tr>
      )}

      {quadro.linhas.map((linha) => (
        <Linha
          key={linha.chave}
          linha={linha}
          /*
            O conjunto comparado — o que tem a subtração — vem do quadro, e não
            de `linha.conjunto`, que é o do demonstrativo e só descreve o
            agrupamento. É nele que mora a auditoria das linhas agrupadas.
          */
          conjunto={
            quadro.conjuntos.find((c) => c.chave === linha.conjunto?.chave) ?? null
          }
          colunas={colunas}
          temPlanilha={temPlanilha}
          aberta={aberta === linha.chave}
          onAbrir={() => onAbrir(linha.chave)}
        />
      ))}

      {/*
        O total do quadro, com o nome que a planilha lhe dá. O quadro reservado
        não tem linha de total no resumo, e por isso não ganha uma aqui.
      */}
      {quadro.rotuloDoTotal && (
        <tr className="border-b font-semibold">
          <td className="py-2 pl-6">{quadro.rotuloDoTotal}</td>
          {colunas.map((c) => (
            <td
              key={c.rotulo}
              className="py-2 text-right font-mono tabular-nums text-xs sm:text-sm"
            >
              {dinheiro(c.de(quadro.devido))}
            </td>
          ))}
          {/*
            O total não repete a marca das linhas dele: o que impede o quadro de
            fechar já está marcado onde aconteceu, e repetir aqui faria a coluna
            parecer cheia quando ela tem um achado só.
          */}
          <td className="py-2 pl-4" />
        </tr>
      )}
    </Fragment>
  );
}

function Linha({
  linha,
  conjunto,
  colunas,
  temPlanilha,
  aberta,
  onAbrir,
}: {
  linha: LinhaComparada;
  /** O conjunto a que a linha pertence, quando pertence — com a subtração dele. */
  conjunto: ConjuntoComparado | null;
  colunas: ColunaDoResumo[];
  temPlanilha: boolean;
  aberta: boolean;
  onAbrir: () => void;
}) {
  const achado = achadoDaLinha(linha, conjunto);

  return (
    <Fragment>
      <tr
        className="border-b cursor-pointer hover:bg-muted/50"
        onClick={onAbrir}
        aria-expanded={aberta}
      >
        <td className="py-2">
          <span className="inline-flex items-center gap-1.5">
            <ChevronRight
              className={cn(
                "w-3.5 h-3.5 text-muted-foreground transition-transform",
                aberta && "rotate-90",
              )}
            />
            {linha.nome}
          </span>
          {/*
            A linha sem fonte operacional diz o que falta, embaixo do nome. É a
            diferença entre uma célula vazia que espera arquivo e uma que espera
            decisão — e a planilha não distingue as duas.
          */}
          {linha.falta && (
            <span className="block pl-5 text-xs text-muted-foreground">
              sem fonte operacional: falta {linha.falta}
            </span>
          )}
        </td>
        {colunas.map((c) => (
          <td
            key={c.rotulo}
            className="py-2 text-right font-mono tabular-nums text-xs sm:text-sm"
          >
            {dinheiro(c.de(linha.devido))}
          </td>
        ))}
        <td className="py-2 pl-4 align-top">
          <Auditar achado={achado} />
        </td>
      </tr>

      {aberta && (
        <tr className="border-b bg-muted/30">
          <td colSpan={colunas.length + 2} className="py-3 px-8 space-y-2 text-sm">
            {/*
              O achado vem primeiro, antes da memória de cálculo: quem abriu uma
              linha marcada abriu por causa da marca.
            */}
            {achado && (
              <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                <span className="font-semibold">Auditar — {achado.marca}. </span>
                {achado.texto}
                {achado.onde === "CONJUNTO" && conjunto && (
                  <span className="mt-1 block text-amber-900/80 dark:text-amber-200/80">
                    As linhas que dividem este número — {conjunto.linhas.join(", ")} — trazem
                    a mesma marca, e trazem porque a diferença é do grupo: o relatório não o
                    parte, e não se sabe de qual delas ela vem.
                  </span>
                )}
              </p>
            )}
            <Memoria linha={linha} />
            <OutrasLeituras linha={linha} colunas={colunas} temPlanilha={temPlanilha} />
            <p className="text-xs text-muted-foreground">
              Na planilha: <code>{linha.rotulo}</code>
              {linha.celulaDaPlanilha && (
                <>
                  {" · células "}
                  <code>
                    {[linha.celulaDaPlanilha.primeira, linha.celulaDaPlanilha.segunda]
                      .filter(Boolean)
                      .join(" / ")}
                  </code>
                </>
              )}
            </p>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

/** A conta que produziu o número, quinzena a quinzena. */
function Memoria({ linha }: { linha: LinhaComparada }) {
  const memorias = (
    [
      ["1ª quinzena", linha.memoria.primeira],
      ["2ª quinzena", linha.memoria.segunda],
    ] as const
  ).filter(([, texto]) => Boolean(texto));

  if (memorias.length === 0) return null;

  return (
    <div className="space-y-0.5">
      {memorias.map(([quando, texto]) => (
        <p key={quando} className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{quando}: </span>
          {texto}
        </p>
      ))}
    </div>
  );
}

/**
 * As outras duas leituras da mesma linha — o demonstrado e a planilha anexada.
 *
 * Elas saem das colunas e entram aqui de propósito. A pergunta desta aba é *o
 * sistema chega ao resultado?*, e a conferência entre fontes é uma segunda
 * pergunta que tem tela própria (`Inconsistências`). Escondê-las por completo
 * seria pior: quem está discutindo uma linha específica quer os três números
 * juntos, e um clique é o preço certo por eles.
 */
function OutrasLeituras({
  linha,
  colunas,
  temPlanilha,
}: {
  linha: LinhaComparada;
  colunas: ColunaDoResumo[];
  temPlanilha: boolean;
}) {
  const emConjunto = linha.conjunto !== null;
  const leituras: { rotulo: string; valores: TresColunas | null; nota?: string }[] = [
    {
      rotulo: "Demonstrado (03.08.20)",
      valores: linha.demonstrado,
      nota: emConjunto
        ? `O relatório traz este número junto com ${linha.conjunto!.linhas.join(", ")} — ` +
          "ele não parte a frota por tipo, e o contrato parte."
        : undefined,
    },
  ];
  if (temPlanilha) {
    leituras.push({
      rotulo: "Planilha anexada",
      valores: linha.planilha,
      nota: linha.causaConhecida ?? undefined,
    });
  }

  return (
    <table className="w-full text-xs">
      <tbody>
        {leituras.map((l) => (
          <tr key={l.rotulo} className="align-top">
            <td className="py-1 pr-4 text-muted-foreground">
              {l.rotulo}
              {l.nota && <span className="block text-muted-foreground/80">{l.nota}</span>}
            </td>
            {colunas.map((c) => (
              <td
                key={c.rotulo}
                className="py-1 text-right font-mono tabular-nums min-w-32"
              >
                {l.valores === null
                  ? "—"
                  : dinheiro(c.de(l.valores))}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * O fecho — as três últimas linhas do `RESUMO GERAL`.
 *
 * `Total geral unidade` é o que o contrato manda pagar; `Total geral SRTrans` é
 * o `Total Remuneração` do 03.08.20, que é o mesmo número que a aba `Verbas`
 * fecha. As duas abas terminarem no mesmo lugar é o que faz delas duas vistas e
 * não duas contas.
 */
function Fecho({
  painel,
  colunas,
}: {
  painel: PainelComparado;
  colunas: ColunaDoResumo[];
}) {
  const linhas: { rotulo: string; valores: TresColunas; forte?: boolean; nota?: string }[] =
    [
      {
        rotulo: "Total geral unidade",
        valores: painel.fecho.totalGeralDaUnidade,
        nota: "Do contrato e dos relatórios — remuneração + outros custos + equipe de entrega.",
      },
      {
        rotulo: "Total geral SRTrans",
        valores: painel.fecho.totalGeralDoSrtrans,
        nota: "O Total Remuneração do 03.08.20 — o mesmo número que a aba Verbas fecha.",
      },
      {
        rotulo: "Diferença — total geral",
        valores: painel.fecho.diferenca,
        forte: true,
        nota: "SRTrans menos unidade, no sinal da planilha.",
      },
    ];

  return (
    <table className="w-full text-sm border-t-2">
      <tbody>
        {linhas.map((l) => (
          <tr key={l.rotulo} className={cn("border-b last:border-0", l.forte && "font-bold")}>
            <td className="py-2">
              {l.rotulo}
              {l.nota && (
                <span className="block text-xs font-normal text-muted-foreground">
                  {l.nota}
                </span>
              )}
            </td>
            {colunas.map((c) => (
              <td
                key={c.rotulo}
                className="py-2 text-right font-mono tabular-nums min-w-32 align-top"
              >
                {dinheiro(c.de(l.valores))}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
