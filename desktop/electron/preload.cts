import { contextBridge, ipcRenderer } from 'electron';
const invoke = (name: string, value?: unknown): Promise<unknown> => ipcRenderer.invoke(name, value);
contextBridge.exposeInMainWorld('desktop', {
  invalidateImage: (id: string) => invoke('image:invalidate', id),
  image: (value: unknown) => invoke('image:read', value),
  wikiImage: (id: string) => invoke('wiki:image', id),
  microphoneSettings: () => invoke('voice:settings'),
  request: (value: unknown) => invoke('api:request', value),
  complianceReminders: () => invoke('compliance:reminders'),
  getServer: () => invoke('connection:get'),
  setServer: (value: unknown) => invoke('connection:set', value),
  accessMode: () => invoke('auth:access-mode'),
  enter: (value: unknown) => invoke('auth:enter', value),
  login: (value: unknown) => invoke('auth:login', value),
  refresh: () => invoke('auth:refresh'),
  logout: () => invoke('auth:logout'),
  printers: () => invoke('printers:list'),
  print: (value: unknown) => invoke('delivery:print', value),
  saveFile: (name: string, data: Uint8Array) => invoke('file:save', { name, data }),
  openExternal: (url: string) => invoke('system:open-external', url),
  getUpdateState: () => invoke('update:get'),
  checkForUpdates: () => invoke('update:check', {}),
  installUpdate: () => invoke('update:install', {}),
  downloadUpdateManually: () => invoke('update:download-manually', {}),
  onUpdateState: (callback: (value: unknown) => void) => {
    ipcRenderer.removeAllListeners('update:state');
    ipcRenderer.on('update:state', (_event, value: unknown) => callback(value));
  },
});
