export {};
declare global {
  interface Window {
    desktop: {
      invalidateImage: (id: string) => Promise<unknown>;
      image: (value: { taskId: string; id: string }) => Promise<unknown>;
      wikiImage: (id: string) => Promise<unknown>;
      request: (value: unknown) => Promise<unknown>;
      complianceReminders: () => Promise<unknown>;
      getServer: () => Promise<unknown>;
      setServer: (value: string) => Promise<unknown>;
      accessMode: () => Promise<unknown>;
      enter: () => Promise<unknown>;
      login: (value: {
        company_code: 'tri' | 'tmy';
        username: string;
        password: string;
      }) => Promise<unknown>;
      refresh: () => Promise<unknown>;
      logout: () => Promise<unknown>;
      printers: () => Promise<unknown>;
      print: (value: {
        printer: string;
        width: number;
        height: number;
        copies: number;
      }) => Promise<unknown>;
      saveFile: (name: string, data: Uint8Array) => Promise<unknown>;
      openExternal: (url: string) => Promise<unknown>;
      getUpdateState: () => Promise<unknown>;
      checkForUpdates: () => Promise<unknown>;
      installUpdate: () => Promise<unknown>;
      downloadUpdateManually: () => Promise<unknown>;
      onUpdateState: (callback: (value: unknown) => void) => void;
    };
  }
}
