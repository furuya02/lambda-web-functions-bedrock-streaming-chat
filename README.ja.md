# lambda-web-functions-bedrock-streaming-chat

AWS Lambda Web Functions で、Amazon Bedrock の応答をストリーミングするチャットを動かすサンプル

[English](README.md)

## 概要

チャット画面（GET /）と API（POST /chat）を、1 つの Hono アプリにして Lambda Web Functions で動かします。
POST /chat は Bedrock の ConverseStream の応答を、届いた順にそのままブラウザへ流します。
Lambda 用のハンドラーやアダプター（Lambda Web Adapter）は使わず、普通の Node.js の HTTP サーバーとして書いています。

```
ブラウザ ─ HTTPS（Basic 認証）─ Lambda Web Functions（Hono）
                                  ├ GET  /      チャット画面（Markdown を描画）
                                  └ POST /chat  ConverseStream の応答をそのまま流す ─ Amazon Bedrock
```

## 機能

- Bedrock の応答をストリーミングで表示（ストリーミングのための追加設定は不要）
- 回答の Markdown をブラウザで描画（marked + DOMPurify）
- クライアントが切断したら、Bedrock の呼び出しも中断
- Basic 認証
- エンドポイントの流量制限（秒間 100 リクエスト、実行環境 2 個まで）
- CDK（L1: CfnWebFunction / CfnWebFunctionRevision / CfnWebFunctionEndpoint）でデプロイ

## 構成

| ディレクトリ | 内容 |
|---|---|
| app/ | Hono アプリ（サーバー: app/src/index.ts、チャット画面: app/src/index.html）。esbuild でサーバーを app/dist/index.js にまとめ、index.html をその隣にコピーする |
| cdk/ | CDK（S3 バケット、実行ロール、Web Function、リビジョン、エンドポイント） |

## 必要要件

- Node.js 22 以上 / pnpm
- AWS 認証情報（東京リージョン ap-northeast-1。CDK のブートストラップ済み）
- Bedrock で `jp.anthropic.claude-haiku-4-5-20251001-v1:0` が使えること
- aws-cdk-lib 2.273.0 以上（Web Functions の L1 が含まれるバージョン）

## 構築手順

```bash
git clone https://github.com/furuya02/lambda-web-functions-bedrock-streaming-chat.git
cd lambda-web-functions-bedrock-streaming-chat

# アプリをビルド（app/dist/index.js と app/dist/index.html が作られる）
pnpm -C app install
pnpm -C app build

# デプロイ（Basic 認証のパスワードを指定。ユーザー名は user）
pnpm -C cdk install
pnpm -C cdk cdk deploy -c basic_password=<パスワード>
```

出力の `Url` を控えます。S3 バケット名のサフィックスは既定でアカウント ID です（`-c bucket_suffix=xxx` で変更できます）。

## 動作確認

### ブラウザ

`Url` を開き、ユーザー名 `user` と指定したパスワードでログインして質問します。回答が少しずつ表示されます。

### curl

```bash
curl -N -u user:<パスワード> -X POST <Url>chat \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":[{"text":"春の季語を5つ"}]}]}'
```

### ローカル

```bash
AWS_REGION=ap-northeast-1 pnpm -C app dev   # http://localhost:3000/（ユーザー名 user / パスワード pass）
```

## 注意

- エンドポイントは ApplicationManaged（アプリ側で認証）なので、URL を知っていれば誰でも届きます。Basic 認証は検証用の最小限の守りです。本番で使う場合は、CloudFront + OAC や別の認証方式を検討してください
- Basic 認証のパスワードは、リビジョンの環境変数と CloudFormation のテンプレート（cdk.out）に平文で入ります
- 使い終わったら、必ず削除してください（Bedrock の呼び出しには費用がかかります）

## 削除

```bash
pnpm -C cdk cdk destroy -c basic_password=<パスワード>
```

## ライセンス

MIT
