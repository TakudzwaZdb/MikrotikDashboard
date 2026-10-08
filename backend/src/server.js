import http from 'http';
import fs from 'fs';
import path from 'path';
import {
  fileURLToPath
} from 'url';

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

import { config } from './config/index.js';

import api from './routes/api.js';

import {
  initSocket
} from './websocket/index.js';

import {
  startPoller
} from './jobs/poller.js';

import { q } from './database/db.js';

const app = express();

/*
 * Render sits behind a reverse proxy.
 */
app.set(
  'trust proxy',
  1
);

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,

      directives: {
        'connect-src': [
          "'self'",
          'ws:',
          'wss:'
        ],

        'upgrade-insecure-requests':
          null
      }
    }
  })
);

app.use(
  cors({
    origin:
      config.corsOrigin
  })
);

app.use(
  express.json({
    limit: '50kb'
  })
);

app.use(
  '/api',
  rateLimit({
    windowMs: 60000,
    limit: 300
  }),
  api
);

app.get(
  '/health',
  (_req, res) => {
    res.json({
      ok: true
    });
  }
);

/*
 * Serve React production build.
 */
const staticDir =
  path.resolve(
    process.env.STATIC_DIR ||
    path.join(
      path.dirname(
        fileURLToPath(
          import.meta.url
        )
      ),
      '../../frontend/dist'
    )
  );

if (
  fs.existsSync(
    path.join(
      staticDir,
      'index.html'
    )
  )
) {

  app.use(
    express.static(
      staticDir,
      {
        maxAge: '1h',
        index: false
      }
    )
  );

  app.get(
    /^\/(?!api|socket\.io|health).*/,
    (_req, res) => {

      res.sendFile(
        path.join(
          staticDir,
          'index.html'
        )
      );
    }
  );
}

const server =
  http.createServer(
    app
  );

/*
 * Render's load balancer reuses connections; Node's default 5 s keep-alive
 * closes them first and causes sporadic 502 errors.
 */
server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;

/* one bad request or socket must never take the whole dashboard down */
process.on('unhandledRejection', e => console.error('Unhandled rejection:', e?.message || e));
process.on('uncaughtException', e => console.error('Uncaught exception:', e?.message || e));

const io =
  initSocket(
    server
  );

app.set(
  'io',
  io
);

server.listen(
  config.port,
  () => {

    console.log(
      `API on :${config.port}`
    );

    /*
     * Make sure host_name exists.
     */
    q(
      'ALTER TABLE devices ADD COLUMN IF NOT EXISTS host_name TEXT'
    )
      .catch(error => {

        console.error(
          'host_name migration failed:',
          error.message
        );

      })
      .finally(() => {

        /*
         * IMPORTANT:
         *
         * Render uses CONNECTOR_MODE=true.
         *
         * Therefore Render does NOT connect
         * directly to 192.168.88.1.
         */
        if (
          config.connectorMode
        ) {

          console.log(
            'CONNECTOR_MODE=true'
          );

          console.log(
            'Direct MikroTik polling disabled - the laptop connector sends the router data.'
          );

          if (!config.connectorToken) {
            console.error(
              'WARNING: CONNECTOR_TOKEN is not set on this server, so the laptop connector ' +
              'can never connect. Set CONNECTOR_TOKEN (same value on the laptop).'
            );
          }

          console.log(
            'Waiting for the laptop connector...'
          );

        } else {

          console.log(
            'Direct MikroTik polling enabled.'
          );

          startPoller(
            io
          );
        }
      });
  });