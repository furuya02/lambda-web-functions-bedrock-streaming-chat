import { App } from 'aws-cdk-lib'
import { ChatStack } from '../lib/stack'

const app = new App()
// Web Functions が使えるリージョン（東京）にデプロイする
new ChatStack(app, 'LambdaWebFunctionsBedrockStreamingChat', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'ap-northeast-1' },
})
