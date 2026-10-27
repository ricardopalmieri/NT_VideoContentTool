import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import WebSocket from 'ws';
import { handleBridgeRequest, isLocalBridgeUrl } from '../../src/automation/agent-bridge';
import { createVctApi } from '../../src/automation/window-vct';
import { createProject, type ProjectDocument } from '../../src/model/types';

// Servidor MCP real (stdio) + "página" falsa que usa o window.vct verdadeiro.
const PORT = 47899;
const TOKEN = 'token-de-teste';
const settings = { name: 'MCP', width: 320, height: 180, fps: 10, duration: 10, background: '#000000', transparent: false };

let project: ProjectDocument = createProject(settings);
const api = createVctApi({
  getProject: () => project,
  keyframeTolerance: () => .05,
  confirmConsequential: () => true,
  commitProject: (next) => { project = next; },
  captureFrame: async (time) => ({ time: time ?? 0, width: 2, height: 1, dataUrl: 'data:image/jpeg;base64,AAAA' }),
});

let client: Client;
let page: WebSocket | null = null;

function text(result: Awaited<ReturnType<Client['callTool']>>) {
  return (result.content as Array<{ type: string; text?: string }>).find((item) => item.type === 'text')?.text || '';
}

function openPage(origin: string, token: string) {
  return new Promise<{ socket: WebSocket; welcomed: boolean; closeCode?: number; rejected?: boolean }>((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${PORT}`, 'vct-bridge-1', { origin });
    socket.on('open', () => socket.send(JSON.stringify({ type: 'hello', token, client: 'test', version: '1' })));
    socket.on('message', async (raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === 'welcome') return resolve({ socket, welcomed: true });
      const response = await handleBridgeRequest(api, message);
      if (response) socket.send(JSON.stringify(response));
    });
    socket.on('close', (code) => resolve({ socket, welcomed: false, closeCode: code }));
    socket.on('unexpected-response', () => resolve({ socket, welcomed: false, rejected: true }));
    socket.on('error', () => undefined);
  });
}

beforeAll(async () => {
  client = new Client({ name: 'vct-test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: ['mcp/vct-mcp-server.mjs'],
    env: { ...process.env, VCT_BRIDGE_PORT: String(PORT), VCT_BRIDGE_TOKEN: TOKEN } as Record<string, string>,
    stderr: 'ignore',
  }));
}, 20_000);

afterAll(async () => {
  page?.close();
  await client?.close();
});

describe('servidor MCP local + ponte com a página', () => {
  it('lista as ferramentas vct_*', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'vct_connection_info', 'vct_describe', 'vct_get_timeline', 'vct_dry_run', 'vct_apply', 'vct_undo', 'vct_capture_frame',
    ]));
  });

  it('sem página conectada, responde com instruções de conexão (endereço e código)', async () => {
    const result = await client.callTool({ name: 'vct_get_timeline', arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain(TOKEN);
    expect(text(result)).toContain(`ws://127.0.0.1:${PORT}`);
  });

  it('recusa origem desconhecida e código errado', async () => {
    expect((await openPage('https://exemplo-malicioso.test', TOKEN)).rejected).toBe(true);
    const wrong = await openPage('http://localhost:4174', 'codigo-errado');
    expect(wrong.welcomed).toBe(false);
    expect(wrong.closeCode).toBe(4401);
  });

  it('com a página conectada, aplica lote, lê a timeline e captura quadro', async () => {
    const connection = await openPage('http://localhost:4174', TOKEN);
    expect(connection.welcomed).toBe(true);
    page = connection.socket;
    const info = JSON.parse(text(await client.callTool({ name: 'vct_connection_info', arguments: {} })));
    expect(info.connected).toBe(true);

    const dry = await client.callTool({ name: 'vct_dry_run', arguments: { commands: [
      { type: 'layer.create', layerId: 'titulo', kind: 'text', name: 'Título', startTime: 0, endTime: 2 },
    ] } });
    expect(dry.isError).toBeFalsy();
    expect(project.layers).toHaveLength(0);

    const applied = await client.callTool({ name: 'vct_apply', arguments: { label: 'Título do agente', commands: [
      { type: 'layer.create', layerId: 'titulo', kind: 'text', name: 'Título', startTime: 0, endTime: 2 },
      { type: 'layer.setText', layerId: 'titulo', text: 'Olá, turma' },
    ] } });
    expect(applied.isError).toBeFalsy();
    expect(project.layers.map((layer) => [layer.id, layer.text])).toEqual([['titulo', 'Olá, turma']]);

    const timeline = JSON.parse(text(await client.callTool({ name: 'vct_get_timeline', arguments: {} })));
    expect(timeline.tracks[0].clips[0]).toMatchObject({ id: 'titulo', startTime: 0, endTime: 2 });

    const invalid = await client.callTool({ name: 'vct_apply', arguments: { label: 'Fora', commands: [
      { type: 'clip.move', layerId: 'titulo', startTime: 99 },
    ] } });
    expect(invalid.isError).toBe(true);
    expect(project.layers[0].startTime).toBe(0);

    const frame = await client.callTool({ name: 'vct_capture_frame', arguments: { time: 1, maxWidth: 200 } });
    expect((frame.content as Array<{ type: string; mimeType?: string }>)[0]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' });
  });
});

describe('ponte do lado da página', () => {
  it('só aceita servidor local', () => {
    expect(isLocalBridgeUrl('ws://127.0.0.1:47811')).toBe(true);
    expect(isLocalBridgeUrl('ws://localhost:47811')).toBe(true);
    expect(isLocalBridgeUrl('wss://exemplo.com:47811')).toBe(false);
    expect(isLocalBridgeUrl('http://127.0.0.1:47811')).toBe(false);
  });

  it('recusa métodos fora da lista e responde erro sem lançar', async () => {
    expect(await handleBridgeRequest(api, { type: 'request', id: 1, method: 'getProjectFile' }))
      .toMatchObject({ ok: false, error: expect.stringContaining('não permitido') });
    expect(await handleBridgeRequest(api, { type: 'request', id: 2, method: 'batch', params: {} }))
      .toMatchObject({ ok: false, error: expect.stringContaining('commands') });
  });
});
