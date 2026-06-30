# Fluxo completo da API - yt-download

Este documento descreve detalhadamente o fluxo atual da aplicação após a migração para o modelo baseado em jobs (`jobId`) e containers (`Dockerfile.vercel`).

O fluxo foi alterado em relação à implementação inicial.

Antes:

```text
URL do vídeo → identificador do download
```

Agora:

```text
jobId → identificador único do download
```

A API agora funciona como um pequeno sistema assíncrono de processamento de jobs.

---

## Fluxo geral

```text
Frontend
↓
GET /formats
↓
yt-dlp -F
↓
parseFormats()
↓
lista de formatos
↓
Usuário escolhe formato
↓
GET /download-with-code
↓
Gera jobId
↓
yt-dlp inicia download
↓
Arquivo salvo em /tmp/downloads
↓
Map armazena progresso
↓
Frontend consulta /progress
↓
Progress atualizado
↓
Download chega em 100%
↓
Frontend chama /file
↓
Express envia arquivo
↓
removeDownload()
↓
unlink()
↓
Job removido do Map
```

---

## Etapa 1 — Usuário cola URL

Exemplo:

```text
https://www.youtube.com/watch?v=wW1cmqj5eFw
```

Usuário clica:

```text
Get Download Options
```

Nenhum download ocorre nesse momento.

A aplicação apenas consulta os formatos disponíveis.

---

## Etapa 2 — Front chama /formats

No frontend:

```ts
const formats = await getVideoFormats(url);
```

O service chama:

```http
GET /formats?url=https://youtube...
```

Router:

```js
router.get("/formats", downloadController.getFormats);
```

Controller:

```js
const output = await downloadService.getFormats(videoUrl);
const formats = parseFormats(output);

res.json({ formats });
```

---

## Etapa 3 — yt-dlp consulta formatos

Dentro do service:

```js
spawn("yt-dlp", ["--cookies", config.cookiesPath, "-F", videoUrl]);
```

Isso equivale a executar:

```bash
yt-dlp -F "https://youtube..."
```

O parâmetro:

```text
-F
```

significa:

```text
Listar formatos disponíveis
```

Exemplo de saída:

```text
ID EXT RESOLUTION FPS SIZE
140 m4a audio only 4MB
248 webm 1920x1080 30 50MB
137 mp4 1920x1080 30 60MB
```

---

## Etapa 4 — parseFormats limpa a saída

A saída do yt-dlp é texto puro.

O parser transforma:

```text
248 webm 1920x1080 30 50MB
```

em:

```js
{
 code: '248',
 extension: 'webm',
 resolution: '1920x1080',
 fps: 30,
 filesize: '50MB'
}
```

Resultado:

```js
[
  {
    code: "140",
    extension: "m4a",
    resolution: "audio only",
    filesize: "4MB",
  },
  {
    code: "248",
    extension: "webm",
    resolution: "1920x1080",
    fps: 30,
    filesize: "50MB",
  },
];
```

Isso é enviado ao frontend.

---

## Etapa 5 — Front renderiza opções

Exemplo:

```text
MP4      1080p      [Download]
WEBM     720p       [Download]
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
GET /download-with-code?url=...&code=248
```

---

## Etapa 7 — API cria um job

Dentro do service:

```js
const jobId = crypto.randomUUID();
```

Exemplo:

```text
e4c90b4f-c915-41f0-a21f-94ecf8af5a73
```

O download é registrado:

```js
this.downloads.set(jobId, {
  progress: 0,
  outputPath,
  process,
});
```

Estado em memória:

```js
Map {
 'e4c90...' => {
   progress:0,
   outputPath:'/tmp/downloads/video.mp4',
   process:ChildProcess
 }
}
```

Resposta enviada:

```json
{
  "message": "Download started",
  "jobId": "e4c90..."
}
```

---

## Etapa 8 — yt-dlp inicia download real

Comando equivalente:

```bash
yt-dlp \
-f 248 \
-o /tmp/downloads/video.mp4 \
https://youtube...
```

Saída:

```text
[download] 12.5%
[download] 35.2%
[download] 67.8%
```

---

## Etapa 9 — Captura do progresso

O service escuta:

```js
process.stdout.on("data");
```

Captura:

```js
const progressMatch = data.toString().match(/(\d+\.\d+)%/);
```

Atualiza:

```js
this.downloads.set(jobId, {
  progress: 35.2,
  outputPath,
  process,
});
```

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
GET /progress?jobId=e4c90...
```

Controller:

```js
const progress = downloadService.getDownloadProgress(jobId);

res.json({ progress });
```

Resposta:

```json
{
  "progress": 35.2
}
```

---

## Etapa 11 — Front atualiza barra

Exemplo visual:

```text
███████░░░░░░░░░ 35%
```

Conforme o backend responde:

```json
{
  "progress": 50
}
```

```json
{
  "progress": 70
}
```

```json
{
  "progress": 95
}
```

---

## Etapa 12 — Download finalizado

Quando o processo termina:

```js
process.on("close");
```

Atualiza:

```js
this.downloads.set(jobId, {
  progress: 100,
  outputPath,
  process: null,
});
```

---

## Etapa 13 — Front detecta conclusão

Recebe:

```json
{
  "progress": 100
}
```

Executa:

```ts
downloadFile(jobId);
```

---

## Etapa 14 — API envia arquivo

Frontend:

```http
GET /file?jobId=e4c90...
```

Controller:

```js
const filePath = await downloadService.getDownloadFile(jobId);

res.download(filePath);
```

Express envia:

```text
/tmp/downloads/video.mp4
```

para o navegador.

---

## Etapa 15 — Limpeza automática

Após o envio:

```js
await downloadService.removeDownload(jobId);
```

Executa:

```js
await unlink(download.outputPath);
this.downloads.delete(jobId);
```

Estado final:

```js
Map {}
```

Arquivo removido:

```text
/tmp/downloads/video.mp4
```

---

### Resumo arquitetural

A aplicação atualmente funciona como:

```text
Frontend
↓
API
↓
yt-dlp
↓
/tmp/downloads
↓
Map em memória
↓
Polling de progresso
↓
Download final
↓
Limpeza automática
```

Embora seja uma implementação simples para um projeto pessoal, a arquitetura se aproxima de sistemas de fila assíncrona usados em produção:

```text
BullMQ
Redis Jobs
Workers
Queues
Background Processing
```

A diferença é que atualmente os jobs ficam apenas em memória (`Map`) e não em armazenamento persistente.
