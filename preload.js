const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('uni', {
  minimize:       ()     => ipcRenderer.invoke('window-minimize'),
  maximize:       ()     => ipcRenderer.invoke('window-maximize'),
  close:          ()     => ipcRenderer.invoke('window-close'),
  getSession:     ()     => ipcRenderer.invoke('get-session'),
  logout:         ()     => ipcRenderer.invoke('logout'),
  navigate:       (p)    => ipcRenderer.invoke('navigate', p),
  splashReady:    ()     => ipcRenderer.invoke('splash-ready'),
  openExternal:   (p)    => ipcRenderer.invoke('open-external', p),
  openExternalUrl:(url)  => ipcRenderer.invoke('open-external-url', url),
  getSettings:    ()     => ipcRenderer.invoke('get-settings'),
  saveSettings:   (d)    => ipcRenderer.invoke('save-settings', d),
  msBrowserLogin: ()     => ipcRenderer.invoke('ms-browser-login'),
  msDeviceCode:   ()     => ipcRenderer.invoke('ms-device-code'),
  msPollToken:    (d)    => ipcRenderer.invoke('ms-poll-token', d),
  getMcVersions:       ()    => ipcRenderer.invoke('get-mc-versions'),
  launchMc:            (d)   => ipcRenderer.invoke('launch-mc', d),
  checkJava:           ()    => ipcRenderer.invoke('check-java'),
  onProgress:          (cb)  => ipcRenderer.on('mc-progress', (_, d) => cb(d)),
  // Profiles
  getProfiles:         ()    => ipcRenderer.invoke('get-profiles'),
  saveProfile:         (p)   => ipcRenderer.invoke('save-profile', p),
  deleteProfile:       (id)  => ipcRenderer.invoke('delete-profile', id),
  setActiveProfile:    (id)  => ipcRenderer.invoke('set-active-profile', id),
  // Per-profile mods/RPs
  getProfileMods:      (id)  => ipcRenderer.invoke('get-profile-mods', id),
  getProfileRps:       (id)  => ipcRenderer.invoke('get-profile-rps', id),
  removeProfileMod:    (d)   => ipcRenderer.invoke('remove-profile-mod', d),
  removeProfileRp:     (d)   => ipcRenderer.invoke('remove-profile-rp', d),
  installProfileMod:   (d)   => ipcRenderer.invoke('install-profile-mod', d),
  // Feature mods
  toggleFeatureMod:    (d)   => ipcRenderer.invoke('toggle-feature-mod', d),
  onFeatureModProgress:(cb)  => ipcRenderer.on('feature-mod-progress', (_, d) => cb(d)),
  // Fabric
  getFabricVersion:    (v)   => ipcRenderer.invoke('get-fabric-version', v),
  installFabric:       (d)   => ipcRenderer.invoke('install-fabric', d),
  onFabricProgress:    (cb)  => ipcRenderer.on('fabric-progress', (_, d) => cb(d)),
  // Mod install
  installMod:          (d)   => ipcRenderer.invoke('install-mod', d),
  removeModById:       (d)   => ipcRenderer.invoke('remove-mod-by-id', d),
  onModProgress:       (cb)  => ipcRenderer.on('mod-progress', (_, d) => cb(d)),
  // RP install
  installProfileRp:    (d)   => ipcRenderer.invoke('install-profile-rp', d),
  onRpProgress:        (cb)  => ipcRenderer.on('rp-progress', (_, d) => cb(d)),
  // Servers
  getServers:          ()    => ipcRenderer.invoke('get-servers'),
  saveServer:          (s)   => ipcRenderer.invoke('save-server', s),
  deleteServer:        (i)   => ipcRenderer.invoke('delete-server', i),
  // MC process control
  killMc:              ()    => ipcRenderer.invoke('kill-mc'),
  onMcExited:          (cb)  => ipcRenderer.on('mc-exited', (_, d) => cb(d)),
  // Screenshots
  getScreenshots:           (id) => ipcRenderer.invoke('get-screenshots', id),
  openScreenshotsFolder:    (id) => ipcRenderer.invoke('open-screenshots-folder', id),
});
