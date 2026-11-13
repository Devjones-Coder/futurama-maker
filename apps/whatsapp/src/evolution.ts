import fs from 'node:fs/promises';
import path from 'node:path';
import { io, Socket } from 'socket.io-client';

export type EvolutionInstance = { id: string; display_name: string; base_url: string; instance_name: string; api_key: string };
export type NormalizedMessage = {
  messageId: string; phone: string; text: string; isGroup: boolean; isStatus: boolean; fromMe: boolean;
  hasVideo: boolean; raw: Record<string, any>;
};

const cleanBase = (value: string) => value.replace(/\/+$/, '');

export class EvolutionClient {
  constructor(private readonly instance: EvolutionInstance) {}

  private async request<T>(endpoint: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${cleanBase(this.instance.base_url)}${endpoint}`, {
      ...init,
      headers: { apikey: this.instance.api_key, 'content-type': 'application/json', ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`EVOLUTION_HTTP_${response.status}`);
    return (body ? JSON.parse(body) : {}) as T;
  }

  async getStatus() {
    try {
      const result = await this.request<any>(`/instance/connectionState/${encodeURIComponent(this.instance.instance_name)}`);
      const state = result?.instance?.state ?? result?.state ?? 'desconhecida';
      return normalizeConnectionState(String(state));
    } catch (error) { return `erro: ${error instanceof Error ? error.message : 'conexão indisponível'}`; }
  }

  async getConnectionQr() {
    return this.request<any>(`/instance/connect/${encodeURIComponent(this.instance.instance_name)}`);
  }

  async connect() { return this.getConnectionQr(); }
  async disconnect() { return this.request<any>(`/instance/logout/${encodeURIComponent(this.instance.instance_name)}`, { method: 'DELETE' }); }

  async downloadIncomingMedia(event: Record<string, any>, destination: string, maxBytes = 500 * 1024 * 1024): Promise<string> {
    const endpoint = `/chat/getBase64FromMediaMessage/${encodeURIComponent(this.instance.instance_name)}`;
    const fetchMedia = (message: Record<string, any>) => this.request<any>(endpoint, {
      method: 'POST', body: JSON.stringify({ message, convertToMp4: false }),
    });
    let media: any;
    try {
      media = await fetchMedia(event);
    } catch (firstError) {
      const key = event?.key;
      if (!key?.id || !/^EVOLUTION_HTTP_(400|500|502|503|504)$/.test((firstError as Error)?.message ?? '')) throw firstError;
      // Evolution can reject the event payload before its stored message is ready.
      // Its media endpoint accepts the message key and resolves the full message itself.
      try {
        media = await fetchMedia({ key });
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        const result = await this.request<any>(`/chat/findMessages/${encodeURIComponent(this.instance.instance_name)}`, {
          method: 'POST', body: JSON.stringify({ where: { key: { id: key.id } } }),
        });
        const records = result?.messages?.records;
        const stored = Array.isArray(records) ? records.find((record: any) => record?.key?.id === key.id && record?.key?.remoteJid === key.remoteJid) : undefined;
        if (!stored?.message) throw firstError;
        media = await fetchMedia({ key: stored.key, message: stored.message });
      }
    }
    const encoded = media?.base64 ?? media?.media?.base64;
    if (!encoded || typeof encoded !== 'string') throw new Error('MEDIA_BASE64_MISSING');
    const base64 = encoded.includes(',') ? encoded.slice(encoded.indexOf(',') + 1) : encoded;
    const bytes = Buffer.from(base64, 'base64');
    if (!bytes.length || bytes.length > maxBytes) throw new Error(bytes.length ? 'VIDEO_TOO_LARGE' : 'MEDIA_EMPTY');
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, bytes);
    return destination;
  }

  async sendText(phone: string, text: string) {
    return this.request<any>(`/message/sendText/${encodeURIComponent(this.instance.instance_name)}`, {
      method: 'POST', body: JSON.stringify({ number: phone, text }),
    });
  }

  async sendVideo(phone: string, filePath: string, caption?: string) {
    const bytes = await fs.readFile(filePath);
    return this.request<any>(`/message/sendMedia/${encodeURIComponent(this.instance.instance_name)}`, {
      method: 'POST', body: JSON.stringify({ number: phone, mediatype: 'video', mimetype: 'video/mp4', media: bytes.toString('base64'), fileName: path.basename(filePath), caption: caption ?? '' }),
    });
  }

  listen(onEvent: (event: any) => void, onStatus: (status: string) => void): () => void {
    const base = cleanBase(this.instance.base_url);
    let socket: Socket;
    let namespaceRetry: NodeJS.Timeout | undefined;
    try {
      socket = io(`${base}/${encodeURIComponent(this.instance.instance_name)}`, {
        transports: ['websocket'], reconnection: true, reconnectionDelay: 1_000, reconnectionDelayMax: 30_000,
        auth: { apikey: this.instance.api_key }, query: { apikey: this.instance.api_key }, extraHeaders: { apikey: this.instance.api_key },
      });
    } catch (error) {
      onStatus(`erro: ${error instanceof Error ? error.message : 'falha ao criar socket'}`);
      return () => {};
    }
    socket.on('connect', () => {
      if (namespaceRetry) clearTimeout(namespaceRetry);
      namespaceRetry = undefined;
    });
    socket.on('connect_error', (error) => {
      // Socket.IO does not automatically retry a rejected namespace. Evolution creates it
      // when the first configured event is emitted, which may happen after this listener starts.
      if (error.message === 'Invalid namespace' && !namespaceRetry) {
        namespaceRetry = setTimeout(() => { namespaceRetry = undefined; socket.connect(); }, 10_000);
        namespaceRetry.unref();
      }
      console.info(`[evolution] websocket ${this.instance.instance_name}: ${error.message === 'Invalid namespace' ? 'namespace indisponível' : 'conexão indisponível'}`);
    });
    const connectionChanged = (payload: any) => {
      const state = payload?.data?.state ?? payload?.data?.instance?.state ?? payload?.state ?? payload?.data?.status;
      if (state) onStatus(normalizeConnectionState(String(state)));
    };
    for (const name of ['connection.update', 'CONNECTION_UPDATE', 'connection-update']) socket.on(name, connectionChanged);
    // Evolution API v2 emits configured events on the per-instance namespace; event payloads carry {event, instance, data}.
    for (const name of ['messages.upsert', 'MESSAGES_UPSERT', 'messages-upsert']) socket.on(name, onEvent);
    return () => { if (namespaceRetry) clearTimeout(namespaceRetry); socket.disconnect(); };
  }
}

export function normalizeConnectionState(state: string) {
  const value = state.toLowerCase();
  if (['open', 'connected', 'online', 'conectada', 'conectado'].includes(value)) return 'conectada';
  if (['close', 'closed', 'disconnected', 'offline', 'desconectada', 'desconectado'].includes(value)) return 'desconectada';
  if (['connecting', 'qr', 'qrcode', 'conectando'].includes(value)) return 'conectando';
  return state;
}

export function normalizeMessage(input: any): NormalizedMessage | null {
  const wrapper = input?.data ? input : { data: input };
  const message = wrapper.data?.key ? wrapper.data : wrapper.data?.message?.key ? wrapper.data.message : wrapper.data?.data?.key ? wrapper.data.data : null;
  if (!message?.key) return null;
  const key = message.key;
  const remote = String(key.remoteJid ?? '');
  const sender = remote.endsWith('@lid') ? String(key.remoteJidAlt ?? key.participant ?? remote) : remote;
  const rawMessage = message.message ?? {};
  const video = rawMessage.videoMessage ?? rawMessage.documentMessage?.mimetype?.startsWith('video/') ?? false;
  const text = rawMessage.conversation ?? rawMessage.extendedTextMessage?.text ?? rawMessage.videoMessage?.caption ?? rawMessage.imageMessage?.caption ?? '';
  return {
    messageId: String(key.id ?? ''), phone: sender.split('@')[0].replace(/\D/g, ''), text: String(text).trim(),
    isGroup: remote.endsWith('@g.us'), isStatus: remote === 'status@broadcast',
    fromMe: Boolean(key.fromMe), hasVideo: Boolean(video), raw: message,
  };
}
