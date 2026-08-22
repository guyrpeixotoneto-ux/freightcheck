import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Link } from "wouter";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { fetchJson } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  APARENCIA,
  APARENCIA_DA_CRITICIDADE,
  numero,
  ORIGEM_DO_ESPERADO,
  percentual,
  type AberturaDoAtributo,
  type DetalheDaLacuna,
  type EntidadeAusente,
  type PontoDoHistorico,
} from "./tipos";
import { caminhoDaFicha, tituloDaPlacaAusente } from "./ficha-da-entidade";

/**
 * A gaveta de uma célula da tabela de atributos.
 *
 * A tabela mostra "62/64" e a cor; quem clica quer as quatro perguntas que o
 * número levanta e que não cabem numa célula: **quanto**, **por quê**, **quem**
 * e **desde quando**. As quatro em ordem, num painel que abre por cima e deixa
 * a tabela atrás — a linha clicada continua na tela, e fechar devolve o leitor
 * exatamente onde ele estava.
 *
 * **Por que gaveta, e não uma seção abaixo.** Era uma seção, e ela nascia
 * embaixo da matriz: clicar numa célula de Jul/26 na trigésima linha da tabela
 * rolava a página para um painel a duzentos pixels dali, e voltar para comparar
 * com Ago/26 era rolar de novo. A informação é sobre **uma célula**, e uma
 * célula tem endereço na tela — o painel precisa não tirar esse endereço do
 * campo de visão.
 *
 * **A gaveta não recebe números; ela os pede.** Abre sabendo só (vigência,
 * atributo), e o servidor devolve a medida inteira, de `medirAtributo` — a
 * mesma função que somou a célula da matriz e desenhou a linha da tabela. A
 * alternativa seria carregar consigo o que a célula já tinha e completar com
 * uma chamada, e aí a gaveta exibiria uma medida montada em dois lugares: a
 * metade que veio da tabela e a metade que veio da resposta. Duas metades
 * concordam hoje.
 */
export function GavetaDoAtributo({
  abertura,
  aoFechar,
}: {
  abertura: AberturaDoAtributo | null;
  aoFechar: () => void;
}) {
  if (!abertura) return null;
  return <Conteudo abertura={abertura} aoFechar={aoFechar} />;
}

function Conteudo({
  abertura,
  aoFechar,
}: {
  abertura: AberturaDoAtributo;
  aoFechar: () => void;
}) {
  const { snapshotId, attributeCode } = abertura;

  const detalhe = useQuery({
    queryKey: ["coverage", "gap", snapshotId, attributeCode],
    /*
      Sem vigência não há o que pedir: `/coverage/gap` é endereçado por
      `snapshotId`, e o conjunto não existe neste período. A gaveta ainda abre —
      com a frase que explica o traço e com o histórico, que é a pergunta que
      sobra: "então quando ele existiu?".
    */
    enabled: snapshotId !== null,
    queryFn: () =>
      fetchJson<DetalheDaLacuna>(
        `/coverage/gap/${snapshotId}/${encodeURIComponent(attributeCode)}`,
      ),
    retry: false,
  });

  const escopo = detalhe.data?.vigencia.scopeHash;
  const canal = detalhe.data?.vigencia.canal;
  const historico = useQuery({
    queryKey: ["coverage", "history", attributeCode, escopo, canal],
    /*
      A série é pedida **deste** recorte, e não do atributo no mundo. Um
      histórico que somasse escopos mostraria a unidade vizinha entregando a
      coluna e faria parecer que o dado existe aqui.
    */
    enabled: snapshotId === null || detalhe.isSuccess,
    queryFn: () => {
      const query = new URLSearchParams();
      if (escopo) query.set("escopo", escopo);
      if (canal) query.set("canal", canal);
      const sufixo = query.toString();
      return fetchJson<PontoDoHistorico[]>(
        `/coverage/history/${encodeURIComponent(attributeCode)}${sufixo ? `?${sufixo}` : ""}`,
      );
    },
    retry: false,
  });

  const d = detalhe.data;
  const medida = d?.medida;
  const aparencia = medida ? APARENCIA[medida.estado] : null;

  return (
    <Sheet open onOpenChange={(aberto) => !aberto && aoFechar()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl p-0 flex flex-col gap-0"
      >
        <header className="px-7 pt-7 pb-5 border-b shrink-0">
          <p className="flex items-center gap-2 flex-wrap text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Atributo</span>
            {d && (
              <span
                className={cn(
                  "px-1.5 py-0.5 border text-[0.625rem]",
                  APARENCIA_DA_CRITICIDADE[d.criticidade].classe,
                )}
              >
                {APARENCIA_DA_CRITICIDADE[d.criticidade].rotulo}
              </span>
            )}
            {aparencia && (
              <span
                className={cn("px-1.5 py-0.5 border text-[0.625rem]", aparencia.classe)}
              >
                {aparencia.rotulo}
              </span>
            )}
          </p>

          <SheetTitle className="text-2xl font-extrabold tracking-tight mt-2 pr-8">
            {d?.attributeLabel ?? abertura.attributeLabel}
          </SheetTitle>

          <SheetDescription className="mt-1.5 leading-snug">
            <code className="text-xs">{attributeCode}</code>
            {d?.sourceName && d.sourceName !== attributeCode && (
              <> · coluna “{d.sourceName}” no arquivo</>
            )}
          </SheetDescription>

          <p className="text-xs text-muted-foreground mt-1">
            {abertura.periodo}
            {d && (
              <>
                {" · "}
                {d.equipamentoLabel} · {d.vigencia.scopeLabel}
                {d.vigencia.canal ? ` · ${d.vigencia.canal}` : ""} · revisão{" "}
                {d.vigencia.revision} ({d.vigencia.sourceLabel})
              </>
            )}
          </p>

          {d?.secaoDaDRE && (
            <p className="text-xs text-brand mt-1.5">
              Alimenta <strong>{d.secaoDaDRE}</strong> na DRE.
            </p>
          )}

          {/*
            O número grande é o da pergunta que a célula levanta, e ele muda com
            o estado: onde há expectativa, o percentual; onde não há, a frase.
            Um "100%" numa célula que ninguém cobra é verdadeiro e enganoso.
          */}
          {medida && (
            <div className="mt-4">
              {medida.esperado ? (
                <>
                  <p
                    className={cn(
                      "text-[2rem] font-extrabold tabular-nums leading-none",
                      medida.entidadesFaltando > 0 ? "text-brand-red" : "text-success",
                    )}
                  >
                    {percentual(medida.percentual)}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {numero(medida.entidadesPresentes)} de{" "}
                    {numero(medida.entidadesEsperadas - medida.naoAplicaveis)}{" "}
                    {d!.equipamentoLabel.toLowerCase()}s com o dado
                  </p>
                </>
              ) : (
                <p className="text-lg font-bold text-muted-foreground">
                  {medida.dispensado
                    ? "Dispensado por decisão registrada"
                    : "Chegou sem ninguém cobrar"}
                </p>
              )}
            </div>
          )}
        </header>

        <div className="flex-1 overflow-y-auto px-7 py-6 space-y-8">
          {snapshotId === null && (
            <p className="text-sm text-muted-foreground">
              Esta vigência não trouxe este conjunto — não há o que medir aqui. O histórico
              abaixo mostra em quais vigências o atributo existiu.
            </p>
          )}
          {detalhe.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {detalhe.isError && (
            <p className="text-sm text-brand-red">
              Não foi possível abrir este atributo. A tabela atrás continua válida.
            </p>
          )}

          {d && medida && (
            <>
              <Conta detalhe={d} />
              <PorQue detalhe={d} />
              <SemODado detalhe={d} />
            </>
          )}

          {historico.data && historico.data.length > 0 && (
            <Historico pontos={historico.data} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * A conta, decomposta nos quatro sentidos de "não tem valor".
 *
 * Ausente, vazio, não aplicável e zero são quatro coisas — é a distinção que
 * `modelo.ts` abre dizendo, e é aqui que ela precisa aparecer inteira. Uma
 * gaveta que dissesse só "faltam 2" deixaria de fora a pergunta que decide o que
 * fazer: a coluna não veio, ou veio e não trouxe número?
 */
function Conta({ detalhe }: { detalhe: DetalheDaLacuna }) {
  const m = detalhe.medida;
  return (
    <section>
      <h3 className="text-sm font-bold uppercase tracking-wide">Nesta vigência</h3>
      <p className="text-xs text-muted-foreground mt-1">
        {m.noLayout
          ? "A coluna veio no arquivo desta vigência."
          : "A coluna não veio no arquivo desta vigência."}{" "}
        {detalhe.entidadesNaVigencia > 0 &&
          `A vigência trouxe ${numero(detalhe.entidadesNaVigencia)} ${detalhe.equipamentoLabel.toLowerCase()}${
            detalhe.entidadesNaVigencia === 1 ? "" : "s"
          }.`}
      </p>
      <dl className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
        <Numero rotulo="Esperadas" valor={m.entidadesEsperadas} nota="entidades" />
        <Numero rotulo="Com valor" valor={m.entidadesPresentes} destaque="success" />
        <Numero
          rotulo="Sem o dado"
          valor={m.entidadesFaltando}
          destaque={m.entidadesFaltando > 0 ? "alerta" : undefined}
        />
        <Numero
          rotulo="Coluna vazia"
          valor={m.entidadesVazias}
          nota="veio sem número"
        />
        <Numero
          rotulo="Não aplicáveis"
          valor={m.naoAplicaveis}
          nota="fora dos dois lados"
        />
        <Numero
          rotulo="Cobertura"
          valor={m.esperado ? percentual(m.percentual) : "—"}
          nota={m.esperado ? undefined : "nada cobrado aqui"}
        />
      </dl>
      {m.novo && (
        <p className="text-xs text-brand mt-3">
          Estreou nesta vigência — não fazia parte do universo conhecido antes dela.
        </p>
      )}
    </section>
  );
}

function Numero({
  rotulo,
  valor,
  nota,
  destaque,
}: {
  rotulo: string;
  valor: number | string;
  nota?: string;
  destaque?: "success" | "alerta";
}) {
  return (
    <div className="border-l-2 pl-3 border-border">
      <div
        className={cn(
          "text-xl font-bold tabular-nums",
          destaque === "success" && "text-success",
          destaque === "alerta" && "text-brand-red",
        )}
      >
        {typeof valor === "number" ? numero(valor) : valor}
      </div>
      <div className="text-xs mt-0.5">{rotulo}</div>
      {nota && <div className="text-[0.6875rem] text-muted-foreground">{nota}</div>}
    </div>
  );
}

/**
 * Por que o FreightCheck acha que isto deveria existir.
 *
 * Com o selo de declaração ou inferência à vista, e a medição que sustenta a
 * frase logo abaixo. Uma expectativa sem explicação é um palpite com aparência
 * de regra — e quem discorda dela precisa dos números para argumentar, não de
 * um percentual misterioso.
 */
function PorQue({ detalhe }: { detalhe: DetalheDaLacuna }) {
  const j = detalhe.justificativa;
  if (!j) {
    return (
      <section>
        <h3 className="text-sm font-bold uppercase tracking-wide">Por que era esperado</h3>
        <p className="text-sm text-muted-foreground mt-1.5">
          {detalhe.medida.dispensado
            ? "Não era: há dispensa registrada em Curadoria. O atributo sai dos dois lados da conta — a ausência dele aqui é legítima e não reduz cobertura."
            : "Nenhuma origem cobra este atributo nesta vigência. Ele não está declarado no contrato nem no catálogo, e o histórico e a estrutura ainda não o sustentam. O que chegou não conta como cobertura, e o que não chegou não é lacuna."}
        </p>
      </section>
    );
  }

  const medicao = Object.entries(j.medicao).filter(([, v]) => v !== null && v !== "");

  return (
    <section>
      <h3 className="text-sm font-bold uppercase tracking-wide flex items-center gap-2">
        Por que era esperado
        <span
          className={cn(
            "px-1.5 py-0.5 border text-[0.625rem] font-normal normal-case tracking-normal",
            j.declarado
              ? "border-brand/40 text-brand bg-brand/10"
              : "border-border text-muted-foreground",
          )}
        >
          {j.declarado ? "Declaração" : "Inferência"} · {ORIGEM_DO_ESPERADO[j.origem]}
        </span>
      </h3>
      <p className="text-sm mt-2 leading-snug">{j.motivo}</p>
      {medicao.length > 0 && (
        <dl className="mt-3 text-xs grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {medicao.map(([chave, valor]) => (
            <div key={chave} className="flex gap-2 min-w-0">
              <dt className="text-muted-foreground shrink-0">{chave}:</dt>
              <dd className="font-medium break-all tabular-nums">
                {typeof valor === "number" ? numero(valor) : valor}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

/**
 * A placa ausente, clicável.
 *
 * O destino e a frase vêm de `ficha-da-entidade.ts`, que é onde a regra mora —
 * o detalhe da célula oferece a mesma travessia e tem de oferecer a mesma.
 */
function LinkParaAFicha({
  ausente,
  vigencia,
}: {
  ausente: EntidadeAusente;
  vigencia: DetalheDaLacuna["vigencia"];
}) {
  return (
    <Link
      href={caminhoDaFicha(ausente, vigencia)}
      title={tituloDaPlacaAusente(ausente)}
      className={cn(
        "block text-xs px-2 py-1 border font-mono transition-colors",
        "border-brand-red/40 bg-brand-red/5 hover:bg-brand-red/10 hover:border-brand-red",
      )}
    >
      {ausente.rotulo}
    </Link>
  );
}

/**
 * Quem ficou sem o dado — em duas listas, porque são dois problemas.
 *
 * O equipamento que veio na vigência e não trouxe número é um problema da
 * coluna; o que não veio na vigência é um problema da frota, e tem outro dono.
 * Os dois somam no mesmo "faltando", e por muito tempo só o primeiro tinha
 * lista: a gaveta exibia "2 sem o dado" no número e "nenhum equipamento sem o
 * dado" logo abaixo, as duas frases certas nos seus próprios termos e a tela
 * contradizendo a si mesma. A separação aqui é a mesma que o painel do conjunto
 * já fazia.
 */
function SemODado({ detalhe }: { detalhe: DetalheDaLacuna }) {
  const m = detalhe.medida;
  const naVigencia = detalhe.entidades.length + detalhe.naoListadas;
  const naoVieram = detalhe.entidadesAusentes.length;
  if (m.entidadesFaltando === 0 && naVigencia === 0 && naoVieram === 0) return null;

  const equipamento = detalhe.equipamentoLabel.toLowerCase() || "equipamento";

  /*
    Quantos dos que não vieram contam **aqui**.

    Nem sempre são todos, e a diferença não é erro: a expectativa inferida do
    histórico é um piso — "o atributo veio para 76" — enquanto o roster da frota
    pode esperar 80. Quatro dos que faltam ficam fora da conta deste atributo, e
    a gaveta tem de dizer isso: mostrar nove placas embaixo de um "5 sem o dado"
    é a mesma contradição que ela veio corrigir, só que uma casa adiante.
  */
  const contamAqui = Math.max(0, m.entidadesFaltando - naVigencia);
  const frotaEsperada = detalhe.entidadesNaVigencia + naoVieram;

  return (
    <section>
      <h3 className="text-sm font-bold uppercase tracking-wide">
        Quem ficou sem o dado ({numero(m.entidadesFaltando)})
      </h3>
      <p className="text-xs text-muted-foreground mt-1">
        {numero(m.entidadesFaltando)} de{" "}
        {numero(m.entidadesEsperadas - m.naoAplicaveis)} {equipamento}s esperados para este
        atributo. São duas coisas diferentes, e por isso duas listas: a coluna que não trouxe
        número e o {equipamento} que não veio na vigência.
      </p>

      {naVigencia > 0 && (
        <div className="mt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Vieram na vigência e estão sem o dado ({numero(naVigencia)})
          </h4>
          {detalhe.naoListadas > 0 && (
            <p className="text-xs text-warning-foreground mt-1 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />
              {numero(detalhe.naoListadas)} não aparecem nesta lista. Ela é limitada de
              propósito — o que está abaixo é amostra, não o conjunto.
            </p>
          )}
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {detalhe.entidades.map((e) => (
              <li
                key={e.entityId}
                className={cn(
                  "text-xs px-2 py-1 border font-mono",
                  e.estado === "AUSENTE" && "border-brand-red/40 bg-brand-red/5",
                  e.estado === "VAZIO" && "border-warning/40 bg-warning/5",
                )}
                title={
                  e.estado === "AUSENTE"
                    ? "A coluna não veio para este equipamento."
                    : `Coluna entregue e sem valor (${e.nullReason ?? "sem motivo declarado"}).`
                }
              >
                {e.identificador}
              </li>
            ))}
          </ul>
        </div>
      )}

      {naoVieram > 0 && (
        <div className="mt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Não vieram nesta vigência ({numero(naoVieram)})
          </h4>
          <p className="text-xs text-muted-foreground mt-1">
            Estavam em vigências anteriores deste mesmo recorte e não estão nesta — enquanto a
            baixa não for registrada em Curadoria, a cobrança continua.
            {contamAqui < naoVieram && (
              <>
                {" "}
                <strong>{numero(contamAqui)} deles contam como falta aqui:</strong> a frota
                esperada nesta vigência é de {numero(frotaEsperada)} {equipamento}s, e a
                expectativa deste atributo alcança {numero(m.entidadesEsperadas)} — o histórico
                nunca o entregou para mais que isso, e cobrar o resto inventaria lacuna.
              </>
            )}
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {detalhe.entidadesAusentes.map((e) => (
              <li key={e.entityId}>
                <LinkParaAFicha ausente={e} vigencia={detalhe.vigencia} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {m.entidadesFaltando === 0 && (
        <p className="text-sm text-muted-foreground mt-2">
          Nenhum {equipamento} sem o dado nesta vigência.
        </p>
      )}
    </section>
  );
}

/**
 * A série do atributo, vigência a vigência — a resposta a "desde quando".
 *
 * Barras em vez de linha, e a vigência sem a coluna aparece vazia em vez de
 * sumir: uma linha que pula o buraco esconde exatamente a quebra de padrão que
 * se veio ver.
 */
export function Historico({ pontos }: { pontos: PontoDoHistorico[] }) {
  const maximo = Math.max(...pontos.map((p) => p.percentual), 100);
  return (
    <section>
      <h3 className="text-sm font-bold uppercase tracking-wide">Desde quando</h3>
      <p className="text-xs text-muted-foreground mt-1">
        Proporção dos equipamentos de cada vigência com o dado presente, neste mesmo recorte.
      </p>
      <ol className="mt-3 flex items-end gap-2 overflow-x-auto pb-2">
        {pontos.map((p) => (
          <li key={p.snapshotId} className="flex flex-col items-center gap-1 min-w-[3.25rem]">
            <span className="text-[0.625rem] tabular-nums text-muted-foreground">
              {p.noLayout ? `${Math.round(p.percentual)}%` : "—"}
            </span>
            <div
              className="w-full bg-muted flex items-end"
              style={{ height: "3.5rem" }}
              title={`${p.periodo}: ${
                p.noLayout
                  ? `${numero(p.comValor)} de ${numero(p.entidadesNaVigencia)} com dado`
                  : "a coluna não veio nesta vigência"
              }`}
            >
              <div
                className={cn(
                  "w-full",
                  !p.noLayout
                    ? "bg-brand-red/30"
                    : p.percentual >= 100
                      ? "bg-success"
                      : p.percentual >= 50
                        ? "bg-warning"
                        : "bg-brand-red",
                )}
                style={{
                  height: p.noLayout ? `${(p.percentual / maximo) * 100}%` : "100%",
                }}
              />
            </div>
            <span className="text-[0.625rem] text-muted-foreground whitespace-nowrap">
              {p.periodo}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
