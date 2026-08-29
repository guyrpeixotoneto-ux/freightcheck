import { AlertTriangle, Loader2, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiErrorNotice } from "@/components/api-error";
import { cn } from "@/lib/utils";
import {
  farolNoCatalogo,
  FRASE_DO_MOTIVO,
  idadeEmPalavras,
  ordenarPorGravidade,
  ROTULO_DO_MOTIVO,
  valorComUnidade,
  type EstadoDaEtapa,
  type Farol,
  type Monitoramento,
} from "@/lib/monitoramento-de-fluxo";
import type { PropsDaVisao } from "@/components/fluxos/visao";

/**
 * VISUALIZAÇÃO 7 — O MONITORAMENTO: o mesmo processo, com o que os dados dizem
 * dele agora.
 *
 * ---------------------------------------------------------------------------
 * O que esta visualização acrescenta, e o que ela se proíbe
 * ---------------------------------------------------------------------------
 *
 * As outras seis são projeções puras do `FluxoCompleto` que já está em memória.
 * Esta é a primeira que **lê de fora**: ela mostra o resultado de
 * `GET /fluxos/:id/monitoramento`, apurado no servidor, com os coletores que a
 * instalação tem ligados.
 *
 * O que ela **não** faz, e é a razão de caber em uma tela só:
 *
 * - **não decide cor.** `VERDE`, `AMARELO`, `VERMELHO` e `SEM_DADO` chegam
 *   decididos, e o rótulo, a descrição e a classe de cada um saem de `FAROIS`,
 *   no motor. Não há um `switch` por cor neste arquivo;
 * - **não recalcula validade.** `vencida` e `idadeEmSegundos` vêm do servidor;
 * - **não completa buraco.** Etapa sem medição aparece apagada, com a causa
 *   escrita — nunca verde, nunca em branco, nunca escondida;
 * - **não escreve nada.** Como as outras seis, é leitura. Trocar para cá e
 *   voltar não pode criar linha nenhuma no banco.
 *
 * ---------------------------------------------------------------------------
 * Todas as etapas aparecem — inclusive as que ninguém mede
 * ---------------------------------------------------------------------------
 *
 * Uma lista só com as etapas monitoradas seria a tela mais bonita e a mais
 * enganosa possível: hoje três de dezoito etapas do fluxo do CTe têm coletor, e
 * mostrar só essas três daria a impressão de um processo inteiramente
 * observado. As quinze restantes aparecem, apagadas, dizendo `sem coletor` — e
 * é essa lista que informa o tamanho real do trabalho que falta.
 *
 * A ordem é por gravidade, e não a do processo: aqui a pergunta é "o que está
 * ruim agora", e uma etapa vermelha na posição 14 não pode exigir rolagem. O
 * desenho na ordem do processo continua nas outras seis visualizações.
 *
 * ---------------------------------------------------------------------------
 * A falha de um coletor não apaga a tela
 * ---------------------------------------------------------------------------
 *
 * `falhas[]` vem sempre na resposta, e aparece no cabeçalho com o nome do
 * coletor e a mensagem. As etapas que dependiam dele ficam `SEM_DADO` com o
 * motivo `coletor falhou`; **todas as outras continuam acesas**. Um farol
 * apagado por integração fora do ar precisa dizer isso a quem está olhando, e
 * não ao arquivo de quem estiver de plantão.
 */
export function VisaoMonitoramento({
  completo,
  etapaSelecionada,
  onSelecionarEtapa,
  monitoramento,
  carregando,
  erro,
  onRecarregar,
  recarregando,
}: PropsDaVisao & {
  monitoramento: Monitoramento | undefined;
  carregando: boolean;
  erro: unknown;
  onRecarregar: () => void;
  recarregando: boolean;
}) {
  if (erro) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <ApiErrorNotice
          error={erro}
          what="o monitoramento deste fluxo"
          onTentarDeNovo={onRecarregar}
          tentando={recarregando}
        />
      </div>
    );
  }

  if (carregando || !monitoramento) {
    return (
      <div className="h-full space-y-2 overflow-y-auto p-4">
        <Skeleton className="h-20 w-full" />
        {completo.etapas.map((etapa) => (
          <Skeleton key={etapa.id} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  const emOrdem = ordenarPorGravidade(monitoramento.etapas);

  return (
    <div className="h-full overflow-y-auto">
      <Cabecalho
        monitoramento={monitoramento}
        onRecarregar={onRecarregar}
        recarregando={recarregando}
      />
      <div className="divide-y border-t">
        {emOrdem.map((estado) => (
          <LinhaDaEtapa
            key={estado.etapaId}
            estado={estado}
            selecionada={estado.etapaId === etapaSelecionada}
            onSelecionar={() => onSelecionarEtapa(estado.etapaId)}
          />
        ))}
      </div>
      {emOrdem.length === 0 && (
        <p className="p-6 text-sm text-muted-foreground">
          Este fluxo não tem etapas para monitorar.
        </p>
      )}
    </div>
  );
}

/**
 * O cabeçalho — as duas contas separadas, o instante da apuração e as falhas.
 *
 * As contas ficam separadas de propósito, e é a mesma disciplina de
 * `resumoDoFluxo`: **um fluxo com uma etapa verde e quinze sem coletor não é um
 * fluxo verde**, e qualquer média o pintaria assim. Por isso não há aqui um
 * número único de saúde — há quantas estão acesas, quantas responderam, quantas
 * venceram e quantas ninguém mede.
 */
function Cabecalho({
  monitoramento,
  onRecarregar,
  recarregando,
}: {
  monitoramento: Monitoramento;
  onRecarregar: () => void;
  recarregando: boolean;
}) {
  const { resumo, falhas, semColetor, apuradoEm } = monitoramento;
  const pior = resumo.pior;

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Monitoramento</span>
          {pior === null ? (
            <Selo farol="SEM_DADO">nenhum farol aceso</Selo>
          ) : (
            <Selo farol={pior}>pior farol: {farolNoCatalogo(pior).rotulo}</Selo>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            apurado {new Date(apuradoEm).toLocaleString("pt-BR")}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            onClick={onRecarregar}
            disabled={recarregando}
          >
            {recarregando ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCcw className="h-3 w-3" />
            )}
            <span className="ml-1.5">Reapurar</span>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <Conta rotulo="etapas" valor={resumo.etapas} />
        <Conta rotulo="com farol aceso" valor={resumo.medidas} />
        <Conta rotulo="responderam" valor={resumo.respondidas} />
        <Conta rotulo="leituras vencidas" valor={resumo.vencidas} />
        <Conta rotulo="sem dado" valor={resumo.semDado} />
        <Conta rotulo="chaves sem coletor" valor={semColetor.length} />
      </div>

      {/*
        A distribuição por cor, com `SEM_DADO` **fora** da mesma régua das
        outras três: ele não é uma nota, é a ausência dela.
      */}
      <div className="flex flex-wrap items-center gap-2">
        {(["VERDE", "AMARELO", "VERMELHO", "SEM_DADO"] as Farol[]).map((farol) => (
          <Selo key={farol} farol={farol}>
            {resumo.porFarol[farol]} {farolNoCatalogo(farol).rotulo.toLowerCase()}
          </Selo>
        ))}
      </div>

      {falhas.length > 0 && (
        <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5">
          <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-500">
            <AlertTriangle className="h-3.5 w-3.5" />
            {falhas.length === 1
              ? "Um coletor falhou nesta apuração"
              : `${falhas.length} coletores falharam nesta apuração`}
          </p>
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {falhas.map((falha, i) => (
              <li key={`${falha.coletor}-${i}`}>
                <span className="font-medium">{falha.coletor}</span> ·{" "}
                {falha.motivo} — {falha.mensagem}
                {falha.chaves.length > 0 && (
                  <span> (sem resposta para {falha.chaves.join(", ")})</span>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            As demais etapas continuam apuradas — a falha de um coletor não apaga
            as medições dos outros.
          </p>
        </div>
      )}
    </div>
  );
}

function Conta({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <span>
      <span className="font-semibold tabular-nums text-foreground">{valor}</span>{" "}
      {rotulo}
    </span>
  );
}

/**
 * O selo de uma cor — rótulo e classe vindos de `FAROIS`, nunca escritos aqui.
 */
function Selo({
  farol,
  children,
}: {
  farol: Farol;
  children: React.ReactNode;
}) {
  const entrada = farolNoCatalogo(farol);
  return (
    <span
      title={entrada.descricao}
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        entrada.classe,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Uma etapa — o farol, o que foi medido, e a causa quando não foi.
 *
 * A linha inteira é clicável e abre o painel da etapa, o mesmo das outras seis
 * visualizações: clicar aqui e clicar num cartão do fluxograma têm de levar ao
 * mesmo lugar.
 */
function LinhaDaEtapa({
  estado,
  selecionada,
  onSelecionar,
}: {
  estado: EstadoDaEtapa;
  selecionada: boolean;
  onSelecionar: () => void;
}) {
  const entrada = farolNoCatalogo(estado.farol);
  const valor = valorComUnidade(estado);
  const idade = idadeEmPalavras(estado.idadeEmSegundos);
  const apagada = estado.farol === "SEM_DADO";

  return (
    <button
      type="button"
      onClick={onSelecionar}
      className={cn(
        "flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/50",
        selecionada && "bg-muted",
      )}
    >
      <span
        aria-hidden
        className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border", entrada.classe)}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="truncate text-sm font-medium">{estado.etapaNome}</span>
          <span className="sr-only">{entrada.rotulo}</span>
          {estado.chave ? (
            <code className="text-[11px] text-muted-foreground">{estado.chave}</code>
          ) : (
            <span className="text-[11px] text-muted-foreground">sem chave</span>
          )}
          {valor !== null && (
            <span className="text-xs font-semibold tabular-nums">{valor}</span>
          )}
        </div>

        {/*
          A frase do coletor, quando há medição. Ela é a única coisa desta tela
          escrita por quem mede, e é onde está a ressalva do que o farol **não**
          diz — a defesa contra a tela prometer mais do que mediu.
        */}
        {estado.leitura?.texto && (
          <p className="mt-0.5 text-xs text-muted-foreground">{estado.leitura.texto}</p>
        )}

        {/*
          A causa do apagado. Nunca um cinza mudo: as cinco causas pedem
          providências diferentes, e a frase é a que faz alguém agir.
        */}
        {apagada && estado.motivo && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {FRASE_DO_MOTIVO[estado.motivo]}
          </p>
        )}

        {/*
          A medição vencida não some: a etapa passa a dizer "sem dado — o último
          era vermelho, há 3 dias", que é a informação que manda conferir o
          coletor em vez de confiar no cinza.
        */}
        {estado.vencida && estado.leitura && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Última medição: {farolNoCatalogo(estado.leitura.farol).rotulo.toLowerCase()}
            {idade ? `, ${idade}` : ""}.
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <Selo farol={estado.farol}>
          {apagada && estado.motivo ? ROTULO_DO_MOTIVO[estado.motivo] : entrada.rotulo}
        </Selo>
        {idade !== null && !estado.vencida && (
          <span className="text-[11px] text-muted-foreground">{idade}</span>
        )}
      </div>
    </button>
  );
}
