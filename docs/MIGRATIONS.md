# Migrations: uma autoridade só

O schema do FreightCheck muda por **migration versionada** em
`lib/db/migrations/*.sql`, aplicada por `runMigrations()`
(`lib/db/src/migrate.ts`), uma transação por migration. Não há segunda via.

Onde isso roda:

| momento | quem aplica |
| --- | --- |
| partida do servidor **em Production** | `artifacts/api-server/src/index.ts` chama `runMigrations()` em segundo plano; o estado sai em `/api/readyz` |
| partida do servidor **em Development** | o mesmo caminho — ver a política abaixo e por que ela mudou de sinal |
| post-merge do Replit | `scripts/post-merge.sh` instala **e aplica a fila** quando há `DATABASE_URL` |
| à mão | `pnpm --filter @workspace/db run migrate` |
| testes | cada banco de teste nasce das migrations, nunca de push |

## A reconvergência da partida — quando o Provision desfaz o que a fila fez

O passo de schema do Publishing compara **Development com Production** e aplica
o diff antes de o servidor novo existir. Enquanto Development ficava atrás da
fila por política — a política antiga, revertida abaixo —, todo deploy nessa
janela propunha **remover** de Production o que as migrations criaram —
colunas, tabelas, índices e constraints —, e o registro não ficava sabendo: ele
vive no schema `drizzle`, fora do espelho. O resultado era o estado sem saída
de 18/08/2026: 35 migrations registradas, `attribute.cost_class` inexistente,
telas caindo com 42703 e a fila sem nada a fazer, porque ela decide pelo
carimbo. Hoje Development converge sozinho e esse estado não persiste; a
reconvergência continua existindo como rede para o dia em que alguém aceitar a
proposta errada mesmo assim.

Por isso a partida de Production tem um segundo passo, depois de
`runMigrations()`: a **reconvergência** (`lib/db/src/reconvergencia.ts`). Ela
compara o schema real com o que o build declara e repõe o que falta com DDL
levantado **verbatim das migrations** — nunca sintetizado. Num deploy limpo ela
não aplica nada; depois de um Provision destrutivo, devolve o schema ao estado
que `estruturaDe` medi(r)ia num banco criado do zero pela fila — provado em
`artifacts/api-server/src/__tests__/deploy-normal-reconverge.test.ts`.

O que ela **não** faz: não roda com migrations pendentes (a fila resolve), não
roda com bridge pendente (o `bridge:up` resolve), e não ressuscita **conteúdo**
de coluna que o Provision destruiu — estrutura é recuperável pela fila, decisão
humana apagada não é recuperável por ninguém. `publicar:conferir` antes de todo
Publish continua sendo o que impede a perda, e o boot loga alto quando teve de
repor qualquer coisa.

A mesma reconvergência existe pela mão de quem opera:

```
pnpm --filter @workspace/db run conferir-schema             # lê e nomeia o que falta
pnpm --filter @workspace/db run conferir-schema -- --aplicar  # repõe pela fila
```

É o caminho para a tela de SCHEMA_DIVERGENTE num ambiente onde a partida não
reconverge — Development, ou um Production que ainda roda um build sem o passo.
As recusas são as mesmas da partida (`reconvergirSeCabivel`, em
`lib/db/src/reconvergencia.ts`): pendência é da fila, bridge é do `bridge:up`,
e as duas portas não têm como discordar, porque são a mesma função.

### Quando a ausência trava a própria fila — 21/08/2026

A recusa de cima ("não roda com migrations pendentes") está certa quase sempre:
com pendência, a ausência de um objeto costuma significar que a fila ainda não
chegou nele. Ela é falsa num caso, e o caso aconteceu — **a pendência é causada
pela ausência de objeto de migration já registrada**.

Production tinha 49 migrations registradas e não tinha `remuneracao_unidade`, a
tabela que a `0048` cria. A `0049` morre no terceiro comando dela:

```sql
ALTER TABLE "remuneracao_unidade" ADD COLUMN IF NOT EXISTS "unidade_id" uuid;
```

`IF NOT EXISTS`, ali, guarda a **coluna** — nunca a tabela. Sobre tabela que não
existe é `42P01`, e a migration inteira volta pelo `ROLLBACK`, o que faz cada
partida repetir idêntico. A fila não repunha a tabela (decide por carimbo, e o
carimbo da `0048` estava lá); a reconvergência não rodava (havia pendência). As
duas autoridades certas, e ninguém agindo.

**O tell, para quem opera:** `Parou em NNNN (SQLSTATE 42P01)` nomeando relação
de uma migration *anterior* não é defeito da migration que falhou. É remoção por
fora da fila, e a migration que parou só teve o azar de ser a primeira a tocar
no buraco.

A saída **não** foi reescrever a `0049` nem acrescentar uma migration de reparo:

- reescrever migration aplicada deixaria Development com um texto e Production
  com outro, pelo motivo que já preservou a `0015`;
- migration de reparo depois da `0049` nunca rodaria — a fila não tenta o que
  vem depois da que falhou, e o relatório daquele dia dizia exatamente isso
  ("Não foram tentadas: 0050").

A saída foi dar à fila como destravar o próprio chão: `migrarComReparo`
(`lib/db/src/fila.ts`), que é o que a partida e o `pnpm ... run migrate` chamam.
Ela roda a fila; se a fila parar, chama `reconvergirRegistradas` — a
reconvergência **limitada ao que as migrations registradas criam**, com o DDL
levantado delas mesmas — e tenta uma segunda vez, uma só. O que apenas as
pendentes sabem criar continua sendo trabalho da fila, e some do relatório em
vez de virar `semComando`: ali a ausência é legítima.

É reativo de propósito. Num banco íntegro a primeira passada não falha e nada
disto roda. E o que volta é estrutura: as linhas que a tabela derrubada
guardava não voltam por aqui — por isso o boot alerta (`RECONVERGENCIA_REPOS`) e
a CLI manda conferir o backup antes de dar o banco por bom.

Preso por `lib/db/src/__tests__/fila-com-reparo.test.ts`, que monta o banco
daquele dia rodando a fila real até a `0048` numa pasta truncada — e não por DDL
que imite o resultado.

### Quando a fila está atrás e a tela diz "o servidor falhou" — 22/08/2026

A janela entre o código e a fila é estrutural neste deploy: o servidor abre a
porta e **depois** aplica as migrations, em segundo plano. Enquanto ela dura, a
tela nova conversa com o banco velho. Para objeto ausente isso já estava
resolvido — `faltaSchema` classifica `42P01`, `42703`, `42704`, `42883` e o
`42P10` do `ON CONFLICT`, e a rota responde 503 com o diagnóstico do
`/healthz`.

Faltava a forma em que **o objeto está lá e é de antes**. A tela do fechamento
passou a oferecer as duas casinhas do 03.08.18 — a `0055` separou
`DISPONIBILIDADE_FF` de `DISPONIBILIDADE_VAN` —, o arquivo subiu inteiro, e o
`check` de `fechamento_documento.tipo` naquele banco ainda era a lista sem os
dois nomes. A coluna existe, a tabela existe: nenhum SQLSTATE de schema
aparece. Sai `23514`, que não é classificado, e o corpo é o 500 genérico:

> O servidor falhou ao processar este pedido. Nada foi gravado por esta chamada.

Quem recebeu isso tem um arquivo perfeito na mão e nenhuma pista de que o que
falta é uma migration.

**O que decide não é o SQLSTATE — é a fila.** `23514` é, quase sempre, o
oposto: um valor que a regra do domínio recusa de verdade, e tratá-lo como
banco atrasado mandaria alguém rodar migrations por causa de um dado errado.
`regraDeMigrationPendente` (`artifacts/api-server/src/lib/schema-ausente.ts`)
pergunta se a constraint que recusou está entre as que uma migration
**pendente neste banco** reescreve — `constraintsTocadasPor`, em
`lib/db/src/reconvergencia.ts`, lendo o SQL da própria fila. Estando, a regra
aplicada ali é comprovadamente uma versão anterior da que o build escreve, e o
desfecho é o de sempre: 503, `MIGRATIONS_PENDENTES`, `pnpm --filter
@workspace/db run migrate`. Não estando, nada muda. É a mesma disciplina do
`42P10`: SQLSTATE ambíguo só vira schema ausente com a evidência que desfaz a
ambiguidade.

**O tell, para quem opera:** um envio que a tela recusa com "o servidor falhou"
enquanto outro, da mesma tela, entra normalmente. O que separa os dois é a fila
— o `/api/readyz` diz quantas migrations faltam, e aplicá-las é o conserto.

Preso por `artifacts/api-server/src/routes/__tests__/fechamento-fila-atrasada.test.ts`,
que monta o banco daquele dia — a fila real, com registro, parada na `0054` — e
manda o 03.08.18 pela rota de verdade.

Isso é a **segunda** linha, e ela existe para o banco atrasado que não é o deste
processo — drift, ou uma instância que já convergiu falando com um banco trocado
por fora. A janela da própria partida foi fechada na raiz, abaixo.

## A porta aberta não é tráfego aceito — o portão de prontidão

`app.listen()` acontece **antes** da fila, e tem de acontecer: a conexão de
produção (SSL, timeout) bloqueava o bind por até 60 s, o startup probe do
autoscale desistia e a publicação falhava mesmo com o código perfeito. Foi por
isso que `runMigrations()` foi para segundo plano, no callback do `listen`.

O que ficou sem resposta por um ano foi o intervalo entre os dois. Nele o
roteador já encaminha `/api/*` para um processo cujo banco pode estar em
qualquer estado anterior — e é uma janela que **toda** migration de contrato
reabre. A `0055` não a criou; foi só a primeira a cair dentro dela.

### As duas arquiteturas possíveis, e por que esta

| | migrations antes do `listen` | subir e recusar até convergir |
| --- | --- | --- |
| fecha a janela | sim | sim |
| startup probe | falha por timeout; a publicação não sobe | passa: a porta abre na hora |
| migration que falha | deployment não sobe, versão anterior servindo, nada diz por quê — e o reinício bate na mesma parede | processo de pé, `ready:false`, alerta, e o diagnóstico legível de fora |
| diagnosticável de fora | não: não há processo para perguntar | sim, é a razão de `/readyz` existir |

A primeira já foi tentada neste repositório e produziu o modo de falha pior.
Vale a segunda — e com uma consequência que decide o desenho: **o roteador do
Replit não tem readiness probe.** O `artifact.toml` declara um probe só, o de
startup, e ele precisa de um endpoint que responda 200 mesmo com o banco fora.
Não há como pedir à plataforma que segure o tráfego. Quem recusa tem de ser o
processo.

### O que foi feito

1. **`lib/prontidao.ts`** — pronto ⇔ o banco **não** está em
   `MIGRATIONS_PENDENTES`, `MIGRATION_FALHOU` nem `REGISTRO_PERDIDO`. Os três
   têm a mesma forma: a fila deste build não está aplicada aqui, e não há como
   saber que versão de contrato o banco aplica. `SCHEMA_DIVERGENTE`,
   `BRIDGE_PENDENTE` e `INDISPONIVEL` **não** fecham o portão — os dois
   primeiros são circunscritos e têm a resposta proporcional da segunda linha;
   o terceiro trocaria o erro de conexão real por um que esconde a causa.
2. **`middlewares/portao-de-prontidao.ts`** — montado em `/api` **antes** de
   `requireSession`, porque a sessão também é lida do banco. Responde 503 com
   `Retry-After` e o diagnóstico. Atravessam o portão fechado só `/healthz`
   (o startup probe), `/readyz`, `/build` e `/` (o deployer sonda as duas).
3. **`/api/readyz`** — a prontidão como código HTTP, para quem consulta por
   probe. E o estado do banco saiu do `/api/healthz` — que virou liveness puro,
   porque enquanto carregava diagnóstico ele era o endereço que a tela
   mandava a pessoa abrir — e mora no `/api/readyz`, para que 200 no
   liveness não volte a poder ser
   lido como "pronto".
4. **A partida grita** — terminada a tentativa, `anunciarProntidao()` mede e,
   se o portão estiver fechado, loga em `error` e alerta `SERVICO_NAO_PRONTO`.

**A prontidão é medida, nunca declarada.** A partida não guarda "convergi": ela
seria uma segunda versão da verdade, e as duas discordariam no minuto em que
outra instância — ou uma pessoa, por `pnpm ... run migrate` — aplicasse a fila.
Medindo pelo mesmo `diagnosticar(observarBanco())` do `/healthz`, o portão abre
sozinho assim que o banco converge, sem reiniciar nada. Uma vez aberto não se
pergunta mais: o caminho quente não paga nada, e o que acontecer depois é drift,
que é da segunda linha.

**Mais de uma instância subindo não disputa nada.** A fila já serializa em
`pg_advisory_lock` (`runMigrations`); o portão só **lê**, e por isso não
acrescenta escrita nenhuma à partida. Provado em
`lib/db/src/__tests__/fila-concorrente.test.ts`: quatro chamadas concorrentes
sobre um banco na `0054`, ninguém falha, a `0055` entra uma vez e o carimbo não
duplica.

A prova de que a janela sumiu está em
`artifacts/api-server/src/__tests__/janela-da-partida.test.ts`, com o **app de
verdade** sobre um banco parado na `0054`: o produto responde 503 (mesmo com
sessão válida), o banco continua literalmente vazio depois das tentativas, o
`/healthz` responde 200 (liveness), `/readyz` responde 503 com o diagnóstico, e — aplicada a `0055`, sem reiniciar
— o serviço fica pronto e o 03.08.18 sobe e grava.

## Quem avança a fila só por ter subido

A regra é uma: **os dois ambientes com banco próprio convergem pela fila ao
iniciar — Production e Development.** Testes e ambientes desconhecidos não.

| ambiente | migra na partida | como avança |
| --- | --- | --- |
| Development (`pnpm dev`) | **sim** | o próprio servidor, na partida; o `post-merge` também aplica no merge |
| Testes e CI | não | cada arquivo cria um banco descartável a partir das migrations |
| Preview / qualquer serviço novo | não — é o padrão | `DB_MIGRATE_ON_BOOT=1`, se for mesmo para migrar |
| Production / Publish | **sim** | o próprio servidor, na partida |

**Por que Development voltou a convergir sozinho — a reversão é medida.** A
regra anterior ("Development só avança à mão") foi escrita para a era do
bridge, quando Production estava atrás da fila e qualquer avanço automático de
Development fabricava um diff no Publishing. Production alcançou a cabeça da
fila, e a mesma regra passou a produzir o estado inverso: **Development atrás é
a precondição do diff destrutivo** — o Provision propõe remover de Production o
que as migrations criaram, e foi isso que apagou dado real em 17 e 18/08/2026.
Os dois sentidos do diff não se equivalem: Development à frente produz proposta
aditiva, cujo pior desfecho é um deploy recusado; Development atrás produz
proposta destrutiva, cujo pior desfecho é perda de decisão humana, que nenhuma
reconvergência devolve. Com Development convergindo na partida e no merge, o
estado "atrás" dura os segundos entre o pull e a fila — não até alguém lembrar
de um comando na véspera de um Publish.

Quem decide é `deveMigrarNaPartida()`, em
`artifacts/api-server/src/lib/migrations.ts`. Ela lê dois sinais, nesta ordem:

1. **`DB_MIGRATE_ON_BOOT`**, quando dita. É a única forma de fixar a resposta
   para um ambiente que ainda não existe. O `[services.production.run.env]` do
   `artifact.toml` a escreve como `"1"`.
2. **`NODE_ENV`**, na ausência dela. `production` migra; qualquer outra coisa,
   não. Os dois lados já configuram isso por escrito — `scripts/dev.mjs` passa
   `development` ao subir o servidor, o artifact passa `production`.

Um valor não reconhecido em `DB_MIGRATE_ON_BOOT` cai de volta no `NODE_ENV` e
aparece no log, em vez de virar "não migre": um erro de digitação numa variável
de deploy não pode ser o que trava a fila de Production.

### O que **não** classifica ambiente

**`DATABASE_URL`.** Ela diz que existe um banco alcançável — desenvolvimento,
teste e produção têm um. O que ela não diz é de quem ele é.

Isto já foi um defeito real, e vale escrito porque a forma dele é traiçoeira. A
regra estava em `scripts/dev.mjs`, na forma de um `runMigrations: null` que
desliga o passo de migração **do supervisor**. Só que o supervisor não abre
conexão: quem abre é o servidor que ele sobe, e o servidor decidia sozinho,
olhando apenas se `DATABASE_URL` existia. Em desenvolvimento ela sempre existe.
O resultado foi um `Run` que aplicou `0020_chamados_exclusao` e
`0021_cobertura` no banco de desenvolvimento enquanto o console imprimia, na
mesma partida, que não aplicaria.

A regra estava na camada errada: quem precisa conhecê-la é o processo que abre
conexão, não o que o inicia.

### Desligado não é cego

Com a migração automática desligada, `/api/readyz` continua dizendo o que
falta: `observarBanco()` pergunta ao banco a cada chamada, e não ao que este
processo fez na partida. O que muda é quem aplica — uma pessoa, por comando.

## Por que não existe uma segunda autoridade

Um diff de schema sabe copiar estrutura. Ele não sabe nada do que sustenta essa
estrutura neste projeto:

- as funções `IMMUTABLE` (`freightcheck_snapshot_key` e companhia) de que a
  coluna gerada `canonical_snapshot_key` depende;
- o backfill que converte as vigências históricas antes de `dataset_family`,
  `canal` e `canonical_scope` poderem ficar `NOT NULL`;
- a validação que recusa canal vazio e escopo vazio **antes** do `NOT NULL`;
- a fusão das vigências duplicadas da `0016`, com `snapshot_merge` guardando
  para onde os dados de cada origem foram;
- as três views de diagnóstico e os gatilhos de imutabilidade.

Aplicado sozinho, o diff não é uma versão mais rápida da migration: é um banco
num estado que nenhuma das duas autoridades reconhece. O caso concreto: o diff
propõe `ALTER TABLE snapshot ADD COLUMN dataset_family text NOT NULL` numa
tabela que já tem linhas — sem backfill, e com a coluna gerada apontando para
uma função que ele não cria.

### O que está trancado, e onde

**`drizzle-kit push`, `migrate` e `drop` abortam** em
`lib/db/drizzle-kit.config.ts`, antes de abrir conexão. `generate`, `check` e
`up` continuam liberados: eles mexem em arquivo do repositório, que é onde a
decisão de schema é tomada e revisada.

**A configuração não se chama `drizzle.config.ts`, e o nome é o ponto.** O
Publishing decide que um projeto "usa Drizzle" procurando por esse nome; achando
um, ele acrescenta ao deploy um passo próprio de migração de schema — derivado
do `schema.ts`, aplicado direto em produção, sem passar pela configuração e
portanto sem esbarrar nas proibições acima. Aqui esse passo não tinha como
funcionar: `snapshot.canonical_snapshot_key` é gerada por
`freightcheck_snapshot_key(...)`, o drizzle modela a coluna e não a função, e o
DDL dele morria em

```
ALTER TABLE "snapshot" ADD COLUMN "canonical_snapshot_key" text
  GENERATED ALWAYS AS (freightcheck_snapshot_key(...)) STORED;
ERROR: function freightcheck_snapshot_key(text, text, text, date, jsonb) does not exist
```

com a tela oferecendo, como saída, copiar o banco de desenvolvimento por cima do
de produção. Com o arquivo fora do nome procurado, o passo não é montado. O
`generate` continua inteiro: o `package.json` o chama com `--config` explícito.

**A configuração não vai para a imagem publicada** (`.replitignore`), de modo
que nenhum passo de publicação consiga usá-la de dentro do contêiner.

**O `meta/` do drizzle está alinhado com o disco** — ver a seção seguinte. Era
daí que vinha a proposta fantasma: o último snapshot era o `0011`, e qualquer
ferramenta que diferencia `schema.ts` contra o `meta/` concluía que as seis
migrations seguintes nunca tinham existido e propunha refazê-las.

### O que **não** está trancado, e é decisão de quem publica

O Publishing do Replit monta a proposta dele comparando o **banco de
desenvolvimento com o de produção**, no navegador, fora do repositório. Não há
interruptor deste lado para aquela comparação. Enquanto produção estiver atrás
de desenvolvimento — o que é o normal no instante do deploy —, ele vai encontrar
diferença e oferecer aplicá-la.

**Recuse a proposta.** Publique só build e start: o servidor aplica a fila
versionada na partida e `/api/readyz` mostra o resultado. Aceitar a proposta é
o único jeito de este projeto ficar com dois schemas.

Ela costuma aparecer como uma pergunta de *renomeação* — "Detected potential
conflicts: essas colunas foram removidas e essa foi adicionada; alguma delas foi
renomeada?". É o resolvedor de conflitos do drizzle-kit, e a pergunta não tem
resposta certa **nenhuma**: as opções todas terminam em aplicar DDL fora da fila.
Não há como responder "isso já está tratado numa migration" — só cancelar.

O que ela mostra, porém, é informação boa de graça: a lista de diferenças diz o
que o **schema** de produção tem, que é outra pergunta. Uma pergunta sobre
`ticket` perdendo `parameter_label`, `attribute_code`, `requested_value_*`,
`applied_value_*` e `impact_*` e ganhando `changed_parameter_count` é a `0013`
inteira — o schema de lá é anterior a ela.

Isso **não** diz em que migration produção está: o registro é o que responde
isso, e ele pode estar vazio com o schema inteiro de pé (foi o caso em
15/08/2026 — ver a seção seguinte). As duas conferências, somente leitura:

```sql
-- o registro
SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at;
```

De fora, sem credencial, `/api/healthz` responde o mesmo em `database.migrations`
— `applied`, `pending` pelo nome, e onde a última tentativa parou. Se a
publicação estiver atrás de um gate de autenticação, o `curl` leva 307 e o
navegador logado não.

## O bridge, e o dia em que ele inverte de sinal

Recusar a proposta nem sempre bastou. Enquanto produção estava muito atrás, a
proposta trazia DDL que **não tinha como rodar** — a coluna gerada
`snapshot.canonical_snapshot_key` chamando uma função que o Publishing não cria
—, e a fase `Provision` morria antes de o servidor novo existir. Para isso
existe `lib/db/src/bridge.ts`: o `bridge:down` deixa Development temporariamente
parecido com Production nos pontos que geram DDL destrutivo ou impossível, e o
que sobra para a proposta são seis `ADD COLUMN` nullable. Depois do deploy, o
servidor aplica a fila em Production e o `bridge:up` devolve Development ao
estado canônico. A justificativa inteira, objeto por objeto, está no cabeçalho
daquele arquivo.

**Duas tabelas descem cheias e voltam cheias.** `modulo_universal` e
`modulo_universal_evento` — o que a instalação desligou para todo mundo, e o
histórico de quem decidiu — saem de `public` como todas as outras, porque o
contrato com o Publishing não admite `CREATE TABLE` na proposta; o que não sai é
o **conteúdo**, que o `down` guarda no schema `drizzle` e o `up` devolve
(`lib/db/src/bridge-guarda.ts`). Elas ficaram um tempo em `TABELAS_REMOVIDAS`,
com a pré-condição de tabela vazia valendo sobre elas, e isso era um beco: o
histórico é append-only e a interface nunca o apaga, então o primeiro módulo que
alguém desligasse travava o `bridge:down` para sempre, e a única saída oferecida
era esvaziar as duas à mão — quer dizer, destruir a decisão da casa e o registro
de quem a tomou para conseguir publicar. Se o `up` não conseguir devolver o
conteúdo, ele **aborta** e o marcador de bridge pendente continua de pé: o cofre
fica intacto para a próxima tentativa, e `/healthz` continua dizendo
`BRIDGE_PENDENTE`.

**A operação tem um pressuposto, e ele vence.** O bridge encolhe o diff *porque
Production está atrás*. Todo deploy que dá certo termina com a fila aplicada em
Production — e a partir daí é Development quem fica atrás, se o `bridge:up` não
rodou ou se ninguém rodou `migrate` lá (que é a política deste repositório:
Development não migra sozinho). Nesse dia a mesma operação faz o oposto do que
ela existe para fazer: o Publishing encontra em Production o que Development não
tem e propõe **remover** de lá.

Foi o `Provision` de 17/08/2026:

```
Failed to run database migration statement
ALTER TABLE "attribute" DROP CONSTRAINT "attribute_meaning_id_semantic_meaning_id_fk";
constraint "attribute_meaning_id_semantic_meaning_id_fk" of relation "attribute" does not exist
```

O erro é ordem interna do gerador — a FK já tinha caído junto com
`semantic_meaning`, que a mesma proposta derrubava antes — e é o menor dos
problemas dela: aquela proposta levava também `coverage_expectation`,
`ticket_change` e `ticket_import_deletion`, que são decisão de gente e registro
append-only. **A tela só oferece cancelar ou copiar Development por cima de
Production; das duas, a única que não perde dado é cancelar.**

### Conferir antes de publicar

A pergunta "a proposta que aquela tela vai montar é segura?" agora tem resposta
observável, somente leitura dos dois lados:

```bash
DATABASE_URL=<development> PRODUCTION_DATABASE_URL=<production> \
  pnpm --filter @workspace/db run publicar:conferir
```

Ele imprime o que a proposta criaria em Production e o que ela removeria, linha
por linha, e reprova se houver qualquer remoção. Nenhum dos dois bancos é
escrito — Production, em particular, não é escrita por ferramenta nenhuma deste
repositório.

A mesma conferência entrou no `bridge:down`, com a mesma variável: com ela
definida, o `down` mede a proposta **dentro da própria transação** e recusa
descer se Production tiver algo que Development perderia; sem ela, o bridge roda
como antes e avisa, no fim, que passou sobre uma suposição.

### Quando a proposta quer remover

É Development que está atrás. Na ordem:

1. **Cancele o deploy.** Nunca a outra opção.
2. Conclua o bridge, se houver um pendente:
   `pnpm --filter @workspace/db run bridge:up`. `/api/healthz` do ambiente de
   desenvolvimento responde `BRIDGE_PENDENTE` quando é o caso.
3. Ponha Development na fila: `pnpm --filter @workspace/db run migrate`.
4. Rode `publicar:conferir` de novo. Com os dois bancos na mesma fila, a
   proposta fica vazia — e um deploy sem proposta de schema é o deploy normal
   deste projeto.

## Um banco que tem o schema e não tem o registro

Acontece: `drizzle.__drizzle_migrations` vazio num banco inteiro de pé. Foi o
estado de produção em 15/08/2026 — `/api/healthz` respondendo `applied: 0` com
todas as telas funcionando.

Isso **não trava mais a fila**. Toda migration, da `0000` à `0020`, atravessa um
banco que já a contém: tipo, tabela, índice, coluna, constraint e gatilho são
procurados antes de criados, e o que já está lá é deixado como está. Rodar a
fila sobre um banco existente é trabalho repetido, não erro — o servidor faz
isso sozinho na partida e o registro se recompõe.

O que a reentrância **não** faz é inventar backfill. Uma migration que converte
dado roda o `UPDATE` de novo; todos eles são escritos com `WHERE` que os torna
inócuos quando o dado já está convertido, e é isso que os testes de
`registro-perdido.test.ts` e `canonical-identity-migration.test.ts` prendem.

`migrate:adotar` continua existindo para o caso oposto — quando se quer
**registrar sem rodar**, por saber que aquele estado já foi alcançado. É
declaração de quem opera, não conserto de partida, e não é mais pré-requisito
para destravar nada.

## O `meta/` do drizzle, e o que ele não representa

`migrations/meta/*.json` são a fotografia que o drizzle-kit usa como base do
próximo diff. Existe um snapshot por entrada do `_journal.json`, e o último tem
de descrever exatamente o `schema.ts` de hoje — senão o diff volta a propor o
que já existe.

Os snapshots `0012`–`0014` foram reconstruídos a partir do `schema.ts` de cada
commit que introduziu a migration correspondente (`231133f`, `2b8b50c`,
`8318985`). Os de `0015`–`0017` foram derivados do `schema.ts` atual desfazendo
o que `0016` e `0017` acrescentam — as três migrations da identidade canônica
foram escritas num commit só (`ecf2a85`), e não existe um `schema.ts` histórico
para cada uma. Cada snapshot é conferido contra um banco real em
`src/__tests__/meta-snapshots.test.ts`: a derivação não vale por si, vale porque
passa nessa conferência.

**O que o snapshot não modela**, e que por isso é autoridade exclusiva do SQL:

- funções (`freightcheck_*`);
- gatilhos e as funções de gatilho (`0001`);
- views (`freightcheck_snapshot_ativo_duplicado`, `freightcheck_fato_duplicado`,
  `freightcheck_identidade_vigencia`);
- índices parciais que o `schema.ts` não declara, como `fact_inherited_idx`;
- todo o SQL procedural — backfill, fusão, validação, `COMMENT ON`.

Consequência prática: um `drizzle-kit push` não veria nenhum desses objetos e os
trataria como ausentes. É mais um motivo para ele estar desligado.

## Alterar o schema

1. edite `lib/db/src/schema/*.ts`;
2. `pnpm --filter @workspace/db run generate` — o SQL sai em
   `lib/db/migrations`, com o snapshot correspondente;
3. **leia e reescreva o SQL gerado.** Ele é um rascunho: coluna obrigatória em
   tabela com dado exige coluna nullable → backfill → validação explícita →
   `NOT NULL` → constraints, nessa ordem, e nada disso o gerador escreve;
4. rode os testes de migration (`pnpm --filter @workspace/db test`);
5. commite SQL e snapshot juntos. Um sem o outro é o começo da divergência.

## As constraints da identidade, e a `0018`

A validação explícita do backfill e as quatro constraints que fecham identidade
vazia (`snapshot_canal_nao_vazio_ck`, `snapshot_dataset_family_nao_vazio_ck`,
`snapshot_canonical_scope_ck`, `snapshot_canonical_scope_nao_vazio_ck`) entraram
na `0015`. Um banco que ainda não a aplicou — produção — recebe tudo por lá.

Um banco que já a aplicou, não: o registro é por carimbo, e migration aplicada
não roda de novo. A `0018` existe só para esse caso, e é escrita para os dois:
onde as constraints já estão, ela confere e não faz nada; onde faltam, ela
valida o dado e as cria. É a diferença entre corrigir uma migration e deixar
desenvolvimento e produção com schemas diferentes.

Migration já aplicada não se reescreve por conveniência — o registro em
`drizzle.__drizzle_migrations` é por carimbo (`when`), então um arquivo editado
não roda de novo em quem já o aplicou, e os dois ambientes passam a ter
histórias diferentes. As exceções são as correções de segurança que **não mudam
o resultado final** em quem já rodou, como a reentrância da `0015`.

## A janela T4→T7 do deploy — e por que o `artifact.toml` ainda aponta para `/healthz`

O startup probe (`[services.production.health.startup]`) decide quando a
plataforma promove um release e passa a mandar tráfego para ele. Ele aponta
para `/api/healthz`, liveness pura — necessária, porque `app.listen()`
acontece antes da fila de migrations rodar (ver acima), e o probe não pode
depender do banco para não desistir do bind. O efeito colateral: a plataforma
pode promover o release **antes** de a fila terminar. Foi o que produziu a
tela de 24/08/2026 — `MIGRATIONS_PENDENTES` na tela de login, com `0056` e
`0057` nomeadas, num Development que não tinha reiniciado.

`/api/startupz` (`routes/health.ts`, `lib/partida.ts`) existe para fechar essa
janela: responde 503 enquanto a tentativa de partida deste processo ainda está
em voo, e 200 quando ela **termina** — por qualquer desfecho, inclusive
falha. Fail-closed sem prazo de validade: não existe teto que o faça
responder 200 sozinho. `STARTUP_PROBE_MAX_WAIT_MS` só rotula a espera como
anômala (`alemDoTeto`) no corpo da resposta; não muda o código HTTP.

**Por que o `artifact.toml` continua apontando para `/healthz`.** Repontar o
startup probe para `/startupz` exige saber por quanto tempo o Autoscale
aceita 503 antes de desistir da promoção — o orçamento **total**, não o tempo
de resposta de uma chamada. Duas buscas na documentação pública do Replit
(24/08/2026) encontraram só isto, por escrito: uma chamada de health check
que demore mais que ~5 s pode falhar a publicação. Nada foi encontrado sobre
quantas tentativas o probe faz, com que intervalo, ou por quanto tempo total
ele insiste antes de desistir — nem na documentação alcançável, nem em
`docs.replit.com`/`replit.discourse.group` diretamente (bloqueados pelo proxy
de rede do ambiente onde isto foi escrito).

Sem esse número, repontar seria uma aposta: se o orçamento total do Autoscale
for mais curto que o que uma fila real chega a levar num dia ruim (banco
lento, `pg_advisory_lock` de outra instância segurando por mais tempo que o
normal), a publicação falharia por timeout do probe — não por erro no código,
e sem nada dizendo isso com clareza. Com `/healthz` continua valendo o
comportamento de sempre: publicação sempre sobe, e a tela de 24/08/2026 pode
voltar a aparecer por alguns segundos a cada deploy com migration, do jeito
que o portão de prontidão (`middlewares/portao-de-prontidao.ts`) já responde
— diagnosticável, nunca dado errado.

Repontar é seguro assim que alguém confirmar, por medição direta contra o
ambiente publicado (não pela documentação), que o Autoscale tolera 503 em
`/startupz` por tempo suficiente — a fila normal leva segundos; o que importa
medir é o pior caso tolerável antes de a plataforma desistir. Essa medição foi
desenhada (harness descartável, sem tocar Production) e fica em espera —
não é necessária para o que este trabalho garante hoje, que é sobre o código
deste repositório, não sobre a plataforma.

**Risco residual: a suposição de que o Autoscale respeita o startup probe
como configurado.** Todo o desenho de `/api/startupz` — `liberar` só quando a
tentativa de partida termina, sem exceção por tempo (`lib/partida.ts`) —
garante o que este código promete: que **este processo nunca diz "pode
promover" antes de a fila terminar**. O que ele não pode garantir sozinho é o
que a plataforma faz com essa resposta depois de recebê-la; isso é
comportamento do Autoscale, fora deste repositório, e não documentado por
escrito em nenhum lugar alcançável (ver acima). Hoje o probe aponta para
`/healthz`, então esse risco é adormecido — só passa a valer no dia em que
`/startupz` for repontado. Se, depois disso, aparecer evidência de uma
promoção pública com `/api/startupz` respondendo 503 no momento em que o
tráfego começou a ser aceito, isso é o sinal para abrir uma investigação
específica da plataforma — não deste código, que já teria feito sua parte
corretamente.

## Três dias parado por uma chave desligada em vez do incidente que ela resolvia — 22–25/08/2026

`DB_MIGRATE_ON_BOOT` foi desligado em Production às 13h16 de 22/08/2026, em
reação a um incidente real: um build de deploy falhou readiness porque o
worker de migration interferia na partida, e os logs do container mostravam
falhas repetidas de health check com erro de Postgres na janela de boot. O
raciocínio do momento — "o Publish do Replit é a única autoridade que altera
o schema de produção" — parecia uma saída razoável.

Duas coisas estavam erradas nela, e as duas já estão documentadas acima neste
arquivo: o passo de schema do Publish **não escreve no registro**
`drizzle.__drizzle_migrations` (ver "A reconvergência da partida"), então
desligar a chave não transferia a autoridade para lugar nenhum que o resto do
sistema — `/api/readyz`, o portão, `diagnosticar` — conseguisse enxergar; e o
incidente de readiness que motivou a mudança já tinha, no mesmo repositório, a
correção estrutural certa esperando para ser aplicada: abrir a porta antes da
fila, migrar em segundo plano, portão de prontidão separado do probe de
partida (ver "A porta aberta não é tráfego aceito", acima). Essa correção foi
ao ar **~9h30 depois**, no mesmo dia — `c9cf017`, 22h55 — tornando o incidente
original estruturalmente irrepetível: `/api/healthz`, alvo do startup probe,
nunca toca o banco e responde 200 imediatamente após o bind, então uma
migration lenta ou recusada não tem como derrubar o probe.

A chave continuou em `"0"` por mais três dias depois de essa correção já
valer. O efeito, com `deveMigrarNaPartida()` retornando `false`
incondicionalmente: todo restart de Production — e houve vários — chegava ao
mesmo lugar sem nunca chamar `migrarComReparo()`. Nenhum `pg_advisory_lock`
disputado, nenhuma tentativa, nenhuma falha registrada — simplesmente nada
tentava. `0056_frota_promax` e `0057_total_do_pagamento` ficaram pendentes o
tempo todo, com o portão de prontidão corretamente recusando produto — a parte
que funcionava — enquanto nada convergia, porque não havia mecanismo tentando
fechar a lacuna. Não foi um SQLSTATE, não foi um `pg_advisory_lock` preso: foi
ausência total de tentativa, disfarçada de decisão deliberada por um
comentário que já estava desatualizado no dia em que foi escrito.

**O tell, para quem opera:** `/api/build` mostrando `startedAt` recente — o
processo reiniciou de verdade — e `/api/readyz` continuando com a mesma
contagem de pendências de antes do restart. Migração que falha muda de
figura a cada tentativa (`falha.tag` nomeia onde parou); migração que nunca é
tentada fica estática para sempre, porque não há tentativa para variar.

**A correção:** reverter a chave para `"1"`, e nada além disso — o runner
inteiro (lock, journal, transações, reparo, fail-closed) nunca foi alterado
pelo incidente; ficou só inatingível. `.agents/memory/publish-owns-production-schema.md`
foi reescrita para não voltar a recomendar este desligamento.
