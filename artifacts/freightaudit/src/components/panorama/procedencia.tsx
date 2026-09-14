import {
  CircleSlash,
  CloudDownload,
  Database,
  Lock,
  RotateCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { Link } from "wouter";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { escreverPercentual } from "@/lib/visao-geral";
import { cn } from "@/lib/utils";
import type {
  EstadoDaProcedencia,
  FalhaDaProcedencia,
  Procedencia as DadosDaProcedencia,
} from "@/lib/panorama";
import type { Tom } from "@/lib/visao-geral";

const COR_DO_TOM: Record<Tom, string> = {
  grave: "text-red-700",
  atencao: "text-amber-700",
  ok: "text-emerald-700",
};

/**
 * Andar 6 — a procedência. *"Posso confiar nisto?"*
 *
 * **O último andar, e deliberadamente o último.** Quem abre a tela vem ver
 * dinheiro, e a qualidade do dado nunca deve competir com o financeiro pelo
 * primeiro olhar — a mesma ordem que o Resumo executivo já praticava com o
 * cartão "Qualidade da auditoria".
 *
 * É também o único andar que lê fontes fora de `/changes` (`/balance` e
 * `/imports`), e o único que responde por *como sabemos* em vez de por *quanto
 * foi*.
 *
 * **É aqui que mora a cobertura auditada** — células alcançadas ÷ células
 * importadas —, e é essa mudança de lugar que conserta o defeito que a seção
 * tinha: o Impacto Líquido publicava "Cobertura financeira" e o Resumo
 * executivo publicava "Cobertura auditada", as duas em percentual, as duas num
 * anel, as duas coloridas pela mesma régua. Quem abria as duas telas na mesma
 * vigência via dois números do mesmo recorte sem pista de que falavam de
 * populações diferentes. Agora a da apuração fica no placar, qualificando o
 * líquido, e a auditada fica aqui, qualificando o dado — separadas por assunto,
 * e cada uma dizendo por extenso do que é percentual.
 *
 * **O andar não some mais.** Ele desenhava só quando tinha os três números, e
 * sumia calado nos outros quatro casos — carregando, sem importação conferida,
 * leitura falhada e acesso negado. Some quatro fatos diferentes reduzidos ao
 * mesmo nada, num andar cuja pergunta é literalmente *"posso confiar nisto?"*:
 * quem lia a tela não tinha como distinguir **ausência de evidência** de
 * **evidência de ausência**, que é o par que uma auditoria existe para separar.
 * {@link EstadoDaProcedencia} é onde os desfechos viraram seis, e cada um deles
 * é desenhado aqui — inclusive o parcial, que é o que de fato acontece quando
 * uma das duas rotas responde e a outra não.
 */
export function Procedencia({
  estado,
  /** Reler as duas fontes. `null` quando a tela não tem como mandar reler. */
  onTentarDeNovo,
}: {
  estado: EstadoDaProcedencia;
  onTentarDeNovo?: (() => void) | null;
}) {
  return (
    <section className="superficie px-6 py-5" aria-label="A procedência dos números">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-bold">De onde vêm estes números</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Medidas da apuração, não da remuneração
          </p>
        </div>
        <Link
          href="/rastreio-de-dados"
          className="text-xs font-semibold text-brand hover:underline"
        >
          Rastreio de Dados →
        </Link>
      </div>

      {estado.estado === "carregando" && <Carregando />}
      {estado.estado === "vazia" && <Vazia />}
      {estado.estado === "falha" && (
        <Falha falhas={estado.falhas} onTentarDeNovo={onTentarDeNovo} />
      )}
      {estado.estado === "sem_acesso" && <SemAcesso falhas={estado.falhas} />}
      {(estado.estado === "pronta" || estado.estado === "parcial") && (
        <Medidas procedencia={estado.procedencia} />
      )}
      {estado.estado === "parcial" && (
        <Parcial faltou={estado.faltou} onTentarDeNovo={onTentarDeNovo} />
      )}
    </section>
  );
}

/**
 * Os três números, quando eles existem.
 *
 * É o corpo que este andar sempre teve. O que mudou em volta dele é que ele
 * deixou de ser a única coisa que o arquivo sabe desenhar.
 */
function Medidas({ procedencia }: { procedencia: DadosDaProcedencia }) {
  const { cobertura, qualidade, integridade, ultima } = procedencia;

  return (
    <>
      <div className="grid gap-5 sm:grid-cols-3 mt-5">
        {cobertura && (
          <Medida
            icone={ShieldCheck}
            rotulo="Cobertura auditada"
            valor={escreverPercentual(cobertura.percentual, 1)}
            tom={qualidade?.tom ?? null}
            /*
              O rótulo diz "das células importadas" por extenso, e não "%
              coberto". Chamar de "% do valor importado" daria a um número de
              massa a autoridade de um número de remuneração — a nota original
              de `cobertura`, em `lib/visao-geral.ts`.
            */
            nota={`das células importadas · ${cobertura.celulas.toLocaleString("pt-BR")} conferidas em ${cobertura.importacoes} ${
              cobertura.importacoes === 1 ? "importação" : "importações"
            }`}
          />
        )}

        {integridade && (
          <Medida
            icone={Database}
            rotulo={integridade.titulo}
            valor={integridade.ok ? "íntegro" : "atenção"}
            tom={integridade.ok ? "ok" : "grave"}
            nota={integridade.detalhe}
          />
        )}

        {ultima && (
          <Medida
            icone={CloudDownload}
            rotulo="Última importação"
            valor={ultima.hora}
            tom={null}
            nota={`${ultima.relativo} · ${ultima.filename}`}
          />
        )}
      </div>

      {cobertura && cobertura.foraDaAuditoria > 0 && (
        <p className="text-xs text-muted-foreground leading-snug mt-5 pt-4 border-t">
          {cobertura.foraDaAuditoria.toLocaleString("pt-BR")}{" "}
          {cobertura.foraDaAuditoria === 1 ? "célula ficou" : "células ficaram"} fora da auditoria
          — o Rastreio de Dados diz quais e por quê.
        </p>
      )}

      {cobertura && cobertura.foraDaAuditoria === 0 && (
        <p className="text-xs text-muted-foreground leading-snug mt-5 pt-4 border-t">
          Toda célula que os arquivos trouxeram chegou a um destino declarado.
        </p>
      )}
    </>
  );
}

/**
 * O carregamento — o esqueleto das três medidas, e não uma frase.
 *
 * `aria-hidden` com um `role="status"` ao lado, pela mesma razão do esqueleto
 * da tela inteira: três retângulos cinzas não são informação nenhuma para quem
 * lê por áudio, e a frase é.
 */
function Carregando() {
  return (
    <>
      <span role="status" className="sr-only">
        Conferindo as importações desta competência…
      </span>
      <div aria-hidden className="grid gap-5 sm:grid-cols-3 mt-5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3 min-w-0">
            <span className="w-8 h-8 rounded-lg bg-muted animate-pulse shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-20 rounded bg-muted animate-pulse" />
              <div className="h-3 w-24 rounded bg-muted animate-pulse" />
              <div className="h-3 w-full rounded bg-muted animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * Não há o que conferir — e a diferença para a falha está escrita.
 *
 * A conta de conservação nasce da promoção de uma importação. Sem nenhuma
 * promovida nesta leitura não há balanço a resumir, e isso **não** põe em
 * dúvida os cinco andares acima: eles leem o canônico, que existe. A frase diz
 * as duas coisas, porque quem chega aqui está decidindo se leva o número para
 * uma reunião.
 */
function Vazia() {
  return (
    <EstadoVazio
      className="mt-5"
      compacto
      icone={CircleSlash}
      titulo="Nenhuma importação desta leitura passou pela conferência"
      descricao="Os números dos andares acima continuam válidos — o que falta é a conta de conservação que diz se alguma célula se perdeu no caminho. Ela é gerada quando a importação é promovida."
      acao={
        <Link href="/importacoes" className="text-xs font-semibold text-brand hover:underline">
          Ver as importações →
        </Link>
      }
    />
  );
}

/**
 * A leitura falhou — e é isto, e não outra coisa, que a tela diz.
 *
 * A primeira frase é a que o andar existia para não precisar dizer e passou a
 * precisar: **não há dado** e **não consegui ler** são dois fatos diferentes, e
 * desenhar nada os tornava o mesmo. A segunda salva os cinco andares acima, que
 * continuam de pé — a procedência é sobre a confiança neles, não sobre a
 * existência deles.
 *
 * O endereço e o status saem por extenso porque é o que faz a pessoa na tela e
 * quem lê o log se encontrarem.
 */
function Falha({
  falhas,
  onTentarDeNovo,
}: {
  falhas: FalhaDaProcedencia[];
  onTentarDeNovo?: (() => void) | null;
}) {
  return (
    <div className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4 flex items-start gap-4 flex-wrap">
      <span className="rounded-full bg-destructive/10 text-destructive p-2 shrink-0">
        <TriangleAlert className="w-5 h-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-destructive leading-snug">
          Não foi possível conferir a procedência
        </p>
        <p className="text-xs text-muted-foreground mt-1 leading-snug">
          Este andar não está dizendo que não há dado — está dizendo que não conseguiu ler. Os
          andares acima continuam de pé; o que falta é a resposta que diria o quanto dá para
          confiar neles.
        </p>
        <ListaDeFalhas falhas={falhas} />
      </div>
      {onTentarDeNovo && <BotaoDeTentarDeNovo onTentarDeNovo={onTentarDeNovo} />}
    </div>
  );
}

/**
 * O acesso não alcança esta leitura — que **não** é a mesma coisa que ela ter
 * falhado.
 *
 * Um número sem procedência por falta de acesso não é um número sem
 * procedência: o andar existe, tem dado, e quem está na frente da tela é que
 * não o vê. Mandar essa pessoa procurar o servidor seria mandá-la ao lugar
 * errado, e é por isso que 401 e 403 saem daqui e não da faixa vermelha.
 *
 * **Não há botão de tentar de novo.** Repetir o pedido devolve o mesmo 403, e
 * um botão que não pode funcionar é uma promessa que a tela não cumpre.
 */
function SemAcesso({ falhas }: { falhas: FalhaDaProcedencia[] }) {
  return (
    <div className="mt-5 rounded-xl border bg-muted/40 px-5 py-4 flex items-start gap-4">
      <span className="rounded-full bg-accent text-brand p-2 shrink-0">
        <Lock className="w-5 h-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold leading-snug">
          Seu acesso não alcança a conferência das importações
        </p>
        <p className="text-xs text-muted-foreground mt-1 leading-snug">
          O andar existe e tem dado — você é que não o vê. A diferença importa: um número sem
          procedência por falta de acesso não é um número sem procedência. Peça o acesso a quem
          administra a sua unidade.
        </p>
        <ListaDeFalhas falhas={falhas} />
      </div>
    </div>
  );
}

/**
 * Uma respondeu, a outra não.
 *
 * É o estado que o desenho original não previa e o que mais acontece: são duas
 * rotas, e elas falham separadamente. Derrubar o andar inteiro jogaria fora uma
 * resposta que chegou; publicar só o que veio, calado, apresentaria meia
 * procedência como se fosse inteira. Aqui as medidas de cima são as que
 * responderam, e esta faixa é o nome do que falta.
 */
function Parcial({
  faltou,
  onTentarDeNovo,
}: {
  faltou: FalhaDaProcedencia[];
  onTentarDeNovo?: (() => void) | null;
}) {
  const soAcesso = faltou.every((falha) => falha.semAcesso);

  return (
    <div className="mt-5 pt-4 border-t flex items-start gap-3 flex-wrap">
      <span className="text-amber-700 shrink-0 mt-0.5">
        {soAcesso ? <Lock className="w-4 h-4" /> : <TriangleAlert className="w-4 h-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-amber-700 leading-snug">
          {soAcesso
            ? "Esta procedência está incompleta: parte dela está fora do seu acesso."
            : "Esta procedência está incompleta: uma das fontes não respondeu."}
        </p>
        <p className="text-xs text-muted-foreground mt-1 leading-snug">
          O que está acima é o que respondeu, e só isso. Não leia esta faixa como a conferência
          inteira desta leitura.
        </p>
        <ListaDeFalhas falhas={faltou} />
      </div>
      {!soAcesso && onTentarDeNovo && <BotaoDeTentarDeNovo onTentarDeNovo={onTentarDeNovo} />}
    </div>
  );
}

/**
 * O endereço, o status e a hora de cada leitura que não respondeu.
 *
 * A hora é a do registro da falha (`errorUpdatedAt`), e nunca um `new Date()`
 * feito aqui: ela diz quando a tentativa falhou, e não que horas são agora — a
 * mesma regra da linha de "dados atualizados às" do cabeçalho.
 */
function ListaDeFalhas({ falhas }: { falhas: FalhaDaProcedencia[] }) {
  if (falhas.length === 0) return null;

  return (
    <ul className="mt-2 space-y-0.5">
      {falhas.map((falha) => (
        <li key={falha.rota} className="text-3xs font-mono text-muted-foreground">
          {falha.rota}
          {falha.status !== null ? ` · HTTP ${falha.status}` : " · sem resposta do servidor"}
          {falha.quando !== null &&
            ` · ${falha.quando.toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}`}
        </li>
      ))}
    </ul>
  );
}

function BotaoDeTentarDeNovo({ onTentarDeNovo }: { onTentarDeNovo: () => void }) {
  return (
    <button
      type="button"
      onClick={onTentarDeNovo}
      className="flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-xs font-bold text-foreground hover:bg-accent transition-colors shrink-0"
    >
      <RotateCw className="w-3.5 h-3.5" />
      Tentar de novo
    </button>
  );
}

function Medida({
  icone: Icone,
  rotulo,
  valor,
  tom,
  nota,
}: {
  icone: typeof ShieldCheck;
  rotulo: string;
  valor: string;
  tom: Tom | null;
  nota: string;
}) {
  return (
    <div className="flex gap-3 min-w-0">
      <span className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center shrink-0">
        <Icone className={cn("w-4 h-4", tom ? COR_DO_TOM[tom] : "text-brand")} strokeWidth={2.25} />
      </span>
      <div className="min-w-0">
        <p className={cn("text-lg font-extrabold leading-tight", tom ? COR_DO_TOM[tom] : "")}>
          {valor}
        </p>
        <p className="text-[0.8125rem] font-semibold leading-tight mt-0.5">{rotulo}</p>
        <p className="text-xs text-muted-foreground leading-snug mt-1">{nota}</p>
      </div>
    </div>
  );
}
