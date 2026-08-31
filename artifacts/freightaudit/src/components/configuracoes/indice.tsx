import { Link } from "wouter";
import { ChevronRight, Check, Hammer } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useContextosDaCasca } from "@/lib/contextos";
import { cn } from "@/lib/utils";
import { useContas } from "./contas";
import { useModulosUniversais } from "./modulos-universais-consulta";
import { usePapeis } from "./papeis-consulta";
import { SECOES_GERAIS, estaEmPreparo, type SecaoDeConfiguracao } from "./secoes";

/**
 * O índice da casa: uma linha por seção, com o que cada uma já tem.
 *
 * A lista não é um menu bonito — ela é o **estado do cadastro**. Cada linha
 * carrega a resposta da pergunta que faria alguém abri-la: quantas unidades
 * existem, quantas contas estão ativas, com que papel você entrou. Quem procura
 * "falta cadastrar alguma coisa?" responde sem abrir nada, e quem procura uma
 * seção específica acha pelo nome.
 *
 * **O visto verde é dado, nunca decoração.** Ele aparece quando a seção tem
 * conteúdo no banco — e some quando não tem, com a linha dizendo que está
 * vazia. Um visto que aparecesse por a tela existir marcaria "pronto" numa
 * instalação sem uma única unidade importada, que é exatamente o erro que uma
 * lista assim é feita para não deixar acontecer.
 *
 * **"Em preparo" é a terceira resposta, e não uma quarta cor de pronto.** As
 * seções que o banco ainda não sustenta não contam para o número da seção nem
 * ganham visto: elas dizem o que são, e abrir uma leva à página que explica o
 * que falta. Ver `secoes.ts` para a razão de elas estarem na lista.
 */

interface EstadoDaSecao {
  /** `null` enquanto a resposta não chegou — a linha cala em vez de chutar. */
  pronta: boolean | null;
  /** O que a linha diz à direita do nome, quando há o que dizer. */
  resumo: string | null;
}

const CARREGANDO: EstadoDaSecao = { pronta: null, resumo: null };

const plural = (n: number, um: string, muitos: string) =>
  `${n} ${n === 1 ? um : muitos}`;

export function IndiceDeConfiguracoes() {
  const { user: me } = useAuth();
  const { contextos, carregando: carregandoUnidades, indisponivel } =
    useContextosDaCasca();
  /*
    A mesma consulta da seção de Usuários — uma `queryFn` por chave, como
    `contas.ts` explica. Duas linhas do índice vivem dela: Usuários, para dizer
    quantas contas estão ativas, e Permissões, para dizer sobre quantas dá para
    decidir.
  */
  const { data: contas, isLoading: carregandoContas } = useContas();
  /* A mesma consulta da seção de Papéis, pela razão de `contas.ts`: uma
     `queryFn` por chave. */
  const { data: papeis, isLoading: carregandoPapeis } = usePapeis();
  /*
    A camada da casa: quantas partes do produto esta instalação desligou para
    todo mundo. A linha existe porque zero é a resposta normal e ninguém abriria
    a seção para descobrir isso — e porque, quando não é zero, ela é a primeira
    explicação para "sumiu uma tela do menu de todo mundo".
  */
  const { data: universais, isLoading: carregandoUniversais } =
    useModulosUniversais();

  const estados = new Map<string, EstadoDaSecao>();

  estados.set("/configuracoes/perfil", me
    ? {
        pronta: true,
        resumo: `${me.name} · ${me.role === "ADMIN" ? "administrador" : "operador"}`,
      }
    : CARREGANDO);

  estados.set(
    "/configuracoes/unidades",
    /*
      Falha de rede não é cadastro vazio. Quando a lista não pôde ser buscada, a
      linha volta a "carregando" — sem visto e sem resumo —, porque marcar
      "nenhuma unidade" por causa de um 502 é a tela inventando um fato sobre o
      banco.
    */
    carregandoUnidades || indisponivel
      ? CARREGANDO
      : {
          pronta: contextos.length > 0,
          resumo:
            contextos.length > 0
              ? plural(contextos.length, "seleção com vigência", "seleções com vigência")
              : "Nenhuma vigência importada ainda",
        },
  );

  estados.set(
    "/configuracoes/usuarios",
    carregandoContas || contas === undefined
      ? CARREGANDO
      : {
          pronta: contas.length > 0,
          resumo: `${plural(
            contas.filter((c) => c.disabledAt === null).length,
            "conta ativa",
            "contas ativas",
          )} de ${contas.length}`,
        },
  );

  estados.set(
    "/configuracoes/papeis",
    /*
      O resumo conta os papéis e quantos deles alguém cadastrou: toda instalação
      nasce com os dois do sistema, e dizer só "2 papéis" faria uma casa que
      nunca cadastrou nada parecer configurada.
    */
    carregandoPapeis || papeis === undefined
      ? CARREGANDO
      : {
          pronta: papeis.length > 0,
          resumo: (() => {
            const proprios = papeis.filter((p) => !p.sistema).length;
            return proprios > 0
              ? `${plural(papeis.length, "papel", "papéis")} · ${plural(
                  proprios,
                  "cadastrado aqui",
                  "cadastrados aqui",
                )}`
              : `${plural(papeis.length, "papel", "papéis")} — só os do sistema`;
          })(),
        },
  );

  const outrasContas =
    contas === undefined || me === null
      ? 0
      : contas.filter((c) => c.id !== me.id).length;

  estados.set(
    "/configuracoes/permissoes",
    /*
      O dado da linha é sobre quantas contas dá para decidir, e não quantas
      restrições existem: saber isso exigiria uma consulta por conta, e o índice
      não abre sete telas para se desenhar. A própria conta fica fora da conta
      pela mesma razão que fica fora da caixa de escolha lá dentro — ninguém
      muda o próprio acesso.
    */
    carregandoContas || contas === undefined || me === null
      ? CARREGANDO
      : {
          pronta: outrasContas > 0,
          resumo:
            outrasContas > 0
              ? `${plural(outrasContas, "conta", "contas")} além da sua`
              : "Só a sua conta — ninguém muda o próprio acesso",
        },
  );

  estados.set(
    "/configuracoes/modulos-universais",
    /*
      Sem visto verde, e de propósito: aqui o cadastro cheio é a exceção, e não
      a meta. O visto diz "esta seção tem conteúdo no banco"; nesta, ter
      conteúdo quer dizer que a casa desligou partes do produto — marcar isso de
      verde diria que uma instalação com tudo no ar está pela metade.
    */
    carregandoUniversais || universais === undefined
      ? CARREGANDO
      : {
          pronta: false,
          resumo:
            universais.desligadas.length > 0
              ? `${plural(
                  universais.desligadas.length,
                  "desligado para todo mundo",
                  "desligados para todo mundo",
                )}`
              : "Tudo ligado — o produto inteiro no ar",
        },
  );

  const emPreparo = SECOES_GERAIS.filter((secao) => estaEmPreparo(secao.href));
  const sustentadas = SECOES_GERAIS.filter((secao) => !estaEmPreparo(secao.href));
  const prontas = sustentadas.filter(
    (secao) => estados.get(secao.href)?.pronta === true,
  ).length;

  return (
    <div className="p-8 space-y-6 max-w-4xl">
      <FaixaDoPreparo
        emPreparo={emPreparo.length}
        primeira={emPreparo[0]?.label ?? null}
      />

      <section className="space-y-2">
        <div className="flex items-baseline gap-2 px-1">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Geral
          </h2>
          <span className="text-xs font-semibold text-muted-foreground/80 tabular-nums">
            {prontas}/{sustentadas.length}
          </span>
        </div>

        <ul className="space-y-2">
          {SECOES_GERAIS.map((secao) => (
            <li key={secao.href}>
              <LinhaDaSecao
                secao={secao}
                estado={estados.get(secao.href) ?? CARREGANDO}
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/**
 * A tira do topo: quanto da casa ainda não existe.
 *
 * Ela ocupa o lugar em que um produto costuma pôr um tutorial guiado, e diz a
 * única coisa que este produto sabe dizer com honestidade sobre o próprio
 * progresso — que quatro destas seções são desenho, não cadastro. Quando a
 * última nascer, a tira some sozinha: o número vem do catálogo.
 */
function FaixaDoPreparo({
  emPreparo,
  primeira,
}: {
  emPreparo: number;
  primeira: string | null;
}) {
  if (emPreparo === 0 || primeira === null) return null;

  return (
    <div className="flex items-center gap-4 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3.5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Hammer className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold tracking-tight">A casa em construção</p>
        <p className="text-sm text-muted-foreground">
          {plural(emPreparo, "seção desenhada", "seções desenhadas")} que o banco
          ainda não sustenta — abrir uma delas diz o que falta, começando por{" "}
          {primeira}.
        </p>
      </div>
      <span className="shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">
        {emPreparo}/{SECOES_GERAIS.length}
      </span>
    </div>
  );
}

function LinhaDaSecao({
  secao,
  estado,
}: {
  secao: SecaoDeConfiguracao;
  estado: EstadoDaSecao;
}) {
  const preparo = estaEmPreparo(secao.href);
  const pronta = !preparo && estado.pronta === true;

  return (
    <Link
      href={`~${secao.href}`}
      className={cn(
        "group flex items-center gap-4 rounded-xl border bg-card px-4 py-3.5",
        "transition-colors hover:border-primary/40 hover:bg-accent/40",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
          pronta
            ? "bg-success/10 text-success"
            : "bg-muted text-muted-foreground",
        )}
        aria-hidden="true"
      >
        {pronta ? <Check className="h-5 w-5" /> : <secao.icon className="h-5 w-5" />}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold tracking-tight">{secao.label}</span>
          {preparo && (
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-muted-foreground">
              <Hammer className="h-2.5 w-2.5" />
              Em preparo
            </span>
          )}
        </div>
        <p className="truncate text-sm text-muted-foreground">
          {/* O dado, quando há; a descrição da seção, quando ainda não há. */}
          {estado.resumo ?? secao.descricao}
        </p>
      </div>

      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
    </Link>
  );
}
