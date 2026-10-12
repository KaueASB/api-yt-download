# Fluxo completo da API - yt-download

Este documento descreve o fluxo atual da aplicação: jobs identificados por `jobId`, com estado no **Upstash Redis** e arquivos no **Cloudflare R2**, rodando em container na Vercel (`Dockerfile.vercel`).

O fluxo mudou duas vezes em relação à implementação inicial.

Primeira versão:

```text
URL do vídeo → identificador do download
```

Segunda versão:

```text
jobId → Map em memória + arquivo em /tmp
```

Versão atual:

```text
jobId → hash no Redis + arquivo no R2
```

### Por que mudou

Na Vercel podem existir várias instâncias do container ao mesmo tempo, sem garantia de que as requisições caiam sempre na mesma. As instâncias também são desligadas depois de alguns minutos sem tráfego.

Com o `Map` em memória, o `/progress` ou o `/file` podiam chegar a uma instância que nunca viu aquele `jobId`. Agora a API não guarda nada no processo, e qualquer instância responde qualquer requisição.

---

## Fluxo geral

```text
Frontend
↓
GET /api/formats
↓
yt-dlp -J (JSON)
↓
parseFormats()
↓
lista de formatos
↓
Usuário escolhe formato
↓
GET /api/download-with-code
↓
Gera jobId + cria job no Redis
↓
yt-dlp baixa em /tmp/downloads (dentro de waitUntil)
↓
Progresso gravado no Redis
↓
Frontend consulta /api/progress (lê do Redis)
↓
Upload do arquivo para o R2
↓
Job marcado como "done" (100%)
↓
Frontend chama /api/file
↓
Redirect para URL assinada do R2
↓
Navegador baixa direto do R2
↓
Arquivo local já foi apagado; R2 e Redis expiram em 1 dia
```

---

## Peças da arquitetura

| Peça | Responsabilidade |
|---|---|
| Vercel (container) | Roda a API, o yt-dlp e o ffmpeg, e faz o upload para o R2 |
| Upstash Redis | Estado dos jobs (`status`, `progress`, `error`, `key`, `filename`) |
| Cloudflare R2 | Arquivos prontos, entregues direto ao navegador |
| `/tmp/downloads` | Rascunho só durante o job: trilhas separadas, merge do ffmpeg e upload |

---

## Etapa 1 — Usuário cola URL

Exemplo:

```text
https://www.youtube.com/watch?v=jNQXAC9IVRw
```

Usuário clica:

```text
Get Download Options
```

Nenhum download ocorre nesse momento. A aplicação apenas consulta os formatos disponíveis.

---

## Etapa 2 — Front chama /api/formats

No frontend:

```ts
const formats = await getVideoFormats(url);
```

Request:

```http
GET /api/formats?url=https://youtube...
```

Router (montado em `/api` no `server.js`):

```js
router.get('/formats', downloadController.getFormats);
```

Controller:

```js
const info = await downloadService.getVideoInfo(videoUrl);
const formats = parseFormats(info);

res.json({ formats });
```

---

## Etapa 3 — yt-dlp consulta formatos em JSON

Dentro do service:

```js
spawn('yt-dlp', [...cookieArgs, '-J', '--no-playlist', videoUrl]);
```

Equivale a:

```bash
yt-dlp -J --no-playlist "https://youtube..."
```

- `-J` devolve todas as informações do vídeo em **JSON**: título, duração e a lista `formats`, com codec, resolução, fps e tamanho de cada formato.
- `--no-playlist` garante que uma URL com `&list=...` traga só o vídeo, e não a playlist inteira.

Antes era usado `-F`, que devolve uma tabela em texto e precisava ser interpretada com regex.

---

## Etapa 4 — parseFormats filtra e formata

O parser percorre `info.formats` e:

- descarta storyboards (imagens, sem áudio nem vídeo);
- descarta duplicatas de áudio `-drc`;
- descarta formatos sem tamanho conhecido (em geral streams m3u8);
- formata o tamanho igual ao yt-dlp (`5.16MiB`).

Resultado:

```js
[
  {
    code: "140",
    extension: "m4a",
    resolution: "audio only",
    filesize: "302.04KiB",
  },
  {
    code: "134",
    extension: "mp4",
    resolution: "320x240",
    fps: 15,
    filesize: "314.82KiB",
  },
];
```

O formato da resposta é o mesmo da versão anterior, então o frontend não precisou mudar.

---

## Etapa 5 — Front renderiza opções

Exemplo:

```text
MP4      720p       [Download]
WEBM     360p       [Download]
M4A      Audio      [Download]
```

Até aqui:

```text
Nenhum arquivo foi baixado
```

---

## Etapa 6 — Usuário inicia download

Ao clicar:

```ts
handleDownload(format.code);
```

Frontend executa:

```ts
const jobId = await startVideoDownload(url, formatId);
```

Que chama:

```http
GET /api/download-with-code?url=...&code=134
```

---

## Etapa 7 — API cria o job no Redis

O service confere se o código existe na lista de formatos e gera o id:

```js
const jobId = crypto.randomUUID();
```

O job é criado no Redis como um hash com expiração de 24h:

```js
await redis.hset(`job:${jobId}`, {
  status: 'downloading',
  progress: 0,
  url: videoUrl,
  filename: 'Me at the zoo.mp4',
});
await redis.expire(`job:${jobId}`, 60 * 60 * 24);
```

Estado no Redis:

```text
job:e4c90b4f-...  →  status=downloading  progress=0  url=...  filename=Me at the zoo.mp4
```

O processamento começa em segundo plano:

```js
waitUntil(this.runJob(jobId, commandArgs, outputPath));
```

Na Vercel, o `waitUntil` mantém a instância viva até o job terminar. Fora da Vercel ele não faz nada, e o job roda normalmente.

Resposta enviada imediatamente:

```json
{
  "message": "Download started",
  "jobId": "e4c90..."
}
```

---

## Etapa 8 — yt-dlp baixa em /tmp

Comando equivalente, para um código de vídeo:

```bash
yt-dlp \
-f 134+bestaudio/best \
--merge-output-format mp4 \
-o /tmp/downloads/<jobId>.mp4 \
https://youtube...
```

Para um código de áudio, o yt-dlp converte para mp3 (`-x --audio-format mp3`).

O `/tmp/downloads` é só rascunho. Ali o yt-dlp baixa vídeo e áudio separados, e o ffmpeg junta os dois. Todos os arquivos do job começam com o `jobId`, o que facilita apagá-los no final.

### Cookies (opcional)

Com `YTDLP_USE_COOKIES=true`, os cookies vêm de `YTDLP_COOKIES_BASE64` (na Vercel) ou de `src/cookies.txt` (local).

Cada execução recebe uma **cópia temporária** (`<id>.cookies.txt`). O yt-dlp reescreve o arquivo de cookies que recebe, e isso estragava os cookies exportados.

---

## Etapa 9 — Captura do progresso

O service escuta a saída do yt-dlp:

```js
ytDlpProcess.stdout.on('data', ...);
```

Captura:

```js
const match = text.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
```

E grava no Redis, **no máximo a cada 2 segundos** para caber no plano gratuito do Upstash:

```js
jobStore.update(jobId, { progress: 35.2 });
```

O progresso fica limitado a 99 até o arquivo estar no R2.

---

## Etapa 10 — Front consulta progresso

O frontend faz polling:

```ts
setInterval(async () => {
  await getDownloadProgress(jobId);
}, 1000);
```

Request:

```http
GET /api/progress?jobId=e4c90...
```

Controller, que lê do Redis e funciona em qualquer instância:

```js
const job = await downloadService.getJob(jobId);

res.json({ progress: job.progress, status: job.status });
```

Resposta:

```json
{
  "progress": 35.2,
  "status": "downloading"
}
```

Respostas possíveis:

| Situação | HTTP | Corpo |
|---|---|---|
| Baixando | 200 | `{ "progress": 35.2, "status": "downloading" }` |
| Enviando para o R2 | 200 | `{ "progress": 99, "status": "uploading" }` |
| Pronto | 200 | `{ "progress": 100, "status": "done" }` |
| Falhou | 500 | `{ "progress": -1, "error": "ERROR: [youtube] ...: Private video" }` |
| Job não existe | 404 | `{ "error": "Download not found" }` |

---

## Etapa 11 — Front atualiza barra

Exemplo visual:

```text
███████░░░░░░░░░ 35%
```

---

## Etapa 12 — Upload para o R2

Quando o yt-dlp termina com sucesso:

```js
await jobStore.update(jobId, { status: 'uploading', progress: 99 });

await storage.uploadFile(`downloads/${jobId}.mp4`, finalPath);

await jobStore.update(jobId, {
  status: 'done',
  progress: 100,
  key: `downloads/${jobId}.mp4`,
});
```

O upload é multipart e lê o arquivo do disco em streaming, então vídeos grandes nunca ficam inteiros na memória.

Em seguida, todos os arquivos locais do job são apagados, tanto no sucesso quanto na falha:

```js
await this.removeLocalFiles(jobId);
```

Se algo falhar (yt-dlp, upload, disco), o erro real fica salvo no job:

```js
await jobStore.update(jobId, { status: 'error', progress: -1, error: error.message });
```

---

## Etapa 13 — Front detecta conclusão

Recebe:

```json
{
  "progress": 100,
  "status": "done"
}
```

Executa:

```ts
downloadFile(jobId);
```

Que abre o `/api/file` num iframe escondido.

---

## Etapa 14 — API redireciona para o R2

Request:

```http
GET /api/file?jobId=e4c90...
```

Controller:

```js
const downloadUrl = await downloadService.getDownloadUrl(job);

res.redirect(downloadUrl);
```

A API gera uma **URL assinada** do R2, válida por 1 hora, que já define o nome do arquivo baixado:

```text
Content-Disposition: attachment; filename="Me at the zoo.mp4"
```

O navegador baixa o arquivo **direto do R2**. A Vercel não transfere o vídeo, o que evita o limite de 4,5 MB por resposta, e o egress do R2 é gratuito.

Se o job ainda não terminou, a resposta é `409 File is not ready yet`.

---

## Etapa 15 — Limpeza automática

Não existe mais rotina de limpeza no código:

| O quê | Quando some |
|---|---|
| Arquivos em `/tmp/downloads` | No fim de cada job, inclusive em falha |
| Job no Redis | TTL de 24h |
| Arquivo no R2 | Regra de ciclo de vida do bucket: prefixo `downloads/`, apagar após 1 dia |

A regra do R2 precisa ser configurada no painel da Cloudflare. Sem ela, os arquivos nunca são apagados.

---

### Resumo arquitetural

```text
Frontend
↓
API na Vercel (stateless)
↓
yt-dlp + ffmpeg em /tmp (rascunho)
↓
Upload para o R2
↓
Estado no Upstash Redis
↓
Polling de progresso (qualquer instância)
↓
Redirect para URL assinada do R2
↓
Expiração automática (Redis TTL + lifecycle do R2)
```

A arquitetura segue o modelo de fila assíncrona, com o estado fora do processo:

```text
Job ID → Redis (estado) → Storage externo (resultado) → Polling
```

### Limitações conhecidas

- **Tempo máximo na Vercel:** o job inteiro (download e upload) precisa terminar dentro do limite da função, que é 300s no Hobby e 800s no Pro.
  - Se isso virar problema, o próximo passo é mover o download para um worker fora da Vercel.
  - O worker leria a fila do Redis e reaproveitaria quase todo o `downloadService`.
- **Bloqueio do YouTube a IPs de datacenter:** se acontecer, ative os cookies (`YTDLP_USE_COOKIES=true`).
- **Ainda não confirmado na Vercel:** o comportamento do `waitUntil` e o espaço disponível em `/tmp` dentro do container.
