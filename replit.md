# FreightCheck

Audita os modelos de remuneração que a Ambev entrega pelo Freightec, mostrando o
que mudou entre vigências e quanto isso custa — sem nunca exibir um número que
não consiga sustentar até a célula da planilha de origem.

## Run & Operate

**Botão Run do Replit.** É o caminho inteiro, e é o único. O workflow `Project`
do `.replit` sobe os dois processos em paralelo, com os mesmos comandos que os
`.replit-artifact/artifact.toml` declaram em `[services.development]` e nas
mesmas portas, os dois implementados por `scripts/dev.mjs`:

| service | porta | o que faz |
| --- | --- | --- |
| `web` (freightaudit) | 25609 | Vite, encaminhando `/api` para a 8080 |
| `API Server` | 8080 | aplica migrations, reconstrói o bundle, sobe, e reconstrói a cada alteração no código |

Nada disso exige terminal: `PORT` e `BASE_PATH` vêm do `[services.env]` de cada
artifact e o `API_PROXY_TARGET` do próprio script. Um workspace novo funciona
só apertando Run.

**Uma forma só de subir, e o que a distingue é a porta.** O workflow roda os
mesmos comandos dos artifacts, em 8080 e 25609 — os endereços para onde o
roteador encaminha. O que já quebrou aqui foi um workflow em 5000/5001: uma
segunda stack, em portas para onde nada é encaminhado, e o efeito foi um 502
sobreviver a duas correções, porque pela porta paralela tudo respondia e pela
URL do app nenhuma chamada de API chegava. Fora do Replit e em CI, `pnpm dev` é
o mesmo script e as mesmas portas; dentro do Replit ele colide com o Run, o que
é o comportamento desejado — a colisão aparece na hora.

O `.replit` **precisa** do bloco `[workflows]`: os `artifact.toml` descrevem
como cada service sobe e para onde o roteador manda, mas não disparam nada
sozinhos. Sem `runButton` e sem workflow, apertar Run não inicia processo
nenhum, e a tela fica em "Your app is not running" — foi exatamente o estado em
que este projeto ficou por um dia.

**As portas não são escolha nossa.** Quem serve o app é o roteador do Replit,
que encaminha por caminho — `/` para a interface, `/api` para o api-server — e
o destino de cada um é o `localPort` declarado no `.replit-artifact/artifact.toml`
do artifact. O roteador não verifica se tem alguém escutando: se não tiver,
devolve 502 sem corpo, e só as chamadas de API falham enquanto a tela abre
normalmente. Porta é contrato, e muda em dois lugares ao mesmo tempo:
`artifact.toml` (`localPort` e `[services.env] PORT`) e `scripts/dev.mjs`. O
script recusa subir se o `PORT` que o ambiente injeta não bater com o que usa.

`node scripts/doctor.mjs [url-do-app]` responde, em uma tela, quem está em cada
porta, se há mais de um processo disputando alguma, e o que a URL do app devolve
em `/api` — que é o aceite desta configuração.

- `pnpm dev` — o mesmo, pelo terminal (útil fora do Replit e em CI)
- `pnpm run typecheck` — typecheck de todos os pacotes
- `pnpm run build` — typecheck + build de todos os pacotes
- `pnpm --filter @workspace/db run migrate` — aplica as migrations à mão
- `pnpm dev:seed` — ferramenta de desenvolvimento; **não** é o caminho do produto
- **Schema muda só por migration versionada** — `lib/db/migrations/*.sql`,
  aplicada por `runMigrations()`. `drizzle-kit push` está desligado, e a
  proposta de schema que o Publishing oferece ao publicar **se recusa**: ela
  copia estrutura sem backfill, sem as funções da identidade canônica e sem a
  fusão da `0016`. Ver `docs/MIGRATIONS.md`.
- Única env obrigatória: `DATABASE_URL`
- Opcional: `ANTHROPIC_API_KEY` liga a redação por modelo no Assistente de IA.
  Sem ela o assistente **continua respondendo**, com a redação montada em código
  sobre o mesmo material; a tela diz em qual dos dois modos está.
  `ASSISTENTE_MODELO` e `ASSISTENTE_ESFORCO` ajustam modelo e esforço.

Importar planilha é feito **pela interface**, em Importações. Nenhum passo do
produto depende de terminal. **Excluir também**: cada importação da lista tem um
botão Excluir que apaga o que ela produziu — fatos, vigências, comparações e a
evidência RAW —, mostrando antes a conta do que sai e liberando o arquivo para
ser reenviado. O registro da exclusão fica (`import_deletion`); os dados não.

O mesmo vale para o export de chamados, em Alterações › Chamados: importar e
excluir são os dois pela tela, e a exclusão leva os chamados e as alterações que
só aquele envio trouxe, com a conta à frente e o arquivo liberado para reenvio.
Ela é mais simples que a da planilha porque um envio de chamados não escreve
fato canônico nem vigência — a aba Planilha não é tocada —, e o rastro fica em
`ticket_import_deletion`, append-only como o outro.

## Acesso

**Nada do produto aparece sem login.** Toda rota da API exige sessão, com cinco
exceções que existem por motivo declarado — `/api/healthz` e `/api/build`
(o health check do deployment não pode depender de credencial) e
`/api/auth/session`, `/login` e `/logout`. A lista está em `isPublicPath`, num
lugar só: rota nova nasce protegida sem ninguém precisar lembrar de protegê-la.

**Contas nascem em Configurações, por quem já tem acesso.** A tela de login
só entra — não cadastra, e não tem link para cadastro. Em Configurações, quem
está logado cria conta para outra pessoa, desativa e reativa acesso, e redefine
a senha de quem esqueceu. É o que existe no lugar de recuperação por e-mail:
este produto não manda e-mail, e fingir que manda seria pior.

**A primeira conta de um ambiente novo é do terminal.** Com o banco vazio não há
quem crie a primeira pela tela — o "primeiro acesso" que existia foi removido de
propósito, porque deixava a porta aberta entre o deploy e o primeiro cadastro:

```
echo "a-senha" | pnpm --filter @workspace/api-server run create-user "Nome" email@empresa.com
```

**Não há papéis.** Quem entra pode tudo, inclusive dar e tirar acesso, e a tela
diz isso em vez de sugerir uma hierarquia que o servidor não tem. O que fica
registrado é *quem fez*: `app_user.created_by` e `disabled_by` guardam o e-mail
de quem deu e de quem tirou o acesso.

**Ninguém é apagado, só desativado.** O `actor` das confirmações já feitas
aponta para essas linhas; apagar uma transformaria um histórico auditável num
e-mail órfão. Desativar tira o acesso, derruba as sessões abertas na hora, e
preserva o histórico. Duas recusas protegem o desfecho pior: não dá para
desativar a própria conta, nem a última que ainda está ativa.

**Trocar de senha derruba as outras sessões.** A própria troca exige a senha
atual e mantém viva só a aba onde foi feita; a redefinição por outra pessoa
derruba todas.

**O que a sessão mudou no produto:** `actor` deixou de ser campo digitado. Quem
confirma uma semântica, quem envia uma planilha e quem promove uma vigência é
lido da sessão, e o servidor ignora o que o corpo do pedido disser. Antes disso
o histórico sustentava "alguém digitou este nome"; agora sustenta quem fez.

Não existe nesta versão: papéis ou permissões por tela, recuperação de senha por
e-mail, e exclusão de conta.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + pino, empacotado com esbuild
- DB: PostgreSQL 16 + Drizzle ORM
- UI: React + wouter + TanStack Query + shadcn/ui + Tailwind
- Testes: Vitest; verificação de navegador com Playwright

## Where things live

- `lib/db` — schema e migrations (fonte da verdade do modelo)
- `lib/ingest` — recebimento do arquivo, RAW, staging, promoção
- `lib/curation` — semântica dos atributos, taxonomia, confirmações humanas
- `lib/comparison` — motor de alterações, visão consolidada
- `lib/balance` — o balanço de massa da importação: os destinos declarados de
  cada célula (`destinos.ts`) e a conta que os confere (`balanco.ts`)
- `artifacts/api-server` — HTTP; autenticação em `src/lib/auth.ts` (as
  primitivas, sem banco), `src/lib/session.ts` (sessões e contas) e
  `src/middlewares/require-session.ts` (o portão)
- `artifacts/freightaudit` — interface; a sessão vive em `src/lib/auth.tsx`, o
  portão em `App.tsx`, e as contas em `src/pages/configuracoes.tsx`
- **Book do Operador** — o contraponto do export, que traz o cadastro
  remunerado da frota e nenhuma regra. O índice dos blocos é transcrição da tela
  do Freightech e mora em `artifacts/freightaudit/src/lib/book-operador.ts`; a
  regra de cada bloco é registrada aqui, em `book_entry`
  (`lib/db/src/schema/book.ts`, rotas em `artifacts/api-server/src/routes/book.ts`),
  de dois tipos — `TEXTO` escrito na tela ou `DOCUMENTO` anexado. Substituir
  cria a revisão seguinte; **não existe DELETE**, e os bytes ficam no Postgres
  porque aqui a entrada *é* o conteúdo e o disco da plataforma é efêmero.
- **Assistente de IA** — `lib/assistant`, rotas em
  `artifacts/api-server/src/routes/assistant.ts` (persistência isolada em
  `src/lib/conversas.ts`), tela em
  `artifacts/freightaudit/src/pages/assistente.tsx`. É a única superfície sem
  dado próprio: responde a partir do conhecimento do produto escrito em código e
  de consultas às **mesmas funções que as telas usam**, e devolve as duas coisas
  junto com o texto. Ver a seção *Assistente de IA* abaixo.
- **Balanço de Massa** — `lib/balance`, rota em
  `artifacts/api-server/src/routes/balance.ts`, tela em
  `artifacts/freightaudit/src/pages/balanco-massa.tsx`. É a única superfície que
  pergunta pelo que **não** está na tela. Ver a seção *Balanço de Massa* abaixo.
- **Cobertura de dados** — `lib/coverage`, rotas em
  `artifacts/api-server/src/routes/coverage.ts`, tela em
  `artifacts/freightaudit/src/pages/dados.tsx` com os componentes em
  `src/components/cobertura/`. É a **autoridade única** do produto sobre "o que
  já temos versus o que deveríamos ter": nenhuma rota e nenhum componente
  calcula cobertura por conta própria, e a tela recebe resumo, matriz, lacunas e
  descobertas de uma medição só. Ver a seção *Cobertura de dados* abaixo.
- **Conhecimento do Freightech** — `lib/knowledge`: o catálogo das telas de
  origem e o índice do Book, que eram da interface e agora são compartilhados,
  porque o assistente e as telas precisam da mesma verdade sobre o que o
  Freightech publica.
- **Alterações → Chamados** tem duas visões. *Resumo* é a lista por
  materialidade; *Por tipo* dobra as mesmas alterações nos componentes da
  remuneração — valor fixo, valor variável, variável diesel — e desce em
  `classe → parâmetro → assunto → as alterações`. A tabela que diz em que valor
  cada parâmetro mexe é `lib/knowledge/src/classificacao.ts`, e é lá que se
  acrescenta o que aparecer em "Não classificado" na tela. A dobra roda em
  `classificarAlteracoes` (`lib/comparison/src/chamados.ts`), servida por
  `GET /api/tickets/classification`. **As classes não somam o total**: um
  parâmetro pode mexer em dois valores (`cavaloEmpurrada` mexe no fixo e no
  variável), e a tela escreve a diferença em vez de escondê-la.
- **Alterações → Impacto** é a terceira aba e a única que **não parte da
  alteração**: uma linha por ativo, uma coluna por vigência, e a alteração
  aparecendo como a diferença entre duas colunas. `lib/comparison/src/impacto.ts`
  (`getQuinzenaMatrix`), servida por `GET /api/impacto/quinzenas`, tela em
  `artifacts/freightaudit/src/components/changes/impacto-quinzenas.tsx`. É
  também o que o menu **Auditoria → Impacto financeiro** abre: `/impacto-financeiro`
  é a mesma tela montada na aba Impacto, e por isso saiu de `TELAS_EM_PREPARO`.
  O que aquela entrada dizia faltar continua faltando — o volume realizado por
  equipamento, sem o qual a variação de um parâmetro não vira o dinheiro que ela
  *move* —, e a tela mostra o preço contratado e a variação dele, nunca o custo
  de uma operação. Existe
  porque as outras duas, por construção, não conseguem mostrar o ativo que *não*
  mudou — ele não está em lista de alteração nenhuma —, e sem ele o total da
  coluna não fecha com o que foi pago. É a tabela dinâmica que o cliente monta no
  Excel (`Soma de finameCavalo`, dobrada pela data de entrada), com três regras
  que a dele não tem: **ausência não é zero** (ativo fora da vigência tem célula
  vazia, nunca R$ 0,00), **vigência que não entregou o equipamento não é frota
  vazia**, e **entrada/saída de ativo fica fora do dinheiro** — a variação entre
  as pontas é decomposta em preço, entrada e saída, e as três somam exatamente a
  ela. O agrupamento por data de entrada arredonda o instante **para o segundo**
  antes de tomar o dia: a fonte grava `12:00:00`, `23:59:59.000` e
  `23:59:59.999` no mesmo campo, e nem truncar nem arredondar para a meia-noite
  reproduz os grupos das duas tabelas do cliente — ver `diaDoInstante`.
- `docs/ARQUITETURA.md` — as decisões estruturais em prosa
- `docs/PROPOSTA-NAVEGACAO-FREIGHTECH.md` — o mapeamento Freightech → FreightCheck

## Assistente de IA

**Cinco etapas, e nenhuma delas é feita por modelo até a última.** Interpretar a
pergunta (`interpretacao.ts` — quinze intenções, padrões ordenados do mais
específico ao mais geral), resolver o que ela nomeia (`parametros.ts`), montar o
plano, executar as ferramentas que a intenção pediu (`ferramentas.ts`) e validar
(`orquestrador.ts`). Só então alguém redige. A escolha da fonte é a decisão mais
consequente do assistente — errar aqui produz uma resposta correta sobre o
assunto errado —, e uma decisão dessas precisa ser reproduzível, testável sem
rede e explicável a quem discordar. É o que a versão anterior não tinha: ela
perguntava *"que palavras a frase contém?"* e caía sempre no resumo da vigência
mais recente, respondesse ela ou não à pergunta.

**O modelo não escolhe entre trinta ferramentas.** Ele recebe o resultado das
que a intenção pediu. Perguntar "o que é IPVA?" não dispara consulta de impacto.

**Quatro corpora, e eles não se confundem.** O conceitual (`corpus.ts`: catálogo
do Freightech, índice do Book, artigos do produto) responde *o que é*; o
dicionário de parâmetros (`parametros.ts`) traduz o vocabulário de quem opera
para as colunas que existem; o analítico (`ferramentas.ts`) consulta o banco no
recorte; e o **conteúdo do Book** (`indice-book.ts`) responde *qual é a regra*.
Uma resposta pode usar os quatro, e diz de qual veio cada parte.

**O Book é lido, indexado e procurável — não é um anexo por bloco.**
`documento.ts` abre `.docx`, `.xlsx` e `.pptx` preservando o que a extração
anterior destruía: títulos, listas e **tabelas**, que é onde as regras da
operação moram (a ressalva "a diagramação não sobreviveu" descrevia esse
defeito, e ela sumiu porque a causa sumiu). `indice-book.ts` quebra cada entrada
em trechos que guardam bloco, seção, arquivo e revisão — sem partir uma tabela
nem separar uma regra do título que a nomeia —, e busca em duas etapas: trinta
candidatos por cobertura de vocabulário, reordenados por frase exata, casamento
de título, seção, sigla e densidade, com teto de três trechos por bloco para um
documento não ocupar a resposta inteira. O índice é léxico de propósito: o
vocabulário aqui é feito de siglas e nomes próprios (QLP ADM, CIVF, PGR), que é
onde a busca vetorial erra e a lexical acerta, e o critério de seleção precisa
ser explicável a quem discordar da resposta. O que a busca semântica resolveria
— sinônimo — é resolvido por duas pontes: a expansão a partir dos títulos do
próprio índice, e o **fio da conversa** (quem perguntou "qual a frequência?"
depois de falar do QLP ADM recebe o bloco do QLP ADM, ainda que o documento
escreva "Periodicidade").

**A busca do Book roda para qualquer pergunta que nomeie assunto**, em paralelo
com o dado. É o que permite uma resposta cruzar as duas coisas — o que mudou,
quanto pesou, e o que a regra escrita diz sobre aquilo — em vez de a intenção
escolher uma fonte e a outra nem ser consultada.

**Mecânica não é resposta.** Revisão vigente, quantidade de revisões, tipo da
entrada e chave do bloco existem no dossiê, aparecem no painel técnico e
sustentam a fonte — e são marcados `interno`, o que os mantém fora da prosa e
fora do material que vai ao modelo. Uma resposta começava com "Revisão vigente:
1 — 1 revisão guardada"; nenhuma instrução de estilo segura de forma confiável
um dado que está no contexto, então ele não é mandado.

**Da palavra à gaveta, numa escada que se lê.** Código exato → alias da origem →
rótulo da tela → nome da gaveta → busca textual → pergunta de volta. Não há
embedding, e é decisão medida: a bateria da Fase 7 confronta a escada com as
perguntas reais, e o passo seguinte só se justifica quando ela não bastar. O que
se resolve é a **gaveta**, não a coluna — "combustível" não é ambíguo entre sete
colunas, é uma gaveta com sete colunas. Ambiguidade de verdade é o termo casar
gavetas diferentes, e aí o assistente pergunta.

**Quatro formas de não saber, e elas não se confundem.** `NAO_ENCONTREI` não é
`NAO_EXISTE_NO_PRODUTO`, que não é `CONCEITO_SEM_DADO` (o Freightech publica o
conceito e o export não traz a coluna), que não é `DADO_SEM_PRECO` (há dado e a
semântica não confirmada impede somar). A `Lacuna` carrega qual das quatro é, e
a resposta é obrigada a dizê-la.

**A pergunta nomeou algo que não existe aqui? Então nenhum número.** Sem alvo
resolvido, os caminhos que consultam o agregado do recorte ficam desligados.
"Quanto mudou o pedágio?" respondia com o movimento de *tudo* — R$ 28 mil que
não têm nada a ver com pedágio, apresentados como se fossem a resposta. Um
número certo sobre o assunto errado é pior que nenhum número, porque parece uma
resposta.

**Conversa é privada de quem a criou, e excluir é arquivar.** `owner_id` filtra
toda leitura e toda escrita, num lugar só (`lib/conversas.ts`): uma rota que
esqueça o dono não compila. `archived_at` recebe a data e a conversa some da
lista; nenhuma linha é apagada, nem a conversa nem as mensagens. A coluna é
`owner_id` e não `user_id` porque o compartilhamento entre pessoas não existe
hoje e não foi fechado fora.

**O motor descobre o que é verdade; o modelo decide como explicar.** A redação
determinística existe para quando não há chave e para quando a trava descarta o
texto do modelo — mas ela deixou de ser o teto de qualidade do produto. Ela abre
pelo conteúdo (o trecho do Book que responde, transcrito com a citação ao lado),
nunca pela ficha do bloco, e não repete o parágrafo com que abriu.

**A numeração das citações mora numa função só** (`itensCitaveis`). Ela estava
reimplementada em três arquivos — quem lista as fontes, quem escreve o dossiê
para o modelo e quem confere as citações —, cada um com um comentário avisando
que mexer num sem mexer nos outros faria a resposta citar um documento e a trava
conferir outra coisa, "sem dar erro em lugar nenhum".

**A continuação herda, e a herança aparece.** "E julho?" mantém o assunto e
troca o período; "Por quê?" refaz a consulta em vez de reexibir número guardado;
"E o pneu?" troca o assunto e mantém a pergunta. O que foi herdado vai no painel
técnico — herdar em silêncio é como a versão anterior respondia sobre outro
período sem que nada na tela denunciasse.

**As etapas que a tela mostra são as que rodaram.** `POST /api/assistant/ask`
responde em `text/event-stream` quando a tela pede: cada etapa sai no instante
em que começa, e o último evento é o mesmo JSON de sempre. A versão anterior
animava uma lista fixa por tempo — anunciava "calculando impacto" em pergunta
conceitual que nunca calcula impacto. Num produto cuja regra é não exibir o que
não se pode sustentar, inventar o próprio progresso é a última coisa a fazer.

**Cada frase diz de onde veio.** As fontes são numeradas na ordem em que entram
no dossiê — trechos primeiro, evidências depois — e o texto marca `[n]` no fim
da frase que se apoia nelas; clicar abre a lista naquela fonte. A numeração é
validada como número: `citacoesSemFonte` derruba a resposta inteira quando ela
cita `[4]` com três fontes, porque uma citação que manda conferir num lugar que
não existe é pior que citação nenhuma.

**A bateria roda contra o banco real.** `lib/assistant/src/__tests__/bateria.ts`
é a lista de perguntas, consumida por dois: a suíte, que a roda como asserção, e
`tabela.mts`, que a roda como relatório. Cada caso quantitativo executa
**também** o serviço que a tela usa e compara os números. Sem `DATABASE_URL` a
bateria não roda — inventar um banco vazio para ela passar seria o mesmo que
apagá-la.

**Recuperar primeiro, escrever depois.** O material é fechado antes de existir
uma frase — os artigos aprovados neste repositório e as consultas que o banco
respondeu, no recorte de quem perguntou — e só então alguém redige sobre ele: o
modelo, quando há chave configurada; o código, quando não há. Os dois escrevem
do mesmo dossiê, e o dossiê vai junto para a tela. A inversão dessa ordem —
gerar a frase e depois procurar com que sustentá-la — é o defeito clássico do
gênero e produz exatamente o que este produto existe para não exibir.

**O conhecimento mora em código, não num índice vetorial.** Mesma razão de
`labels.ts` e `families.ts`: é decisão de produto, precisa existir com o banco
vazio, passa por revisão quando muda, e é conferível linha a linha por quem
discordar de uma resposta. Nenhum artigo contém número — números vêm do banco, e
envelheceriam ali dentro sendo ditos com a mesma segurança.

**Nenhum número sem lastro, mecanicamente.** Depois de o modelo escrever,
`numerosSemLastro` confere cada token numérico do texto contra o que as
evidências autorizam citar. Sobrando algum, a resposta do modelo é **descartada
inteira** e sai a redação em código. Não é desconfiança do modelo: numa
aplicação de auditoria a diferença entre um número consultado e um número
plausível não pode depender de ninguém reler.

**Toda resposta diz quem a escreveu.** `redacao` é `IA` ou `DETERMINISTICA`, e a
tela mostra isso ao lado do texto. Quando a API de linguagem falha ou recusa, a
resposta sai pela redação em código e o selo muda — o produto não fica sem
responder uma pergunta que sabe responder.

**Não achar é um desfecho.** Abaixo do limiar de relevância a resposta é dizer
que não sabe, com o que perguntar em vez disso. Um assistente que sempre
responde soa igual quando sabe e quando não sabe.

**O denominador do Book não é contado no servidor.** O índice dos blocos é
transcrição da tela do Freightech e vive na interface; o assistente conhece o
que foi registrado em `book_entry` e diz isso, em vez de manter uma segunda
cópia do índice que sairia de sincronia no primeiro rename.

## Balanço de Massa

**A pergunta inversa da rastreabilidade.** Todas as outras telas respondem *de
onde veio este número*, e a resposta vai até a célula da planilha. Esta responde
*toda célula da planilha chegou a algum lugar?* — e é a única que pega o defeito
que não se vê. Número inventado aparece: está na tela, errado, e alguém confere.
Dado que sumiu não aparece em lugar nenhum. Uma coluna que a Freightec renomeou
e o leitor deixou de reconhecer não produz erro nenhum: produz um total menor,
com todas as parcelas exibidas conferindo perfeitamente entre si. **Ninguém
audita o que não é exibido**, e era esse o buraco.

**Três etapas, e cada uma fecha por conta própria.** Do arquivo ao preparo,
célula a célula; do preparo à vigência, fato a fato; e o portão da semântica, que
diz quanto do que entrou já pode ser somado. A terceira costuma ser a que
surpreende: a massa chega inteira ao canônico e ainda assim quase nada dela entra
numa conta, porque só o atributo com semântica confirmada é somável.

**Descarte, perda e resíduo não se confundem.** `DESCARTE` é saída sem perder
informação — linha em branco, aba de pivô que refaz conta sobre dados que já
entraram por outra aba. `PERDA` é o arquivo trazer e o sistema recusar, com
motivo e com o endereço da célula. `RESIDUO` é célula que sumiu sem destino, e é
a única das três que significa defeito. Somar as duas primeiras num "não
aproveitado" esconderia exatamente o número que alguém precisa ver — por isso
**uma importação fecha tendo perdas**, e o alarme fica reservado para o resíduo.

**Os destinos moram em código** (`lib/balance/src/destinos.ts`), pelo mesmo
motivo de `labels.ts` e `families.ts`. Uma célula que não se encaixa em nenhum
deles cai em `SEM_DESTINO` em vez de sumir da conta, e a consulta e a lista são
obrigadas a concordar: um ramo novo na classificação sem entrada na lista faz a
leitura falhar, em vez de exibir um total menor sem sinal nenhum.

**Nada aqui recalcula o pipeline.** A classificação é feita sobre o que ficou
gravado — abas, linhas, células, mapeamentos de coluna, recusas e fatos. Uma
segunda implementação das regras de leitura concordaria com a primeira inclusive
quando as duas estivessem erradas, que é o único caso em que este módulo teria
serventia.

**O export real do cliente não exercita as saídas de perda**, porque ele é
limpo: toda célula dele vira fato, cabeçalho ou grão. Então elas têm bateria
própria, sobre uma planilha construída com os defeitos dentro
(`src/__tests__/perdas.test.ts`) — linha sem placa, rótulo de vigência ilegível,
coluna sem cabeçalho, duas colunas colidindo no mesmo código e uma aba de pivô —,
com a contagem exigida célula a célula. Uma saída que só contasse pela primeira
vez em produção seria um número que ninguém teria como conferir.

## Cobertura de dados

**Arquivo não é a unidade de cobertura; dado é.** Importações responde *o que
entrou* — arquivos, linhas, estados. Esta responde *com tudo que já importamos,
quanto do universo de dados necessário nós realmente possuímos?*. A diferença
tem consequência: três arquivos que se completam — 100 entidades com A/B/C, as
mesmas 100 com D/E/F, mais 44 com tudo — não são três coberturas de 40%, 35% e
20%; são **144 entidades e 6 atributos**. A consolidação já acontecia no
`promote`, que funde entrega parcial na vigência canônica que existe e marca o
que veio herdado; a cobertura só a lê.

**Esperado, observado, lacuna — e a linha entre declaração e inferência.** O
esperado tem quatro origens, e duas delas nunca viram linha no banco:

| Origem | O que é | Onde vive |
|---|---|---|
| `CONTRATO` | o plano da DRE: `fontes` + `essencial`, com a evidência medida | `coverage_expectation` |
| `CURADORIA` | uma pessoa confirmou, dispensou ou aceitou uma renomeação | `coverage_expectation` |
| `HISTORICO` | a coluna veio e trouxe valor nas vigências anteriores | recalculado na leitura |
| `ESTRUTURA` | veio para ≥90% das entidades desta mesma vigência | recalculado na leitura |

As duas últimas chegam à tela dizendo *é inferência, não contrato*. Gravá-las as
tornaria, em uma migration ou duas, indistinguíveis de contrato — e é assim que
uma estatística vira verdade sem que ninguém tenha decidido. Promovê-las é um
clique com nome e motivo, que escreve em `coverage_expectation` **e** em
`curation_event`.

**Cobertura crítica não é uma segunda lista.** Um atributo é crítico se, e
somente se, alimenta um componente `essencial` do plano da DRE. É a mesma
declaração que faz a DRE se recusar a fechar subtotal, então mudar uma muda a
outra no mesmo commit — e não há uma cópia da regra espalhada pela aplicação
para divergir da original.

**Quatro estados que o resto do mundo confunde.** Ausência, nulo, zero e não
aplicável: `fact.is_null = false` com valor zero é um zero econômico;
`is_null = true` com `null_reason` é coluna entregue e vazia; sem linha em
`snapshot_attribute` é coluna que não veio; `NOT_APPLICABLE` sai dos **dois**
lados da fração, porque tirá-lo só de um faria uma dispensa legítima mexer no
percentual.

**Uma medição achou coisa no dado real.** Cinco colunas de carreta —
`operador_tms`, `organizacao_de_compras`, `prazo_pagamento`,
`unidade_promax_unb`, `unidade_tms` — continuam vindo no layout de Fev/26 em
diante e chegam vazias para todas as carretas. Coluna entregue e valor presente
passaram a ser duas contagens por causa disso: um histórico que contasse só o
layout diria "presente nas 4 vigências anteriores" a respeito de colunas que não
trazem número há três meses.

**Escala.** Resumo e matriz saem de `snapshot_entity_type` (uma linha por
vigência e equipamento) e `snapshot_attribute` (uma por vigência e coluna) — as
duas escritas na promoção, as duas pequenas. **Nenhuma das duas é `fact`**: a
única descida ao fato na matriz é a contagem de `NOT_APPLICABLE`, por índice
parcial. `fact` só é lida no drill-down até a placa, por
`(snapshot_id, attribute_id)`. Medido sobre o export real promovido (124.632
fatos): a visão inteira das nove vigências leva **58 ms**.

**Renomeação não é remapeamento.** `ipvaLicenciamentoMensal` aparecendo quando
`ipvaLicenciamento` some produz um *candidato* com confiança e os motivos que a
formaram, um a um — e nada mais. Semelhança de nome é portão, não peso: sem ela,
entidade + família + tipo + coincidência de calendário somavam exatamente o
limiar, e dois campos sem relação nenhuma que trocassem de lugar no mesmo mês
seriam propostos um como o outro. A decisão é da Curadoria; o campo antigo
continua contando como lacuna até alguém decidir.

## Architecture decisions

- Camadas separadas: RAW é imutável (garantido por trigger), STAGING é
  descartável, CANONICAL é o grão `(snapshot, entidade, atributo) → valor`, e
  COMPARISON é derivado — pode ser recalculado a qualquer momento.
- **A imutabilidade tem uma porta, e ela abre por dentro.** Excluir uma
  importação é a única operação que apaga RAW e vigência fechada, e as triggers
  da `0001` só a aceitam quando a transação declara
  `freightcheck.purge_import_run` (local à transação, morre no COMMIT — ver
  `0010_import_deletion.sql`). UPDATE em RAW e edição de snapshot fechado
  continuam proibidos em qualquer circunstância: o que passou a existir foi
  desfazer uma importação inteira, não corrigir um número no lugar. Sai o que só
  aquela importação sustentava; o que outra vigência também sustenta fica. Uma
  correção não pode ser apagada antes do que ela corrigiu — a mais recente sai
  primeiro, e apagá-la devolve a revisão anterior a CLOSED. O rastro fica em
  `import_deletion`, que é append-only sem exceção.
- Identidade da entidade é um UUID interno; a placa é um identificador com
  histórico, não a chave. Comparação nunca é por posição de linha.
- Semântica é versionada (`attribute_semantics`) com vigência por data.
  `attribute` guarda a versão corrente como projeção.
- Mudança na fonte cria versão nova; correção da nossa interpretação reescreve a
  versão existente. São ações distintas e nunca compartilham botão.
- Impacto financeiro é acumulado **por periodicidade**. Nunca existe um total
  único somando R$/mês com R$/ano.
- Carreta e Cavalo são séries independentes. O consolidado é projeção da API e
  da interface, não uma entidade de snapshot.
- **Toda leitura acontece dentro de um contexto: `(unidade, canal)`.** Uma
  vigência não é uma data, é uma data *de alguém*. Chavear por data só — que era
  o que `listPeriods` e a visão agrupada faziam — somaria duas unidades que
  entregam no mesmo dia num total que nenhuma das duas reconhece. O contexto é
  resolvido em `lib/comparison/src/series.ts`, e a resposta **sempre diz qual
  contexto ela está descrevendo** e quais outros existem: escolher por padrão
  não pode ser escolher em silêncio.
- **Família operacional e classe de custo são eixos diferentes, e os dois
  valem.** A taxonomia (`taxonomy_node`) responde "custo fixo ou variável?" e
  alimenta o impacto; as famílias do Freightech (Frota, Dimensões, Parâmetros
  Gerais) respondem "de que assunto isto trata?" e servem para reconhecer.
  O segundo eixo vive em `lib/comparison/src/families.ts` — em código, pelo
  mesmo motivo que `labels.ts` — e **não** toca em `attribute.taxonomy_node_id`:
  reclassificar mudaria a classe de custo das comparações futuras e as faria
  divergir do `taxonomy_path` já gravado nas antigas.
- **A soma das famílias fecha com o total da vigência**, dentro de cada
  periodicidade. O índice de composição é montado sobre a vigência inteira e
  passado para cada fatia — um titular e a sua parcela podem estar em famílias
  diferentes (`custo_fixo` e `lucro_fixomodelo_novo_ciclo` estão), e uma fatia
  que montasse o próprio índice traria a dupla contagem de volta.
- **O canal é o prefixo do rótulo da vigência** (`EMPURRADA_1_8_2026`,
  `ROTA_1_8_2026`), derivado e não persistido: `snapshot` é congelado por
  trigger quando fecha, então uma coluna nova não seria preenchível nas
  vigências já importadas. A derivação existe em TypeScript
  (`lib/ingest/src/vigencia.ts`) e em SQL (`series.ts`), e um teste roda as duas
  sobre os mesmos rótulos para que não divirjam. Vigências de canais diferentes
  não se comparam, e a recusa é escrita.

## Product

Importar os exports do Freightec, conferir antes de promover, e então responder:
o que mudou, entre quais vigências, em qual célula da planilha, quanto vale, e
quando a comparação não é confiável — dizendo por quê em vez de inventar um
número.

## User preferences

- Nada de mudança silenciosa por efeito colateral de heurística: toda
  reclassificação precisa ser listada com antes, depois e motivo.
- Não presumir semântica sem evidência suficiente. `UNKNOWN` é uma resposta
  aceitável; certeza fabricada não é.
- O caminho oficial é a interface. `bootstrap` e `dev:seed` são ferramentas de
  desenvolvimento e não devem ser apresentados como o fluxo do produto.

## Gotchas

- **502 em toda chamada de API, com a tela abrindo normalmente, é sempre a
  mesma coisa: não há ninguém na porta para onde o roteador encaminha `/api`.**
  O 502 vem do roteador, não do servidor — nada da sua requisição chegou a
  código nosso. Não adianta mexer em como o navegador envia (já se tentou
  binário, JSON, upload em segundo plano): confira antes se a 8080 está viva.
  Foi assim que o api-server passou de scaffold: o `artifact.toml` dele nunca
  teve `[services.env] PORT`, `src/index.ts` exige `PORT` e morria na primeira
  linha, e a 8080 nunca teve ninguém.
- **Se a API não puder subir, quem ocupa a porta é um explicador.** Migrations
  que falham, build que quebra sem processo anterior, servidor que morre
  sozinho: em todos, `scripts/dev.mjs` deixa na porta um servidor que responde
  503 com o motivo em JSON, e a interface mostra esse motivo. Porta vazia é o
  estado a ser evitado — 502 sem corpo não diz nem de que camada veio. Os
  testes em `scripts/__tests__` existem para que os três caminhos não voltem a
  terminar em silêncio.
- **Nunca subir o api-server com `node dist/index.mjs` direto.** Isso serve o
  bundle que estiver em disco, que pode ser de antes da sua alteração — um
  frontend novo conversando com um servidor velho responde 404 numa rota que
  você acabou de escrever. `scripts/dev.mjs` sempre reconstrói primeiro, e é
  ele que os artifacts rodam em desenvolvimento.
- `curl -s localhost:8080/api/healthz` responde pelo api-server;
  `curl -s localhost:25609/api/healthz` confirma o caminho inteiro pela
  interface. Um proxy do Vite sem servidor atrás responde **500**, não 502 — a
  diferença entre os dois números diz em qual camada procurar.
- Dependências entre pacotes do workspace mudam sem que o `package.json` da raiz
  mude, e o que falta depois de um `git pull` não é código: são os symlinks de
  `@workspace/*` dentro de `node_modules`, que só o install cria. Sem eles o
  build para com `Could not resolve "@workspace/..."`, apontando para o `import`
  em vez da causa — foi assim que o Assistente de IA chegou quebrado num
  workspace onde o código estava inteiro. **O Run não depende mais de ninguém
  lembrar disso**: `scripts/dev.mjs` roda `pnpm install --frozen-lockfile` antes
  de construir, e se ele falhar quem ocupa a porta diz que foi o install. O hook
  em `scripts/post-merge.sh` continua fazendo o mesmo e aplicando as migrations.
- `TEST_ADMIN_DATABASE_URL` precisa ter query string (`…/postgres?sslmode=disable`).
  `lib/ingest/src/testing.ts` deriva o banco de cada teste substituindo
  `"/postgres?"`; sem o `?` todos os testes caem no mesmo banco e falham com
  `SKIPPED_DUPLICATE`.
- `pnpm run typecheck` passa limpo, e passa a valer como porta: erro que aparecer
  ali é de agora, não herança. Eram 9 pontos vindos do scaffold, zerados em três
  etapas. Três apontavam para o `cn` de `src/lib/utils.ts`, que descartava o
  objeto `{ classe: condição }` que todo componente do shadcn passa — o efeito
  visível era **todo botão do produto sem cor, sem altura e sem padding**, em
  todas as telas; `cn` agora é `twMerge(clsx(...))`, que é o contrato que esses
  componentes já assumiam. Quatro estavam em `alert-dialog`, `calendar`,
  `command` e `pagination`, que o scaffold trouxe importando um `buttonVariants`
  e um `DialogContent` que o `button.tsx` e o `dialog.tsx` deste projeto — dois
  componentes escritos à mão, sem `cva` e sem Radix — nunca exportaram. Nenhuma
  tela os importava: foram removidos, porque componente que não compila e ninguém
  usa só ensina a ignorar o typecheck. Os dois últimos estavam em
  `src/pages/snapshots/[id].tsx` (ver o comentário lá, sobre o `queryKey`).
- **`pnpm run build` precisa de `PORT` e `BASE_PATH`.** Não é o typecheck: o
  `vite.config.ts` do `mockup-sandbox` exige as duas e para o build da raiz sem
  elas. No Replit cada artifact injeta as suas pelo `[services.env]`; pelo
  terminal, `PORT=8081 BASE_PATH=/__mockup pnpm run build`. Os dois artifacts do
  produto (`api-server` e `freightaudit`) constroem sem nada disso.
- **401 em toda chamada de API é sessão, não infraestrutura.** A interface leva
  para a tela de login por conta própria; se isso acontecer no meio de um
  trabalho, a sessão expirou (sete dias, absolutos) ou alguém saiu em outra aba.
  É diferente do 502 e do 503: o 503 de `SESSION_CHECK_FAILED` quer dizer que o
  banco não respondeu para *verificar* a sessão, e aí o problema não é a senha
  de ninguém.
- **O assistente sem `ANTHROPIC_API_KEY` não está quebrado.** Ele responde do
  mesmo conhecimento e das mesmas consultas; o que muda é quem redige, e a tela
  diz qual dos dois foi. Um relato de "o assistente não usa IA" quase sempre é a
  chave ausente, não um defeito — confira `GET /api/assistant/capabilities`.
- **E quando `capabilities` diz `ia: true` e a resposta saiu em código, a
  pergunta é outra: o que aconteceu com a chamada?** São três desfechos
  diferentes com a mesma aparência na tela — o modelo escreveu e a trava de
  lastro descartou (número sem evidência ou citação sem fonte), o modelo recusou,
  ou a chamada falhou. `GET /api/assistant/usage` devolve o resumo das últimas
  chamadas (quantas, quanto custaram, quantas descartadas, quantas com erro) e o
  painel técnico de cada resposta diz qual dos cinco desfechos foi o dela.
  Descarte subindo é sinal de dossiê chegando pobre ao modelo, não de modelo
  pior. O anel vive em memória e zera no restart, de propósito: ele responde
  "como está agora".
- O limite do `express.json` fica em `app.ts`, não na rota de upload — o parser
  global roda antes e rejeitaria o corpo com 413 antes da rota ver.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
