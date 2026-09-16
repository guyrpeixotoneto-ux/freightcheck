import { Users } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  ROTULO_DO_ESTADO,
  SELO_DO_ESTADO,
  corDaDiferenca,
  escreverCargo,
  escreverDiferenca,
  escreverRubrica,
  escreverValor,
  escreverVariacao,
  type LinhaDeQlpComparado,
} from "@/lib/qlp-comparacao";

/**
 * O detalhe de um cargo — as variáveis dele lado a lado, na mesma gaveta.
 *
 * Recebe as linhas que a comparação já trouxe para aquele cargo: não faz uma
 * segunda consulta e não recalcula nada. É a mesma gaveta das seis auditorias
 * de rubrica, com duas diferenças que o quadro de pessoal obriga.
 *
 * **As variáveis vêm agrupadas por rubrica.** Um cargo administrativo tem 21
 * colunas e um operacional 30; uma lista corrida de trinta linhas é onde o
 * salário e o vale-transporte ficam a vinte linhas um do outro sem que nada
 * diga que são assuntos diferentes.
 *
 * **As que não entram em soma ficam separadas, no fim.** Os subtotais mudam
 * junto com as parcelas deles, e lidos na mesma lista fazem a mesma mudança
 * parecer várias — é o aviso mais caro do dicionário da tabela de equipe.
 */
export function DetalheDoCargo({
  cargo,
  linhas,
  rotulos,
  rotuloBase,
  rotuloComparada,
  onFechar,
}: {
  /** A chave normalizada do cargo aberto, ou `null` com a gaveta fechada. */
  cargo: string | null;
  linhas: LinhaDeQlpComparado[];
  rotulos: Record<string, string>;
  rotuloBase: string;
  rotuloComparada: string;
  onFechar: () => void;
}) {
  if (!cargo) return null;

  const doCargo = linhas.filter((l) => l.entityLabel === cargo);
  const somaveis = doCargo.filter((l) => l.foraDaSoma === null);
  const foraDaSoma = doCargo.filter((l) => l.foraDaSoma !== null);
  const { unidade, cargo: nome } = escreverCargo(cargo, rotulos);

  /* Por rubrica, na ordem em que as rubricas apareceram — que é a ordem do
     catálogo, porque é dela que a tabela veio. */
  const porRubrica = new Map<string, LinhaDeQlpComparado[]>();
  for (const linha of somaveis) {
    const chave = linha.rubrica ?? "";
    const lista = porRubrica.get(chave);
    if (lista) lista.push(linha);
    else porRubrica.set(chave, [linha]);
  }

  return (
    <Sheet open onOpenChange={(aberto) => !aberto && onFechar()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            <Users className="h-4 w-4 text-brand" aria-hidden="true" />
            {nome}
          </SheetTitle>
          <SheetDescription>
            {unidade && <span className="font-mono">{unidade}</span>}
            {unidade && " · "}
            {rotuloBase} → {rotuloComparada}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 flex flex-col gap-5">
          {[...porRubrica.entries()].map(([rubrica, doGrupo]) => (
            <section key={rubrica || "sem-rubrica"}>
              <h3 className="mb-2 text-sm font-bold">{escreverRubrica(rubrica || null)}</h3>
              <TabelaDoDetalhe linhas={doGrupo} />
            </section>
          ))}

          {foraDaSoma.length > 0 && (
            <section>
              <h3 className="mb-1 text-sm font-bold">Fora de toda soma</h3>
              <p className="mb-2 text-[0.7rem] text-muted-foreground">
                Subtotais, benchmark e colunas sem rubrica declarada. Elas mudam junto com as
                parcelas que as compõem — somá-las às parcelas conta a mesma mudança duas vezes.
              </p>
              <ul className="flex flex-col gap-2 text-sm">
                {foraDaSoma.map((l, i) => (
                  <li key={`${l.variavel}-${i}`} className="flex flex-col gap-0.5">
                    <span className="flex flex-wrap items-baseline gap-2">
                      <span className="font-semibold">{l.rotuloDaVariavel}</span>
                      <span className="font-mono tabular-nums">
                        {escreverValor(l.base, l.medida)} → {escreverValor(l.comparada, l.medida)}
                      </span>
                      <span
                        className={cn(
                          "font-mono text-xs tabular-nums",
                          corDaDiferenca(l.diferenca, l.medida),
                        )}
                      >
                        {escreverDiferenca(l.diferenca, l.medida)}
                      </span>
                    </span>
                    <span className="text-[0.7rem] text-muted-foreground">{l.foraDaSoma}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-r-lg border-l-[3px] border-brand bg-brand/10 px-3 py-2.5 text-xs">
            <p>
              <strong className="font-semibold">
                Nenhum total de dinheiro aparece nesta gaveta.
              </strong>{" "}
              As colunas do QLP chegam sem semântica confirmada: somar despesa de ordenados com
              despesa de encargos exige saber que as duas são montantes da mesma natureza, e isso
              é decisão de curadoria, não de tela. Cada variável aparece com os dois lados e a
              diferença dela — que não depende de confirmação nenhuma.
            </p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TabelaDoDetalhe({ linhas }: { linhas: LinhaDeQlpComparado[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[30rem] border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/60 text-[0.65rem] uppercase tracking-[0.07em] text-muted-foreground">
            <th scope="col" className="px-3 py-2 text-left font-bold">Variável</th>
            <th scope="col" className="px-3 py-2 text-right font-bold">De</th>
            <th scope="col" className="px-3 py-2 text-right font-bold">Para</th>
            <th scope="col" className="px-3 py-2 text-right font-bold">Δ</th>
            <th scope="col" className="px-3 py-2 text-left font-bold">Status</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={`${l.variavel}-${i}`} className="border-b last:border-0">
              <td className="px-3 py-1.5">{l.rotuloDaVariavel}</td>
              <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                {escreverValor(l.base, l.medida)}
              </td>
              <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                {escreverValor(l.comparada, l.medida)}
              </td>
              <td
                className={cn(
                  "px-3 py-1.5 text-right font-mono tabular-nums",
                  corDaDiferenca(l.diferenca, l.medida),
                )}
              >
                {escreverVariacao(l.variacao)}
              </td>
              <td className="px-3 py-1.5">
                <span
                  className={cn(
                    "inline-flex rounded-full px-2 py-0.5 text-[0.7rem] font-semibold",
                    SELO_DO_ESTADO[l.estado],
                  )}
                >
                  {ROTULO_DO_ESTADO[l.estado]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
