// Types minimaux de l'environnement Cloudflare Workers utilisés par le serveur (sans dépendance).
interface D1Result<T> {
  results?: T[];
  meta: { changes: number };
}
interface D1PreparedStatement {
  bind(...valeurs: unknown[]): D1PreparedStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<D1Result<T>>;
  run(): Promise<D1Result<unknown>>;
}
interface D1Database {
  prepare(sql: string): D1PreparedStatement;
}
interface KVNamespace {
  get(cle: string, type: 'json'): Promise<unknown>;
  put(cle: string, valeur: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(cle: string): Promise<void>;
}
interface DurableObjectStub {
  fetch(url: string): Promise<Response>;
}
interface DurableObjectNamespace {
  idFromName(nom: string): unknown;
  get(id: unknown): DurableObjectStub;
}
declare module 'cloudflare:workers' {
  export abstract class DurableObject<E = unknown> {
    protected ctx: { storage: { getAlarm(): Promise<number | null>; setAlarm(t: number): Promise<void> } };
    protected env: E;
    constructor(ctx: unknown, env: E);
  }
}
