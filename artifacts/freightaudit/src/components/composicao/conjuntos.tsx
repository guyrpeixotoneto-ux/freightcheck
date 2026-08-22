import { useState } from "react";
import { Link } from "wouter";
import { ChevronDown, ChevronRight, Info, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBrl, formatBrlShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Bolinha, VariacaoMensal } from "./farol";
import {
  ROTULO_DA_NATUREZA,
  ROTULO_DO_FAROL,
  type Farol,
  type LadoDoConjunto,
  type LinhaDoConjunto,
  type VisaoDeConjuntos,
} from "./tipos";

/**
 * Conjuntos — o cavalo e a carreta lidos como uma unidade só.
 *
 * **A tela é uma conferência, e a coluna que a justifica é a última.** A fonte
 * entrega a remuneração do conjunto pronta, em `custoFixo`; o produto apura o
 * cavalo e a carreta separadamente, cada um pela ficha dele. Os dois caminhos
 * têm de chegar ao mesmo número, e é isso que a linha mostra: o que a fonte
 * declara, o que as duas fichas somam, e a diferença entre os dois.
 *
 * Foi por não fazer isso que a aba ficou desligada até agora — repetir a coluna
 * `custoFixo` numa terceira tela não diria nada que a ficha da carreta não diga.
 * Confrontá-la com a soma que o produto apurou por outro caminho diz.
 */

export interface FiltrosDeConjuntos {
  busca: string;
  status: Farol | "";
  comDivergencia: boolean;
  semPar: boolean;
  comAlteracao: boolean;
}

export const SEM_FILTRO_DE_CONJUNTOS: FiltrosDeConjuntos = {
  busca: "",
  status: "",
  comDivergencia: false,
  semPar: false,
  comAlteracao: false,
};

export function ResumoDosConjuntos({ view }: { view: VisaoDeConjuntos }) {
  const { resumo } = view;
  const conferenciaFecha = resumo.divergem === 0 && resumo.conferidos > 0;

  return (
    <section className="bg-card border rounded-md">
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0">
        <div className="px-6 py-5">
          <div className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
            Remuneração mensal do conjunto
          </div>
          <div className="text-3xl font-bold tabular-nums mt-1 tracking-tight">
            {resumo.declaradoTotal === null ? (
              <span className="text-muted-foreground text-xl font-normal">não declarada</span>
            ) : (
              <>
                {formatBrlShort(resumo.declaradoTotal)}
                <span className="text-base font-normal text-muted-foreground">/mês</span>
              </>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {resumo.comDeclarado} de {resumo.conjuntos} conjuntos com total declarado pela fonte
          </div>
          {/*
            Como a frota se pareia, embaixo do número que ela forma. Cada
            equipamento entra em exatamente um conjunto — é isso que permite
            somar a coluna sem contar ninguém duas vezes, e é a leitura que dá
            sentido ao "de {resumo.conjuntos}" da linha acima.
          */}
          <div className="text-xs text-muted-foreground mt-0.5">
            {resumo.pareados} pareados · {resumo.carretasOrfas} carretas sem cavalo
            {resumo.cavalosSemCarreta > 0 && (
              <> · {resumo.cavalosSemCarreta} cavalos sem carreta</>
            )}
          </div>
        </div>

        <div className="px-6 py-5">
          <div className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
            Contra {view.anterior?.periodLabel ?? "a vigência anterior"}
          </div>
          <div className="text-3xl font-bold tabular-nums mt-1 tracking-tight">
            <VariacaoMensal
              variacao={
                resumo.variacaoTotal === null
                  ? null
                  : { absoluta: resumo.variacaoTotal, percentual: null }
              }
            />
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {resumo.comAumento} com aumento · {resumo.comReducao} com redução
            {resumo.trocaramDeCarreta > 0 && (
              <> · {resumo.trocaramDeCarreta} trocaram de carreta</>
            )}
          </div>
        </div>

        {/*
          A conferência. É o número que dá razão à aba: quantos conjuntos o
          produto conseguiu refazer pelo caminho das duas fichas e chegar ao
          mesmo total que a fonte declara.
        */}
        <div className="px-6 py-5">
          <div className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
            Conferência com a fonte
          </div>
          <div
            className={cn(
              "text-3xl font-bold tabular-nums mt-1 tracking-tight",
              conferenciaFecha ? "text-emerald-600" : resumo.divergem > 0 ? "text-brand-red" : "",
            )}
          >
            {resumo.fecham}
            <span className="text-base font-normal text-muted-foreground">
              {" "}
              de {resumo.conferidos}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {resumo.divergem === 0
              ? `cavalo + carreta reproduz o total declarado, dentro de ${formatBrl(
                  view.toleranciaDaConferencia,
                )}`
              : `${resumo.divergem} ${
                  resumo.divergem === 1 ? "conjunto não fecha" : "conjuntos não fecham"
                } com o que a fonte declara`}
          </div>
        </div>

        <div className="px-6 py-5">
          <div className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
            Situação dos conjuntos
          </div>
          <div className="flex items-center gap-4 mt-2.5 flex-wrap">
            {(["CRITICO", "ATENCAO", "NORMAL", "INCOMPLETO"] as Farol[]).map((farol) => (
              <span key={farol} className="inline-flex items-center gap-1.5 text-sm">
                <Bolinha farol={farol} />
                <span className="tabular-nums font-semibold">{resumo.porFarol[farol]}</span>
                <span className="text-muted-foreground text-xs">
                  {ROTULO_DO_FAROL[farol].toLowerCase()}
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function BarraDeFiltrosDosConjuntos({
  filtros,
  onMudar,
  resultado,
}: {
  filtros: FiltrosDeConjuntos;
  onMudar: (f: FiltrosDeConjuntos) => void;
  resultado: string;
}) {
  const alternar = (chave: "comDivergencia" | "semPar" | "comAlteracao") =>
    onMudar({ ...filtros, [chave]: !filtros[chave] });

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filtros.busca}
          onChange={(e) => onMudar({ ...filtros, busca: e.target.value })}
          placeholder="Placa do cavalo ou da carreta"
          className="pl-9 w-72"
        />
      </div>

      <Select
        value={filtros.status === "" ? "TODOS" : filtros.status}
        onValueChange={(v) =>
          onMudar({ ...filtros, status: v === "TODOS" ? "" : (v as Farol) })
        }
      >
        <SelectTrigger className="w-44">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="TODOS">Todos os status</SelectItem>
          {(["CRITICO", "ATENCAO", "NORMAL", "INCOMPLETO"] as Farol[]).map((f) => (
            <SelectItem key={f} value={f}>
              {ROTULO_DO_FAROL[f]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {(
        [
          ["comDivergencia", "Que não fecham com a fonte"],
          ["semPar", "Sem par formado"],
          ["comAlteracao", "Com alteração na vigência"],
        ] as const
      ).map(([chave, rotulo]) => (
        <button
          key={chave}
          type="button"
          onClick={() => alternar(chave)}
          className={cn(
            "px-3 py-2 text-sm rounded-md border transition-colors",
            filtros[chave]
              ? "border-brand bg-accent text-brand font-medium"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          {rotulo}
        </button>
      ))}

      {resultado && (
        <span className="text-xs text-muted-foreground ml-auto tabular-nums">
          {resultado} conjuntos
        </span>
      )}
    </div>
  );
}

/**
 * A tabela dos conjuntos.
 *
 * A ordem das colunas é a ordem da conta: **o que a fonte declara**, depois
 * **quanto disso é do cavalo e quanto é da carreta**, e por último **o que
 * sobra**. Ler da esquerda para a direita é refazer a decomposição.
 *
 * A diferença nunca aparece como "R$ 0,00" quando não houve conferência: um
 * zero conferido e uma conferência que não pôde ser feita são coisas
 * diferentes, e confundi-las numa tela de auditoria é a mentira mais cara que
 * esta tabela poderia contar.
 */
export function TabelaDeConjuntos({ view }: { view: VisaoDeConjuntos }) {
  const [aberta, setAberta] = useState<string | null>(null);

  if (view.linhas.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center border rounded-md bg-card">
        Nenhum conjunto nesta vigência com os filtros aplicados.
      </p>
    );
  }

  return (
    <div className="bg-card border rounded-md overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
            <th className="w-8 px-4 py-2.5" />
            <th className="text-left px-2 py-2.5 font-semibold">Conjunto</th>
            <th className="text-left px-4 py-2.5 font-semibold">Formação</th>
            <th className="text-right px-4 py-2.5 font-semibold">Declarado pela fonte</th>
            <th className="text-right px-4 py-2.5 font-semibold">Cavalo</th>
            <th className="text-right px-4 py-2.5 font-semibold">Carreta</th>
            <th className="text-right px-4 py-2.5 font-semibold">Diferença</th>
            <th className="text-right px-4 py-2.5 font-semibold">Variação</th>
            <th className="w-8 px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {view.linhas.map((linha) => (
            <LinhaDaTabela
              key={linha.id}
              linha={linha}
              view={view}
              aberta={aberta === linha.id}
              onAlternar={() => setAberta(aberta === linha.id ? null : linha.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LinhaDaTabela({
  linha,
  view,
  aberta,
  onAlternar,
}: {
  linha: LinhaDoConjunto;
  view: VisaoDeConjuntos;
  aberta: boolean;
  onAlternar: () => void;
}) {
  return (
    <>
      <tr
        className="border-b last:border-0 hover:bg-muted/40 transition-colors cursor-pointer"
        onClick={onAlternar}
      >
        <td className="px-4 py-3">
          <Bolinha farol={linha.status.farol} titulo={linha.status.motivos.join(" ")} />
        </td>
        <td className="px-2 py-3">
          <span className="font-semibold font-mono tracking-wide">{linha.rotulo}</span>
          {linha.carretaAnterior && (
            <div className="text-[0.6875rem] text-amber-600">
              antes: {linha.carretaAnterior}
            </div>
          )}
        </td>
        <td className="px-4 py-3 text-xs text-muted-foreground uppercase tracking-wide">
          {ROTULO_DA_NATUREZA[linha.natureza]}
        </td>
        <td className="px-4 py-3 text-right">
          {linha.declarado === null ? (
            <span className="text-muted-foreground text-xs">não declarado</span>
          ) : (
            <>
              <span className="font-semibold tabular-nums text-base">
                {formatBrl(linha.declarado)}
              </span>
              <span className="text-muted-foreground text-xs">/mês</span>
            </>
          )}
        </td>
        <Lado lado={linha.cavalo} effectiveDate={view.effectiveDate} />
        <Lado lado={linha.carreta} effectiveDate={view.effectiveDate} />
        <td className="px-4 py-3 text-right">
          <Diferenca linha={linha} />
        </td>
        <td className="px-4 py-3 text-right">
          <VariacaoMensal variacao={linha.variacao} semSinalNulo />
        </td>
        <td className="px-4 py-3 text-right text-muted-foreground">
          {aberta ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </td>
      </tr>
      {aberta && (
        <tr className="border-b last:border-0 bg-muted/20">
          <td />
          <td colSpan={8} className="px-2 py-4 pr-6">
            <Detalhe linha={linha} view={view} />
          </td>
        </tr>
      )}
    </>
  );
}

function Lado({ lado, effectiveDate }: { lado: LadoDoConjunto | null; effectiveDate: string }) {
  if (lado === null) {
    return <td className="px-4 py-3 text-right text-muted-foreground text-xs">—</td>;
  }
  return (
    <td className="px-4 py-3 text-right">
      {lado.mensal === null ? (
        <span className="text-muted-foreground text-xs">não apurado</span>
      ) : (
        <span className="tabular-nums">{formatBrl(lado.mensal)}</span>
      )}
      <div className="text-[0.6875rem] text-muted-foreground font-mono">
        <Link
          href={`/composicao/${lado.entityId}?period=${effectiveDate}`}
          onClick={(e) => e.stopPropagation()}
          className="hover:text-brand transition-colors"
        >
          {lado.placa ?? "sem placa"}
        </Link>
      </div>
    </td>
  );
}

function Diferenca({ linha }: { linha: LinhaDoConjunto }) {
  if (linha.divergencia === null) {
    return <span className="text-muted-foreground text-xs">sem conferência</span>;
  }
  if (linha.fecha) {
    return (
      <span className="text-emerald-600 text-xs">
        fecha
        {linha.divergencia !== 0 && (
          <span className="text-muted-foreground ml-1 tabular-nums">
            ({linha.divergencia > 0 ? "+" : "−"}
            {formatBrl(Math.abs(linha.divergencia))})
          </span>
        )}
      </span>
    );
  }
  return (
    <span className="text-brand-red font-semibold tabular-nums">
      {linha.divergencia > 0 ? "+" : "−"}
      {formatBrl(Math.abs(linha.divergencia))}
    </span>
  );
}

/**
 * A conta aberta, para a linha que alguém decidiu conferir.
 *
 * É a memória de cálculo do conjunto: as parcelas de cada lado, a soma, o total
 * declarado e a diferença. Quem quiser ir mais fundo — até a célula da planilha
 * — chega lá pela ficha de cada equipamento, que é o único lugar onde a
 * proveniência é carregada.
 */
function Detalhe({ linha, view }: { linha: LinhaDoConjunto; view: VisaoDeConjuntos }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground max-w-3xl">{linha.explicacaoDoVinculo}</p>

      <div className="grid gap-4 md:grid-cols-2">
        <ParcelasDoLado titulo="Cavalo" lado={linha.cavalo} />
        <ParcelasDoLado titulo="Carreta" lado={linha.carreta} />
      </div>

      <div className="border-t pt-3 text-sm space-y-1 max-w-xl">
        <div className="flex justify-between gap-6">
          <span className="text-muted-foreground">Soma apurada pelas duas fichas</span>
          <span className="tabular-nums font-medium">
            {linha.apurado === null ? "não apurada" : `${formatBrl(linha.apurado)}/mês`}
          </span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-muted-foreground">
            Declarado pela fonte
            {linha.declaradoTitulo && (
              <span className="font-mono text-xs ml-1.5">{linha.declaradoTitulo}</span>
            )}
          </span>
          <span className="tabular-nums font-medium">
            {linha.declarado === null ? "não declarado" : `${formatBrl(linha.declarado)}/mês`}
          </span>
        </div>
        <div className="flex justify-between gap-6 border-t pt-1">
          <span className="text-muted-foreground">
            Diferença (tolerância de {formatBrl(view.toleranciaDaConferencia)})
          </span>
          <span className="tabular-nums font-semibold">
            <Diferenca linha={linha} />
          </span>
        </div>
        {linha.fonte && (
          <div className="text-xs text-muted-foreground pt-1 font-mono">{linha.fonte}</div>
        )}
      </div>

      {linha.status.motivos.length > 0 && (
        <div className="flex gap-2 text-sm border-l-[3px] border-l-brand pl-3">
          <Info className="w-4 h-4 mt-0.5 shrink-0 text-brand" />
          <ul className="space-y-1">
            {linha.status.motivos.map((motivo) => (
              <li key={motivo}>{motivo}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ParcelasDoLado({ titulo, lado }: { titulo: string; lado: LadoDoConjunto | null }) {
  return (
    <div>
      <div className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
        {titulo}
        {lado?.placa && <span className="font-mono ml-1.5 normal-case">{lado.placa}</span>}
      </div>
      {lado === null ? (
        <p className="text-sm text-muted-foreground mt-1">
          Este conjunto não tem {titulo.toLowerCase()} nesta vigência.
        </p>
      ) : lado.componentes.length === 0 ? (
        <p className="text-sm text-muted-foreground mt-1">
          Nenhum componente mensal apurado nesta vigência.
        </p>
      ) : (
        <table className="w-full text-sm mt-1">
          <tbody>
            {lado.componentes.map((componente) => (
              <tr key={componente.code}>
                <td className="py-0.5 pr-4">
                  {componente.titulo}
                  <span className="text-muted-foreground font-mono text-[0.6875rem] ml-1.5">
                    {componente.code}
                  </span>
                </td>
                <td className="py-0.5 text-right tabular-nums">
                  {formatBrl(componente.valor)}
                </td>
              </tr>
            ))}
            <tr className="border-t">
              <td className="py-0.5 pr-4 text-muted-foreground">Subtotal</td>
              <td className="py-0.5 text-right tabular-nums font-medium">
                {lado.mensal === null ? "—" : formatBrl(lado.mensal)}
              </td>
            </tr>
          </tbody>
        </table>
      )}
      {lado !== null && lado.semRegraFinanceira > 0 && (
        <div className="text-[0.6875rem] text-muted-foreground mt-1">
          + {lado.semRegraFinanceira} componentes monetários ainda sem regra financeira
        </div>
      )}
    </div>
  );
}
