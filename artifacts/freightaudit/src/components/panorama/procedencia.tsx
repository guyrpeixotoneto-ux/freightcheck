import {
  CircleSlash,
  CloudDownload,
  Database,
  FileStack,
  Lock,
  RotateCw,
  TriangleAlert,
} from "lucide-react";
import { Link } from "wouter";
import { EstadoVazio } from "@/components/ui/estado-vazio";
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
 * **A cobertura auditada saiu deste andar, e não foi para outro.** Ela era um
 * percentual do acervo inteiro publicado debaixo do cabeçalho de uma unidade:
 * `/balance` não aceitava recorte, de modo que PERNAMBUCO e a Visão Geral
 * exibiam o mesmo número — ele nunca foi de unidade nenhuma. A fonte agora é
 * `/balance/recorte`, recortada pela mesma unidade, canal e competência dos
 * cinco andares acima.
 *
 * E o que entra no lugar são **contagens**, não um percentual recortado. A razão
 * é de aritmética, não de tela: o resíduo — célula que não chegou a destino —
 * nunca virou fato, logo não tem unidade nem vigência a que pertencer, e é
 * justamente a parcela que o Rastreio de Dados existe para achar. Ratear o
 * irrateável para publicar "99,2% desta unidade" seria dar precisão a um número
 * que não a tem. Então o andar diz quantos arquivos alimentaram este recorte,
 * quantos deles fecham, quantas células deste recorte viraram fato, e de quando
 * é a última importação **dele** — cada uma sendo o que o nome diz.
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
  const { arquivos, ultima } = procedencia;
  const inteiro = (n: number) => n.toLocaleString("pt-BR");

  return (
    <>
      {/*
        A pastilha do recorte, e ela não é enfeite: é o que este andar não tinha
        e por isso mentia de escopo. Um número de procedência sem o recorte ao
        lado é indistinguível de um número do acervo inteiro — que é exactamente
        o que ele era.
      */}
      <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-accent border px-2.5 py-1 text-3xs font-bold text-brand">
        <FileStack className="w-3 h-3 shrink-0" />
        {procedencia.recorte.label} · o mesmo recorte dos andares acima
      </p>

      <div className="grid gap-5 sm:grid-cols-3 mt-5">
        <Medida
          icone={FileStack}
          rotulo="Fontes deste recorte"
          valor={inteiro(arquivos.total)}
          tom={arquivos.fecham === arquivos.total ? "ok" : "grave"}
          nota={
            arquivos.fecham === arquivos.total
              ? `${arquivos.total === 1 ? "a importação fecha" : "todas fecham"}: nenhuma célula sem destino`
              : `${inteiro(arquivos.total - arquivos.fecham)} de ${inteiro(arquivos.total)} não fecham`
          }
        />

        <Medida
          icone={Database}
          rotulo="Células deste recorte"
          valor={inteiro(procedencia.celulasEmFato)}
          tom={null}
          /*
            A nota diz de que população é o outro número, porque é o único jeito
            de os dois conviverem sem se confundir: a massa é dos arquivos, e a
            contagem de cima é do recorte. Sem esta frase, quem divide uma pela
            outra inventa o percentual que o contrato recusa.
          */
          nota={`viraram fato · os arquivos trouxeram ${inteiro(procedencia.massaDosArquivos)} células ao todo`}
        />

        {ultima && (
          <Medida
            icone={CloudDownload}
            rotulo="Última importação deste recorte"
            valor={ultima.hora}
            tom={null}
            nota={`${ultima.relativo} · ${ultima.filename}`}
          />
        )}
      </div>

      {procedencia.residuo > 0 ? (
        <p className="text-xs text-muted-foreground leading-snug mt-5 pt-4 border-t">
          {inteiro(procedencia.residuo)}{" "}
          {procedencia.residuo === 1 ? "célula ficou" : "células ficaram"} fora da auditoria nos
          arquivos que alimentam este recorte — o Rastreio de Dados diz quais e por quê.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground leading-snug mt-5 pt-4 border-t">
          Toda célula que estes arquivos trouxeram chegou a um destino declarado.
        </p>
      )}

      {/*
        A ressalva que torna a conta defensável, e ela só aparece quando é
        verdadeira: um arquivo multi-unidade entra legitimamente na procedência
        de todas as unidades que alimentou, e o resíduo dele é **do arquivo**.
        Dizer isso é o que impede alguém de somar a massa de três recortes e
        achar que tem o acervo.
      */}
      {!arquivos.exclusivos && (
        <p className="text-xs text-muted-foreground leading-snug mt-2">
          Parte destes arquivos alimenta outras unidades ou competências: a massa e o resíduo
          acima são <strong>deles</strong>, e não deste recorte.
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
        Conferindo as importações deste recorte…
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
      titulo="Nenhuma importação deste recorte passou pela conferência"
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
  icone: typeof Database;
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
