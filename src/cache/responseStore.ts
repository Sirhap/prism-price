export interface ResponseStore {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

let localStore: ResponseStore | undefined;

/** The self-hosted entry point selects its own cache before serving requests. */
export function configureLocalResponseStore(store: ResponseStore): void {
  localStore = store;
}

export function responseStore(): ResponseStore {
  return localStore ?? caches.default;
}
