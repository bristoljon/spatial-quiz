import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const logGroup = (scope: Construct, id: string) =>
  new logs.LogGroup(scope, id, { retention: logs.RetentionDays.ONE_WEEK, removalPolicy: cdk.RemovalPolicy.DESTROY });

export interface SpatialQuizStackProps extends cdk.StackProps {
  /** Optional PIN required to create a room from /host. */
  hostPin?: string;
}

export class SpatialQuizStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SpatialQuizStackProps = {}) {
    super(scope, id, props);

    // ---- State ------------------------------------------------------------
    const table = new dynamodb.Table(this, 'Table', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ---- WebSocket API ----------------------------------------------------
    const wsApi = new apigwv2.WebSocketApi(this, 'WsApi', { apiName: 'spatial-quiz' });
    const wsStage = new apigwv2.WebSocketStage(this, 'WsStage', { webSocketApi: wsApi, stageName: 'prod', autoDeploy: true });

    const fnDefaults = {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: cdk.Duration.seconds(20),
      bundling: { format: OutputFormat.ESM, target: 'node22', minify: true, sourceMap: true, externalModules: [] as string[] },
      environment: {
        TABLE_NAME: table.tableName,
        WS_ENDPOINT: wsStage.callbackUrl,
        HOST_PIN: props.hostPin ?? '',
        NODE_OPTIONS: '--enable-source-maps',
      },
    };

    // Fires when a question's clock runs out. Kept separate from the socket
    // handler so the state machine and the handler don't reference each other.
    const finalizeFn = new NodejsFunction(this, 'FinalizeFn', {
      ...fnDefaults,
      logGroup: logGroup(this, 'FinalizeLogs'),
      entry: path.join(here, '../lambda/finalize-handler.ts'),
    });

    // ---- Question timer: Wait until fireAt, then finalize -----------------
    const timer = new sfn.StateMachine(this, 'QuestionTimer', {
      stateMachineType: sfn.StateMachineType.EXPRESS,
      queryLanguage: sfn.QueryLanguage.JSONATA,
      timeout: cdk.Duration.minutes(5),
      definitionBody: sfn.DefinitionBody.fromChainable(
        sfn.Wait.jsonata(this, 'WaitForClock', { time: sfn.WaitTime.timestamp('{% $states.input.fireAt %}') })
          .next(tasks.LambdaInvoke.jsonata(this, 'Finalize', {
            lambdaFunction: finalizeFn,
            payload: sfn.TaskInput.fromObject({ code: '{% $states.input.code %}', qIndex: '{% $states.input.qIndex %}' }),
            payloadResponseOnly: true,
          })),
      ),
    });

    const wsFn = new NodejsFunction(this, 'WsHandlerFn', {
      ...fnDefaults,
      logGroup: logGroup(this, 'WsHandlerLogs'),
      entry: path.join(here, '../lambda/ws-handler.ts'),
      environment: { ...fnDefaults.environment, TIMER_ARN: timer.stateMachineArn },
    });

    table.grantReadWriteData(wsFn);
    table.grantReadWriteData(finalizeFn);
    wsStage.grantManagementApiAccess(wsFn);
    wsStage.grantManagementApiAccess(finalizeFn);
    timer.grantStartExecution(wsFn);

    const integration = (name: string) => new WebSocketLambdaIntegration(name, wsFn);
    wsApi.addRoute('$connect', { integration: integration('ConnectIntegration') });
    wsApi.addRoute('$disconnect', { integration: integration('DisconnectIntegration') });
    wsApi.addRoute('$default', { integration: integration('DefaultIntegration') });

    // ---- Static site: S3 + CloudFront -------------------------------------
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const distribution = new cloudfront.Distribution(this, 'Site', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
      // Single-page app: unknown paths (/host, /play) serve index.html.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: cdk.Duration.seconds(0) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: cdk.Duration.seconds(0) },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    // The built site plus a config.json carrying the WebSocket URL, so the
    // front end never needs to be rebuilt to learn where the API lives.
    new s3deploy.BucketDeployment(this, 'DeploySite', {
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
      sources: [
        s3deploy.Source.asset(path.join(here, '../../web/dist')),
        s3deploy.Source.jsonData('config.json', { wsUrl: wsStage.url }),
      ],
    });

    new cdk.CfnOutput(this, 'SiteUrl', { value: `https://${distribution.distributionDomainName}` });
    new cdk.CfnOutput(this, 'HostUrl', { value: `https://${distribution.distributionDomainName}/host` });
    new cdk.CfnOutput(this, 'WebSocketUrl', { value: wsStage.url });
    new cdk.CfnOutput(this, 'TableName', { value: table.tableName });
  }
}
