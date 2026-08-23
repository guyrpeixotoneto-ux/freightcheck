import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  ArrowRight,
  CalendarDays,
  Lock,
  LockOpen,
  Plus,
  Tag,
  Trash2,
  WifiOff,
} from "lucide-react";
import { ApiErrorNotice } from "@/components/api-error";
import { Layout } from "@/components/layout/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ComboboxCriavel } from "@/components/ui/combobox-criavel";
import {
  CadastrarParte,
  type ParteDigitada,
} from "@/components/fechamento/cadastrar-parte";
import { FecharQuinzena } from "@/components/fechamento/fechar-quinzena";
import {
  abrirCompetencia,
  cadastrarParte,
  excluirCompetencia,
  fontesDaCompetencia,
  informarTipoDeOperacao,
  lerCompetencia,
  listarCompetencias,
  listarFontes,
  listarPartes,
  NOME_DO_ESTADO,
  rotuloDoTipo,
  TIPO_NAO_INFORMADO,
  TIPOS_DE_OPERACAO,
  type Competencia,
  type Parte,
  type TipoDeParte,
  listarUnidadesCanonicas,
  type UnidadeCanonica,
} from "@/lib/fechamento";
import { MES_LONGO, mesPorExtenso } from "@/lib/fechamento-gerencial";
import { apresentar } from "@/lib/apresentar-erro";
import { useConsultaResiliente } from "@/lib/consulta-resiliente";
import { anoAceito, chaveDaCompetencia } from "@/lib/fechamento-tela";

/**
 * O erro, na frase que a apresentação escolheu.
 *
 * `apresentar` decide entre a orientação tipada e a mensagem crua — a regra de
 * "uma orientação só" mora lá, e repeti-la aqui abriria uma segunda opinião
 * sobre o mesmo erro.
 */
function textoDoErro(erro: unknown): string {
  const aviso = apresentar(erro);
  return aviso.principal ?? aviso.mensagemCrua ?? "Não foi possível concluir.";
}

/**
 * O texto digitado, lido como `código — nome`.
 *
 * O separador aceita travessão, hífen ou barra porque quem digita não sabe qual
 * escolhemos, e as três formas são inequívocas: o código de um CDD e o de uma
 * transportadora são numéricos, então o que vem antes do separador é o código e
 * o que vem depois é o nome. Sem separador, o texto inteiro vira código — é o
 * caso de quem digita só `443`, e o nome fica em branco até alguém escrevê-lo.
 *
 * A função **lê** e não grava: quem grava é o servidor, em `cadastrarParte`. O
 * nome anterior (`cadastrar`) prometia o contrário, e a promessa era verdadeira
 * quando o cadastro só existia dentro do estado desta tela.
 */
export function lerParteDigitada(texto: string): {
  codigo: string;
  nome: string | null;
} {
  const partido = /^\s*([^—\-/]+?)\s*[—\-/]\s*(.+?)\s*$/.exec(texto);
  if (partido) return { codigo: partido[1]!, nome: partido[2]! };
  return { codigo: texto.trim(), nome: null };
}

/**
 * O que o combobox precisa saber enquanto o formulário está aberto.
 *
 * `aoCriar` promete uma parte, e quem a produz agora é um diálogo — então a
 * promessa fica aberta e o `resolver` viaja com o estado. Cancelar resolve
 * `null`, que é o que impede o dropdown de fechar em cima de um texto que não
 * foi gravado: quem perde o que escreveu junto com o motivo escreve de novo às
 * cegas.
 */
interface CadastroEmCurso {
  tipo: TipoDeParte;
  digitado: ParteDigitada;
  resolver: (parte: Parte | null) => void;
}

/**
 * O texto da busca dividido entre os dois campos do formulário.
 *
 * Com separador, `lerParteDigitada` já decide, e ela decide bem — foi para isso
 * que nasceu. Sem separador é preciso escolher um campo, e escolher errado faz
 * a pessoa apagar e redigitar: `443` no campo do nome, ou `CDD BELÉM` no do
 * código.
 *
 * A régua é a que esta tela já declarava em `lerParteDigitada`: **o código de
 * um CDD e o de uma transportadora são numéricos**. Só de dígitos vai para o
 * código; qualquer outra coisa vai para o nome. Nos dois casos o texto
 * sobrevive, e os dois campos estão à vista para quem discordar da escolha —
 * que é a diferença entre um palpite e um palpite que se corrige.
 */
const SEM_LETRA = /^[\d.\-/\s]+$/;

export function paraOFormulario(texto: string): ParteDigitada {
  const cru = texto.trim();
  if (cru === "") return { codigo: "", nome: null };

  /*
    Um documento inteiro é código, mesmo trazendo separador dentro. `443` e
    `12.345.678/0001-99` caem aqui, e o segundo é o caso que obrigou esta linha
    a existir: a barra e o hífen do CNPJ **são** os separadores que
    `lerParteDigitada` procura, e sem esta guarda ela partia o documento ao
    meio — `12.345.678` de código e `0001-99` de nome. Silenciosamente, e num
    campo cuja única função é casar com o cadastro de Remuneração, onde o CNPJ é
    exatamente o formato que a tela pede.
  */
  if (SEM_LETRA.test(cru)) return { codigo: cru, nome: null };

  /* Com separador, só vale a divisão se o que veio antes puder ser código. */
  const lido = lerParteDigitada(cru);
  if (lido.nome !== null && SEM_LETRA.test(lido.codigo)) return lido;

  return { codigo: "", nome: cru };
}

const rotuloDaParte = (p: Parte) =>
  p.nome ? `${p.codigo} — ${p.nome}` : p.codigo;

/*
  A parte cadastrada e ainda não usada não é "nova": ela está gravada, e some
  da lista só se alguém a apagar. Dizer "vai ser cadastrada ao abrir" era
  verdade quando o cadastro era efeito da abertura — e era exatamente o que
  fazia o nome ir embora junto com a importação excluída.
*/
const detalheDaParte = (p: Parte) =>
  p.competencias === 0
    ? "cadastrada — ainda sem competência"
    : `${p.competencias} competência${p.competencias === 1 ? "" : "s"}`;

/*
  A prévia deixou de ser um aviso sobre sintaxe e passou a ser o que o
  formulário vai mostrar: o texto digitado só **preenche** os campos, e quem
  decide o que é código e o que é nome é a pessoa, olhando dois rótulos.
*/
const previaDaParte = (texto: string) => {
  const parte = paraOFormulario(texto);
  /*
    Sem nada digitado, a linha de criação não é a prévia de um texto: é a porta
    do formulário. O que a frase precisa dizer, então, é o que existe atrás
    dela — e o que existe atrás dela é o campo do código, que é justamente o
    que a lista fechada não mostrava.
  */
  if (parte.codigo === "" && parte.nome === null)
    return "Abre o cadastro em branco, com nome e código em campos separados.";
  return parte.nome
    ? `Abre o cadastro com código ${parte.codigo} e nome “${parte.nome}”.`
    : `Abre o cadastro com “${parte.codigo}” preenchido — nome e código em campos separados.`;
};

/*
  `TIPOS_DE_OPERACAO` e `rotuloDoTipo` vivem em `@/lib/fechamento` e não aqui.

  **Não confundir com `Canal`**, que no motor do Fechamento é `ROTA` | `AS` —
  distribuição urbana diária contra área de serviço, o eixo de agregação das
  verbas. As duas palavras colidem em "ROTA" e querem dizer coisas diferentes:
  aqui ROTA é o **modelo de operação da unidade**, o mesmo eixo que o rótulo da
  vigência carrega (`EMPURRADA_1_8_2026`) e o mesmo da planilha de remuneração.
  É por isso que o campo se chama Tipo, e não Canal.

  A lista mudou de casa porque duas telas a leem — esta, que **abre**, e o
  Resumo geral, que **consulta** —, e as duas precisam escrever o mesmo tipo com
  a mesma palavra. Duas cópias já custaram caro uma vez: o Resumo nasceu com a
  lista de abrir e por isso não alcançava nenhum fechamento anterior à `0046`.
*/

/**
 * O que a linha da lista oferece, pelo estado da competência.
 *
 * São três, e não dois, porque "não dá para fechar" tem duas causas diferentes
 * e a tela deve dizer qual: quem ainda não apurou precisa apurar — o servidor
 * recusa encerrar um período que não sabe quanto vale —, e quem já encerrou não
 * fecha de novo, reabre com motivo. Um botão desabilitado sem explicação
 * juntaria os dois casos numa frustração só.
 *
 * `EM_APURACAO` cai no mesmo lugar que `ABERTA` porque nenhuma apuração vigente
 * existe enquanto a conta não terminou de rodar, e `APROVADA` no mesmo que
 * `APURADA` porque aprovar não desfaz a apuração — os dois estados ainda não
 * são escritos por ninguém, e o dia em que forem, esta função já os conhece.
 */
export type AcaoDoFechamento = "FECHAR" | "REABRIR" | "APURAR";

export function acaoDoFechamento(
  estado: Competencia["estado"],
): AcaoDoFechamento {
  if (estado === "ENCERRADA") return "REABRIR";
  if (estado === "APURADA" || estado === "APROVADA") return "FECHAR";
  return "APURAR";
}

/**
 * Dá para excluir esta importação? A mesma régua que o servidor aplica.
 *
 * Só a encerrada é recusada, e é o único estado em que apagar destruiria algo
 * que vale como prova: uma quinzena fechada é o registro do que foi cobrado.
 * Nos outros — aberta, em apuração, apurada, aprovada — a competência ainda é
 * trabalho em curso, e um trabalho em curso aberto por engano é exatamente o
 * que este ato existe para desfazer.
 *
 * A regra continua sendo do servidor (`excluirCompetencia`, em
 * `persistencia.ts`): o que a tela evita é oferecer um botão que vai voltar 409.
 */
export function podeExcluir(estado: Competencia["estado"]): boolean {
  return estado !== "ENCERRADA";
}

/**
 * O que a linha oferece a respeito do tipo de operação, pelo que ela já diz.
 *
 * São três, como em {@link acaoDoFechamento}, e pela mesma razão: "não dá para
 * mexer no tipo" tem uma causa só, e ela precisa aparecer com nome. Informar e
 * corrigir também não são o mesmo gesto, ainda que escrevam a mesma coluna.
 *
 * `INFORMAR` é preencher o `NAO_INFORMADO` que o backfill da `0046` carimbou em
 * toda competência anterior a ele. Não apaga declaração nenhuma — o campo está
 * em branco porque a coluna nasceu depois da competência —, e por isso vale
 * **inclusive na encerrada**: o que o encerramento congela é o dinheiro apurado,
 * não a resposta à pergunta de qual operação o apurou. Sem essa exceção as
 * quinzenas antigas, que são justamente as fechadas, ficariam sem endereço para
 * sempre.
 *
 * `CORRIGIR` é trocar um tipo que alguém declarou por outro. `REABRIR_ANTES` é o
 * mesmo pedido numa competência encerrada, e aí a resposta é não: aquele total
 * foi fechado como sendo de uma operação, e mudá-lo o move de um mês para o
 * outro. O caminho existe e é o de sempre — reabrir, com motivo.
 *
 * A régua continua sendo do servidor (`informarTipoDeOperacao`, em
 * `persistencia.ts`); o que a tela evita é oferecer um botão que volta 409.
 */
export type EdicaoDoTipo = "INFORMAR" | "CORRIGIR" | "REABRIR_ANTES";

export function edicaoDoTipo(
  competencia: Pick<Competencia, "tipoDeOperacao" | "estado">,
): EdicaoDoTipo {
  if (competencia.tipoDeOperacao === TIPO_NAO_INFORMADO) return "INFORMAR";
  return competencia.estado === "ENCERRADA" ? "REABRIR_ANTES" : "CORRIGIR";
}

/**
 * Importações — a porta por onde entram os períodos que o fechamento fecha, e
 * onde eles se fecham.
 *
 * A tela é uma lista e um formulário, e o formulário é curto de propósito: uma
 * competência é (unidade, transportadora, quinzena), e nada mais. Tudo o que a
 * define depois — quanto vale, o que falta — vem dos arquivos que a Ambev
 * exporta, não de campo digitado.
 *
 * Abrir a mesma competência duas vezes devolve a que já existe, e o botão
 * simplesmente navega para ela. É o gesto de quem volta no dia seguinte, e
 * tratá-lo como erro ("esta competência já existe") ensinaria a pessoa a temer
 * um botão que não faz mal nenhum.
 *
 * **Por que o fechamento acontece aqui também.** Porque quem fecha não fecha
 * uma competência: fecha a quinzena inteira, CDD a CDD. Obrigar a entrar em
 * cada uma para clicar no mesmo botão do fim da página fazia perder a lista a
 * cada fechamento — e a lista é justamente o que diz quantas ainda faltam. O
 * ato é o mesmo painel da tela de dentro (`components/fechamento/fechar-quinzena`),
 * com o mesmo resumo antes do botão: o que muda é o caminho até ele, nunca o
 * que se vê antes de congelar um período.
 *
 * **Um painel aberto por vez.** Ao contrário de Apurações, onde abrir várias
 * contas serve para comparar CDDs, aqui o que se abre é um ato — e dois atos
 * abertos ao mesmo tempo convidam a fechar a quinzena errada.
 */
export default function Competencias() {
  const [, navegar] = useLocation();
  const cliente = useQueryClient();
  const hoje = new Date();

  const [ano, setAno] = useState(String(hoje.getFullYear()));
  const [mes, setMes] = useState(String(hoje.getMonth() + 1));
  const [quinzena, setQuinzena] = useState(hoje.getDate() <= 15 ? "1" : "2");
  /*
    A unidade **canônica**, e não mais uma `Parte`.

    O seletor lia `fechamento_parte`, que é texto livre e herdou da `0044` o que
    quer que estivesse nas competências — `443`, `081-0443`, `CDD Belém`. Agora
    lê o cadastro mestre: escolher aqui é escolher uma identidade, e o que vai
    para o servidor é o `id` dela. Ninguém digita código.
  */
  const [unidade, setUnidade] = useState<UnidadeCanonica | null>(null);
  /*
    As unidades canônicas — só as **cadastradas**. A linha "detectada no acervo"
    não é identidade e por isso não é selecionável: cadastrá-la é um ato, e o
    lugar dele é Administração → Unidades.
  */
  const unidadesCanonicas = useQuery({
    queryKey: ["unidades", "canonicas"],
    queryFn: listarUnidadesCanonicas,
    select: (todas: UnidadeCanonica[]) => todas.filter((u) => u.id !== null),
  });
  const [transportadora, setTransportadora] = useState<Parte | null>(null);
  /*
    O tipo de operação — EMPURRADA, ROTA. Nasce vazio de propósito, e não com um
    padrão: ele entra na **chave** do fechamento desde a `0046`, e um padrão
    escolheria em silêncio de qual operação é a quinzena que alguém abriu.
  */
  const [tipoDeOperacao, setTipoDeOperacao] = useState("");
  /** A competência cujo painel de fechamento está aberto — uma, ou nenhuma. */
  const [fechando, setFechando] = useState<string | null>(null);
  /*
    E a que está sendo excluída, que é outro painel e nunca o mesmo. Um estado
    só, com um "qual", pareceria mais enxuto e deixaria os dois atos a um
    `setState` de distância um do outro — e o ato que apaga uma quinzena inteira
    não deve compartilhar variável com o que a fecha.
  */
  const [excluindo, setExcluindo] = useState<string | null>(null);
  /*
    E a que está informando o tipo, que é um terceiro painel pela mesma
    regra: mexer na chave de um fechamento não compartilha variável com
    fechá-lo nem com apagá-lo.
  */
  const [tipando, setTipando] = useState<string | null>(null);

  /*
    A lista sustenta a tela inteira, e por isso é a que paga o preço de uma
    falha de transporte. Era ela que sumia atrás do aviso vermelho quando uma
    chamada não completava — inclusive quando a chamada seguinte teria
    respondido, e inclusive quando a lista em tela continuava correta.

    Os defaults globais (`App.tsx`) já lhe dão repetição só para falha
    transitória, 400/1200ms, foco desligado e reconexão ligada. O que só o hook
    entrega é o que muda o desenho: preservar a resposta anterior, distinguir
    "não respondeu" de "respondeu vazio", e oferecer a tentativa manual.
  */
  const competencias = useConsultaResiliente<Competencia[]>({
    queryKey: ["fechamento", "competencias"],
    endpoint: "/fechamento/competencias",
    buscar: listarCompetencias,
  });
  const partes = useQuery({
    queryKey: ["fechamento", "partes"],
    queryFn: listarPartes,
  });

  /*
    O cadastro de uma parte — uma mutação por campo, e não uma compartilhada
    pelos dois. A recusa precisa aparecer embaixo do campo que a provocou;
    compartilhada, o erro da transportadora piscaria no campo da unidade.

    A lista é invalidada no sucesso porque a parte recém-cadastrada passa a ser
    uma opção como qualquer outra — inclusive para o outro fechamento que a
    pessoa vai abrir em seguida, sem recarregar a tela.
  */
  /*
    A mutação recebe os dois campos, e não mais o texto. Quem os separa passou a
    ser o formulário (`CadastrarParte`), e não uma sintaxe que a pessoa tinha de
    conhecer — `lerParteDigitada` continua aqui para **preencher** o formulário
    a partir do que foi digitado no campo de busca, que é leitura e não regra.
  */
  const opcoesDoCadastro = (tipo: TipoDeParte) => ({
    mutationFn: (parte: ParteDigitada) => cadastrarParte({ tipo, ...parte }),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ["fechamento", "partes"] });
    },
  });
  const cadastroDaUnidade = useMutation(opcoesDoCadastro("UNIDADE"));
  const cadastroDaTransportadora = useMutation(
    opcoesDoCadastro("TRANSPORTADORA"),
  );
  const [cadastroEmCurso, setCadastroEmCurso] =
    useState<CadastroEmCurso | null>(null);

  /* O texto do campo de busca preenche o formulário — não vira regra. */
  const abrirCadastro = (
    tipo: TipoDeParte,
    texto: string,
  ): Promise<Parte | null> =>
    new Promise((resolver) =>
      setCadastroEmCurso({ tipo, digitado: paraOFormulario(texto), resolver }),
    );

  const mutacaoEmCurso =
    cadastroEmCurso?.tipo === "TRANSPORTADORA"
      ? cadastroDaTransportadora
      : cadastroDaUnidade;

  const fecharCadastro = (parte: Parte | null) => {
    cadastroEmCurso?.resolver(parte);
    setCadastroEmCurso(null);
  };

  const abrir = useMutation({
    mutationFn: () =>
      abrirCompetencia({
        ano: Number(ano),
        mes: Number(mes),
        quinzena: Number(quinzena) as 1 | 2,
        /* Só o `id`: nome e código saem do cadastro, no servidor. */
        unidade: { id: unidade!.id ?? undefined },
        transportadora: {
          codigo: transportadora!.codigo,
          nome: transportadora!.nome ?? undefined,
        },
        tipoDeOperacao,
      }),
    onSuccess: (criada) => {
      void cliente.invalidateQueries({
        queryKey: ["fechamento", "competencias"],
      });
      void cliente.invalidateQueries({ queryKey: ["fechamento", "partes"] });
      navegar(`/fechamento/competencias/${criada.id}`);
    },
  });

  const anoValido = anoAceito(ano);
  const podeAbrir =
    unidade !== null &&
    transportadora !== null &&
    anoValido &&
    tipoDeOperacao !== "";

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <h1 className="text-2xl font-bold tracking-tight">Importações</h1>
        <p className="text-muted-foreground mt-2 max-w-3xl">
          Cada competência é uma quinzena de um CDD com uma transportadora — o
          período que se apura, se confere e se fecha.
        </p>
      </header>

      <div className="p-8 space-y-6 max-w-4xl">
        <Card>
          <CardHeader className="pb-3">
            {/*
              "Realizar Fechamento", e não "Abrir competência": o cartão é a
              porta do trabalho, e quem chega aqui vem fechar a quinzena — não
              criar um registro chamado competência. A competência continua
              sendo o que o formulário produz, e o resto da tela continua
              chamando-a assim; o que mudou é o rótulo do gesto, que passa a
              dizer o que a pessoa veio fazer em vez de como o sistema guarda.
            */}
            <CardTitle className="text-base flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Realizar Fechamento
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="ano">Ano</Label>
                <Input
                  id="ano"
                  value={ano}
                  onChange={(e) => setAno(e.target.value)}
                  inputMode="numeric"
                />
                {!anoValido && (
                  <p className="text-xs text-amber-700">
                    O ano vai de 2000 a 2100.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mes">Mês</Label>
                {/*
                  O mês é escolhido, e não digitado: ele tem doze valores e
                  nomes que todo mundo sabe de cor, e `7` num campo de texto é
                  uma pergunta a mais ("julho?") num formulário que existe para
                  não ter nenhuma. O valor continua sendo o número — é o que a
                  rota espera —, e só o rótulo é a palavra.
                */}
                <Select value={mes} onValueChange={setMes}>
                  <SelectTrigger id="mes">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MES_LONGO.map((_, indice) => (
                      <SelectItem key={indice} value={String(indice + 1)}>
                        {mesPorExtenso(indice + 1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quinzena">Quinzena</Label>
                <Select value={quinzena} onValueChange={setQuinzena}>
                  <SelectTrigger id="quinzena">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1ª — dias 1 a 15</SelectItem>
                    <SelectItem value="2">2ª — dia 16 ao fim do mês</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="unidade">Unidade (CDD)</Label>
                {/*
                  Só unidades **canônicas cadastradas**, e nenhuma opção de usar
                  o texto digitado: a identidade da unidade deixou de ser algo
                  que se digita aqui. Quem precisa de uma que não existe cadastra
                  em Administração → Unidades — o link abaixo — e volta.

                  A busca continua sendo por nome **e** por CNPJ, porque as duas
                  coisas identificam a linha para quem a procura; o que muda é
                  que o que sai daqui é o `id`.
                */}
                <ComboboxCriavel<UnidadeCanonica>
                  id="unidade"
                  itens={unidadesCanonicas.data ?? []}
                  valor={unidade}
                  aoEscolher={setUnidade}
                  rotuloDe={(u) => `${u.nome} — ${u.cnpjFormatado}`}
                  detalheDe={(u) =>
                    u.vigencias > 0
                      ? `${u.vigencias} vigência${u.vigencias === 1 ? "" : "s"} no acervo`
                      : "sem importação ainda"
                  }
                  chaveDe={(u) => u.id ?? u.cnpj}
                  placeholder="Escolha a unidade cadastrada"
                  /*
                    O campo é obrigatório e não cria nada: sem o atalho, quem
                    chega antes do primeiro cadastro — ou procura uma unidade
                    que ainda não foi cadastrada — fica com "Nada encontrado."
                    e sem caminho. O parágrafo abaixo já diz onde é; aqui a
                    porta fica dentro do próprio dropdown, que é onde a pessoa
                    está olhando quando descobre que falta.
                  */
                  atalhoDeCadastro={{
                    rotulo: "Cadastrar unidade em Administração → Unidades",
                    para: "/unidades",
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="transportadora">Transportadora</Label>
                <ComboboxCriavel<Parte>
                  id="transportadora"
                  itens={partes.data?.transportadoras ?? []}
                  valor={transportadora}
                  aoEscolher={setTransportadora}
                  aoCriar={(texto) => abrirCadastro("TRANSPORTADORA", texto)}
                  erro={
                    cadastroDaTransportadora.isError
                      ? textoDoErro(cadastroDaTransportadora.error)
                      : null
                  }
                  rotuloDe={rotuloDaParte}
                  detalheDe={detalheDaParte}
                  chaveDe={(p) => p.codigo}
                  placeholder="Escolha, ou digite para buscar e cadastrar"
                  rotuloDeCriacao={(texto) => `Cadastrar “${texto}”…`}
                  rotuloDeCriacaoVazia="Cadastrar uma transportadora…"
                  previaDe={previaDaParte}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="tipo-de-operacao">Tipo</Label>
                {/*
                  O tipo entra na chave do fechamento, e é por isso que ele é
                  obrigatório: a mesma unidade roda EMPURRADA e ROTA com a mesma
                  transportadora na mesma quinzena, e são duas operações — cada
                  uma com a sua planilha de remuneração, os seus relatórios e a
                  sua conta. Sem o campo, a segunda abertura encontrava a
                  primeira e devolvia o fechamento da outra operação, em
                  silêncio, porque repetir a abertura é o caminho feliz.

                  Um select fechado, e não um campo livre como os de parte: o
                  eixo é o mesmo do rótulo da vigência, e o produto conhece os
                  dois nomes que ele tem hoje. O dia em que aparecer um terceiro,
                  esta lista é uma linha — e enquanto isso ela impede que
                  "Empurrada" e "EMPURRADA" virem dois fechamentos do mesmo mês.
                */}
                <Select
                  value={tipoDeOperacao}
                  onValueChange={setTipoDeOperacao}
                >
                  <SelectTrigger id="tipo-de-operacao">
                    <SelectValue placeholder="Escolha o tipo da operação" />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPOS_DE_OPERACAO.map((t) => (
                      <SelectItem key={t.valor} value={t.valor}>
                        {t.rotulo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {TIPOS_DE_OPERACAO.find((t) => t.valor === tipoDeOperacao)
                    ?.explicacao ??
                    "EMPURRADA e ROTA são fechamentos separados na mesma quinzena."}
                </p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              A <strong>unidade</strong> vem do cadastro de{" "}
              <a href="/unidades" className="text-primary hover:underline">
                Administração → Unidades
              </a>
              , onde ela é identificada pelo <strong>CNPJ</strong>. Não existe
              aqui a opção de usar o texto digitado: quem escolhe uma unidade
              escolhe uma identidade, e é ela que faz a competência encontrar o
              cadastro de Remuneração. Se a unidade não estiver na lista,
              cadastre-a lá e volte. A lista de transportadoras continua sendo a
              de partes, com o código da Ambev — <code>36</code> —, que é
              identidade legítima daquele lado.
            </p>

            {/*
              O formulário vive aqui, e não dentro do combobox, porque ele é um
              diálogo: o dropdown fecha, a lista fica, e o que se digita nos dois
              campos não disputa espaço com a busca.
            */}
            {cadastroEmCurso && (
              <CadastrarParte
                tipo={cadastroEmCurso.tipo}
                nomeInicial={cadastroEmCurso.digitado.nome ?? ""}
                codigoInicial={cadastroEmCurso.digitado.codigo}
                erro={
                  mutacaoEmCurso.isError
                    ? textoDoErro(mutacaoEmCurso.error)
                    : null
                }
                salvando={mutacaoEmCurso.isPending}
                aoCancelar={() => fecharCadastro(null)}
                aoConfirmar={(parte) => {
                  void mutacaoEmCurso
                    .mutateAsync(parte)
                    .then((criada) => fecharCadastro(criada))
                    .catch(() => undefined);
                }}
              />
            )}

            {abrir.isError && (
              <Alert variant="destructive">
                <AlertDescription>{textoDoErro(abrir.error)}</AlertDescription>
              </Alert>
            )}

            <Button
              onClick={() => abrir.mutate()}
              disabled={!podeAbrir || abrir.isPending}
            >
              {abrir.isPending ? "Iniciando…" : "Realizar Fechamento"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            {/*
              "Competências", e não "Competências abertas": a lista sempre
              trouxe também as encerradas — a tarja de cada linha diz qual é
              qual —, e agora que se fecha daqui o título velho prometeria uma
              lista da qual o próprio ato tiraria a competência.
            */}
            <CardTitle className="text-base">Competências</CardTitle>
          </CardHeader>
          <CardContent>
            {competencias.carregando && (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            )}

            {/*
              O aviso só aparece quando não há lista nenhuma para mostrar —
              nunca houve resposta, e as tentativas automáticas já se esgotaram.
              Antes ele aparecia em qualquer falha, sobre uma lista que
              continuava em tela e continuava certa.

              É o `ApiErrorNotice`, e não um `Alert` com uma linha de texto.
              Esta tela desenhava a falha à mão, e desenhava **um terço dela**:
              `textoDoErro` devolve só o `resumo` da orientação, então caíam
              fora o risco — "Nada foi gravado e nada se perdeu", que é a
              primeira pergunta de quem vê vermelho — e a ação, que é a única
              linha acionável. O que sobrava era um parágrafo de diagnóstico sem
              saída, e sem nem o botão de repetir que a tira âmbar logo abaixo
              já tinha.

              A Curadoria, com o mesmo hook e a mesma falha, já usava este
              componente. Duas telas com dois tratamentos para a mesma falha é
              exatamente o que o cabeçalho de `useConsultaResiliente` diz ter
              sido escrito para acabar — e tinha sobrevivido aqui.
            */}
            {competencias.indisponivel && (
              <ApiErrorNotice
                error={competencias.erro}
                what="A lista de competências não pôde ser carregada."
                onTentarDeNovo={competencias.tentarDeNovo}
                tentando={competencias.atualizando}
              />
            )}

            {/*
              Com lista em tela, a falha é recado de rodapé: o que se vê é o que
              o servidor mandou, e só a hora mudou. Dizer a hora é o que torna
              isto honesto — "de 14h02" é verificável, "pode estar
              desatualizado" é desculpa.
            */}
            {competencias.avisarSobreDadoGuardado && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-amber-200 bg-amber-50/70 px-4 py-2 text-sm text-amber-900">
                <WifiOff className="w-4 h-4 shrink-0" />
                <span>
                  A atualização da lista não completou. O que está em tela é de{" "}
                  {new Date(competencias.respondidoEm ?? 0).toLocaleTimeString(
                    "pt-BR",
                    { hour: "2-digit", minute: "2-digit" },
                  )}
                  , e continua válido.
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  disabled={competencias.atualizando}
                  onClick={competencias.tentarDeNovo}
                >
                  {competencias.atualizando ? "Tentando…" : "Tentar de novo"}
                </Button>
              </div>
            )}

            {/*
              "Nenhuma ainda" é uma afirmação sobre a base, e só pode ser feita
              depois de o servidor ter respondido. `houveResposta` é a
              autoridade: `dados?.length === 0` também é verdade quando não
              houve resposta alguma, e era assim que a tela chegava a prometer
              "nenhuma competência" a respeito de uma pergunta que ninguém
              conseguiu fazer.
            */}
            {competencias.houveResposta && competencias.dados?.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nenhuma ainda. Comece o primeiro fechamento acima e envie os
                relatórios da quinzena.
              </p>
            )}
            {(competencias.dados?.length ?? 0) > 0 && (
              <p className="text-sm text-muted-foreground mb-3">
                A linha abre a competência — relatórios, dias e a conta. A que
                já apurou fecha aqui mesmo; a que já fechou reabre com motivo.
              </p>
            )}
            <ul className="divide-y">
              {competencias.dados?.map((c) => {
                const acao = acaoDoFechamento(c.estado);
                const painelAberto = fechando === c.id;
                const excluindoEsta = excluindo === c.id;
                const tipandoEsta = tipando === c.id;
                const edicao = edicaoDoTipo(c);
                return (
                  <li key={c.id}>
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/fechamento/competencias/${c.id}`}
                        className="flex min-w-0 flex-1 items-center justify-between gap-4 py-3 hover:bg-muted/50 -mx-2 px-2 rounded"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 font-medium">
                            <CalendarDays className="w-4 h-4 text-muted-foreground shrink-0" />
                            <span>
                              {c.inicio.split("-").reverse().join("/")} a{" "}
                              {c.fim.split("-").reverse().join("/")}
                            </span>
                            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
                              {NOME_DO_ESTADO[c.estado]}
                            </span>
                          </div>
                          {/*
                            O tipo entra na identidade da linha, e não como
                            enfeite: desde a `0046` duas competências da mesma
                            unidade, transportadora e quinzena podem existir, e
                            a única coisa que as separa é ele. Sem o tipo à
                            vista, a lista mostraria duas linhas idênticas.
                          */}
                          {/*
                            O código ao lado do nome, e não escondido atrás
                            dele. É por ele que o cadastro de Remuneração
                            encontra esta competência — e ele era a única coisa
                            que quem precisava conferir os dois lados não tinha
                            como ver em tela nenhuma. Nome é rótulo; código é
                            identidade.
                          */}
                          <p className="text-sm text-muted-foreground truncate">
                            {c.unidade.nome ?? c.unidade.codigo}
                            {c.unidade.nome && (
                              <span className="text-muted-foreground/70">
                                {" "}
                                ({c.unidade.codigo})
                              </span>
                            )}
                            {" · "}
                            {c.transportadora.nome ?? c.transportadora.codigo}
                            {" · "}
                            <span
                              className={
                                c.tipoDeOperacao === TIPO_NAO_INFORMADO
                                  ? "italic"
                                  : "font-medium"
                              }
                            >
                              {rotuloDoTipo(c.tipoDeOperacao)}
                            </span>
                          </p>
                        </div>
                        <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                      </Link>
                      {/*
                        Largura fixa para a coluna da ação: sem ela, "Fechar a
                        quinzena", "Reabrir" e "apure para fechar" empurram a
                        seta de cada linha para um x diferente, e a lista perde
                        a margem direita que a faz ser lida de cima a baixo.
                      */}
                      <div className="flex w-44 shrink-0 justify-end">
                        <AcaoDaLinha
                          acao={acao}
                          aberto={painelAberto}
                          aoAlternar={() => {
                            setExcluindo(null);
                            setFechando(painelAberto ? null : c.id);
                          }}
                        />
                      </div>
                      {/*
                        O tipo é ícone pela mesma régua do excluir logo abaixo,
                        e não por falta de espaço: informá-lo é conserto de
                        cadastro — acontece uma vez por competência, e não deve
                        disputar o olho com o que se faz toda quinzena.

                        O que muda é a cor. Enquanto o tipo não foi dito o ícone
                        sai do cinza dos outros e ganha o contraste do texto,
                        porque ali ele não é uma ação disponível entre as
                        outras: é a lacuna que a linha acabou de mostrar em
                        itálico, a um clique de distância dela. O `title` mora no
                        `span` pelo motivo do vizinho — o botão desabilitado tem
                        `pointer-events: none` e engoliria a explicação.
                      */}
                      <span
                        className="shrink-0"
                        title={
                          edicao === "INFORMAR"
                            ? "Esta quinzena não diz de qual operação é — informe o tipo"
                            : edicao === "CORRIGIR"
                              ? `Corrigir o tipo de operação (hoje: ${rotuloDoTipo(c.tipoDeOperacao)})`
                              : "A quinzena está fechada — reabra, com motivo, antes de trocar o tipo."
                        }
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-8 w-8 ${
                            edicao === "INFORMAR"
                              ? "text-foreground"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                          aria-label={`${
                            edicao === "INFORMAR" ? "Informar" : "Corrigir"
                          } o tipo de operação da quinzena de ${c.inicio.split("-").reverse().join("/")} a ${c.fim.split("-").reverse().join("/")}`}
                          aria-expanded={tipandoEsta}
                          disabled={edicao === "REABRIR_ANTES"}
                          onClick={() => {
                            setFechando(null);
                            setExcluindo(null);
                            setTipando(tipandoEsta ? null : c.id);
                          }}
                        >
                          <Tag className="w-4 h-4" />
                        </Button>
                      </span>
                      {/*
                        Excluir é ícone, e as outras ações são texto: a
                        hierarquia da linha é o trabalho da quinzena — fechar,
                        reabrir, apurar —, e apagar a importação é o conserto de
                        um engano de cadastro, que acontece uma vez e não deve
                        disputar o olho com o que se faz toda quinzena. O
                        `title` mora no `span` porque o botão desabilitado tem
                        `pointer-events: none` e engoliria a explicação de por
                        que está desabilitado.
                      */}
                      <span
                        className="shrink-0"
                        title={
                          podeExcluir(c.estado)
                            ? "Excluir esta importação"
                            : "A quinzena está fechada — reabra, com motivo, antes de excluir."
                        }
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          aria-label={`Excluir a importação de ${c.inicio.split("-").reverse().join("/")} a ${c.fim.split("-").reverse().join("/")}`}
                          aria-expanded={excluindoEsta}
                          disabled={!podeExcluir(c.estado)}
                          onClick={() => {
                            setFechando(null);
                            setTipando(null);
                            setExcluindo(excluindoEsta ? null : c.id);
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </span>
                    </div>
                    {painelAberto && (
                      <div className="mb-3 rounded-md border bg-muted/20 px-4 py-4">
                        <FechamentoDaLinha competenciaId={c.id} />
                      </div>
                    )}
                    {excluindoEsta && (
                      <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-4">
                        <ExclusaoDaLinha
                          competencia={c}
                          aoFechar={() => setExcluindo(null)}
                        />
                      </div>
                    )}
                    {tipandoEsta && (
                      <div className="mb-3 rounded-md border bg-muted/20 px-4 py-4">
                        <TipoDaLinha
                          competencia={c}
                          aoFechar={() => setTipando(null)}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

/**
 * O que a linha oferece à direita: fechar, reabrir, ou o motivo de nenhum dos dois.
 *
 * O botão alterna o painel em vez de agir no clique. Encerrar é o ato que faz o
 * banco recusar escrita na competência, e um clique de lista não pode
 * desencadeá-lo sem antes mostrar o que está sendo congelado — é a mesma regra
 * da tela de dentro, e ela não afrouxa por estarmos numa lista.
 */
function AcaoDaLinha({
  acao,
  aberto,
  aoAlternar,
}: {
  acao: AcaoDoFechamento;
  aberto: boolean;
  aoAlternar: () => void;
}) {
  if (acao === "APURAR") {
    /*
      Sem apuração vigente o servidor recusa encerrar, e com razão: congelaria
      um período que não sabe quanto vale. A frase diz o que falta em vez de um
      botão cinza que não explica nada — e o caminho para apurar é a própria
      linha, que abre a competência.
    */
    return (
      <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap">
        apure para fechar
      </span>
    );
  }

  return (
    <Button
      variant={aberto ? "secondary" : "outline"}
      size="sm"
      className="shrink-0"
      aria-expanded={aberto}
      onClick={aoAlternar}
    >
      {acao === "FECHAR" ? (
        <>
          <Lock className="w-3.5 h-3.5 mr-1.5" />
          Fechar a quinzena
        </>
      ) : (
        <>
          <LockOpen className="w-3.5 h-3.5 mr-1.5" />
          Reabrir
        </>
      )}
    </Button>
  );
}

/**
 * O painel de fechamento de uma linha — buscado quando ela abre.
 *
 * A competência inteira é buscada aqui, e não junto da lista, pelo mesmo motivo
 * de `ContaDaLinha` em Apurações: a lista é o índice de dezenas de quinzenas, e
 * o resumo de cada uma traz documentos e apuração. Baixar todas para mostrar uma
 * seria pagar o fechamento inteiro para ler uma linha.
 *
 * A chave é a mesma da tela da competência (`chaveDaCompetencia`)
 * de propósito: quem fecha daqui e entra logo depois não espera de novo, e o
 * painel — que invalida essa chave ao fechar — atualiza as duas telas com uma
 * consulta só.
 */
function FechamentoDaLinha({ competenciaId }: { competenciaId: string }) {
  const dados = useQuery({
    queryKey: chaveDaCompetencia(competenciaId),
    queryFn: () => lerCompetencia(competenciaId),
  });
  const fontes = useQuery({
    queryKey: ["fechamento", "fontes"],
    queryFn: listarFontes,
  });

  if (dados.isLoading) {
    return (
      <p className="text-sm text-muted-foreground">Carregando a competência…</p>
    );
  }
  if (dados.isError || !dados.data) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{textoDoErro(dados.error)}</AlertDescription>
      </Alert>
    );
  }

  const { competencia, documentos, apuracao } = dados.data;
  if (!apuracao) {
    /*
      A lista só oferece o botão a quem está apurada ou encerrada, então chegar
      aqui sem apuração é a lista tendo lido um estado que o banco já mudou —
      alguém reabriu e reapurou noutra aba. Dizer isso é melhor do que um painel
      vazio ou um botão que o servidor vai recusar.
    */
    return (
      <p className="text-sm text-muted-foreground">
        Esta competência não tem apuração vigente — apure-a antes de fechar.
        Abra a competência para rodar a conta.
      </p>
    );
  }

  return (
    <FecharQuinzena
      competencia={competencia}
      documentos={documentos}
      apuracao={apuracao}
      /* Os da quinzena desta linha — a primeira pede quatro, a segunda, seis. */
      fontes={fontesDaCompetencia(
        fontes.data ?? [],
        competencia.quinzena,
        documentos.filter((d) => d.vigente).map((d) => d.tipo),
      )}
    />
  );
}

/**
 * O painel que informa — ou corrige — o tipo de operação de uma linha.
 *
 * **Por que ele é um painel e não um select solto na linha.** Porque o tipo
 * entra na chave do fechamento, e mudá-lo muda em qual operação aquela quinzena
 * aparece no Resumo do mês. Um dropdown que gravasse no `onChange` faria isso
 * acontecer entre dois cliques de rolagem — e o que a lista mostra depois é
 * indistinguível de um erro de leitura. O painel diz o que vai mudar antes de
 * mudar, como o de fechar e o de excluir.
 *
 * **O select não oferece "Não informado".** Ele é carimbo do backfill, e não uma
 * escolha: quem informa está saindo dele, e desinformar de volta não é pedido
 * que a operação faça — o servidor recusa (`normalizarTipoDeOperacao`), e
 * oferecer aqui seria oferecer um 400.
 *
 * A frase de recusa vem inteira do servidor. É lá que mora o caso que a tela não
 * tem como prever: o tipo de destino já ocupado por outro fechamento da mesma
 * quinzena, com o nome de quem está no lugar.
 */
function TipoDaLinha({
  competencia,
  aoFechar,
}: {
  competencia: Competencia;
  /** Fecha o painel — o mesmo gesto para quem desistiu e para quem gravou. */
  aoFechar: () => void;
}) {
  const cliente = useQueryClient();
  const informando = edicaoDoTipo(competencia) === "INFORMAR";
  /*
    Nasce no que já está lá quando há o que corrigir, e vazio quando não há.
    O vazio é deliberado: um padrão no campo em branco escolheria em silêncio de
    qual operação é a quinzena — a mesma razão pela qual o formulário de abrir,
    no alto desta tela, também nasce sem tipo.
  */
  const [escolhido, setEscolhido] = useState(
    informando ? "" : competencia.tipoDeOperacao,
  );

  const informar = useMutation({
    mutationFn: () => informarTipoDeOperacao(competencia.id, escolhido),
    onSuccess: () => {
      void cliente.invalidateQueries({
        queryKey: ["fechamento", "competencias"],
      });
      void cliente.invalidateQueries({ queryKey: ["fechamento", "apuracoes"] });
      void cliente.invalidateQueries({
        queryKey: chaveDaCompetencia(competencia.id),
      });
      /*
        E o Resumo do mês, que é o que esta mudança serve para consertar: ele
        pergunta por (unidade, transportadora, tipo, mês), e a competência
        acabou de trocar de resposta em duas dessas perguntas — some da do tipo
        velho, aparece na do novo. Sem esta linha, a tela que se foi conferir
        continuaria mostrando o vazio que motivou a correção.
      */
      void cliente.invalidateQueries({ queryKey: ["fechamento", "resumo"] });
      aoFechar();
    },
  });

  const periodo = `${competencia.inicio.split("-").reverse().join("/")} a ${competencia.fim.split("-").reverse().join("/")}`;
  const explicacao = TIPOS_DE_OPERACAO.find(
    (t) => t.valor === escolhido,
  )?.explicacao;

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">
        {informando
          ? "Informar o tipo de operação"
          : "Corrigir o tipo de operação"}
      </p>
      <p className="text-sm text-muted-foreground">
        {periodo} · {competencia.unidade.nome ?? competencia.unidade.codigo} ·{" "}
        {competencia.transportadora.nome ?? competencia.transportadora.codigo} ·{" "}
        <span className={informando ? "italic" : "font-medium"}>
          {rotuloDoTipo(competencia.tipoDeOperacao)}
        </span>
      </p>
      <p className="text-sm text-muted-foreground">
        {informando ? (
          <>
            Esta quinzena foi aberta antes de o tipo existir, e por isso ninguém
            disse de qual operação ela é. Enquanto não disser, ela não aparece
            no <strong>Resumo do mês</strong> de operação nenhuma — é o que este
            campo conserta. Nada do que já foi apurado muda: o tipo diz de qual
            operação é a conta, não como ela é calculada.
          </>
        ) : (
          <>
            EMPURRADA e ROTA são dois fechamentos da mesma quinzena, cada um com
            a sua planilha de remuneração. Trocar o tipo move esta competência
            de um <strong>Resumo do mês</strong> para o outro; os valores
            apurados seguem os mesmos.
          </>
        )}
      </p>
      <div className="max-w-xs space-y-1.5">
        <Label htmlFor={`tipo-${competencia.id}`}>Tipo de operação</Label>
        <Select value={escolhido} onValueChange={setEscolhido}>
          <SelectTrigger id={`tipo-${competencia.id}`}>
            <SelectValue placeholder="Escolha a operação" />
          </SelectTrigger>
          <SelectContent>
            {TIPOS_DE_OPERACAO.map((t) => (
              <SelectItem key={t.valor} value={t.valor}>
                {t.rotulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {explicacao && (
          <p className="text-xs text-muted-foreground">{explicacao}</p>
        )}
      </div>
      {informar.isError && (
        <Alert variant="destructive">
          <AlertDescription>{textoDoErro(informar.error)}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {/*
          Desabilitado enquanto não há mudança a gravar, e não só enquanto o
          campo está vazio: em "corrigir" o select nasce no tipo atual, e um
          botão ativo ali prometeria uma correção que não corrige nada.
        */}
        <Button
          onClick={() => informar.mutate()}
          disabled={
            informar.isPending ||
            escolhido === "" ||
            escolhido === competencia.tipoDeOperacao
          }
        >
          <Tag className="w-4 h-4 mr-1.5" />
          {informar.isPending
            ? "Gravando…"
            : informando
              ? "Informar o tipo"
              : "Trocar o tipo"}
        </Button>
        <Button
          variant="ghost"
          onClick={aoFechar}
          disabled={informar.isPending}
        >
          Cancelar
        </Button>
      </div>
    </div>
  );
}

/**
 * O painel de exclusão de uma linha — a pergunta antes do ato irreversível.
 *
 * **Por que a pergunta mora na tela, e não num `window.confirm`.** É a mesma
 * razão do descarte na competência aberta: o diálogo do navegador não sabe
 * dizer *quantos* arquivos vão embora, e ver o tamanho do que se vai apagar é a
 * única defesa real contra apagar a importação errada. Aqui vale duas vezes,
 * porque na lista as quinzenas se parecem — dois CDDs no mesmo período são duas
 * linhas quase idênticas.
 *
 * **Por que busca a competência inteira.** Pelo mesmo motivo de
 * `FechamentoDaLinha`: a lista traz o índice, e o tamanho do que existe dentro
 * de cada quinzena não cabe nele. A chave é a mesma da tela da competência, de
 * propósito — quem já abriu a competência não espera de novo aqui.
 *
 * **A encerrada não chega até aqui**: o botão da linha está desabilitado, e o
 * servidor recusaria de todo modo. Reabrir, com motivo, vem antes — é o que
 * mantém uma quinzena fechada valendo como prova do que foi cobrado.
 */
function ExclusaoDaLinha({
  competencia,
  aoFechar,
}: {
  competencia: Competencia;
  /** Fecha o painel — o mesmo gesto para quem desistiu e para quem excluiu. */
  aoFechar: () => void;
}) {
  const cliente = useQueryClient();
  const dados = useQuery({
    queryKey: chaveDaCompetencia(competencia.id),
    queryFn: () => lerCompetencia(competencia.id),
  });

  const excluir = useMutation({
    mutationFn: () => excluirCompetencia(competencia.id),
    onSuccess: () => {
      /*
        A competência apagada sai do cache em vez de ser invalidada: invalidar
        mandaria buscar de novo o que não existe mais, e a tela dela — se
        alguém a tiver aberta noutra aba — pediria um 404 para descobrir o que
        já se sabe aqui.
      */
      cliente.removeQueries({ queryKey: chaveDaCompetencia(competencia.id) });
      void cliente.invalidateQueries({
        queryKey: ["fechamento", "competencias"],
      });
      void cliente.invalidateQueries({ queryKey: ["fechamento", "apuracoes"] });
      void cliente.invalidateQueries({ queryKey: ["fechamento", "partes"] });
      aoFechar();
    },
  });

  const periodo = `${competencia.inicio.split("-").reverse().join("/")} a ${competencia.fim.split("-").reverse().join("/")}`;
  const enviados = dados.data?.documentos.filter((d) => d.vigente).length ?? 0;

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Excluir esta importação?</p>
      <p className="text-sm text-muted-foreground">
        {periodo} · {competencia.unidade.nome ?? competencia.unidade.codigo} ·{" "}
        {competencia.transportadora.nome ?? competencia.transportadora.codigo} ·{" "}
        {rotuloDoTipo(competencia.tipoDeOperacao)}
      </p>
      {dados.isLoading ? (
        <p className="text-sm text-muted-foreground">
          Contando o que vai junto…
        </p>
      ) : (
        <ul className="text-sm text-muted-foreground space-y-1">
          <li>
            • {enviados} relatório(s) enviado(s), com as linhas que eles
            produziram
          </li>
          <li>
            •{" "}
            {dados.data?.apuracao
              ? "a conta apurada e as divergências dela"
              : "nenhuma apuração"}
          </li>
          <li>• os dias da quinzena, como esta competência os montou</li>
        </ul>
      )}
      <p className="text-sm text-muted-foreground">
        A quinzena deixa de existir e não volta. Se o que está errado são os
        arquivos, e não a quinzena, abra a competência e use{" "}
        <strong>Descartar dados</strong> — ela fica, vazia, e recebe os certos.
      </p>
      {excluir.isError && (
        <Alert variant="destructive">
          <AlertDescription>{textoDoErro(excluir.error)}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="destructive"
          onClick={() => excluir.mutate()}
          disabled={excluir.isPending}
        >
          <Trash2 className="w-4 h-4 mr-1.5" />
          {excluir.isPending ? "Excluindo…" : "Sim, excluir a importação"}
        </Button>
        <Button variant="ghost" onClick={aoFechar} disabled={excluir.isPending}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
