import * as cdk from 'aws-cdk-lib';
import { SpatialQuizStack } from '../lib/spatial-quiz-stack.js';

const app = new cdk.App();
new SpatialQuizStack(app, 'SpatialQuiz', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'eu-west-2',
  },
  hostPin: process.env.HOST_PIN,
});
