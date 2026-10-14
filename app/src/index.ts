// Lambda Web Functions で動かすストリーミングチャット
// - Lambda 用のハンドラーやアダプター（LWA）は使わず、普通の Hono アプリとしてポートで待ち受ける
// - GET / でチャット画面（HTML）を返し、POST /chat で Bedrock の応答をそのまま流す。画面と API が 1 つのアプリ
import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'
import { streamText } from 'hono/streaming'
import { serve } from '@hono/node-server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { BedrockRuntimeClient, ConverseStreamCommand, type Message } from '@aws-sdk/client-bedrock-runtime'

// チャット画面（index.html）は、起動時に 1 回だけ読み込んでおく
const HTML = readFileSync(path.join(__dirname, 'index.html'), 'utf8')

const MODEL_ID = process.env.MODEL_ID ?? 'jp.anthropic.claude-haiku-4-5-20251001-v1:0'

// Bedrock のクライアントは実行環境ごとに 1 つ作り、同時に来たリクエストで使い回す
const bedrock = new BedrockRuntimeClient({})

const app = new Hono()

// エンドポイントは ApplicationManaged（アプリ側で認証）なので、誰でも届く。Basic 認証で守る
app.use('*', basicAuth({ username: process.env.BASIC_USER ?? 'user', password: process.env.BASIC_PASSWORD ?? 'pass' }))

// チャット画面
app.get('/', (c) => c.html(HTML))

// Bedrock の応答を、届いた順にそのままクライアントへ流す
app.post('/chat', async (c) => {
  const { messages } = await c.req.json<{ messages: Message[] }>()

  return streamText(c, async (stream) => {
    // クライアントが切断したら、Bedrock の呼び出しも止める（止めないと、誰も読まない回答の生成が続く）
    const ac = new AbortController()
    stream.onAbort(() => ac.abort())

    const start = Date.now()
    let outputTokens = 0
    try {
      const res = await bedrock.send(new ConverseStreamCommand({ modelId: MODEL_ID, messages }), { abortSignal: ac.signal })
      for await (const event of res.stream ?? []) {
        // 文字の断片（delta）が届いたら、すぐに書き出す
        const text = event.contentBlockDelta?.delta?.text
        if (text) await stream.write(text)
        // 最後に届くメタデータからトークン数を拾う（ログ用）
        if (event.metadata) outputTokens = event.metadata.usage?.outputTokens ?? 0
      }
    } finally {
      // 検証用のログ。aborted が true なら、途中で切断されて Bedrock の呼び出しを止めたことを表す
      console.log(JSON.stringify({ aborted: ac.signal.aborted, ms: Date.now() - start, outputTokens }))
    }
  })
})

// Lambda が待ち受け先を AWS_LAMBDA_HTTP_ENDPOINT（host:port）で渡してくる。ローカルでは 3000 番で待ち受ける
const [hostname, port] = (process.env.AWS_LAMBDA_HTTP_ENDPOINT ?? 'localhost:3000').split(':')
serve({ fetch: app.fetch, hostname, port: Number(port) }, () => console.log(`listening on ${hostname}:${port}`))
