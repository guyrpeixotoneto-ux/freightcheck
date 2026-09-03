/**
 * Para onde o seletor de unidade leva — as regras, fora do JSX.
 *
 * O seletor "Unidade atual" da lateral (`components/layout/sidebar.tsx`) faz
 * duas perguntas na mesma caixa: *qual unidade* e *todas de uma vez*. As duas
 * respondem a mesma coisa — **em que tela você cai** —, e a resposta nunca foi
 * "sempre a mesma": ela depende da tela em que você já está, porque trocar de
 * recorte não deve trocar de assunto.
 *
 * Estas regras moravam dentro de `sidebar.tsx`, privadas, e por isso não tinham
 * teste: o pacote testa lógica e não pixel (ver `vitest.config.ts`), e um
 * `enderecoDe` que só existe dentro de um componente React só seria observável
 * montando o componente. Como o Painel de Unidades passou a honrar os dois
 * modos, o custo de errar aqui subiu — errar agora não é cair na tela errada, é
 * cair na tela certa com o recorte de outra pessoa.
 *
 * Nada aqui lê a rede nem o React. São strings entrando e strings saindo, como
 * em `lib/recorte.ts`, com quem este módulo divide o vocabulário.
 */

import {
  DASHBOARD,
  ENTRADA_DA_AUDITORIA,
  EVOLUCAO_POR_PLACA,
  GESTAO_A_VISTA,
  LINHA_DO_TEMPO,
  RESUMO_EXECUTIVO,
} from "@/lib/ambiente";

/**
 * O Monitoramento de Chamados, escrito uma vez.
 *
 * Não vem de `lib/ambiente.ts` como os outros porque lá moram as telas que o
 * seletor de ambiente conhece; esta é uma rota da lateral, como
 * `/justificativas`. O nome existe porque ela é lida em três lugares deste
 * arquivo — as duas listas e a chave de tempo —, e um literal repetido três
 * vezes é o começo de uma discordar das outras.
 */
const MONITORAMENTO_DE_CHAMADOS = "/monitoramento-de-chamados";

/** O que o seletor precisa saber de um contexto para montar o endereço dele. */
export interface EscopoNavegavel {
  scopeHash: string;
  channel: string | null;
}

/**
 * As telas, fora de Parâmetros, que já leem `scopeHash`/`canal` da própria
 * URL — trocar de unidade nelas troca só o dado, sem trocar de tela.
 *
 * Deliberadamente uma lista fechada, e não "qualquer rota da Auditoria": uma
 * tela de detalhe de um ativo específico (`/composicao/:id`, `/dre/:id`) não
 * entra, porque o ativo da URL é de outra unidade e preservar o caminho levaria
 * a um erro 404 ou a uma ficha errada — para essas, Parâmetros continua sendo o
 * destino seguro.
 *
 * **Estar nesta lista é uma promessa**, e o Painel de Unidades passou tempo aqui
 * sem cumpri-la: ele recebia `scopeHash` e resumia o acervo inteiro do mesmo
 * jeito. Uma tela entra aqui quando lê o par, não quando poderia ler.
 */
export const TELAS_QUE_HONRAM_ESCOPO = new Set<string>([
  RESUMO_EXECUTIVO,
  DASHBOARD,
  GESTAO_A_VISTA,
  LINHA_DO_TEMPO,
  /*
    A Evolução por Placa lê o par (unidade, canal) e recorta a leitura inteira
    no servidor — entra aqui porque cumpre a promessa, e fica **fora** de
    `TELAS_QUE_HONRAM_VISAO_GERAL` pelo mesmo critério: a matriz placa ×
    vigência é de um contexto de cada vez, e somar placas entre unidades sem o
    servidor ter somado daria uma frota que nenhuma delas reconheceria.
  */
  EVOLUCAO_POR_PLACA,
  ENTRADA_DA_AUDITORIA,
  "/vigencia",
  "/qlp-administrativo",
  "/remunerado",
  "/dre",
  "/composicao",
  "/parametros",
  "/alteracoes",
  /*
    A Cobertura de dados. Ela mede "o que já temos versus o que deveríamos ter",
    e media isso sobre o acervo inteiro enquanto a lateral, ao lado, nomeava uma
    unidade — cinco unidades na matriz sob a palavra PERNAMBUCO. A tela agora lê
    o par (`pages/dados.tsx`), e a soma continua existindo: é `visaoGeral=1`,
    logo abaixo, que é uma escolha e não a ausência de uma.
  */
  "/dados",
  /*
    As telas 360° das quatro auditorias. Elas são a mesma tela parametrizada
    pelo tipo (`pages/frota-360.tsx`), e as seis leem o par unidade/canal do
    endereço — trocar de unidade numa delas troca o dado, não a tela.

    Os caminhos são relativos à base do ambiente, como todos os desta lista:
    dentro de uma auditoria prefixada a localização chega sem a base
    (`lib/ambiente-aberto.ts`), e é por isso que uma lista só serve às quatro.
  */
  "/cavalo-360",
  "/carreta-360",
  "/caminhao-360",
  "/carroceria-360",
  "/empilhadeira-360",
  "/trecho-360",
  "/radar-trechos",
  /*
    As Justificativas. Elas recortam as comparações pelo `scopeHash` aberto
    (`comparacoesDoEscopo`, em `lib/justificativas.ts`) — antes o seletor de
    vigência atravessava as unidades e trocar de vigência trocava de unidade
    calada, sob a lateral escrita com o nome da anterior.

    O Painel de Justificativas entra pelo mesmo motivo: ele soma o que falta
    justificar, e somava a operação inteira — CAMAÇARI, MANAUS e CDD CEBRASA
    num total escrito sob a palavra PERNAMBUCO. As duas consultas dele levam o
    `scopeHash` (`lib/painel-de-justificativas.ts`), e o servidor recorta as
    comparações por ele.
  */
  "/justificativas",
  "/painel-de-justificativas",
  /*
    O Monitoramento de Chamados. Ele entra pela mesma porta das duas de cima e
    pela mesma reclamação, dita de novo: "eu mudo de PERNAMBUCO para CAMAÇARI e
    muda o módulo, mas eu quero ver justamente os chamados que importei de
    Camaçari". Trocar de unidade nele desviava para Parâmetros, e trocar de
    assunto é o que esta lista existe para impedir.

    Ele cumpre a promessa por um caminho que nenhuma outra tela desta lista
    percorre: o recorte dele no banco não é `scope_hash`, é a **série** — a
    unidade que o export da Ambev nomeia. Quem casa as duas é
    `lib/serie-da-unidade.ts`, e o que a tela faz quando elas não se encontram
    está escrito lá: diz que aquela unidade não tem envio, em vez de somar todas
    embaixo do nome de uma.
  */
  MONITORAMENTO_DE_CHAMADOS,
]);

/**
 * As telas que sabem ler `visaoGeral=1` — as que somam todas as unidades.
 *
 * O Painel de Unidades entrou aqui, e é o caso em que a lista deixa de ser
 * detalhe de implementação: ele **é** a soma de todas as unidades, e enquanto
 * esteve de fora escolher "Visão Geral" estando nele expulsava quem escolheu
 * para o Resumo executivo — a opção mais natural da tela era a única que tirava
 * dela.
 *
 * **Parâmetros entrou, e o comentário acima dizia que ele nunca entraria.**
 * Dizia porque era verdade: não existia "Visão Geral de Parâmetros", e a tela
 * é grade de atributo e de gaveta — a soma que a Visão Geral publicava (o
 * resumo executivo, as famílias como totais, uma fila cortada em quarenta) não
 * alimentava nem uma das duas grades. O efeito era o pior possível para quem
 * usa: escolher "Visão Geral" estando em Parâmetros **trocava de tela**, sem
 * avisar, e quem só queria trocar de recorte perdia o que estava lendo.
 *
 * O que mudou não foi a régua, foi o dado: `getFamiliesOverview` agora devolve
 * a árvore inteira somada (`FamiliesOverview.parametros`, montada em
 * `lib/comparison/src/visao-geral-de-parametros.ts`), que é uma `FamiliesView`
 * como a de uma unidade só. A promessa desta lista — *estar aqui é ler
 * `visaoGeral=1` de verdade* — continua valendo para Parâmetros como vale para
 * as outras cinco.
 *
 * Fora desta lista o destino continua sendo o Resumo executivo: não existe
 * Visão Geral de Composição nem de DRE, e oferecer o link ali seria a mesma
 * promessa vazia que `TELAS_QUE_HONRAM_ESCOPO` já recusa para uma unidade.
 */
export const TELAS_QUE_HONRAM_VISAO_GERAL = new Set<string>([
  ENTRADA_DA_AUDITORIA,
  RESUMO_EXECUTIVO,
  LINHA_DO_TEMPO,
  DASHBOARD,
  GESTAO_A_VISTA,
  "/parametros",
  /*
    A Cobertura de dados entra pelas duas portas, e aqui pelo motivo que esta
    lista exige: a soma de todas as unidades é o que `visaoDaCobertura` já
    devolve quando ninguém manda `escopo` — não é uma tela nova nem um cálculo
    novo, é a mesma medição sem o recorte. Estar aqui é ler `visaoGeral=1` de
    verdade, e é o que a tela faz.
  */
  "/dados",
  /*
    As Justificativas entram pelas duas portas: com uma unidade aberta a fila é
    a dela, e `visaoGeral=1` é a lista atravessando as unidades — que é o que a
    tela fazia sempre, agora como escolha e não como padrão.

    O Painel de Justificativas idem: sem `scopeHash` a rota soma todas as
    unidades da operação, que é exatamente a leitura que `visaoGeral=1` pede.
  */
  "/justificativas",
  "/painel-de-justificativas",
  /*
    O Monitoramento de Chamados entra pelas duas portas: com uma unidade aberta
    ele lê a série dela, e `visaoGeral=1` é a soma de todas as séries — que é o
    que a tela já sabia fazer desde sempre, agora como escolha e não como
    padrão.
  */
  MONITORAMENTO_DE_CHAMADOS,
]);

/**
 * O recorte temporal que cada tela carrega — e por que ele não é um só.
 *
 * Quase toda tela da Auditoria fala de uma quinzena, e o nome disso na URL é
 * `period`. O Painel de Unidades fala do ano inteiro, e o nome disso é `ano`
 * (`pages/visao-gerencial.tsx`). O Monitoramento de Chamados fala de **um
 * dia** — a data da importação —, e o nome disso é `dia`. Trocar de unidade não
 * deve trocar de tempo em nenhuma das três: quem está lendo 2025 e escolhe
 * CAMAÇARI quer CAMAÇARI em 2025, e quem está olhando as movimentações de 28/08
 * quer as de CAMAÇARI em 28/08, não as de hoje.
 *
 * Preservar os três sempre seria mais simples e estaria errado: `period` numa
 * tela de ano é um filtro que ninguém aplica, e `ano` numa tela de quinzena é
 * lixo que viaja em todo link colado por aí.
 *
 * O que **não** viaja junto é `regua` — a janela de nove dias que a tela
 * desenha. Ela é derivada do dia aberto quando ninguém a escreve, e carregá-la
 * levaria uma posição de rolagem para dentro de um recorte novo, onde ela pode
 * nem existir.
 */
const CHAVE_DO_TEMPO: Record<string, string> = {
  [ENTRADA_DA_AUDITORIA]: "ano",
  [MONITORAMENTO_DE_CHAMADOS]: "dia",
};

function tempoPreservado(destino: string, searchAtual: string): [string, string] | null {
  const chave = CHAVE_DO_TEMPO[destino] ?? "period";
  const valor = new URLSearchParams(searchAtual).get(chave);
  return valor === null || valor === "" ? null : [chave, valor];
}

/**
 * O endereço de uma unidade — a tela atual quando ela sabe ler escopo,
 * Parâmetros quando não.
 *
 * `canal` só entra quando o contexto tem um: a ausência da chave quer dizer "as
 * vigências sem canal legível no rótulo", que é uma partição real da base e não
 * a ausência de escolha (ver `Recorte`, em `lib/recorte.ts`).
 */
export function enderecoDe(
  contexto: EscopoNavegavel,
  pathnameAtual: string,
  searchAtual = "",
): string {
  const query = new URLSearchParams({ scopeHash: contexto.scopeHash });
  if (contexto.channel !== null) query.set("canal", contexto.channel);
  const destino = TELAS_QUE_HONRAM_ESCOPO.has(pathnameAtual) ? pathnameAtual : "/parametros";
  const tempo = tempoPreservado(destino, searchAtual);
  if (tempo) query.set(tempo[0], tempo[1]);
  return `${destino}?${query}`;
}

/**
 * O endereço da Visão Geral — a soma de todas as unidades.
 *
 * `visaoGeral=1` viaja mesmo para o Painel de Unidades, onde a ausência de
 * `scopeHash` já bastaria para dizer a mesma coisa. É deliberado: é o que
 * distingue "escolhi ver todas" de "cheguei aqui sem escolher nada", e é o que a
 * caixa da lateral lê para se desenhar. Sem ele, voltar de uma unidade para a
 * Visão Geral produziria um endereço idêntico ao da porta de entrada — e um
 * botão que não muda a URL é um botão que o histórico do navegador não desfaz.
 */
export function enderecoDeVisaoGeral(pathnameAtual: string, searchAtual: string): string {
  const query = new URLSearchParams({ visaoGeral: "1" });
  const destino = TELAS_QUE_HONRAM_VISAO_GERAL.has(pathnameAtual)
    ? pathnameAtual
    : RESUMO_EXECUTIVO;
  const tempo = tempoPreservado(destino, searchAtual);
  if (tempo) query.set(tempo[0], tempo[1]);
  return `${destino}?${query}`;
}

/**
 * O endereço de um item do menu — **com a unidade aberta junto**.
 *
 * Este é o dual de `enderecoDe`, e fecha a segunda metade do mesmo defeito.
 * `enderecoDe` responde "trocar de recorte não deve trocar de assunto"; faltava
 * dizer o contrário, que é o que a lateral fazia a cada clique: **trocar de
 * assunto não deve trocar de recorte**.
 *
 * O que acontecia, e é a reclamação de novo — *"eu troco a Unidade Atual por
 * Camaçari e muda de módulo, mas eu quero ver os chamados de Camaçari"* —, agora
 * pela outra ponta: todo `href` da lateral era o caminho **nu**
 * (`/monitoramento-de-chamados`, `/alteracoes`, `/parametros`). Sem `scopeHash`
 * no endereço, quem chega cai no primeiro contexto do banco
 * (`contextoAberto`, em `lib/contextos.ts`), que é o de vigência mais recente.
 * Então quem abria CAMAÇARI e clicava em "Monitoramento de Chamados" chegava lá
 * em PERNAMBUCO — a lateral trocava sozinha a unidade que ela mesma acabara de
 * escrever, e a única pista era o nome na caixa, cinco centímetros acima, que
 * ninguém lê como aviso.
 *
 * O produto já sabia disto para **um** item: o Assistente
 * (`lib/entrada-do-assistente.ts`), cujo cabeçalho descreve exatamente este
 * defeito e o conserta só para ele. O que estava faltando era a regra valer para
 * a lista inteira.
 *
 * As três decisões:
 *
 * 1. **Só as telas que honram o recorte recebem.** A régua é a mesma de
 *    `enderecoDe` — `TELAS_QUE_HONRAM_ESCOPO` e `TELAS_QUE_HONRAM_VISAO_GERAL` —,
 *    porque é a mesma promessa: escrever `scopeHash` num endereço que ninguém lá
 *    lê é o filtro prometido e não aplicado que estas listas existem para
 *    impedir.
 * 2. **A Visão Geral atravessa como Visão Geral.** Quem está somando as unidades
 *    e muda de tela continua somando, onde a tela nova sabe somar; onde não sabe,
 *    o endereço vai nu e a tela abre como sempre abriu.
 * 3. **O tempo não viaja.** Aqui é o contrário de `enderecoDe`, e pela mesma
 *    razão: lá a tela é a mesma antes e depois, e o vocabulário do tempo com
 *    ela; aqui a tela muda, e `CHAVE_DO_TEMPO` diz que o vocabulário muda junto
 *    — `dia` no Monitoramento, `ano` no Painel, `period` no resto. Traduzir um
 *    no outro seria inventar um recorte que ninguém pediu.
 *
 * Endereços com consulta própria e os absolutos do wouter (`~`, que saem do
 * ambiente — ver `nav-administracao.ts`) saem daqui intactos: o primeiro já
 * escolheu o que leva, e o segundo vai para fora, onde a unidade desta auditoria
 * não quer dizer nada.
 */
export function enderecoDoMenu(
  href: string,
  pathnameAtual: string,
  searchAtual: string,
): string {
  if (href.startsWith("~") || href.includes("?")) return href;

  if (visaoGeralAtiva(pathnameAtual, searchAtual)) {
    return TELAS_QUE_HONRAM_VISAO_GERAL.has(href) ? `${href}?visaoGeral=1` : href;
  }

  const atual = new URLSearchParams(searchAtual);
  const scopeHash = atual.get("scopeHash");
  if (!scopeHash || !TELAS_QUE_HONRAM_ESCOPO.has(href)) return href;

  const query = new URLSearchParams({ scopeHash });
  /*
    O canal é copiado como está, inclusive vazio: `canal=` é a partição das
    vigências sem canal legível, e a **ausência** da chave é outra coisa. Ver
    `Recorte`, em `lib/recorte.ts`, e o `channel !== null` de `enderecoDe`.
  */
  const canal = atual.get("canal");
  if (canal !== null) query.set("canal", canal);
  return `${href}?${query}`;
}

/**
 * O endereço de outro ano no Painel de Unidades, com o escopo aberto intacto.
 *
 * Reescreve `ano` na consulta atual em vez de montar uma nova: `scopeHash`,
 * `canal` e `visaoGeral` continuam valendo depois da troca, e é isso que faz
 * "2025" ser uma pergunta sobre tempo e não um retorno ao acervo. Montar a
 * consulta do zero — que era o que a tela fazia — devolvia ao acervo inteiro
 * quem só queria trocar de ano, e ainda deixava a lateral nomeando a unidade que
 * a tela tinha acabado de largar.
 */
export function enderecoDoAno(ano: string, buscaAtual: string): string {
  const query = new URLSearchParams(buscaAtual);
  query.set("ano", ano);
  return `${ENTRADA_DA_AUDITORIA}?${query}`;
}

/**
 * Se a caixa da lateral deve dizer "Visão Geral" em vez de nomear uma unidade.
 *
 * Duas formas de estar em Visão Geral, e a segunda é a que faltava: o
 * `visaoGeral=1` escrito por quem escolheu, e **o Painel de Unidades sem
 * `scopeHash`**, que é a porta de entrada da Auditoria (`ENTRADA_DA_AUDITORIA`)
 * e mostra todas as unidades por padrão.
 *
 * Sem a segunda, abrir o produto pintava na lateral a primeira unidade da lista
 * enquanto a tela mostrava as cinco — a caixa afirmava um recorte que ninguém
 * escolheu e que a tela não estava aplicando. É o mesmo desencontro que fazia o
 * seletor prometer um filtro que o Painel ignorava, visto do outro lado.
 */
export function visaoGeralAtiva(pathnameAtual: string, searchAtual: string): boolean {
  const params = new URLSearchParams(searchAtual);
  if (params.get("visaoGeral") === "1") return true;
  return pathnameAtual === ENTRADA_DA_AUDITORIA && !params.get("scopeHash");
}
