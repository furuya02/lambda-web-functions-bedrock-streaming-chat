// Lambda Web Functions でストリーミングチャットを動かすスタック
// Web Functions の L2 はまだ無いので、L1（CfnWebFunction / CfnWebFunctionRevision / CfnWebFunctionEndpoint）で組む
import * as path from 'node:path'
import { CfnOutput, Fn, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'
import { Construct } from 'constructs'

const PROJECT = 'lambda-web-functions-bedrock-streaming-chat'

export class ChatStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)

    // バケット名だけはグローバルで一意にする必要があるので、サフィックス（既定はアカウント ID）を付ける
    const suffix = this.node.tryGetContext('bucket_suffix') ?? this.account
    // Basic 認証のパスワードは、デプロイ時に -c basic_password=xxx で渡す
    const password = this.node.tryGetContext('basic_password')
    if (!password) throw new Error('-c basic_password=xxx を指定してください')

    // (1) コード置き場。Web Functions はコードを S3 の .zip から読み、バージョニングが必須
    const bucket = new s3.Bucket(this, 'CodeBucket', {
      bucketName: `${PROJECT}-${suffix}`,
      versioned: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true, // cdk destroy で中身（全バージョン）ごと消す
    })

    // Lambda サービスがコードを読めるようにする（このファンクションのリビジョンからの読み込みに限定）
    bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal('lambda.amazonaws.com')],
        actions: ['s3:GetObject', 's3:GetObjectVersion'],
        resources: [bucket.arnForObjects('*')],
        conditions: {
          ArnLike: { 'aws:SourceArn': `arn:aws:lambda:${this.region}:${this.account}:web-function/${PROJECT}/revision/*` },
        },
      }),
    )

    // app/dist（esbuild で 1 ファイルにまとめた index.js）を .zip のまま S3 に置く
    const code = new s3deploy.BucketDeployment(this, 'Code', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../app/dist'))],
      destinationBucket: bucket,
      extract: false, // 展開せず .zip のまま置く
    })

    // (2) 実行ロール。ログの出力と、Bedrock のストリーミング呼び出しを許可する
    const role = new iam.Role(this, 'Role', {
      roleName: `${PROJECT}-role`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
    })
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModelWithResponseStream'],
        // 推論プロファイル（jp.）は国内の別リージョンのモデルにも振り分けるので、リージョンはワイルドカードにする
        resources: [`arn:aws:bedrock:*::foundation-model/*`, `arn:aws:bedrock:*:${this.account}:inference-profile/*`],
      }),
    )

    // (3) Web Function 本体（入れ物）
    const fn = new lambda.CfnWebFunction(this, 'WebFunction', { functionName: PROJECT })

    // (4) リビジョン（コードと設定の不変のスナップショット）
    const revision = new lambda.CfnWebFunctionRevision(this, 'Revision', {
      functionName: fn.ref,
      buildConfig: {
        runtimeConfig: { runtime: 'nodejs24.x' },
        codeConfig: { s3Object: { bucket: bucket.bucketName, key: Fn.select(0, code.objectKeys) } },
      },
      serviceConfig: {
        executionRoleArn: role.roleArn,
        // 既定は 30 秒。ストリーミングは応答を流し終えるまでが 1 リクエストなので、長めにする（最大 900 秒）
        timeoutSeconds: 120,
        environmentVariables: {
          MODEL_ID: 'jp.anthropic.claude-haiku-4-5-20251001-v1:0',
          BASIC_USER: 'user',
          BASIC_PASSWORD: password,
        },
      },
    })
    // コードの配置とバケットポリシーが済んでからリビジョンを作る（作成時に Lambda が S3 の読み取り権限を確認するため）
    revision.node.addDependency(code, bucket.policy!)

    // (5) エンドポイント
    const endpoint = new lambda.CfnWebFunctionEndpoint(this, 'Endpoint', {
      functionName: fn.ref,
      endpointName: 'prod',
      endpointType: 'HomeRegion', // 東京リージョンだけで動かす
      // ブラウザは SigV4 で署名できないので、アプリ側で認証する（Basic 認証）。この設定だけだと誰でも届く点に注意
      authType: 'ApplicationManaged',
      revisionWeights: [{ revisionId: revision.attrRevisionId, weight: 100 }],
      // 費用の上限を抑えるため、流量（秒間リクエスト数）と実行環境の数に上限を付ける
      throttleConfig: { rateLimit: 100 },
      scalingConfig: { maxEnvironments: 2 },
    })

    new CfnOutput(this, 'Url', { value: `https://${endpoint.attrDomainName}/` })
  }
}
