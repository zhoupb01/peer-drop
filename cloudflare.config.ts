import { bindings, defineConfig, exports } from 'cf/config';

const workerName = 'peer-drop';

export default defineConfig(({ mode }) => ({
  accountId: '2e481bb6133d64d883c5515efe3edaa5',
  worker: {
    name: workerName,
    compatibilityDate: '2026-08-18',
    compatibilityFlags: ['nodejs_compat'],
    entrypoint: 'src/worker.js',
    exports: {
      Room: exports.durableObject({ storage: 'sqlite' }),
    },
    env: {
      ROOMS: bindings.durableObject({ worker: workerName, exportName: 'Room' }),
      API_WRITE_LIMIT: bindings.rateLimit({
        namespace: '7300',
        simple: { limit: 10, period: 60 },
      }),
      API_READ_LIMIT: bindings.rateLimit({
        namespace: '7301',
        simple: { limit: 120, period: 60 },
      }),
      ASSETS: bindings.assets(),
      ROOM_TTL_MS: bindings.text(mode === 'smoke' ? '5000' : '600000'),
      TURN_KEY_ID: bindings.secret(),
      TURN_KEY_API_TOKEN: bindings.secret(),
    },
    assets: {
      notFoundHandling: 'single-page-application',
      runWorkerFirst: ['/api/*'],
    },
    domains: ['drop.zhoupb.com'],
    workersDev: false,
    previewUrls: false,
    observability: {
      enabled: true,
      logs: {
        enabled: true,
        headSamplingRate: 1,
        invocationLogs: true,
      },
    },
  },
}));
