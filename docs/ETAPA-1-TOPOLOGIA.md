# Etapa 1 — topologia: respondida

**Data:** 18/09/2026 · **Medido** do Shell do Replit contra o Neon de produção.

---

## 1. A resposta

```
host            ep-rough-art-aci1nmr1.sa-east-1.aws.neon.tech
região          sa-east-1 (aws)            ← São Paulo
endpoint        direto (não é o pooled)

TCP (1 ida e volta)   p50 144,3 ms · p95 151,6 ms · min 142,0 ms
TCP+TLS (3-4 idas)    p50 444,5 ms
psql SELECT 1         p50 1.038,4 ms
```

**É CAUSA A — geografia.** O banco está em São Paulo e a aplicação não está.
144 ms de ida e volta é a distância, e nada além dela: o p95 fica a 7 ms do p50,
que é o retrato de um caminho de rede estável e longo, não de um servidor
ocupado.

## 2. As outras três causas — o que a aritmética resolve, e o que não

| | Hipótese | Veredito |
|---|---|---|
| **B** | O pool não reaproveita conexão | **Evidência forte, não prova.** Se cada consulta abrisse conexão, pagaria TCP+TLS = **444 ms**; o custo medido por consulta é **123 ms**, menos que um TCP puro daqui. A aritmética só fecha com conexão reaproveitada — mas é inferência a partir de tempo agregado, e não uma leitura do pool. A medição direta é a de §2.1: comparar a **primeira** requisição de um processo recém-nascido com as seguintes |
| **C** | O endpoint *pooled* acrescenta um salto | **Descartada.** O host não tem `-pooler`: é o endpoint direto |
| **D** | O compute do Neon suspende por ociosidade | **NÃO descartada — eu errei.** Escrevi "descartada" com base em 40 amostras de `/api/build` cuja dispersão era de 9 ms. Só que **as 40 eram quentes**: um compute suspenso acorda na *primeira* consulta e fica de pé. Amostra quente não vê suspensão, por construção. O que aquelas 40 mostram é que **em regime** não há suspensão — nada sobre a primeira visita depois de ociosidade. Falta medir, e há sonda para isso (§2.1) |

Vale notar que **o número do deployment (123 ms por consulta) é menor que o do
workspace (144 ms)**. Os dois são da mesma ordem e a diferença é de caminho de
rede — mas quem responde pela experiência do usuário é o do deployment, e é ele
que entra nas contas abaixo.

## 2.1 O que ainda falta medir, e a sonda que mede

Tudo acima veio do **Shell**. O que decide é o **deployment**, e três coisas
continuam sem medição direta:

| | Falta | Sonda |
|---|---|---|
| 1 | RTT e custo por consulta **de dentro do processo publicado**, pelo pool real | `prova-no-deployment.mjs agora` |
| 2 | Conexão **fria** separada da **reutilizada** — é o que fecha B e D | `prova-no-deployment.mjs aguardar` |
| 3 | Que o `DATABASE_URL` do Deployment é este mesmo host `sa-east-1` | painel do Replit → Deployments → Secrets |

`scripts/diagnostico/prova-no-deployment.mjs` usa o próprio servidor publicado
como instrumento, pelo mesmo truque da Fase 0: `/api/build` custa **0 consultas**
sem cookie e **3** com cookie, e não lê dado de produto. A diferença é o custo de
três consultas **pelo pool de verdade, de dentro da aplicação**.

```bash
# estado quente: p50/p95/p99 e o custo por consulta
node /tmp/fase0/scripts/diagnostico/prova-no-deployment.mjs https://freightaudit.replit.app agora

# fria: fica sondando até o Autoscale recolher, e mede a PRIMEIRA autenticada
node /tmp/fase0/scripts/diagnostico/prova-no-deployment.mjs https://freightaudit.replit.app aguardar
```

O modo `aguardar` sonda `/api/build` **sem cookie** — 0 consultas, não acorda o
banco nem segura o processo de pé. Quando o `startedAt` muda, ele dispara a
primeira requisição autenticada e cronometra. **Não abra o app durante a
espera**, ou o processo não é recolhido.

A leitura:

| | Significa |
|---|---|
| fria − quente ≈ 3×RTT | é só o pool estabelecendo conexão. **B confirmado, D descartado** |
| fria − quente ≫ 3×RTT | tem compute do Neon acordando junto. **D confirmado** — e desligar a suspensão tira esse custo da primeira visita |

Exercitada de ponta a ponta contra a pilha local, com um reinício provocado no
meio da espera: detectou o processo novo, mediu a primeira autenticada (8,4 ms
contra 4,4 ms quente), comparou o excedente com 3×RTT e deu o veredito certo.

## 3. O que aproximar app e banco vale — **estimativa, não medição**

Consultas por rota: as que o modelo da Fase 0 estimou e que bateram com o log do
Postgres. Base de rede (~56 ms) preservada — ela é o caminho até o app, e não
muda. Alvo conservador de 2 ms por consulta na mesma região.

| Rota | Consultas | Hoje (medido) | Só RTT (**a conta errada**) | Piso honesto | Fator |
|---|--:|--:|--:|--:|--:|
| `/api/build` (só o pedágio) | 3 | **426 ms** | ~~62 ms~~ | **64 ms** | 7× |
| `/api/contexts` | 5 | **675 ms** | ~~66 ms~~ | **71 ms** | 10× |
| `/api/curation/summary` | 5 | **675 ms** | ~~66 ms~~ | **70 ms** | 10× |
| `/api/auth/session` | 10 | **1,3 s** | ~~76 ms~~ | **80 ms** | 16× |
| `/api/composition/fleet` | 12 | **1,6 s** | ~~80 ms~~ | **138 ms** | 11× |
| `/api/changes/grouped` | 19 | **2,4 s** | ~~94 ms~~ | **173 ms** | 14× |
| `/api/changes/families` | 20 | **2,6 s** | ~~96 ms~~ | **166 ms** | 15× |
| `/api/curation/queue` | 33 | **4,1 s** | ~~122 ms~~ | **343 ms** | 12× |
| `/api/dre/fleet` | 48 | **6,0 s** | ~~152 ms~~ | **260 ms** | 23× |

> **A coluna riscada era a minha conta anterior, e ela estava errada.** Eu
> projetei `rede + consultas × RTT` e **deixei o SQL e o trabalho da aplicação
> fora**. Eles não somem quando o banco chega perto: a consulta continua
> executando, a linha continua sendo serializada, o motor continua compondo.
> Em `/api/curation/queue` isso é grosseiro — 164 ms só de SQL, medidos no log
> local: a projeção de 122 ms era **menor que o SQL sozinho**, o que é
> impossível.
>
> A coluna "piso honesto" soma `rede + consultas × 2 ms + SQL + fora do banco`,
> com SQL e "fora do banco" medidos no log local. E **é piso, não previsão**: o
> acervo publicado é maior que o seed de uma unidade — as próprias contagens de
> consulta do ar (48 contra 15 em `/dre/fleet`) provam isso —, então o SQL de
> produção é maior que o local. O número real vai ficar **acima** desta coluna.

Em tela: `/dre` sai de ~7,3 s para algo **da ordem de 0,4–0,8 s** — não os 0,2 s que eu disse antes.

**Mesmo com a conta corrigida, nenhuma correção de código chega perto disso** —
a menor melhora da tabela é de 7×. O que mudou não foi a conclusão; foi a
honestidade do número. E é por isso que valia medir antes de escrever qualquer
linha.

## 4. O que isso faz com a 1b

| | Ganho da 1b (tirar 2 das 3 consultas de pedágio) |
|---|--:|
| Hoje | **247 ms** por requisição |
| Depois de aproximar | **4 ms** por requisição |

A 1b era o 2º item do plano justamente porque o RTT era alto. **Com app e banco
juntos ela deixa de valer a pena** — não pelo mérito, que continua o mesmo, mas
porque passa a economizar 4 ms às custas de mexer em caminho de ACL, que é o
lugar mais delicado do servidor.

**Recomendo suspender a 1b** até a aproximação acontecer, e então remedir. Se
depois disso ela ainda aparecer, faz-se; se não aparecer, economiza-se um risco
de segurança por 4 ms.

## 5. As três opções, em ordem

Valores de custo são ordens de grandeza para dimensionar a decisão, não cotação
— os planos de Replit e Neon mudam, e nenhum dos dois painéis é consultável
desta sessão.

### Opção 1 — mover o Deployment para São Paulo ⭐

| | |
|---|---|
| **Esforço** | mínimo, se a plataforma permitir: é escolher a região e publicar de novo |
| **Risco** | **baixo.** Não toca no dado. O pior caso é a região não existir no plano |
| **Indisponibilidade** | a de uma publicação normal |
| **Custo** | nenhum, se a região estiver no plano atual; a diferença de preço entre regiões, se não |
| **Impacto** | resolve o RTT inteiro **e** encurta os ~56 ms até quem usa, que é brasileiro. É a única opção que melhora os dois eixos |
| **Bloqueio** | **não sei se o Replit deixa escolher a região do Deployment.** É a primeira coisa a conferir no painel |

### Opção 2 — hospedar a aplicação em `sa-east-1` fora do Replit

Se a opção 1 não existir. Qualquer provedor com região em São Paulo serve; a
aplicação é um processo Node com um build estático ao lado.

| | |
|---|---|
| **Esforço** | **alto.** Sai do Replit: build, deploy, segredos, domínio, TLS, observabilidade — tudo de novo |
| **Risco** | **médio-alto.** Muda a plataforma inteira de uma vez. O `artifact.toml`, o portão de prontidão e o fluxo de migrations foram desenhados para o Replit |
| **Indisponibilidade** | uma janela de troca de DNS, minutos, com volta atrás possível |
| **Custo** | da ordem de US$ 10–40/mês para um serviço pequeno, mais o tempo de quem migra, que é o item caro |
| **Impacto** | o mesmo da opção 1 |
| **Efeito colateral bom** | resolve de quebra a 1a: um servidor próprio comprime, e a autorização sobre `artifacts/` deixa de ser necessária |

### Opção 3 — migrar o banco para perto da aplicação

Só se as duas acima falharem.

| | |
|---|---|
| **Esforço** | **médio.** O Neon não muda a região de um projeto: cria-se outro na região certa e migra-se com `pg_dump`/`pg_restore` |
| **Risco** | **o mais alto dos três, e é de dado.** 114 MB no seed local; o publicado é maior. Exige conferir contagens dos dois lados antes de virar a chave |
| **Indisponibilidade** | **real**: o dump precisa de um ponto estável. Dezenas de minutos, com escrita bloqueada |
| **Custo** | o do projeto novo durante a sobreposição; depois, o mesmo de hoje |
| **Impacto** | resolve o RTT app↔banco, **mas não** os ~56 ms até quem usa |
| **Contraindicação** | põe o banco longe do Brasil. Não importa para o produto — quem fala com o banco é a aplicação —, mas importa para quem for restaurar um backup ou rodar um diagnóstico daqui |

### A ordem, e por quê

**1 → 2 → 3.** A primeira é configuração; a terceira mexe no ativo mais valioso
que o produto tem. Entre elas, a segunda troca uma migração de dado por uma
migração de plataforma — mais trabalho, menos risco irreversível.

## 6. Plano revisado

| | Item | Estado |
|--:|---|---|
| **0** | **Aproximar app e banco** | **novo, e é o maior ganho de toda a auditoria** — 7× a 39× por rota |
| 1 | **1a** — compressão e cache | provada; aguarda a autorização sobre `artifacts/` |
| — | ~~1b — pedágio 3→1~~ | **suspensa**: passa a valer 4 ms depois do item 0 |
| 3 | A1/A2 — esqueleto deixa de ser mudo | continua valendo: 13,2 s de silêncio é do cliente, não do RTT |
| 4 | C1 — `staleTime` | continua valendo, e fica **mais** barato de justificar depois do item 0 |
| 5 | D3/D4 — round trips das rotas caras | **cai muito**: 48 consultas a 2 ms são 96 ms. Vira otimização, não correção |
| 10 | D2 — a consulta de 592 ms | sobe de novo: a 2 ms por consulta, 592 ms de SQL puro passa a ser o maior item de uma rota |

**O item 0 reordena o plano inteiro pela segunda vez** — e nos dois casos quem
reordenou foi a medição, não a opinião.

---

## 7. O que peço agora

1. **Rodar `prova-no-deployment.mjs agora`** — confirma o custo por consulta de
   dentro do processo publicado, com o pool real.
2. **Rodar `prova-no-deployment.mjs aguardar`** e deixar o app ocioso — é o que
   fecha B e D, e é a medição que eu devia ter feito antes de escrever
   "descartada".
3. **Conferir no painel do Replit**: a região do Deployment, se ela é
   escolhível, e se o `DATABASE_URL` dos Secrets do Deployment é este mesmo
   host `sa-east-1`.

A **1b** fica suspensa. A **1a** segue aprovada conceitualmente e parada na
autorização sobre `artifacts/` — ela é sobre bytes, não sobre o banco, e o ganho
dela (−62% em 4G) não muda com a aproximação.

Nada foi implementado. `git diff -- artifacts lib` continua vazio.
