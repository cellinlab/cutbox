const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (name, input) => {
  const result = await ipcRenderer.invoke(`cutbox:${name}`, input);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
const api = {};
for (const name of ['snapshot', 'capabilities', 'importMedia', 'saveEntity', 'deleteEntity', 'saveAnnotation', 'deleteAnnotation', 'saveCollection', 'exportReference', 'exportPackage', 'importPackage', 'cancelJob']) {
  api[name] = input => invoke(name, input);
}
api.mediaUrl = (id, kind = 'source') => `cutbox-media://asset/${encodeURIComponent(id)}?kind=${kind === 'thumbnail' ? 'thumbnail' : 'source'}`;
api.onJob = callback => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on('cutbox:job', listener);
  return () => ipcRenderer.removeListener('cutbox:job', listener);
};
contextBridge.exposeInMainWorld('cutbox', Object.freeze(api));
