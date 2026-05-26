const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');

let USER_DATA_PATH, SESSION_PATH, SETTINGS_PATH, MC_DIR, PROFILES_PATH, SERVERS_PATH;

function initPaths() {
  USER_DATA_PATH = path.join(app.getPath('userData'), 'users.json');
  SESSION_PATH   = path.join(app.getPath('userData'), 'session.json');
  SETTINGS_PATH  = path.join(app.getPath('userData'), 'settings.json');
  PROFILES_PATH  = path.join(app.getPath('userData'), 'profiles.json');
  SERVERS_PATH   = path.join(app.getPath('userData'), 'servers.json');
  MC_DIR         = path.join(app.getPath('userData'), 'minecraft');
  ['versions','libraries','assets/indexes','assets/objects','assets/log_configs','profiles','runtime']
    .forEach(d => fs.mkdirSync(path.join(MC_DIR, d), { recursive: true }));
}

// ── Profile helpers ──
function loadProfiles() {
  try { return JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf8')); }
  catch { return { profiles: [], activeProfile: null }; }
}
function saveProfiles(d) { fs.writeFileSync(PROFILES_PATH, JSON.stringify(d, null, 2), 'utf8'); }
function profileDir(id)  { return path.join(MC_DIR, 'profiles', id); }
function profileModsDir(id) { return path.join(profileDir(id), 'mods'); }
function profileRpDir(id)   { return path.join(profileDir(id), 'resourcepacks'); }
function ensureProfileDirs(id) {
  [profileDir(id), profileModsDir(id), profileRpDir(id)].forEach(d => fs.mkdirSync(d, { recursive: true }));
}

const FEATURE_MODS = {
  coords:   ['coordinates-display', 'boxlib'],
  optimize: ['sodium', 'lithium'],
};

function loadSession() {
  try { return JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8')); }
  catch { return null; }
}
function saveSession(s) {
  if (s) fs.writeFileSync(SESSION_PATH, JSON.stringify(s), 'utf8');
  else if (fs.existsSync(SESSION_PATH)) fs.unlinkSync(SESSION_PATH);
}
function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); }
  catch { return { ram: 4, msClientId: '' }; }
}
function saveSettings(s) { fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s), 'utf8'); }

function loadServers() {
  try { return JSON.parse(fs.readFileSync(SERVERS_PATH, 'utf8')); }
  catch { return []; }
}
function saveServersList(s) { fs.writeFileSync(SERVERS_PATH, JSON.stringify(s, null, 2), 'utf8'); }

let splashWin, mainWin;

function createSplash() {
  splashWin = new BrowserWindow({
    width: 900, height: 506, frame: false, resizable: false,
    center: true, backgroundColor: '#000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  splashWin.loadFile('renderer/splash.html');
}

function createMain() {
  mainWin = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 680,
    frame: false, show: false, backgroundColor: '#0d0d14',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    icon: path.join(__dirname, 'assets', 'logo.png'),
  });
  mainWin.loadFile('renderer/launcher.html');
}

app.whenReady().then(() => { initPaths(); createSplash(); createMain(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ── HTTP helpers ──

function fetchData(url, method, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const opts = {
      hostname: u.hostname, port: u.port || undefined,
      path: u.pathname + u.search, method: method || 'GET',
      headers: headers || {}
    };
    if (body) opts.headers['Content-Length'] = Buffer.byteLength(body);
    const req = mod.request(opts, res => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location)
        return fetchData(res.headers.location, method, body, headers).then(resolve).catch(reject);
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function postForm(url, params) {
  const body = new URLSearchParams(params).toString();
  return fetchData(url, 'POST', body, { 'Content-Type': 'application/x-www-form-urlencoded' });
}

function postJson(url, obj, extra) {
  const body = JSON.stringify(obj);
  return fetchData(url, 'POST', body, Object.assign(
    { 'Content-Type': 'application/json', Accept: 'application/json' }, extra));
}

function downloadFile(url, dest) {
  if (fs.existsSync(dest)) return Promise.resolve();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.tmp';
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(tmp);
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, res => {
      if ([301,302,303].includes(res.statusCode) && res.headers.location) {
        file.close(); try { fs.unlinkSync(tmp); } catch {}
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('close', () => { try { fs.renameSync(tmp, dest); resolve(); } catch(e) { try { fs.unlinkSync(tmp); } catch {} reject(e); } });
      file.on('error', e => { try { fs.unlinkSync(tmp); } catch {} reject(e); });
    }).on('error', e => { try { fs.unlinkSync(tmp); } catch {} reject(e); });
  });
}

function downloadFileProgress(url, dest, onProgress) {
  if (fs.existsSync(dest)) { onProgress && onProgress(100); return Promise.resolve(); }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.tmp';
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(tmp);
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, res => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        file.close(); try { fs.unlinkSync(tmp); } catch {}
        return downloadFileProgress(res.headers.location, dest, onProgress).then(resolve).catch(reject);
      }
      const total = parseInt(res.headers['content-length'] || '0');
      let received = 0;
      res.on('data', chunk => {
        received += chunk.length;
        file.write(chunk);
        if (total > 0 && onProgress) onProgress(Math.floor((received / total) * 100));
      });
      res.on('end', () => file.end());
      file.on('close', () => { try { fs.renameSync(tmp, dest); resolve(); } catch(e) { try { fs.unlinkSync(tmp); } catch {} reject(e); } });
      file.on('error', e => { try { fs.unlinkSync(tmp); } catch {} reject(e); });
    }).on('error', e => { try { fs.unlinkSync(tmp); } catch {} reject(e); });
  });
}

function getModsDir()  { return path.join(MC_DIR, 'game', 'mods'); }
function getRpDir()    { return path.join(MC_DIR, 'game', 'resourcepacks'); }

// ── Window IPC ──

ipcMain.handle('splash-ready', () => {
  if (splashWin && !splashWin.isDestroyed()) { splashWin.close(); splashWin = null; }
  if (mainWin && !mainWin.isDestroyed()) { mainWin.show(); mainWin.focus(); }
});
ipcMain.handle('window-minimize', () => { const w = mainWin || splashWin; if (w && !w.isDestroyed()) w.minimize(); });
ipcMain.handle('window-maximize', () => {
  if (!mainWin || mainWin.isDestroyed()) return;
  mainWin.isMaximized() ? mainWin.unmaximize() : mainWin.maximize();
});
ipcMain.handle('window-close', () => app.quit());
ipcMain.handle('navigate', (_, page) => {
  if (mainWin && !mainWin.isDestroyed()) mainWin.loadFile(`renderer/${page}`);
});
ipcMain.handle('open-external', (_, page) => {
  shell.openPath(path.join(__dirname, '..', 'uni-website', `${page}.html`));
});
ipcMain.handle('open-external-url', (_, url) => shell.openExternal(url));

// ── Session / Settings IPC ──

ipcMain.handle('get-session', () => loadSession());
ipcMain.handle('logout', () => {
  saveSession(null);
  if (mainWin && !mainWin.isDestroyed()) mainWin.reload();
});
ipcMain.handle('get-settings', () => loadSettings());
ipcMain.handle('save-settings', (_, data) => {
  saveSettings({ ...loadSettings(), ...data }); return { ok: true };
});

// ── Server IPC ──
ipcMain.handle('get-servers', () => loadServers());
ipcMain.handle('save-server', (_, server) => {
  const servers = loadServers();
  servers.push(server);
  saveServersList(servers);
  return { ok: true };
});
ipcMain.handle('delete-server', (_, idx) => {
  const servers = loadServers();
  servers.splice(idx, 1);
  saveServersList(servers);
  return { ok: true };
});

// ── Microsoft OAuth (Browser Popup Flow) ──

ipcMain.handle('ms-browser-login', async () => {
  // Uses Microsoft Live OAuth endpoint — no custom Azure app required
  const clientId = '00000000402b5328';
  const redirectUri = 'https://login.live.com/oauth20_desktop.srf';
  const scope = 'XboxLive.signin offline_access';
  const authUrl = `https://login.live.com/oauth20_authorize.srf?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&prompt=select_account`;

  const authWin = new BrowserWindow({
    width: 480, height: 680,
    parent: mainWin, modal: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  authWin.setMenuBarVisibility(false);
  authWin.loadURL(authUrl);

  return new Promise((resolve) => {
    let resolved = false;

    const finish = async (url) => {
      if (resolved) return;
      resolved = true;
      try { if (!authWin.isDestroyed()) authWin.close(); } catch {}

      const params = new URL(url).searchParams;
      const code = params.get('code');
      const error = params.get('error');
      if (error || !code) {
        resolve({ ok: false, error: params.get('error_description') || error || '인증 취소됨' });
        return;
      }

      try {
        const token = await postForm('https://login.live.com/oauth20_token.srf', {
          client_id: clientId, grant_type: 'authorization_code',
          code, redirect_uri: redirectUri, scope,
        });
        if (token.error) { resolve({ ok: false, error: token.error_description || token.error }); return; }

        const xbl = await postJson('https://user.auth.xboxlive.com/user/authenticate', {
          Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${token.access_token}` },
          RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT',
        });
        const uhs = xbl.DisplayClaims?.xui?.[0]?.uhs;

        const xsts = await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
          Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
          RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT',
        });
        if (xsts.XErr) {
          const errMap = { 2148916233: 'Xbox 계정이 없습니다.', 2148916238: '미성년자 계정입니다.' };
          resolve({ ok: false, error: errMap[xsts.XErr] || `Xbox 오류 (${xsts.XErr})` }); return;
        }

        const mc = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox',
          { identityToken: `XBL3.0 x=${uhs};${xsts.Token}` });
        if (!mc.access_token) {
          resolve({ ok: false, error: `MC 인증 오류: ${JSON.stringify(mc).slice(0, 300)}` }); return;
        }

        const profile = await fetchData('https://api.minecraftservices.com/minecraft/profile', 'GET', null,
          { Authorization: `Bearer ${mc.access_token}`, Accept: 'application/json' });
        if (!profile.name) {
          resolve({ ok: false, error: `프로필 오류: ${JSON.stringify(profile).slice(0, 300)}` }); return;
        }

        const session = { username: profile.name, uuid: profile.id,
          accessToken: mc.access_token, type: 'microsoft' };
        saveSession(session);
        resolve({ ok: true, session });
      } catch (e) { resolve({ ok: false, error: e.message }); }
    };

    const check = (_, url) => {
      if (typeof url === 'string' && url.startsWith('https://login.live.com/oauth20_desktop.srf')) finish(url);
    };
    authWin.webContents.on('will-redirect', check);
    authWin.webContents.on('will-navigate', check);
    authWin.webContents.on('did-navigate', check);
    authWin.on('closed', () => {
      if (!resolved) { resolved = true; resolve({ ok: false, error: '로그인 창이 닫혔습니다.' }); }
    });
  });
});

// ── Microsoft OAuth (Device Code Flow — legacy) ──

ipcMain.handle('ms-device-code', async () => {
  const { msClientId } = loadSettings();
  if (!msClientId) return { ok: false, error: 'CLIENT_ID_MISSING' };
  try {
    const res = await postForm('https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode',
      { client_id: msClientId, scope: 'XboxLive.signin offline_access' });
    if (res.error) return { ok: false, error: res.error_description || res.error };
    return {
      ok: true,
      device_code: res.device_code,
      user_code: res.user_code,
      verification_uri: res.verification_uri,
      expires_in: res.expires_in,
      interval: res.interval || 5,
    };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('ms-poll-token', async (_, { device_code }) => {
  const { msClientId } = loadSettings();
  try {
    const token = await postForm('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
      client_id: msClientId,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code,
    });
    if (token.error === 'authorization_pending') return { pending: true };
    if (token.error === 'expired_token') return { ok: false, error: '인증 시간이 초과되었습니다.' };
    if (token.error) return { ok: false, error: token.error_description || token.error };

    // Xbox Live
    const xbl = await postJson('https://user.auth.xboxlive.com/user/authenticate', {
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${token.access_token}` },
      RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT',
    });
    const uhs = xbl.DisplayClaims?.xui?.[0]?.uhs;

    // XSTS
    const xsts = await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
      RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT',
    });
    if (xsts.XErr) {
      const errMap = { 2148916233: 'Xbox 계정이 없습니다.', 2148916238: '미성년자 계정입니다.' };
      return { ok: false, error: errMap[xsts.XErr] || `Xbox 오류 (${xsts.XErr})` };
    }

    // Minecraft auth
    const mc = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox',
      { identityToken: `XBL3.0 x=${uhs};${xsts.Token}` });

    // Profile
    const profile = await fetchData('https://api.minecraftservices.com/minecraft/profile', 'GET', null,
      { Authorization: `Bearer ${mc.access_token}`, Accept: 'application/json' });
    if (!profile.name)
      return { ok: false, error: '이 계정으로 마인크래프트를 플레이할 수 없습니다. (게임 미구매)' };

    const session = { username: profile.name, uuid: profile.id,
      accessToken: mc.access_token, type: 'microsoft' };
    saveSession(session);
    return { ok: true, session };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ── Minecraft IPC ──

ipcMain.handle('get-mc-versions', async () => {
  try {
    const manifest = await fetchData('https://launchermeta.mojang.com/mc/game/version_manifest.json');
    const releases = manifest.versions.filter(v => v.type === 'release').slice(0, 20);
    return { ok: true, versions: releases, latest: manifest.latest.release };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ── Profile IPC ──

ipcMain.handle('get-profiles', () => loadProfiles());

ipcMain.handle('save-profile', (_, profile) => {
  const data = loadProfiles();
  const idx = data.profiles.findIndex(p => p.id === profile.id);
  if (idx >= 0) data.profiles[idx] = profile; else data.profiles.push(profile);
  if (!data.activeProfile) data.activeProfile = profile.id;
  saveProfiles(data);
  ensureProfileDirs(profile.id);
  return { ok: true };
});

ipcMain.handle('delete-profile', (_, profileId) => {
  const data = loadProfiles();
  data.profiles = data.profiles.filter(p => p.id !== profileId);
  if (data.activeProfile === profileId) data.activeProfile = data.profiles[0]?.id || null;
  saveProfiles(data);
  return { ok: true };
});

ipcMain.handle('set-active-profile', (_, profileId) => {
  const data = loadProfiles();
  data.activeProfile = profileId;
  saveProfiles(data);
  return { ok: true };
});

ipcMain.handle('get-profile-mods', (_, profileId) => {
  const dir = profileModsDir(profileId);
  try { fs.mkdirSync(dir, { recursive: true }); return fs.readdirSync(dir).filter(f => f.endsWith('.jar')); }
  catch { return []; }
});

ipcMain.handle('get-profile-rps', (_, profileId) => {
  const dir = profileRpDir(profileId);
  try { fs.mkdirSync(dir, { recursive: true }); return fs.readdirSync(dir).filter(f => f.endsWith('.zip')); }
  catch { return []; }
});

ipcMain.handle('remove-profile-mod', (_, { profileId, filename }) => {
  try { fs.unlinkSync(path.join(profileModsDir(profileId), path.basename(filename))); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('remove-profile-rp', (_, { profileId, filename }) => {
  try { fs.unlinkSync(path.join(profileRpDir(profileId), path.basename(filename))); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// ── Modrinth mod installer ──
async function installModrinthMod(slug, mcVersion, destDir) {
  const enc = s => encodeURIComponent(JSON.stringify([s]));
  let versions = await fetchData(
    `https://api.modrinth.com/v2/project/${slug}/version?loaders=${enc('fabric')}&game_versions=${enc(mcVersion)}`
  );
  // Fallback: if no exact version match, use latest fabric build
  if (!Array.isArray(versions) || !versions.length) {
    versions = await fetchData(
      `https://api.modrinth.com/v2/project/${slug}/version?loaders=${enc('fabric')}`
    );
  }
  if (!Array.isArray(versions) || !versions.length) throw new Error(`${slug}: 호환 버전 없음`);
  const file = versions[0].files[0];
  const dest = path.join(destDir, file.filename);
  await downloadFileProgress(file.url, dest, () => {});
  return file.filename;
}

async function installModrinthRp(slug, destDir) {
  const versions = await fetchData(`https://api.modrinth.com/v2/project/${slug}/version`);
  if (!Array.isArray(versions) || !versions.length) throw new Error(`${slug}: 버전 없음`);
  let file = null;
  for (const v of versions) {
    const f = v.files.find(f => f.filename.endsWith('.zip'));
    if (f) { file = f; break; }
  }
  if (!file) throw new Error(`${slug}: 리소스팩 파일 없음`);
  const dest = path.join(destDir, file.filename);
  await downloadFileProgress(file.url, dest, () => {});
  return file.filename;
}

ipcMain.handle('install-profile-mod', async (_, { profileId, slug, mcVersion }) => {
  const dir = profileModsDir(profileId);
  fs.mkdirSync(dir, { recursive: true });
  const send = (msg, pct) => mainWin?.webContents.send('mod-progress', { profileId, slug, msg, pct });
  try {
    send('다운로드 중...', 10);
    const filename = await installModrinthMod(slug, mcVersion, dir);
    send('완료!', 100);
    return { ok: true, filename };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ── Feature mod install/remove ──
ipcMain.handle('toggle-feature-mod', async (_, { profileId, feature, enable, mcVersion }) => {
  const send = (msg, pct) => mainWin?.webContents.send('feature-mod-progress', { feature, msg, pct });

  const slugs = FEATURE_MODS[feature];
  if (!slugs) return { ok: false, error: '알 수 없는 기능' };
  const dir = profileModsDir(profileId);
  fs.mkdirSync(dir, { recursive: true });

  if (enable) {
    send('모드 설치 중...', 5);
    const toInstall = [...slugs];
    // Also install fabric-api as dependency
    if (!toInstall.includes('fabric-api')) toInstall.push('fabric-api');
    for (let i = 0; i < toInstall.length; i++) {
      const slug = toInstall[i];
      send(`${slug} 다운로드 중...`, 10 + (i / toInstall.length) * 85);
      try { await installModrinthMod(slug, mcVersion, dir); } catch {}
    }
    send('설치 완료!', 100);
  } else {
    // Don't remove a mod slug if another active feature in the profile also uses it
    const { profiles } = loadProfiles();
    const prof = profiles.find(p => p.id === profileId);
    const feats = prof?.features || {};
    for (const slug of slugs) {
      const usedByOther = Object.entries(FEATURE_MODS).some(
        ([f, ss]) => f !== feature && ss.includes(slug) && feats[f]
      );
      if (!usedByOther) {
        try {
          fs.readdirSync(dir).filter(f => f.includes(slug)).forEach(f => fs.unlinkSync(path.join(dir, f)));
        } catch {}
      }
    }
  }
  return { ok: true };
});

// ── Fabric install ──
ipcMain.handle('get-fabric-version', async (_, mcVersion) => {
  try {
    const loaders = await fetchData(`https://meta.fabricmc.net/v2/versions/loader/${mcVersion}`);
    if (!Array.isArray(loaders) || !loaders.length) return { ok: false, error: '호환 Fabric 없음' };
    return { ok: true, version: loaders[0].loader.version };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('install-fabric', async (_, { mcVersion, fabricVersion }) => {
  const send = (msg, pct) => mainWin?.webContents.send('fabric-progress', { msg, pct });
  try {
    send('Fabric 메타데이터 가져오는 중...', 10);
    const profileJson = await fetchData(
      `https://meta.fabricmc.net/v2/versions/loader/${mcVersion}/${fabricVersion}/profile/json`
    );
    const vId = profileJson.id || `fabric-loader-${fabricVersion}-${mcVersion}`;
    const vDir = path.join(MC_DIR, 'versions', vId);
    fs.mkdirSync(vDir, { recursive: true });
    fs.writeFileSync(path.join(vDir, `${vId}.json`), JSON.stringify(profileJson), 'utf8');

    send('Fabric 라이브러리 다운로드 중...', 30);
    const libDir = path.join(MC_DIR, 'libraries');
    for (const lib of profileJson.libraries || []) {
      if (!lib.name || !lib.url) continue;
      const [g, a, v] = lib.name.split(':');
      const gp = g.replace(/\./g, '/');
      const jar = `${a}-${v}.jar`;
      const rel = `${gp}/${a}/${v}/${jar}`;
      const dest = path.join(libDir, rel.replace(/\//g, path.sep));
      const base = lib.url.endsWith('/') ? lib.url : lib.url + '/';
      await downloadFile(base + rel, dest);
    }
    send('Fabric 설치 완료!', 100);
    return { ok: true, fabricVersionId: vId };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Simple Voice Chat (profile-based)
ipcMain.handle('install-mod', async (_, { profileId, slug, mcVersion }) => {
  const dir = profileId ? profileModsDir(profileId) : path.join(MC_DIR, 'game', 'mods');
  fs.mkdirSync(dir, { recursive: true });
  const send = (msg, pct) => mainWin?.webContents.send('mod-progress', { modId: slug, msg, pct });
  try {
    send('다운로드 중...', 10);
    await installModrinthMod(slug, mcVersion || '1.21.1', dir);
    send('설치 완료!', 100);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('install-profile-rp', async (_, { profileId, slug }) => {
  const dir = profileRpDir(profileId);
  fs.mkdirSync(dir, { recursive: true });
  const send = (msg, pct) => mainWin?.webContents.send('rp-progress', { profileId, slug, msg, pct });
  try {
    send('다운로드 중...', 10);
    const filename = await installModrinthRp(slug, dir);
    send('완료!', 100);
    return { ok: true, filename };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('remove-mod-by-id', (_, { profileId, prefix }) => {
  const dir = profileId ? profileModsDir(profileId) : path.join(MC_DIR, 'game', 'mods');
  try {
    fs.readdirSync(dir).filter(f => f.startsWith(prefix)).forEach(f => fs.unlinkSync(path.join(dir, f)));
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('get-screenshots', (_, profileId) => {
  const dir = path.join(profileDir(profileId), 'screenshots');
  try {
    fs.mkdirSync(dir, { recursive: true });
    return fs.readdirSync(dir)
      .filter(f => /\.(png|jpg|jpeg)$/i.test(f))
      .map(f => ({ name: f, path: path.join(dir, f) }))
      .sort((a, b) => { try { return fs.statSync(b.path).mtimeMs - fs.statSync(a.path).mtimeMs; } catch { return 0; } });
  } catch { return []; }
});

ipcMain.handle('open-screenshots-folder', (_, profileId) => {
  const dir = path.join(profileDir(profileId), 'screenshots');
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});

ipcMain.handle('check-java', async () => {
  try {
    const { execSync } = require('child_process');
    const out = execSync('java -version 2>&1', { encoding: 'utf8', timeout: 5000 });
    return { ok: true, version: out.split('\n')[0].trim() };
  } catch { return { ok: false }; }
});

let mcProcess = null;

ipcMain.handle('kill-mc', () => {
  if (mcProcess) {
    try { process.kill(mcProcess.pid); } catch {}
    try { mcProcess.kill(); } catch {}
    mcProcess = null;
  }
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('mc-exited', {});
  return { ok: true };
});

function sendProgress(msg, pct) {
  if (mainWin && !mainWin.isDestroyed())
    mainWin.webContents.send('mc-progress', { msg, pct });
}

async function downloadVanilla(versionId) {
  const manifest = await fetchData('https://launchermeta.mojang.com/mc/game/version_manifest.json');
  const vInfo = manifest.versions.find(v => v.id === versionId);
  if (!vInfo) throw new Error(`버전 ${versionId}을 찾을 수 없습니다.`);
  const vDir = path.join(MC_DIR, 'versions', versionId);
  fs.mkdirSync(vDir, { recursive: true });
  const vJsonPath = path.join(vDir, `${versionId}.json`);
  if (!fs.existsSync(vJsonPath)) {
    const vd = await fetchData(vInfo.url);
    fs.writeFileSync(vJsonPath, JSON.stringify(vd), 'utf8');
  }
  return { vJson: JSON.parse(fs.readFileSync(vJsonPath, 'utf8')), vDir };
}

// ── Mojang JRE auto-download ──
async function ensureJre(component, onProgress) {
  const jreDir = path.join(MC_DIR, 'runtime', component);
  const javaExe = path.join(jreDir, 'bin', 'java.exe');
  if (fs.existsSync(javaExe)) return javaExe;

  onProgress('Mojang Java 런타임 목록 가져오는 중...', 0);
  const allJson = await fetchData(
    'https://piston-meta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json'
  );
  const platformKey = process.arch === 'x64' ? 'windows-x64' : 'windows-x86';
  const runtimeList = (allJson[platformKey] || allJson['windows'] || {})[component];
  if (!runtimeList?.length) throw new Error(`Java 런타임 '${component}'를 찾을 수 없습니다.`);

  onProgress('Java 런타임 파일 목록 가져오는 중...', 5);
  const manifest = await fetchData(runtimeList[0].manifest.url);
  const fileEntries = Object.entries(manifest.files || {})
    .filter(([, f]) => f.type === 'file' && f.downloads?.raw?.url);

  for (let i = 0; i < fileEntries.length; i++) {
    const [relPath, file] = fileEntries[i];
    const dest = path.join(jreDir, ...relPath.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await downloadFile(file.downloads.raw.url, dest);
    if (i % 30 === 0) onProgress(`Java 설치 중... (${i}/${fileEntries.length})`, 5 + Math.floor((i / fileEntries.length) * 90));
  }
  onProgress('Java 설치 완료!', 100);
  return javaExe;
}

function filterLibs(libs) {
  return (libs || []).filter(lib => {
    if (!lib.rules) return true;
    return lib.rules.some(r => (r.action === 'allow' && !r.os) || (r.action === 'allow' && r.os?.name === 'windows'))
      && !lib.rules.some(r => r.action === 'disallow' && r.os?.name === 'windows');
  });
}

// Resolve version-JSON JVM/game args (handles strings and conditional rule objects)
function resolveArgs(rawArgs, argMap) {
  const sub = s => typeof s === 'string' ? s.replace(/\$\{([^}]+)\}/g, (m, k) => argMap['${' + k + '}'] ?? m) : s;
  const out = [];
  for (const a of (rawArgs || [])) {
    if (typeof a === 'string') {
      out.push(sub(a));
    } else if (a && typeof a === 'object' && Array.isArray(a.rules)) {
      const allowed = a.rules.every(r => {
        if (r.features) return false;
        const osOk = !r.os || r.os.name === 'windows';
        return r.action === 'allow' ? osOk : !osOk;
      });
      if (allowed) {
        const vals = Array.isArray(a.value) ? a.value : [a.value];
        vals.forEach(v => { if (v != null) out.push(sub(String(v))); });
      }
    }
  }
  return out;
}

ipcMain.handle('launch-mc', async (_, { profileId }) => {
  const session = loadSession();
  if (!session) return { ok: false, error: '로그인이 필요합니다.' };

  const { profiles } = loadProfiles();
  const profile = profiles.find(p => p.id === profileId);
  if (!profile) return { ok: false, error: '프로파일을 찾을 수 없습니다.' };

  const { mcVersion, useFabric, fabricVersionId, ram: profRam } = profile;

  try {
    sendProgress('버전 정보 가져오는 중...', 5);
    const { vJson: vanillaJson, vDir: vanillaDir } = await downloadVanilla(mcVersion);

    // Client jar
    sendProgress('클라이언트 다운로드 중...', 10);
    const jarPath = path.join(vanillaDir, `${mcVersion}.jar`);
    await downloadFile(vanillaJson.downloads.client.url, jarPath);

    // Libraries
    sendProgress('라이브러리 다운로드 중...', 20);
    const libDir = path.join(MC_DIR, 'libraries');
    const nativesDir = path.join(vanillaDir, 'natives');
    fs.mkdirSync(nativesDir, { recursive: true });
    const classpath = [jarPath];

    // If Fabric: load Fabric JSON and merge libs
    let launchJson = vanillaJson;
    let mainClass = vanillaJson.mainClass || 'net.minecraft.client.main.Main';

    if (useFabric && fabricVersionId) {
      const fJsonPath = path.join(MC_DIR, 'versions', fabricVersionId, `${fabricVersionId}.json`);
      if (fs.existsSync(fJsonPath)) {
        const fabricJson = JSON.parse(fs.readFileSync(fJsonPath, 'utf8'));
        mainClass = fabricJson.mainClass || mainClass;
        // Fabric libs first in classpath
        for (const lib of fabricJson.libraries || []) {
          if (!lib.name) continue;
          const [g, a, v] = lib.name.split(':');
          const rel = `${g.replace(/\./g,'/')}/${a}/${v}/${a}-${v}.jar`;
          const dest = path.join(libDir, rel.replace(/\//g, path.sep));
          if (fs.existsSync(dest)) classpath.push(dest);
        }
        launchJson = { ...vanillaJson, arguments: { ...vanillaJson.arguments, jvm: [...(fabricJson.arguments?.jvm || []), ...(vanillaJson.arguments?.jvm || [])] } };
      }
    }

    const libs = filterLibs(vanillaJson.libraries);
    for (let i = 0; i < libs.length; i++) {
      const lib = libs[i];
      if (lib.downloads?.artifact) {
        const { url, path: p } = lib.downloads.artifact;
        const dest = path.join(libDir, p);
        await downloadFile(url, dest);
        classpath.push(dest);
      }
      const nat = lib.downloads?.classifiers?.['natives-windows'] ||
                  lib.downloads?.classifiers?.['natives-windows-64'] ||
                  lib.downloads?.classifiers?.['natives-windows-x86_64'];
      if (nat) {
        const dest = path.join(libDir, nat.path);
        await downloadFile(nat.url, dest);
        try {
          const { execFileSync } = require('child_process');
          const psCmd = [
            'Add-Type -AssemblyName System.IO.Compression.FileSystem;',
            `$z=[System.IO.Compression.ZipFile]::OpenRead('${dest.replace(/'/g,"''")}');`,
            `foreach($e in $z.Entries){if($e.Name -ne ''){`,
            `$dp=[System.IO.Path]::Combine('${nativesDir.replace(/'/g,"''")}', $e.Name);`,
            `[System.IO.Compression.ZipFileExtensions]::ExtractToFile($e,$dp,$true)}}`,
            `$z.Dispose()`,
          ].join(' ');
          execFileSync('powershell.exe', ['-NoProfile', '-Command', psCmd], { stdio: 'ignore', timeout: 30000 });
        } catch {}
      }
      if (i % 8 === 0) sendProgress(`라이브러리 (${i+1}/${libs.length})`, 20 + (i/libs.length)*40);
    }

    // Assets
    sendProgress('에셋 다운로드 중...', 62);
    const ai = vanillaJson.assetIndex;
    const aiPath = path.join(MC_DIR, 'assets', 'indexes', `${ai.id}.json`);
    if (!fs.existsSync(aiPath)) {
      const aid = await fetchData(ai.url);
      fs.writeFileSync(aiPath, JSON.stringify(aid), 'utf8');
    }
    const assetEntries = Object.values(JSON.parse(fs.readFileSync(aiPath,'utf8')).objects || {});
    const CONCUR = 10;
    for (let i = 0; i < assetEntries.length; i += CONCUR) {
      await Promise.all(assetEntries.slice(i, i + CONCUR).map(({ hash }) =>
        downloadFile(`https://resources.download.minecraft.net/${hash.slice(0,2)}/${hash}`,
          path.join(MC_DIR, 'assets', 'objects', hash.slice(0,2), hash))
      ));
      if (i % 100 === 0) sendProgress(`에셋 (${Math.min(i+CONCUR, assetEntries.length)}/${assetEntries.length})`, 62 + (i/assetEntries.length)*23);
    }

    // Java — use Mojang's bundled JRE matching the MC version requirement
    sendProgress('Java 확인 중...', 87);
    const jreComponent = vanillaJson.javaVersion?.component || 'java-runtime-gamma';
    let javaPath;
    try {
      javaPath = await ensureJre(jreComponent, (msg, pct) => sendProgress(msg, 87 + Math.floor(pct * 0.08)));
    } catch (e) {
      // Fall back to system Java
      javaPath = 'java';
      if (process.env.JAVA_HOME) { const j = path.join(process.env.JAVA_HOME,'bin','java.exe'); if (fs.existsSync(j)) javaPath = j; }
    }

    sendProgress('게임 실행 중...', 95);
    const ramMb = (profRam || loadSettings().ram || 4) * 1024;
    const gameDir = profileDir(profileId);
    ensureProfileDirs(profileId);

    // Apply feature settings before launch
    const feats = profile.features || {};
    const optPath = path.join(gameDir, 'options.txt');
    let opts = '';
    try { opts = fs.readFileSync(optPath, 'utf8'); } catch {}
    try {
      const rpDir = profileRpDir(profileId);
      const rpEntries = fs.readdirSync(rpDir).filter(f => {
        if (f.endsWith('.zip')) return true;
        try { return fs.statSync(path.join(rpDir, f)).isDirectory() && fs.existsSync(path.join(rpDir, f, 'pack.mcmeta')); } catch { return false; }
      });
      if (rpEntries.length > 0) {
        let packs = ['vanilla'];
        const rpLine = opts.split('\n').find(l => l.startsWith('resourcePacks:'));
        if (rpLine) { try { packs = JSON.parse(rpLine.slice('resourcePacks:'.length)); } catch {} }
        if (!packs.includes('vanilla')) packs.unshift('vanilla');
        rpEntries.forEach(f => { const e = `file/${f}`; if (!packs.includes(e)) packs.push(e); });
        opts = opts.split('\n').filter(l => !l.startsWith('resourcePacks:') && !l.startsWith('incompatibleResourcePacks:')).join('\n').trimEnd();
        opts += '\nresourcePacks:' + JSON.stringify(packs) + '\n';
        opts += 'incompatibleResourcePacks:' + JSON.stringify(rpEntries.map(f => `file/${f}`)) + '\n';
      }
    } catch {}
    fs.writeFileSync(optPath, opts, 'utf8');


    const gameArgMap = {
      '${auth_player_name}': session.username, '${version_name}': mcVersion,
      '${game_directory}': gameDir, '${assets_root}': path.join(MC_DIR,'assets'),
      '${assets_index_name}': ai.id, '${auth_uuid}': session.uuid||'0',
      '${auth_access_token}': session.accessToken||'0',
      '${user_type}': session.type==='microsoft'?'msa':'legacy',
      '${version_type}': vanillaJson.type||'release',
      '${resolution_width}':'854','${resolution_height}':'480',
      '${user_properties}':'{}','${clientid}':'','${auth_xuid}':'',
    };
    const jvmArgMap = {
      '${natives_directory}': nativesDir,
      '${launcher_name}': 'uni-launcher',
      '${launcher_version}': '1.0',
      '${classpath}': classpath.join(';'),
      '${version_name}': mcVersion,
      '${library_directory}': libDir,
      '${classpath_separator}': ';',
    };

    // Game args (handle conditional objects too)
    const gameArgs = [];
    if (vanillaJson.minecraftArguments) {
      gameArgs.push(...vanillaJson.minecraftArguments.split(' ').map(a => resolveArgs([a], gameArgMap)[0]));
    } else {
      gameArgs.push(...resolveArgs(launchJson.arguments?.game, gameArgMap));
    }

    // JVM args from version JSON — includes critical --add-opens for Java 17+
    let extraJvmArgs = resolveArgs(launchJson.arguments?.jvm, jvmArgMap);
    // Strip args we manage ourselves to avoid duplicates
    const cpIdx = extraJvmArgs.indexOf('-cp');
    if (cpIdx >= 0) extraJvmArgs.splice(cpIdx, 2);
    extraJvmArgs = extraJvmArgs.filter(a =>
      !a.startsWith('-Djava.library.path') &&
      !a.startsWith('-Xmx') && !a.startsWith('-Xms') &&
      !a.startsWith('-Dminecraft.launcher.brand') &&
      !a.startsWith('-Dminecraft.launcher.version')
    );

    const jvmArgs = [
      `-Xmx${ramMb}m`, `-Xms512m`,
      `-Djava.library.path=${nativesDir}`,
      `-Dminecraft.launcher.brand=uni-launcher`,
      `-Dminecraft.launcher.version=1.0`,
      ...extraJvmArgs,
      `-cp`, classpath.join(';'),
      mainClass,
    ];

    const logPath = path.join(gameDir, 'launcher_latest.log');
    let logFd = null;
    try { logFd = fs.openSync(logPath, 'w'); } catch {}
    const child = spawn(javaPath, [...jvmArgs, ...gameArgs], {
      detached: false,
      stdio: logFd !== null ? ['ignore', logFd, logFd] : 'ignore',
      cwd: gameDir,
      windowsHide: true,
    });
    mcProcess = child;
    child.on('close', (code) => {
      if (logFd !== null) { try { fs.closeSync(logFd); } catch {} logFd = null; }
      mcProcess = null;
      if (mainWin && !mainWin.isDestroyed()) {
        let errorSnippet = null;
        if (code !== null && code !== 0) {
          try { errorSnippet = fs.readFileSync(logPath, 'utf8').slice(-3000); } catch {}
          if (!errorSnippet?.trim())
            try { errorSnippet = fs.readFileSync(path.join(gameDir, 'logs', 'latest.log'), 'utf8').slice(-3000); } catch {}
        }
        mainWin.webContents.send('mc-exited', { code, errorSnippet });
      }
    });
    sendProgress('게임이 실행되었습니다!', 100);
    return { ok: true };
  } catch (e) {
    sendProgress(`오류: ${e.message}`, -1);
    return { ok: false, error: e.message };
  }
});
