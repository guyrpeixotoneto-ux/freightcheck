import { CheckCircle2, CircleAlert, Info, Sparkles, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { numero, percentual, type ResumoDaCobertura } from "./tipos";

/**
 * O topo da tela: está tudo coberto?
 *
 * Cinco números e uma frase, e nenhum deles é decorativo. O que ficou de fora
 * é tão deliberado quanto o que ficou: não há contagem de arquivos importados,
 * de linhas lidas nem de vigências no sistema — esses três respondem "o que
 * entrou", que é a pergunta de Importações, e tê-los aqui foi o que fez a
 * versão anterior desta tela parecer um inventário.
 *
 * **A cobertura crítica vem antes da geral em importância, e ao lado dela em
 * tamanho.** 99,7% de cobertura total com 92% de cobertura crítica é uma
 * análise comprometida; 96,4% com 100% não é. Quem lê só o número grande da
 * esquerda tira a conclusão errada nos dois casos, e é por isso que a frase do
 * veredito fica embaixo dos dois, escrita por extenso.
 */
export function Resumo({ resumo }: { resumo: ResumoDaCobertura }) {
  const comprometida = resumo.veredito.estado === "COMPROMETIDA";
  const semDado = resumo.veredito.estado === "SEM_DADO";

  return (
    <section className="mt-6">
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-5">
        <Numero
          valor={percentual(resumo.geral.percentual)}
          rotulo="Cobertura geral"
          detalhe={`${numero(resumo.geral.combinacoesEncontradas)} de ${numero(
            resumo.geral.combinacoesEsperadas - resumo.geral.combinacoesNaoAplicaveis,
          )} combinações esperadas`}
          destaque
        />
        <Numero
          valor={percentual(resumo.critica.percentual)}
          rotulo="Cobertura crítica"
          detalhe={
            resumo.critica.combinacoesEsperadas === 0
              ? "nenhum dado crítico declarado"
              : `${numero(resumo.critica.atributosEncontrados)} de ${numero(
                  resumo.critica.atributosEsperados,
                )} atributos que sustentam análise`
          }
          tom={comprometida ? "alerta" : semDado ? "neutro" : "bom"}
        />
        <Numero
          valor={numero(resumo.lacunas.total)}
          rotulo={resumo.lacunas.total === 1 ? "Lacuna" : "Lacunas"}
          detalhe={
            resumo.lacunas.total === 0
              ? "nada esperado está faltando"
              : `${numero(resumo.lacunas.critico)} crítica${
                  resumo.lacunas.critico === 1 ? "" : "s"
                } · ${numero(resumo.lacunas.relevante)} relevante${
                  resumo.lacunas.relevante === 1 ? "" : "s"
                }`
          }
          tom={resumo.lacunas.critico > 0 ? "alerta" : "neutro"}
        />
        <Numero
          valor={numero(resumo.conjuntosParciais)}
          rotulo={resumo.conjuntosParciais === 1 ? "Conjunto parcial" : "Conjuntos parciais"}
          detalhe={
            resumo.conjuntosAusentes > 0
              ? `${numero(resumo.conjuntosAusentes)} ausente${
                  resumo.conjuntosAusentes === 1 ? "" : "s"
                } por completo`
              : "nenhum conjunto ausente"
          }
        />
        <Numero
          valor={numero(resumo.novos)}
          rotulo={resumo.novos === 1 ? "Dado novo" : "Dados novos"}
          detalhe={
            resumo.novos === 0
              ? "o universo conhecido não mudou"
              : "atributos que não faziam parte do universo conhecido"
          }
        />
      </div>

      <div
        className={cn(
          "mt-5 bg-card border border-l-[6px] px-6 py-4 flex gap-3 items-start",
          comprometida ? "border-l-brand-red" : semDado ? "border-l-border" : "border-l-success",
        )}
        role="status"
      >
        {comprometida ? (
          <TriangleAlert className="w-5 h-5 mt-0.5 shrink-0 text-brand-red" />
        ) : semDado ? (
          <Info className="w-5 h-5 mt-0.5 shrink-0 text-muted-foreground" />
        ) : (
          <CheckCircle2 className="w-5 h-5 mt-0.5 shrink-0 text-success" />
        )}
        <div className="min-w-0">
          <p className="font-semibold">{resumo.veredito.frase}</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-4xl">
            Cobertura crítica mede só os atributos que sustentam as análises do FreightCheck —
            os que o plano da DRE declara essenciais. Perseguir 100% de cobertura total importa
            menos do que manter esta em 100%.
          </p>
        </div>
      </div>
    </section>
  );
}

function Numero({
  valor,
  rotulo,
  detalhe,
  destaque,
  tom,
}: {
  valor: string;
  rotulo: string;
  detalhe: string;
  destaque?: boolean;
  tom?: "bom" | "alerta" | "neutro";
}) {
  return (
    <div
      className={cn(
        "bg-card border border-t-[3px] p-5",
        destaque && "border-t-brand",
        tom === "bom" && "border-t-success",
        tom === "alerta" && "border-t-brand-red",
        !destaque && !tom && "border-t-border",
      )}
    >
      <div
        className={cn(
          "text-3xl font-bold tabular-nums",
          tom === "alerta" && "text-brand-red",
          tom === "bom" && "text-success",
        )}
      >
        {valor}
      </div>
      <div className="text-sm mt-1">{rotulo}</div>
      <div
        className="text-xs text-muted-foreground mt-2 pt-2 border-t line-clamp-2"
        title={detalhe}
      >
        {detalhe}
      </div>
    </div>
  );
}

/** O selo de uma novidade, para reaproveitar fora do resumo. */
export function SeloDeNovidade({ quantidade }: { quantidade: number }) {
  if (quantidade === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-brand">
      <Sparkles className="w-3 h-3" />
      {quantidade} novo{quantidade === 1 ? "" : "s"}
    </span>
  );
}

/** O aviso de medição incompleta — nunca um número otimista em silêncio. */
export function MedicaoIncompleta({
  incompleto,
}: {
  incompleto: { vigencia: string; motivo: string }[];
}) {
  if (incompleto.length === 0) return null;
  return (
    <div className="mt-5 bg-card border border-l-[6px] border-l-warning px-6 py-4 flex gap-3 text-sm">
      <CircleAlert className="w-4 h-4 mt-0.5 shrink-0 text-warning" />
      <div>
        <strong>Medição incompleta.</strong>{" "}
        {incompleto.length === 1 ? "Uma vigência não pôde" : `${incompleto.length} vigências não puderam`}{" "}
        ser medida
        {incompleto.length === 1 ? "" : "s"}: {incompleto.map((i) => i.vigencia).join(", ")}. O que
        elas trazem não está contado como presente — a cobertura acima é o piso, não o retrato.
      </div>
    </div>
  );
}
