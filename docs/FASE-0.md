# Fase 0 — o que foi possível executar, e o plano revisado

**Data:** 18/09/2026 · **Etapa:** conferência no ambiente publicado, antes das
Fases 1–3.

> **Nada foi alterado no produto.** Nenhuma otimização, índice, cache,
> infraestrutura ou mudança na política de repetição. O que entrou no
> repositório são **cinco scripts de diagnóstico somente-leitura**, em
> `scripts/diagnostico/`, ao lado dos que já existiam — eles são o instrumento
> da Fase 0, não uma correção. Nenhum arquivo de `artifacts/` ou `lib/` foi
> tocado.

---

## 1. A Fase 0 não pôde ser executada desta sessão

Preciso dizer isto antes de qualquer outra coisa, porque o pedido é explícito
sobre não aceitar conclusão sem evidência: **eu não consegui alcançar o
deployment publicado nem o Neon.** São dois bloqueios independentes, e cada um
sozinho já impede.

### Bloqueio 1 — não tenho o endereço nem a credencial

| Procurei | Resultado |
|---|---|
| URL do app em `replit.md`, `docs/`, `.replit`, `artifact.toml`, scripts | **Não existe no repositório.** E é deliberado: `doctor.mjs` e `diagnostico-assistente.mjs` recebem a URL como argumento (`node scripts/doctor.mjs https://<seu-app>.replit.dev`) |
| `PRODUCTION_DATABASE_URL` no ambiente | **Ausente** |
| `DATABASE_URL` no ambiente | **Ausente** |
| Variáveis `REPLIT_*` | **Nenhuma** |

`scripts/diagnostico/ler-producao.sh` existe exatamente para esta leitura e tem
as travas certas — mas ele recusa, corretamente, sem a variável.

### Bloqueio 2 — a política de rede desta sessão bloqueia a saída

O ambiente remoto sai por um proxy que aplica a política de egresso da
organização. Testado:

```
curl https://replit.com   → curl: (56) CONNECT tunnel failed, response 403
curl https://neon.tech    → curl: (56) CONNECT tunnel failed, response 403
```

E o próprio proxy registra o motivo:

```json
"recentRelayFailures": [
  { "kind": "connect_rejected",
    "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)" } ]
```

O `403` vem do gateway **antes** de DNS ou upstream, então vale para qualquer
host fora da allowlist — inclusive `*.replit.app` e o endpoint do Neon. A
orientação do próprio proxy é não contornar: *"Do not retry or route around it —
report the blocked host."* É o que estou fazendo.

**Consequência:** as três perguntas da Fase 0 — compressão do host estático,
RTT até o Neon, e as cinco hipóteses no ar — continuam **sem resposta**. Não vou
inventar nenhuma delas, e não vou reordenar o plano fingindo que sei o
resultado.

### O que destrava

Qualquer um destes resolve, em ordem de esforço:

1. **Você rodar os três comandos do §2** e colar a saída aqui — leva ~5 minutos
   e não precisa de mim.
2. **Me passar a URL do app** e liberar `*.replit.app` na política de egresso
   desta sessão (Configurações → Conectores/rede do ambiente). Aí eu rodo.
3. **Rodar do Shell do próprio Replit**, que é o único lugar de onde a medição
   API→Neon é literalmente de dentro.

---

## 2. O instrumento, pronto para rodar

**Um comando só.** O orquestrador roda as três medições, confere os
pré-requisitos, lê a credencial sem ecoar, redige qualquer vazamento e escreve
um relatório consolidado e auditável.

> **Troque `SEU-APP` pelo endereço de verdade, e não use `<` `>`.** O bash trata
> `<` como redirecionamento e falha **antes** de o script rodar, com uma
> mensagem que não tem nada a ver com a causa (`bash: app: No such file or
> directory`). O script recusa o marcador quando ele chega até lá, mas nesse
> caso ele nem chega.

```bash
./scripts/diagnostico/fase-0-publicado.sh https://SEU-APP.replit.app
```

Ele pede o cookie em entrada silenciosa. Para não digitar na hora:

```bash
read -rs FREIGHTCHECK_COOKIE && export FREIGHTCHECK_COOKIE
./scripts/diagnostico/fase-0-publicado.sh https://SEU-APP.replit.app
```

O que ele produz, em `./fase-0-<carimbo>/`:

| Arquivo | Conteúdo |
|---|---|
| `RELATORIO.md` | o consolidado — **é este que você me manda** |
| `bruto/1-estatica.txt`, `2-pedagio.txt`, `3-navegador.txt` | a saída crua de cada etapa, também anexada ao relatório |
| `json/*.json` | os mesmos dados estruturados |

Um exemplo completo da forma da saída está em
[`docs/exemplos/fase-0-saida-exemplo.md`](exemplos/fase-0-saida-exemplo.md) —
gerado contra a pilha local, com o aviso no topo de que os números **não** valem
como evidência do ar.

### 2.0 Como pegar os scripts no Shell do Replit

Eles estão no branch `claude/confident-fermi-dvk0jl`, e o workspace do Replit
está no `main` — por isso o caminho não existe lá ainda (`bash:
./scripts/diagnostico/fase-0-publicado.sh: No such file or directory`).

**Sem trocar de branch e sem tocar no seu workspace**, que é o que interessa
quando o app está rodando dali:

```bash
cd ~/workspace
git fetch origin claude/confident-fermi-dvk0jl
mkdir -p /tmp/fase0
git archive FETCH_HEAD scripts/diagnostico | tar -x -C /tmp/fase0
```

Isso escreve só em `/tmp`. O seu `main` fica intacto, nada é sobrescrito, e
nenhum processo do app é interrompido. Os cinco scripts são autocontidos — a
única dependência externa é o `playwright-core`, que o próprio orquestrador
instala em `/tmp/pw`.

Depois é o comando normal, apontando para `/tmp/fase0`:

```bash
read -rs FREIGHTCHECK_COOKIE && export FREIGHTCHECK_COOKIE
/tmp/fase0/scripts/diagnostico/fase-0-publicado.sh https://SEU-APP.replit.app
```

Se preferir trocar de branch mesmo (só faça com o workspace limpo, porque isto
mexe nos arquivos e pode derrubar o app que está rodando):

```bash
git fetch origin claude/confident-fermi-dvk0jl
git checkout claude/confident-fermi-dvk0jl
```

### 2.0.1 A credencial

O cookie **nunca** entra por argumento: em `argv` ele fica no histórico do shell
e aparece em `ps aux` para qualquer processo da máquina. Os três scripts o leem
só de `FREIGHTCHECK_COOKIE`, **recusam** um argumento a mais em vez de aceitá-lo
calados, e nenhum deles imprime o valor.

O orquestrador ainda faz duas coisas por cima disso:

1. passa o relatório inteiro por uma redação que troca a credencial por
   `<REDIGIDO>` — cinto e suspensório, caso uma biblioteca futura resolva ecoar
   um cabeçalho;
2. no fim, **procura a credencial em todos os arquivos de saída** e se recusa a
   terminar se encontrar.

Como obter o valor, sem expor nada: abra o FreightCheck publicado já logado →
DevTools → Application → Cookies → `freightcheck_session` → copiar.

### 2.0.2 Somente leitura, e o que isso quer dizer aqui

Só há `GET` e `HEAD`. Nada escreve no banco, na configuração, no cache ou no
deployment. A única escrita é o diretório de saída, na máquina onde o comando
roda.

O 503 do cenário H5 é injetado **dentro do navegador** (`page.route`): o
deployment nunca recebe nada diferente do que um usuário mandaria. E o teste de
concorrência da auditoria **não** faz parte da Fase 0, de propósito — não se põe
carga num ambiente de produção sem combinar antes.

### 2.1 Entrega estática — item 1 do pedido

Rodada pelo orquestrador; também roda sozinha:

```bash
./scripts/diagnostico/entrega-estatica.sh https://SEU-APP.replit.app
```

Responde: `content-encoding` de cada `.js` e `.css`, **tamanho na rede × tamanho
bruto** (com uma passada `accept-encoding: identity` e outra anunciando
gzip/br/zstd), `cache-control`, `etag`, `last-modified`, `vary`, a negociação
que um Chrome de verdade faria, e a **revisita** — um `if-none-match` que
devolve 304 prova que o arquivo não é rebaixado de novo.

Saída validada localmente:

```
  JavaScript
    content-encoding gzip
    cache-control   public, max-age=31536000, immutable
    bruto           3866331 bytes
    na rede         1032499 bytes
    fator           3.7x
```

### 2.2 Pedágio e latência até o banco — item 2 do pedido

```bash
read -rs FREIGHTCHECK_COOKIE && export FREIGHTCHECK_COOKIE
node scripts/diagnostico/pedagio-e-latencia.mjs https://SEU-APP.replit.app
```

**Como ele mede o RTT até o Neon sem credencial de banco e sem shell no
deployment.** Conferido no log do Postgres em 18/09/2026:

| Requisição | Consultas |
|---|--:|
| `GET /api/healthz` | **0** — rota pública, não toca o banco |
| `GET /api/build` **sem** cookie | **0** — sem sessão, os dois middlewares saem cedo |
| `GET /api/build` **com** cookie | **3** — exatamente o pedágio, e nada mais |

`/api/build` não lê dado de produto: devolve cinco campos de `process`. Então

```
pedágio ≈ p50(build com cookie) − p50(build sem cookie)
RTT     ≈ pedágio / 3
```

e isso **já inclui** o RTT da API até o Neon, que é o número inalcançável de
fora por qualquer outro caminho. `healthz` dá a linha de base do que não é
aplicação nenhuma (rede até o Replit, roteador, Node aceitando a conexão).

O script emite p50/p95/p99/min por rota, o pedágio isolado, o RTT estimado, e
**quanto por cento de cada rota de produto é pedágio**. Validado localmente:

```
  pedágio (3 consultas)   p50 1.5 ms   p95 2.6 ms
  RTT estimado até o banco  ~0.5 ms por consulta
  /api/contexts          p50 4.3   pedágio ≈ 34% do total
  /api/curation/queue    p50 222.6  pedágio ≈ 1% do total
```

O `1,5 ms ≈ 3 × 0,5 ms` bate com as três consultas que o log mostrou — é a
auto-conferência do método.

**O que este script não separa, e por quê.** Aquisição de conexão do pool,
execução SQL e serialização **não** são observáveis de fora: são etapas dentro
de um processo sem instrumentação publicada. O que sai é a soma por requisição,
que é o que decide a prioridade. Separá-las exige `pg_stat_statements` no Neon
ou um cabeçalho `server-timing` no servidor — e as duas coisas são **mudança**,
não medição. Se você quiser essa separação, ela é um item de implementação e
precisa da sua aprovação.

O §4 do script também imprime `pid`, `uptimeSeconds` e `startedAt` de
`/api/build`: rodar de novo após ~15 min de ociosidade e ver **pid diferente com
a mesma revision** é a assinatura do cold start do Autoscale.

### 2.3 As cinco hipóteses no ar — item 3 do pedido

```bash
npm install playwright-core@1.50.1 --no-save --prefix /tmp/pw   # o orquestrador faz isto sozinho
node scripts/diagnostico/medir-no-ar.mjs https://SEU-APP.replit.app
```

| Hipótese | Como é conferida |
|---|---|
| **H1** casca global de seis chamadas | conta as chamadas da casca em cada **abertura direta (F5)** |
| **H2** três consultas em toda requisição | pelo script 2.2 — não é observável no navegador |
| **H3** ausência de `staleTime` útil | primeira visita × revisita, **esperando 75 s** entre as duas |
| **H4** bundle inicial único | nº de arquivos `.js`, maior chunk, rede × bruto, FCP/DCL |
| **H5** retry longo e silencioso | troca a resposta por 503 **dentro do navegador** (`page.route`) e cronometra até a tela dizer algo. O deployment não é tocado |

Validado contra a pilha local, onde os quatro mensuráveis confirmam:

```
  H4  arquivos .js 1 · 1009 KB / 3776 KB · maior chunk 3776 KB   → CONFIRMADO
  H3  3 de 3 rotas refazem chamadas na revisita, 75s depois      → CONFIRMADO
  H1  /panorama 6 da casca · /dre 6 · /composicao 6              → CONFIRMADO
  H5  esqueleto aos 25 ms · a tela só diz que houve erro aos 13.310 ms → CONFIRMADO
```

> **Duas armadilhas que achei escrevendo isto, e que valem para quem for ler a
> saída.** A primeira versão do script mediu a casca na navegação *interna* e
> concluiu "H1 não se confirmou" — falso: o `Layout` nunca desmonta e a casca
> declara `staleTime` de 30–60 s, então dentro da mesma aba ela **não deve
> mesmo** sair de novo. A afirmação da auditoria é sobre a **abertura**. A
> segunda versão mediu a revisita dez segundos depois da primeira visita e
> concluiu "H3 não se confirmou" — falso pelo mesmo motivo: sem esperar o
> `staleTime` vencer, o veredito sai negativo. As duas estão corrigidas, e o
> script agora imprime o intervalo junto do veredito para que ninguém leia o
> número sem ele.

---

## 3. A árvore de decisão — o que cada resultado muda

O plano do §4 está escrito para valer nos dois desfechos, e estes são os dois
resultados que **reordenam** a prioridade:

| Se a medição disser | Então |
|---|---|
| **JS sem `content-encoding`** | **E1 sobe para o primeiro lugar absoluto.** Deixa de ser código e vira configuração do host: +2,7 s em 4G e +15,1 s em 3G, de graça, sem tocar no produto. E o code splitting (E2) perde metade do ganho relativo |
| **JS comprimido** | E1 sai da fase 1; E2 continua onde está |
| **RTT > 10 ms** | **D1 sobe para o primeiro lugar do backend.** Uma tela de 14 chamadas passa a pagar `14 × 3 × RTT` de pedágio: a 15 ms são 630 ms; a 60 ms, 2,5 s. Nessa faixa, tirar o pedágio rende mais que D2 e D3 somados |
| **RTT < 2 ms** | D1 cai para a fase 2; D2 (592→63 ms) vira o item de backend mais valioso |
| **`cache-control` sem `immutable`/`max-age` longo nos assets** | entra um item novo em E, de custo quase zero |
| **`pid` muda após ociosidade** | o cold start do Autoscale entra no orçamento da primeira abertura, e a política de retry (B) ganha uma justificativa a mais para os degraus longos |
| **H3 não se confirmar no ar** | C inteiro cai de prioridade — mas só aceito isso com o intervalo de espera impresso junto (ver a armadilha do §2.3) |

---

## 4. Plano revisado, priorizado por impacto percebido

**A ordem mudou em relação ao relatório de diagnóstico, e a razão é o seu
critério.** Lá a lista era por ganho técnico e começava por `staleTime` e pelo
bundle. Aqui ela começa pelo **bloco A**, que quase não muda milissegundo
nenhum — e é o que mais muda a sensação de sistema travado. Uma consulta que sai
de 592 ms para 63 ms não tira ninguém da impressão de que o produto travou; um
aviso aos 3 s, sim.

A coluna **"evidência no ar"** está marcada `PENDENTE` onde depende da Fase 0.
Nenhum item de risco alto entra em execução com ela pendente.

### Prioridade 1 — A tela para de parecer travada

| # | Problema | Evidência local | Evidência no ar | Causa-raiz | Mudança proposta | Ganho esperado | Risco | Esforço | Validação objetiva | Rollback |
|--:|---|---|---|---|---|---|---|---|---|---|
| **A1** | Esqueleto calado por 13,2 s antes de qualquer palavra | 503 injetado: erro só aos **13.747 ms**; esqueleto aos 582 ms | `medir-no-ar.mjs` H5 — **PENDENTE** | `deveTentarDeNovo` insiste 5× sem nada em tela entre as tentativas | Estado novo *"está demorando; continuo tentando (2ª de 5)"* a partir da 1ª falha, no lugar do esqueleto mudo | silêncio **13,2 s → ~0,4 s** | Baixo | P | reinjetar o 503 e reamostrar o DOM: aviso visível **< 1 s**, texto muda a cada tentativa | reverter um componente; sem efeito em dado |
| **A2** | Tela "travada" por até ~238 s quando o endpoint pendura | pendurado: 1ª desistência aos **45,4 s**, 10 esqueletos, nada escrito | **PENDENTE** | `TEMPO_LIMITE_MS = 45 s` × 5 tentativas + 13,2 s | Contagem regressiva visível + botão **"parar de tentar"**; e B1 baixa o teto | pior caso **238 s → ~73 s**, e **sempre legível** | Baixo | P | endpoint pendurado: a tela nomeia o que espera em ≤ 3 s e oferece saída | idem |
| **A3** | Um cartão secundário segura a tela inteira | `/dre` troca de escopo: conteúdo some para **10 esqueletos** | **PENDENTE** | falta `keepPreviousData` onde as irmãs já o têm | `LEITURA_DE_APURACAO` na DRE, como em `/composicao`, `/vigencia`, `/alteracoes` | 10 esqueletos → **0**; conteúdo anterior fica | Baixo | P | trocar escopo: `chars` nunca cai abaixo do anterior | uma linha por consulta |
| **A4** | Seis estados indistinguíveis de "carregando" | o produto já tem `EstadoVazio`, `ApiErrorNotice`, `estadoDaProcedencia` com 6 desfechos — mas só no Panorama | **PENDENTE** | vocabulário existe e não é compartilhado | Içar `estadoDaProcedencia` para um componente de estado único: **inicial · atualizando · vazio · erro · timeout · indisponível · sem permissão** | os 4 casos que hoje caem no mesmo nada passam a se distinguir | Baixo | M | uma tabela de 7 linhas × tela, conferida no navegador | componente novo, adoção rota a rota |
| **A5** | 404 como estado vazio polui o console em 4 telas | `/trechos/radar`, `/conciliacao-*`, `/qlp/*`, `/qlp/auditoria` ×2 | **PENDENTE** | 404 usado para "ainda não há dado" | 204 + corpo vazio, telas ajustadas junto | console limpo | Médio — é contrato | M | abrir as 65 rotas: zero erro de console | contrato versionado |

### Prioridade 2 — A revisita fica instantânea

| # | Problema | Evidência local | Evidência no ar | Causa-raiz | Mudança proposta | Ganho esperado | Risco | Esforço | Validação objetiva | Rollback |
|--:|---|---|---|---|---|---|---|---|---|---|
| **C1** | Voltar a uma tela custa o mesmo que abri-la | `/dre` 561→**363 ms**, `/curadoria` 283→**313 ms**, `/gestao-a-vista` 262→**276 ms** | `medir-no-ar.mjs` H3, com os 75 s impressos — **PENDENTE** | `PADRAO_DAS_CONSULTAS` não declara `staleTime`; **176 de 216** consultas sem política | Estender `lib/frescor-das-leituras.ts`, **uma família por vez, cada uma com a invalidação que a sustenta** | revisita **→ ~0 ms e 0 requisições** | **Médio — pode mostrar número velho** | M | por família: mutar → chave invalidada → tela nova sem recarregar | `staleTime` por família; reverter uma não mexe nas outras |
| **C2** | `gcTime` nunca declarado | o padrão de 5 min descarta o que C1 acabou de guardar | **PENDENTE** | herdado | `gcTime` explícito por família, ≥ `staleTime` | a revisita sobrevive a um desvio de 10 min | Baixo | P | sair da rota 10 min e voltar: 0 requisições | uma constante |
| **C3** | Mesma chamada duas vezes na mesma tela | `/panorama` dispara `changes/range` idêntica com **2 ms** de diferença; `/build` até **6×** | **PENDENTE** | chaves inconsistentes; `chamadaResiliente` lê o carimbo por sucesso, sem dedup | Unificar as chaves; janela de dedup no `/build` | −5 requisições e −15 consultas em `/monitoramento-de-chamados` | Muito baixo | P | recontar as requisições nas 65 rotas | trivial |
| **C4** | Cache por dimensão e isolamento entre tenants | `queryKeyHashFn` já carrega o ambiente (`cache-do-ambiente.ts`) — mas `scopeHash`, competência e vigência entram na chave **por convenção de cada tela** | **PENDENTE** | não há regra central | Uma chave canônica: `[recurso, ambiente, operacao, scopeHash, competencia, …]`, montada num lugar só | impede vazamento entre unidades quando C1 aumentar a vida do cache | **Alto se errar** | M | trocar de unidade e conferir que nenhum número da anterior sobrevive; teste automatizado por dimensão | a chave é pura; reverter é uma função |

### Prioridade 3 — A primeira abertura encurta

| # | Problema | Evidência local | Evidência no ar | Causa-raiz | Mudança proposta | Ganho esperado | Risco | Esforço | Validação objetiva | Rollback |
|--:|---|---|---|---|---|---|---|---|---|---|
| **E1** | O host estático pode não comprimir | com gzip: 4G **1.896 ms** · sem: **4.603 ms**. 3G: 7.727 → **22.820 ms** | `entrega-estatica.sh` — **PENDENTE, e é a medição que reordena tudo** | configuração do host, não código | ligar compressão no host (ou pré-comprimir no build) | **−2,7 s em 4G, −15,1 s em 3G** | Muito baixo | **PP** | o próprio script: `content-encoding` presente e fator ≥ 3× | configuração |
| **E2** | Bundle inicial único de 3,87 MB | 1 arquivo, 1.009 KB na rede; FCP 344 ms local, **1.312 ms em 4G** | `medir-no-ar.mjs` H4 — **PENDENTE** | `App.tsx` importa as ~65 páginas estaticamente; zero `lazy()` no repositório | `lazy()` por rota + `manualChunks` para `recharts`/`framer-motion` | entrada **1.032 → ~400 KB** gzip; 4G **1.896 → ~1.100 ms** | Baixo | M | `vite build` + os 4 perfis de rede do §5.1 da auditoria | por rota |
| **E3** | Sem orçamento de bundle — cresceu 52% em 3 semanas | 2.540 KB (26/08) → **3.866 KB** (18/09) | — | nada falha quando cresce | Teto no CI: **600 KB gzip** na entrada, 1.200 KB no total | impede a regressão voltar | Muito baixo | P | o CI reprova o PR que estourar | remover a regra |
| **E4** | Prefetch ausente | 1ª visita 561 ms em `/dre` | **PENDENTE** | — | prefetch do chunk **no hover do menu**, e só dele | tira o download do caminho crítico | Baixo | P | 1ª visita após hover cai ao nível da revisita | desligar a flag |

### Prioridade 4 — O backend para de cobrar pedágio

| # | Problema | Evidência local | Evidência no ar | Causa-raiz | Mudança proposta | Ganho esperado | Risco | Esforço | Validação objetiva | Rollback |
|--:|---|---|---|---|---|---|---|---|---|---|
| **D1** | 3 consultas antes de toda rota; sessão lida 2× em `/auth/session` | log do Postgres: `/api/build` sem dado nenhum custa **3**; `/auth/session` custa **10** | `pedagio-e-latencia.mjs` — **PENDENTE, e é o que decide a posição deste bloco** | `escopoEmObservacao` recalcula `escopoEfetivo` por requisição; `resolveSession` roda 2× | memória por sessão com invalidação explícita em mudança de ACL; uma leitura só de sessão | 3 → 1 consulta; a **630 ms** de pedágio de `/panorama` a 15 ms de RTT viram ~210 ms | **Médio — ACL que não invalida é falha de segurança** | M | log do Postgres: recontar as 55 rotas. **E: revogar acesso e conferir que a requisição seguinte já recusa** | desligar a memória por flag; volta ao cálculo por requisição |
| **D2** | A consulta de 592 ms | `EXPLAIN`: laço aninhado, **387.387 iterações**, 1.171.271 páginas; estimativa 25 × real 4.650 | **PENDENTE** | três subselects correlacionados por linha | CTE + `count(*) FILTER` — **já escrita e conferida** | consulta **592 → 63 ms** (9,4×); `/api/balance/:id` **482 → ~120 ms** | Baixo | P | `EXPLAIN` antes/depois + igualdade das 5 colunas nas 18 vigências (**já feita**) | uma consulta |
| **D3** | `/api/dre/history`: 18 vigências em série, catálogo relido 18× | 447 ms, **50 consultas**, 191 ms SQL + **256 ms fora do banco**, para 1 KB | **PENDENTE** | laço `await` em `historico.ts:77`; catálogo dentro do laço | içar o catálogo; paralelizar com limite | 50 → **~14 consultas**; 447 → **~150 ms** | Médio | M | log do Postgres + p50/p95; **e o teste de 20 usuários, para não estourar o pool** | por função |
| **D4** | 11 endpoints `/candidatos` com 31 consultas cada | 31 consultas para devolver 1–2 KB, ×11 telas | **PENDENTE** | mesma leitura repetida por rubrica | fatorar a leitura comum | 31 → ~8 consultas em 11 telas | Médio | M | idem | por endpoint |
| **D5** | Paginação e limites | `/changes/consolidated` aceita `limit`; 26 das 54 rotas não têm teto | — | — | teto padrão + `limit` onde falta | impede a resposta de 165 KB voltar | Baixo | M | resposta de qualquer rota ≤ 200 KB bruta | por rota |
| **D6** | Pool | 10 conexões; p95 1.163 ms com 20 usuários, vazão trava em **~40 req/s** | **PENDENTE** | saturação é de **CPU**, não de conexões | **não mexer no pool.** Reavaliar só depois de D2–D4 | — | — | — | repetir o teste de concorrência | — |

### Prioridade 5 — Política de rede, explícita

| # | Problema | Evidência local | Evidência no ar | Causa-raiz | Mudança proposta | Ganho esperado | Risco | Esforço | Validação objetiva | Rollback |
|--:|---|---|---|---|---|---|---|---|---|---|
| **B1** | Timeout de 45 s por tentativa, igual para tudo | pendurado: 1ª desistência aos **45,4 s** | **PENDENTE — precisa do p99 real por rota** | um número só para leitura e escrita | teto por classe: leitura interativa **8 s**, leitura pesada 30 s, escrita/importação 120 s | pior caso **238 s → ~73 s** | **Médio — uma leitura legítima longa passa a falhar** | P | medir o p99 real de cada rota **antes** de escolher; nenhuma rota com p99 acima do teto da sua classe | uma constante por classe |
| **B2** | 5 tentativas para tudo que é transitório | 400/1.200/3.600/8.000 = **13,2 s** | **PENDENTE** | `TENTATIVAS_AUTOMATICAS = 5` global | **2 tentativas** em leitura interativa (o usuário está olhando); 5 fica para a casca e o `/build`, que são o caso do cold start | erro visível em ~1,6 s onde hoje leva 13,2 s | Médio | P | o cenário 503: erro em ≤ 3 s numa rota interativa | por classe |
| **B3** | Quais erros repetir | `ehFalhaTransitoria` já exclui 4xx e cancelamento — **está certo** | — | — | **manter.** Acrescentar: nunca repetir o que o usuário pode reler clicando | evita repetição invisível | Baixo | P | teste unitário por classe de erro | — |
| **B4** | Cancelamento ao trocar de rota | zero cancelamentos em 585 medições — as chamadas da rota anterior **continuam** | `medir-no-ar.mjs` — **PENDENTE** | `queryFn` não recebe o `signal` do React Query | passar `ctx.signal` ao `fetch` | a troca de rota para de disputar CPU e pool com a tela que ficou para trás | Baixo | P | trocar de rota no meio de uma chamada: a requisição aparece como cancelada | uma linha |

---

## 5. Os cinco blocos, como você pediu

A tabela do §4 está ordenada por impacto percebido; esta seção é a mesma coisa
agrupada por assunto, para conferir que nada do pedido ficou de fora.

### A. Resposta e estado visual
- **A1** acaba com o esqueleto silencioso durante a repetição — é o item nº 1 do plano inteiro.
- **A4** separa os sete estados: *carregamento inicial · atualizando · vazio · erro · timeout · indisponível · sem permissão*. O produto já tem o vocabulário (`estadoDaProcedencia` distingue seis); falta compartilhá-lo.
- **A3** + **C1** mostram o dado anterior quando há cache, em vez de apagar a tela.
- **A3** impede que um endpoint secundário bloqueie a tela inteira. A regra passa a ser: **cada cartão carrega o seu, e nenhum cartão apaga o vizinho.**

### B. Política de rede
- **B1** timeout por classe (8 s / 30 s / 120 s), no lugar de 45 s para tudo.
- **B2** backoff mantido (400/1.200/3.600/8.000 — está bem calibrado para cold start), mas **2 tentativas** em leitura interativa.
- **B3** quais erros repetir: `ehFalhaTransitoria` já está correto e fica.
- **Quais consultas nunca devem tentar cinco vezes:** toda leitura de tela com alguém olhando. As cinco ficam onde fazem sentido — a casca e o `/build`, que são exatamente o caso do Repl acordando.
- **B4** cancelamento ao trocar de rota ou desmontar.

### C. Cache e revisita
- **C1** `staleTime` por família, com a invalidação que o sustenta — a regra de `frescor-das-leituras.ts` vira a regra do app.
- **C2** `gcTime` explícito.
- **C3** deduplicação (chaves unificadas + janela no `/build`).
- **Invalidação após mutação:** já existe e funciona para as 17 famílias de hoje; C1 estende o mesmo mecanismo, **nunca o `staleTime` sozinho**.
- **C4** chave canônica por empresa, unidade, competência e vigência.
- **Vazamento entre tenants:** C4 é pré-requisito de C1, não item paralelo. Nenhum `staleTime` novo entra antes da chave canônica existir.

### D. Backend e banco
- **D1** consolidar as três consultas de pedágio.
- **D2** a reescrita de 592 → 63 ms.
- **D3** e **D4** round trips: 50 → ~14 e 31 → ~8.
- **Paralelização segura:** com limite de concorrência, e validada pelo teste de 20 usuários — paralelizar sem teto troca latência por esgotamento de pool.
- **D5** limites e paginação.
- **D6** pool: **não mexer.** A saturação medida é de CPU.

### E. Entrega do frontend
- **E2** divisão por rota e carregamento preguiçoso.
- **E1** compressão — a medição que pode reordenar tudo.
- **E4** prefetch **só no hover do menu**, que é onde há sinal de intenção. Sem prefetch especulativo: em 3G ele compete com o que a pessoa está esperando.
- **E3** orçamento máximo: **600 KB gzip** na entrada, 1.200 KB no total, com o CI reprovando.

---

## 6. Metas de aceite

Números de hoje medidos com 1 unidade e 124.632 fatos. Cada linha é um teste,
não uma impressão.

| Cenário | Hoje | Meta | Como se afere |
|---|--:|--:|---|
| **Primeira abertura** (F5, cache vazio, localhost) | 403–904 ms | **≤ 700 ms** | `medir.mjs` recarga, p50 das 65 rotas |
| **Primeira abertura em 4G** | 1.896 ms | **≤ 1.200 ms** | perfil 4G do harness |
| **Primeira abertura em 3G** | 7.727 ms | **≤ 4.000 ms** | perfil 3G |
| **Revisita** (mesma rota, > 60 s depois) | 18–363 ms, **igual à 1ª visita** | **≤ 100 ms e 0 requisições** | `medir-no-ar.mjs` H3, com o intervalo impresso |
| **Troca de rota** (casca visível) | 13–83 ms | **≤ 200 ms**, sem regressão | 65 rotas |
| **Troca de unidade** | **não medido** — o seed tem uma unidade só | **≤ 800 ms, e nenhum número da unidade anterior em tela** | exige 2ª unidade; teste de isolamento por dimensão (C4) |
| **Troca de competência** | `/panorama` 611 ms, 10 chamadas, 3 ondas | **≤ 400 ms, ≤ 7 chamadas, ≤ 2 ondas** | `cenario-troca.mjs` |
| **Endpoint lento** (6 s) | 6 s de esqueleto mudo | **aviso visível em ≤ 3 s**, conteúdo anterior preservado | proxy de atraso + DOM a 250 ms |
| **503** | erro só aos **13.747 ms** | **aviso em ≤ 1 s, erro em ≤ 3 s** | 503 injetado |
| **Endpoint pendurado** | calado por ≥ 58 s; teto ~238 s | **nomeia o que espera em ≤ 3 s; desiste em ≤ 30 s; oferece saída** | endpoint pendurado |
| **Concorrência** | p95 1.163 ms e ~40 req/s com 20 usuários | **p95 ≤ 600 ms e ≥ 80 req/s** | `carga.mjs`, 1/5/10/20 |
| **Endpoints** | 5 de 55 acima de 200 ms (p95) | **nenhum acima de 250 ms**; p95 global < 800 ms | `medir-api.mjs` |
| **Esqueleto indefinido** | **zero** (já cumprido) | **manter zero** | sonda de 40 s nas 65 rotas, no CI |
| **Permissões** | — | **nenhuma regressão** | revogar acesso → a requisição seguinte recusa; suíte de `portao-de-permissao` e `escopo-em-observacao` verde |
| **Isolamento por tenant** | `queryKeyHashFn` cobre o ambiente | **nenhum dado de uma unidade sob a chave de outra** | teste por dimensão: ambiente, operação, `scopeHash`, competência, vigência |
| **Bundle** | 3.866 KB / 1.032 KB gzip, 1 chunk | **≤ 600 KB gzip na entrada** | teto no CI |

**A meta que resume o pedido, e que não é um milissegundo:** em **nenhum** dos
três cenários de defeito o usuário deve ficar mais de **3 segundos** sem saber o
que está acontecendo, e em nenhum deles a tela deve perder o que já tinha
mostrado.

---

## 7. Onde isto para

**Aqui.** Nada das Fases 1–3 foi implementado, e não implemento sem sua
aprovação.

O que preciso de você para destravar a Fase 0 é uma destas três:

1. rodar **o comando do §2** e me mandar o `RELATORIO.md`;
2. me passar a URL do app **e** liberar `*.replit.app` na política de rede desta sessão;
3. rodar do Shell do Replit — é o único lugar de onde a medição API→Neon é de dentro.

Com a saída em mãos eu fecho a árvore de decisão do §3, reordeno o §4 com a
coluna "evidência no ar" preenchida, e volto para a sua aprovação antes de
escrever a primeira linha da Fase 1.
