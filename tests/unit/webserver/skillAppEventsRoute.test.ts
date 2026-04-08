/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import type { RequestHandler } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSessionForToken, mockSubscribeToEvents, mockUnsubscribe, mockEmitEvent } = vi.hoisted(() => ({
  mockGetSessionForToken: vi.fn(),
  mockSubscribeToEvents: vi.fn(),
  mockUnsubscribe: vi.fn(),
  mockEmitEvent: vi.fn(),
}));

vi.mock('@process/services/database', () => ({
  getDatabase: vi.fn(),
}));

vi.mock('@process/utils/initStorage', () => ({
  getSystemDir: vi.fn().mockReturnValue({ cacheDir: '/tmp/cache' }),
  ProcessConfig: {
    get: vi.fn().mockResolvedValue(false),
    set: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@process/webserver/auth/middleware/TokenMiddleware', () => ({
  TokenMiddleware: {
    validateToken: vi
      .fn()
      .mockReturnValue((_req: express.Request, _res: express.Response, next: express.NextFunction) => next()),
  },
}));

vi.mock('@process/extensions', () => ({
  ExtensionRegistry: {
    getInstance: vi.fn().mockReturnValue({
      getWebuiContributions: vi.fn().mockReturnValue([]),
      getLoadedExtensions: vi.fn().mockReturnValue([]),
    }),
  },
}));

vi.mock('@process/bridge/services/SpeechToTextService', () => ({
  SpeechToTextService: {
    transcribe: vi.fn().mockResolvedValue({ text: 'transcribed text' }),
  },
}));

vi.mock('@process/bridge/pptPreviewBridge', () => ({
  isActivePreviewPort: vi.fn().mockReturnValue(false),
}));

vi.mock('@process/bridge/officeWatchBridge', () => ({
  isActiveOfficeWatchPort: vi.fn().mockReturnValue(false),
}));

vi.mock('@process/services/skillapp', () => ({
  pocketBaseProvider: {
    getSessionForToken: mockGetSessionForToken,
  },
  skillAppRuntime: {
    emitEvent: mockEmitEvent,
    subscribeToEvents: mockSubscribeToEvents,
  },
  extractCollectionNameFromPocketBasePath: vi.fn(),
}));

vi.mock('../middleware/security', () => ({
  apiRateLimiter: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

vi.mock('../directoryApi', () => ({
  default: vi.fn(),
}));

vi.mock('./weixinLoginRoutes', () => ({
  registerWeixinLoginRoutes: vi.fn(),
}));

function getGetRouteHandler(app: express.Express, routePath: string): RequestHandler {
  const layer = app.router.stack.find(
    (entry: {
      route?: { path?: string; methods?: Record<string, boolean>; stack?: Array<{ handle: RequestHandler }> };
    }) => entry.route?.path === routePath && entry.route?.methods?.get
  );

  return layer?.route?.stack?.at(-1)?.handle as RequestHandler;
}

describe('SkillApp event stream route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubscribeToEvents.mockReturnValue(mockUnsubscribe);
    mockGetSessionForToken.mockReturnValue({
      session: { workspace: '/workspace/demo' },
      scopedToken: { conversationId: 'conv-1' },
    });
  });

  it('opens an SSE stream and forwards matching SkillApp events', async () => {
    const { registerApiRoutes } = await import('../../../src/process/webserver/routes/apiRoutes');
    const app = express();
    registerApiRoutes(app);

    const handler = getGetRouteHandler(app, '/api/skillapps/:appId/events');
    let closeHandler: (() => void) | undefined;
    let subscribedListener: ((event: unknown) => void) | undefined;
    mockSubscribeToEvents.mockImplementation((_filter, listener) => {
      subscribedListener = listener;
      return mockUnsubscribe;
    });

    const req = {
      params: { appId: 'todo' },
      query: { token: 'token-1' },
      method: 'GET',
      header: vi.fn((name: string) => {
        if (name === 'origin') return 'http://127.0.0.1:53598';
        return undefined;
      }),
      on: vi.fn((event: string, listener: () => void) => {
        if (event === 'close') {
          closeHandler = listener;
        }
      }),
    } as unknown as express.Request;

    const res = {
      writableEnded: false,
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    } as unknown as express.Response;

    handler(req, res, vi.fn());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockSubscribeToEvents).toHaveBeenCalledWith(
      {
        appId: 'todo',
        conversationId: 'conv-1',
        workspace: '/workspace/demo',
      },
      expect.any(Function)
    );
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream; charset=utf-8');
    expect(res.write).toHaveBeenCalledWith(': connected\n\n');

    subscribedListener?.({
      id: 'evt-1',
      appId: 'todo',
      conversationId: 'conv-1',
      workspace: '/workspace/demo',
      type: 'STATE_DELTA',
      timestamp: Date.now(),
      payload: { action: 'todo.updated', origin: 'agent' },
      summary: 'TODO updated',
    });

    expect(res.write).toHaveBeenCalledWith(expect.stringContaining('"action":"todo.updated"'));

    closeHandler?.();

    expect(mockUnsubscribe).toHaveBeenCalledOnce();
    expect(res.end).toHaveBeenCalledOnce();
  });
});
