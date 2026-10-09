import { defineRailway, project, service } from 'railway/iac';
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = 'wedding-be';
export default defineRailway(() => {
  const weddingBe = service('wedding-be', {
    build: { builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile' },
    start: 'node --enable-source-maps --import ./dist/instrumentation.js dist/server.js',
    healthcheck: '/health/ready',
    healthcheckTimeout: 120,
    preDeploy: 'npm run db:migrate:deploy',
    replicas: 1,
    deploy: {
      ipv6EgressEnabled: true,
      restartPolicyMaxRetries: 3,
    },
  });

  const configuration = project('wedđing', {
    resources: [weddingBe],
  });
  // The CLI supports variable policy; the SDK project type does not expose it yet.
  return { ...configuration, variables: { managed: false } };
});
