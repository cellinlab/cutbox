const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (name, input) => {
  const result = await ipcRenderer.invoke(`cutbox:${name}`, input);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
const api = {};
for (const name of ['saveProduction','deleteProduction','productionAudit','draftShotPrompt','exportProduction','inspectDataset','exportTrainingDataset','discoverAnnotations','installProductionTemplates','importSubtitles']) api[name]=input=>invoke(name,input);
for (const name of ['snapshot', 'capabilities', 'importMedia', 'saveEntity', 'deleteEntity', 'saveAnnotation', 'deleteAnnotation', 'saveCollection', 'exportReference', 'exportPackage', 'importPackage', 'cancelJob','jobs','saveAnnotations','deleteCollection','saveTemplate','deleteTemplate','saveEvent','deleteEvent','saveRelation','deleteRelation','saveStory','deleteStory','undo','redo','history','updateMedia','checkMedia','relinkMedia','createProxy','backupProject','restoreProject','analyzeMedia','exportDataset','modelStatus','modelConfigure','exportStory','findSimilar','searchAnnotations','exportReferences']) {
  api[name] = input => invoke(name, input);
}
api.mediaUrl = (id, kind = 'source') => `cutbox-media://asset/${encodeURIComponent(id)}?kind=${['thumbnail','proxy','original'].includes(kind) ? kind : 'source'}`;
api.onJob = callback => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on('cutbox:job', listener);
  return () => ipcRenderer.removeListener('cutbox:job', listener);
};
contextBridge.exposeInMainWorld('cutbox', Object.freeze(api));
