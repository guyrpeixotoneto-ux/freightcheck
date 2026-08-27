# Fluxos Operacionais

O mapa dos processos da empresa, dentro de **Administração → Fluxos
Operacionais**. Ele existe para responder uma pergunta:

> Como este processo funciona, quem participa, quais sistemas e documentos
> entram, onde podem ocorrer falhas — e onde eu consulto isso dentro do
> FreightCheck?

Não é um desenhador de fluxogramas. O fluxograma é a leitura mais visível do que
está guardado; o resto — o painel da etapa, os botões que navegam para as telas
do produto, e no futuro o farol do Modo Monitoramento — lê exatamente as mesmas
linhas.

---

## 1. A arquitetura, em uma página

Três camadas, e a fronteira entre elas é o ponto do módulo.

```
lib/fluxos                      O MOTOR GENÉRICO
  catalogo.ts                     o vocabulário (tipos, espécies, status)
  modelo.ts                       o que entra e o que sai
  validacao.ts                    o que é aceito, e as recusas com nome
  layout.ts                       onde os cartões ficam (função pura)
  roteiro.ts                      o texto colado vira etapas e setas (função pura)
  repositorio.ts                  toda leitura e escrita, escopada por empresa
  exemplos/                       fluxos declarados — DADO, não código
  semear.ts                       plantar um modelo numa empresa

artifacts/api-server            A SUPERFÍCIE HTTP
  routes/fluxos.ts                traduz requisição em chamada; decide nada
  lib/empresa-da-requisicao.ts    de quem é a requisição — autoridade única

artifacts/freightaudit          A TELA
  lib/fluxos.ts                   tipos, consultas, e as funções puras testadas
  lib/fluxos-exportar.ts          o desenho virando PNG, PDF e SVG (função pura)
  components/fluxos/*             canvas, cartão, painel, editores
  pages/fluxos.tsx                a lista
  pages/fluxo.tsx                 o fluxograma + painel lateral + editor
```

**Nenhuma linha do motor sabe o que é um CTe.** "Emissão de CTe até
Recebimento" é um registro em `fluxo_operacional` com dezesseis em
`fluxo_etapa` — montado por `importarFluxo`, a mesma função que a tela usa
quando alguém cria um fluxo à mão. O arquivo
`lib/fluxos/src/exemplos/cte-ate-recebimento.ts` é um objeto literal, e
trocá-lo por outro processo é trocar aquele arquivo e nada mais.

A prova disso não é este texto: é
`lib/fluxos/src/exemplos/nf-ate-pagamento.ts` — um processo de contas a pagar,
de outro domínio, montado pelas mesmas funções — e o caso
`o motor é genérico` em `isolamento.test.ts`, que constrói um terceiro processo
("Disponibilidade de frota") do zero pelas funções públicas, sem tabela, rota ou
componente próprio.

---

## 2. As tabelas

Seis, todas novas. Nenhuma tabela existente foi alterada.

| tabela | o que guarda |
| --- | --- |
| `fluxo_operacional` | o processo: nome, slug, categoria, status, versão, dono, carimbos |
| `fluxo_etapa` | a etapa: tipo, ordem, área, responsável, textos, status, posição no canvas, chave de monitoramento |
| `fluxo_conexao` | a seta: origem, destino, tipo, rótulo/condição, ordem |
| `fluxo_etapa_item` | sistemas, documentos, responsáveis, falhas e gargalos — uma linha por item, `especie` discrimina |
| `fluxo_etapa_indicador` | nome, unidade, sentido desejado, origem futura do dado |
| `fluxo_etapa_acao` | as consultas no FreightCheck: título, rota interna, parâmetros, ícone |

O porquê de cada decisão está por extenso em `lib/db/src/schema/fluxo.ts`.
As três que mais importam:

**`empresa_id` em todas as seis, e chave composta.** A empresa é a `unidade`
canônica — a autoridade por CNPJ que a `0049` criou; não há tabela de inquilino
nova. A coluna se repete nas filhas para que exista
`(fluxo_id, empresa_id) → fluxo_operacional(id, empresa_id)`: com ela, gravar
uma etapa da empresa A dentro de um fluxo da B é recusado **pelo Postgres**, não
por um `if` que a próxima rota pode esquecer. As duas pontas de `fluxo_conexao`
referenciam `(etapa_id, fluxo_id)` pela mesma razão — ligar etapas de fluxos
diferentes deixa de ser expressável.

**Tipo, espécie e status são `text` sem `CHECK`.** A lista de valores válidos
mora em `lib/fluxos/src/catalogo.ts`, que é código: acrescentar um tipo de etapa
é uma linha, sem migration. O que tem `CHECK` é estrutura, não vocabulário:
nome não vazio, conexão não voltando para a própria etapa, rota de ação
começando com `/`.

**`fluxo_etapa_item` é uma tabela só.** Cinco espécies com a mesma forma dariam
cinco tabelas, cinco rotas e cinco componentes idênticos — e uma migration por
espécie nova. Isso **não** é o "JSON opaco" que o módulo recusa: cada item é uma
linha consultável, com tipo, ordem e chave estrangeira.
`SELECT nome, count(*) FROM fluxo_etapa_item WHERE especie='FALHA' GROUP BY 1`
responde "quais falhas mais aparecem nos nossos processos" — pergunta que um
`textarea` não responde.

Indicadores e ações ficam fora daquela tabela porque têm campos que só elas têm
(unidade/sentido/origem; rota/parâmetros).

---

## 3. A migration

`lib/db/migrations/0068_fluxos_operacionais.sql`, gerada por
`drizzle-kit generate` a partir do schema e depois tornada reentrante à mão, no
padrão da `0015`, `0048` e `0049`: `CREATE TABLE IF NOT EXISTS`,
`CREATE INDEX IF NOT EXISTS`, e as chaves estrangeiras dentro de um
`DO $$ … IF NOT EXISTS (SELECT 1 FROM pg_constraint …)`.

Nenhuma migration anterior foi tocada. O journal e o snapshot foram atualizados
pelo gerador; o arquivo foi renomeado para o nome descritivo e o journal
acompanhou.

Verificado: a fila inteira aplica do zero (`0000` … `0068`), e aplicar o
`0068` duas vezes sobre o mesmo banco não produz erro.

---

## 4. As APIs

Todas sob sessão (o portão `requireSession` cobre `/api` inteiro), e todas
escopadas por `?empresaId=`. **A empresa nunca vem do corpo** — há um teste que
manda `empresaId` no `POST` e confirma que ele é ignorado.

| método | caminho | o que faz |
| --- | --- | --- |
| GET | `/fluxos/catalogo` | o vocabulário + os modelos disponíveis |
| GET | `/fluxos` | lista (`incluirArquivados`, `status`, `categoria`) |
| GET | `/fluxos/:id` | o fluxo inteiro: etapas com material, e conexões |
| POST | `/fluxos` | cria |
| POST | `/fluxos/de-modelo` | cria a partir de um modelo do catálogo |
| POST | `/fluxos/importar` | cria fluxo + etapas + conexões numa transação |
| POST | `/fluxos/roteiro` | cria o fluxo inteiro a partir de um texto, uma etapa por linha |
| POST | `/fluxos/:id/roteiro` | acrescenta etapas por texto a um fluxo que já existe |
| POST | `/fluxos/:id/organizar` | aplica o layout automático ao que já está gravado |
| PUT | `/fluxos/:id` | edita o cabeçalho |
| POST | `/fluxos/:id/arquivar` · `/desarquivar` | muda o status, com verbo nomeado |
| POST | `/fluxos/:id/duplicar` | cópia completa, nasce rascunho |
| POST | `/fluxos/:id/etapas` | cria etapa |
| PUT | `/fluxos/:id/etapas/:etapaId` | edita etapa |
| DELETE | `/fluxos/:id/etapas/:etapaId` | exclui (setas somem em cascata) |
| PUT | `/fluxos/:id/posicoes` | grava o arrastar — todas as posições, ou nenhuma |
| POST | `/fluxos/:id/conexoes` | liga duas etapas |
| PUT | `/fluxos/:id/conexoes/:conexaoId` | troca tipo/condição |
| DELETE | `/fluxos/:id/conexoes/:conexaoId` | remove a seta |
| PUT | `/fluxos/:id/etapas/:etapaId/itens/:especie` | substitui a lista daquela espécie |
| PUT | `/fluxos/:id/etapas/:etapaId/indicadores` | substitui os indicadores |
| PUT | `/fluxos/:id/etapas/:etapaId/acoes` | substitui as ações |

Não há `PATCH /qualquer-coisa/:id`: cada caminho nomeia o que faz com o quê.

**Erros.** A rota não tem `try/catch`. As recusas do motor (`RecusaDeFluxo` e
filhas) sobem para `middlewares/contrato-json.ts`, que as traduz pela tabela de
`lib/recusa-de-dominio.ts`: 404 para não encontrado (inclusive "é de outra
empresa" — confirmar a existência já seria vazamento), 409 para slug repetido e
seta duplicada, 400 para o resto, 403 para empresa não permitida.

---

## 5. Multi-tenant — o que existe, e o que ainda não

O que **está** feito, com prova:

- toda consulta e toda escrita recebem `empresaId` como argumento separado do
  corpo e o incluem no `where` — não há sobrecarga que o dispense;
- as escritas filtram por `(id, fluxoId, empresaId)` na própria instrução, e não
  por "ler o dono, depois escrever";
- as chaves compostas do banco tornam o vínculo atravessado impossível de
  gravar, mesmo por SQL direto (dois testes exercitam isso sem passar pelo
  repositório);
- vinte e dois casos de teste — treze no motor, nove pela API — tentam ler,
  editar, arquivar, duplicar, criar etapa, editar etapa, excluir etapa,
  reposicionar, conectar, editar conexão, excluir conexão e gravar material da
  empresa A sobre registros reais da B. Todos recebem "não existe", e o último
  confirma que o fluxo da B ficou intacto depois de todas as tentativas.

O que **não** existe, e é a limitação honesta deste módulo: o FreightCheck não
tem vínculo entre conta e empresa. Não há `empresa_id` em `app_user` e nenhuma
tela do produto restringe unidades por usuário — está escrito no próprio schema
desde antes deste módulo ("este produto é hoje de um cliente só: não há coluna
de empresa em lugar nenhum", `lib/db/src/schema/significado.ts`). Portanto hoje
**qualquer conta autenticada pode operar qualquer empresa cadastrada nesta
instalação**.

A costura para o dia em que isso mudar é uma função só:
`podeOperar(usuario, empresaId)` em
`artifacts/api-server/src/lib/empresa-da-requisicao.ts`. Ela é o único ponto
onde a pergunta é respondida; quando houver vínculo, muda ali e as dezenas de
consultas escopadas continuam valendo sem uma linha de alteração.

---

## 6. As telas

**`/fluxos` — a lista.** Nome, categoria, descrição resumida, status, versão,
quantidade de etapas, dono e última atualização. Busca, filtro por categoria e
interruptor de arquivados. Ações por linha: abrir, duplicar, arquivar/
desarquivar. Botão **+ Novo fluxo**. Com a lista vazia, oferece começar de um
modelo.

**`/fluxos/:id` — o fluxograma.** O canvas ocupa a tela; o cabeçalho é uma faixa
fina com nome, categoria, status e o resumo ("16 etapas · 20 conexões · com
retorno"). Pan, zoom, ajuste automático na abertura, mapa de navegação a partir
de doze etapas.

O **cartão** mostra nome, tipo, área/responsável e um contador discreto de
detalhes — e nada mais. Três formas apenas: pílula (início/fim), losango
(decisão), retângulo (o resto); a cor vem do catálogo do servidor.

Clicar abre o **painel lateral** (coluna à direita, o fluxo continua visível):
cabeçalho, o que acontece aqui, objetivo, sistema principal, as cinco listas de
material, regras, indicadores, observações e **Consultar no FreightCheck** — os
botões que navegam para as telas do produto. Seção sem conteúdo não aparece.

---

## 7. O editor

Não há tela de edição separada do visualizador: é o mesmo canvas, com um
interruptor de "só leitura" para quem só quer consultar.

- **Criar etapa** — botão no cabeçalho.
- **Editar/excluir etapa** — pelo painel lateral.
- **Conectar** — arrastando de uma borda do cartão à outra. As alças aparecem
  no hover, nas quatro laterais, o que permite desenhar a volta do retrabalho.
- **Editar/remover conexão** — clicando na seta: um painel pequeno com tipo e
  condição.
- **Posicionar** — arrastando. Grava quando o arrasto termina, todas as posições
  numa chamada, e só se algo mudou.

O editor da etapa tem três abas: **Etapa** (identidade e textos), **Detalhes**
(as cinco listas), **Consultas** (indicadores, ações e a chave de
monitoramento). As listas usam um componente só, `ListaEditavel`, cuja diferença
entre elas é dado — uma espécie nova no catálogo do servidor não exige nada da
interface.

### Os três atalhos que fazem o cadastro caber numa reunião

O diálogo de etapa é bom para **descrever uma** etapa e péssimo para
**levantar treze**: treze aberturas, treze fechamentos e doze arrastos para
ligar um cartão no outro. Era a fricção que deixava um fluxo criado e vazio.

- **Montar por texto** — a lista que saiu da reunião, uma etapa por linha,
  vira o esqueleto inteiro ligado e posicionado. Na lista de fluxos ("Montar
  por texto") cria um fluxo novo; dentro do fluxograma ("Colar etapas")
  acrescenta ao que já existe, opcionalmente pendurado na etapa selecionada.
  A gramática cabe em quatro regras:

  ```
  # comentário
  [inicio] Origem da tarifa / trecho | Operação | Freitec/TMS
  Validação da tarifa | Ambev / Operação | SAP
  [documento] Emissão do documento | Ambev / Sistema | Unidox
  Integração com Rodopar | Sistemas / TI | Rodopar
  + Integração com Connect | Sistemas / TI | Connect
  ```

  `nome | área | sistema` (os dois últimos opcionais), `[tipo]` escolhendo o
  tipo do catálogo, `+` pondo a linha **em paralelo** com a de cima — as duas
  nascem da mesma etapa anterior e a próxima linha recebe as duas —, e `#`
  para comentário. Nada é inferido além disso: a primeira linha não vira
  `INICIO` sozinha, porque corrigir o que o computador inventou custa mais do
  que escrever `[inicio]`.

  Quem interpreta é `interpretarRoteiro`, no motor, e **só** ele: a tela manda
  o texto cru e conta linhas para mostrar "13 etapas" enquanto se digita. Uma
  segunda gramática no front aceitaria hoje o que o servidor recusa amanhã.

- **Etapa seguinte** — no painel da etapa: cria a próxima **já ligada** a esta
  e já posicionada. É a frase mais comum de quem levanta um processo ("e
  depois disto vem aquilo") em um gesto, em vez de cinco.

- **Organizar** — no cabeçalho do fluxograma: aplica `posicionarEtapas` ao que
  está gravado. O clique arruma só quem nunca foi arrastado; com **Shift**,
  refaz o arranjo inteiro. Até aqui a função era pura, testada e não chamada
  por ninguém fora da importação — quem esquecesse de arrastar ficava com os
  cartões empilhados na origem.

Gravação: uma chamada de identidade e uma por lista, **em série**. Em paralelo,
uma recusa deixaria a etapa com metade do que a pessoa digitou. Erro mantém o
diálogo aberto com o conteúdo preservado.

---

### Exportar — o desenho saindo do produto

Botão **Exportar** no cabeçalho do fluxograma: **PNG** (colar num slide),
**PDF** (anexar e imprimir) e **SVG** (abrir num editor de vetor). Os três saem
do mesmo SVG montado por `montarSvgDoFluxo`, então nenhum pode divergir dos
outros.

O arquivo é montado **do dado**, e não raspado do DOM do canvas:

- toda etapa e toda seta cadastradas aparecem, e isso é afirmado em teste sem
  navegador — o que sai é decisão, e decisão neste pacote vira função pura;
- zoom, rolagem, painel aberto, tema escuro e cartão selecionado não vazam para
  o arquivo: exporta-se o fluxo inteiro, enquadrado;
- o arquivo sai sempre claro, porque o tema é preferência de quem lê a tela e
  não propriedade do processo;
- o cabeçalho leva nome, categoria, tamanho, dono, empresa e a data — um
  fluxograma que circula fora do produto precisa dizer de quem ele é;
- a legenda traz **só** os tipos de seta que aquele fluxo usa.

Duas decisões de desenho vieram de olhar o arquivo gerado, não do código: a
folha tem uma largura mínima ditada pelo cabeçalho (um processo em corrente é
estreito, e o nome por extenso saía cortado), e a seta de retrabalho que sobe
mais de uma faixa sai por um **canal à direita** de todos os cartões, com o
rótulo dentro dele — em linha reta ela atravessava meia dúzia de etapas.

Nada disso passa pelo servidor: não há rota de exportação, fila nem arquivo
guardado. E nenhuma dependência nova — o PDF de uma página com uma imagem
dentro são seis objetos e uma tabela de deslocamentos, escritos em
`montarPdfDeImagem` e conferidos em teste; a imagem entra sem perda via
`FlateDecode` (`CompressionStream`), com JPEG como caminho alternativo.

## 8. Como adicionar um novo tipo de fluxo

**Pela tela, sem tocar em código** — que é o critério de aceite. Dois caminhos,
e a diferença é o que a pessoa tem em mãos:

- *com a lista pronta* — **Montar por texto**: nome, categoria, colar as etapas
  uma por linha, criar. O fluxo nasce ligado e desenhado, e o detalhe de cada
  etapa entra depois pelo painel;
- *descobrindo o processo enquanto desenha* — **+ Novo fluxo** → criar etapas →
  ligar → cadastrar detalhes → adicionar consultas.

Nenhuma tabela nova, nenhuma página nova, nenhum componente novo em nenhum dos
dois.

**Como modelo que acompanha o produto** (opcional) — é o que
`exemplos/operacao-empurrada.ts` faz com o macrofluxo da operação empurrada
(origem da tarifa, emissão no Unidox, as integrações Rodopar e Connect em
paralelo, auditoria fiscal, pendências, conciliação, e a volta do retrabalho):
crie
`lib/fluxos/src/exemplos/<slug>.ts` exportando um `FluxoDeclarado`, e some uma
entrada em `exemplos/index.ts`. `semeado: false` o deixa disponível como ponto
de partida sem plantá-lo em instalação nenhuma.

**Um vocabulário novo** (um tipo de etapa, uma espécie de item): uma entrada em
`lib/fluxos/src/catalogo.ts`. Sem migration, sem `ALTER TYPE`, sem mudança na
interface — a tela lê o catálogo do servidor.

---

## 9. Os testes

| onde | arquivos | casos |
| --- | --- | --- |
| motor — puro | `lib/fluxos/src/__tests__/catalogo-e-validacao.test.ts` | 43 |
| motor — roteiro em texto | `lib/fluxos/src/__tests__/roteiro.test.ts` | 20 |
| motor — layout | `lib/fluxos/src/__tests__/layout.test.ts` | 14 |
| motor — banco e multi-tenant | `lib/fluxos/src/__tests__/isolamento.test.ts` | 53 |
| API sobre HTTP | `artifacts/api-server/src/routes/__tests__/fluxos.test.ts` | 44 |
| interface | `artifacts/freightaudit/src/lib/__tests__/fluxos.test.ts` | 34 |
| interface — exportação | `artifacts/freightaudit/src/lib/__tests__/fluxos-exportar.test.ts` | 39 |

**247 casos.** O que eles cobrem, por eixo do pedido:

- **Banco** — criação de fluxo, etapa e conexão; contagens da lista (incluindo a
  armadilha do join em leque); unicidade de slug por empresa; seta duplicada;
  laço recusado e **ciclo permitido** (decisão explícita, com prova);
  cascata ao excluir etapa; `RESTRICT` ao apagar a empresa; `CHECK` de nome
  vazio por SQL direto.
- **Multi-tenant** — os vinte e dois casos descritos na seção 5, mais dois que
  provam a defesa do banco sem passar pelo repositório.
- **API** — portão de sessão; catálogo; escopo ausente/inválido; empresa vinda
  do corpo ignorada; ciclo completo; cada recusa com o status certo; lote
  inválido que não grava metade; importação transacional.
- **Roteiro** — uma linha vira uma etapa, os campos separados por barra, o
  marcador de tipo com e sem acento, o `+` abrindo e fechando o paralelo (dois
  e três ramos), o prefixo de chave que evita colisão ao acrescentar, e cada
  recusa com o número da linha; mais o macrofluxo da operação empurrada escrito
  como texto, com a bifurcação das integrações conferida.
- **Acrescentar e organizar** — a ordem continuando de onde parou, a ponta
  inventada recusada antes de gravar, o lote inválido que não entra pela
  metade, a empresa alheia recusada nas duas operações, e o arranjo à mão que
  só `refazerTudo` desmancha.
- **Exportação** — toda etapa e toda seta no arquivo; o rótulo da condição; o
  cabeçalho com data e empresa; o fundo claro; o XML escapado; a conexão órfã
  que não vira seta para o nada; o fluxo vazio que ainda produz arquivo; o tipo
  fora do catálogo que continua desenhado; a volta longa saindo pelo canal e a
  curta seguindo em linha; a largura mínima do cabeçalho; e o PDF — cabeçalho,
  objetos, a tabela de deslocamentos batendo byte a byte com o arquivo, a
  imagem embutida intacta, a orientação escolhida pela forma do desenho e o
  parêntese escapado no título.
- **Interface** — montagem do canvas (todo cartão, toda seta, inclusive a volta
  do retrabalho); tipo desconhecido não derruba o desenho; o recorte do cartão;
  o agrupamento do painel; **o endereço de cada ação de navegação**, incluindo a
  recusa de `//host` e `javascript:`; filtros da lista.

A ligação entre o item do menu e a rota é coberta pelo teste que já existia
(`components/layout/__tests__/sidebar.test.ts`), que exige que todo `href` da
lateral tenha rota no `App.tsx`.

**Não há teste de renderização com DOM.** Este pacote de interface não tem jsdom
nem testing-library, por decisão anterior a este módulo (ver
`artifacts/freightaudit/vitest.config.ts`): o que é lógica vira função pura e é
provado; o que é pixel não é testado aqui. O módulo foi escrito para caber nessa
régua — daí `montarCanvas`, `resumoDoCartao`, `itensPorEspecie` e
`enderecoDaAcao` viverem em `lib/fluxos.ts` e não dentro dos `.tsx`.

---

## 10. Limitações atuais

1. **Sem vínculo conta ↔ empresa** — seção 5. É a limitação mais importante, e
   a costura para resolvê-la é uma função.
2. **Versionamento é um número.** `fluxo.versao` existe, é exibido e é
   carimbado; não há histórico de versões nem comparação entre elas.
3. **Indicadores são metadados.** Cadastráveis, nunca calculados. A tela diz
   isso explicitamente em vez de mostrar um número sem lastro.
4. **Modo Monitoramento não existe.** A opção aparece desabilitada no seletor —
   o lugar dela está decidido, nada foi implementado por antecipação.
5. **O layout automático é simples, e assume um processo em corrente.**
   `posicionarEtapas` distribui por níveis a partir das raízes; não minimiza
   cruzamento de arestas. Ele é aplicado na importação, ao acrescentar um
   roteiro e pelo botão **Organizar** — o que restou de limitação é o
   algoritmo, não o gatilho.
6. **A exportação é de uma página só.** PNG, PDF e SVG saem inteiros, e o PDF
   encaixa o desenho numa página A4 — um processo muito longo sai legível na
   tela e pequeno no papel. Repartir em várias páginas com emenda não foi
   feito.
7. **Sem reordenação por arrastar dentro das listas** do editor — a ordem é a de
   inserção, e reordenar é remover e adicionar.
8. **O canvas não é usável em tela de celular.** É responsivo no sentido de se
   ajustar à largura, mas desenhar processo em 375px não é o caso de uso.

---

## 11. Próximos passos para o Modo Monitoramento

A arquitetura não bloqueia nada disso, e nenhuma tabela nova é necessária para
os três primeiros passos.

**Passo 1 — a chave.** `fluxo_etapa.chave_monitoramento` já existe: um nome
estável e opcional (`cte.autorizacao_sefaz`) pelo qual um coletor liga dados a
uma etapa. Hoje nada o lê, o que é o que impede o acoplamento prematuro de já
ter acontecido.

**Passo 2 — o coletor, fora do motor.** Um pacote novo
(`lib/fluxos-monitoramento`) que sabe, para cada chave conhecida, como perguntar
ao acervo. Ele depende de `@workspace/fluxos`; o inverso **nunca** — é o que
mantém o motor genérico. Uma rota
`GET /fluxos/:id/monitoramento?competencia=…` devolve
`{ chave, farol, valores[] }` por etapa.

**Passo 3 — o farol na tela.** `montarCanvas` já recebe o fluxo e devolve
`data` por nó; o farol entra como mais um campo desse `data`, e o cartão ganha
um ponto colorido. Verde/amarelo/vermelho/**cinza** — cinza é obrigatório e
significa "sem dado", nunca "tudo bem". O seletor de modo já está no cabeçalho.

**Passo 4 — os indicadores ganham número.**
`fluxo_etapa_indicador.origem` é hoje uma frase; vira a referência que o coletor
resolve. É a única mudança de schema prevista, e é uma coluna.

**Passo 5 — SLA e séries.** Só depois dos anteriores, e aí sim com tabela nova
(uma série temporal por chave). Antes disso, qualquer histórico seria inventado.

Uma regra atravessa os cinco: **o motor não pode passar a saber de dado real.**
No dia em que `lib/fluxos` importar algo de `@workspace/fechamento` para
calcular um farol, o módulo deixou de ser genérico — e o teste
`o motor é genérico` está lá para tornar isso visível.
