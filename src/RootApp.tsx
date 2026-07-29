import { ArrowRight, Carrot, Check, Code2, Download, HardDrive, Image, Layers3, LockKeyhole, Monitor, MonitorSmartphone, ShieldCheck, Smartphone, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import App from './App';
import { AuthProvider } from './auth/AuthProvider';
import { useAuth } from './auth/authContext';
import { isDesktopApp } from './auth/supabase';
import { BrandLockup } from './components/BrandLockup';
import './Shell.css';

type AuthMode = 'login' | 'register' | 'forgot' | 'reset';

function getRoute() {
  const route = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  if (route === 'editor') return 'editor';
  if (route === 'login' || route === 'register' || route === 'forgot' || route === 'reset') return route;
  return isDesktopApp ? 'editor' : 'home';
}

function navigate(route: string) {
  if (route === 'editor') {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) activeElement.blur();
    window.scrollTo(0, 0);
  }
  window.location.hash = `#/${route}`;
}

function useRoute() {
  const [route, setRoute] = useState(getRoute);
  useEffect(() => {
    const update = () => setRoute(getRoute());
    window.addEventListener('hashchange', update);
    if (isDesktopApp && !window.location.hash) navigate('editor');
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return route;
}

function LandingPage() {
  const repository = import.meta.env.VITE_GITHUB_REPOSITORY || 'OWNER/dongni-market-studio';
  const windowsInstallerUrl = repository.startsWith('OWNER/')
    ? 'https://github.com/'
    : `https://github.com/${repository}/releases/latest/download/Dongni-Market-Studio-Setup-x64.exe`;
  return (
    <main className="public-site">
      <nav className="public-nav">
        <button type="button" className="public-brand" onClick={() => navigate('')}><BrandLockup fixedLight /></button>
        <div><a href={windowsInstallerUrl}><Download size={14} />下载 Windows 版</a><button type="button" onClick={() => navigate('editor')}>打开网页版 <ArrowRight size={14} /></button></div>
      </nav>
      <section className="public-hero">
        <div className="public-hero-copy">
          <span className="public-kicker"><i />本地优先的专业图片编辑器</span>
          <h1>让复杂图片处理，<br />回到你的设备里。</h1>
          <p>抠图、图层、画板、滤镜、PSD与批量工作流。原图保存在本机，登录后即可在网页或Windows版本中使用。</p>
          <div className="public-hero-actions"><button type="button" onClick={() => navigate('editor')}>登录使用网页版 <ArrowRight size={16} /></button><a href={windowsInstallerUrl}><Download size={16} />获取 Windows 安装版</a></div>
          <div className="public-trust"><span><ShieldCheck size={14} />图片不上传</span><span><Check size={14} />免费使用</span><span><LockKeyhole size={14} />账号登录保护</span></div>
          <section className="public-version-guide" aria-label="网页版与 Windows 版设备限制">
            <header><strong>先看设备限制</strong><span>大文件优先使用 Windows 版</span></header>
            <article>
              <Smartphone size={16} />
              <div><strong>手机网页版</strong><span>建议 6GB 内存，最高 16MP；低内存手机会自动降低预览清晰度。</span></div>
            </article>
            <article>
              <Monitor size={16} />
              <div><strong>桌面网页版</strong><span>建议 8GB 内存，最高 50MP；受浏览器内存和本地存储配额限制。</span></div>
            </article>
            <article className="recommended">
              <HardDrive size={16} />
              <div><strong>Windows 版</strong><span>不受网页 16MP/50MP 限制，可处理更大文件与更多画板；实际上限取决于电脑内存和磁盘。</span></div>
            </article>
          </section>
        </div>
        <div className="public-product-card" aria-label="产品功能预览">
          <div className="product-window-bar"><span /><span /><span /><small className="product-mini-brand"><b>东尼菜市场</b><em>STUDIO</em></small></div>
          <div className="product-window-body">
            <aside><Carrot size={21} /><Image size={18} /><Sparkles size={18} /><Layers3 size={18} /></aside>
            <div className="product-canvas"><div className="product-artboard"><span>画板 01</span><div className="product-shape" /><div className="product-copy"><i /><i /><i /></div></div></div>
            <section><strong>属性</strong><div /><div /><div /><small>本地处理</small></section>
          </div>
        </div>
      </section>
      <section className="public-feature-row">
        <article><MonitorSmartphone size={20} /><strong>网页与桌面双版本</strong><span>同一账号、同一套工作流，工程文件保持兼容。</span></article>
        <article><Layers3 size={20} /><strong>专业图层和多画板</strong><span>按需加载画板，减少大型工程占用的内存。</span></article>
        <article><ShieldCheck size={20} /><strong>原图只保存一份</strong><span>本机分块存储，撤销记录不再重复复制图片。</span></article>
      </section>
      <footer className="public-footer"><BrandLockup fixedLight compact /><a href={repository.startsWith('OWNER/') ? 'https://github.com/' : `https://github.com/${repository}`} target="_blank" rel="noreferrer"><Code2 size={15} />GitHub</a></footer>
    </main>
  );
}

function AuthScreen({ mode }: { mode: AuthMode }) {
  const auth = useAuth();
  const offlineBlocked = isDesktopApp && !navigator.onLine && !auth.session;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const title = mode === 'register' ? '创建免费账号' : mode === 'forgot' ? '找回密码' : mode === 'reset' ? '设置新密码' : '登录东尼菜市场';
  const description = mode === 'register' ? '注册后请前往邮箱完成验证' : mode === 'forgot' ? '我们会向你的邮箱发送重置链接' : mode === 'reset' ? '请输入至少6位的新密码' : '登录后才能进入图片编辑工作区';
  const versionImage = `${import.meta.env.BASE_URL}auth-version-v2.svg`;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (mode === 'register') {
        if (password !== confirmPassword) throw new Error('两次输入的密码不一致');
        await auth.signUp(email, password);
        setMessage(auth.developmentMode ? '本地预览账号已创建，即将进入编辑器。' : '注册成功，请打开邮箱完成验证后再登录。');
        if (auth.developmentMode) navigate('editor');
      } else if (mode === 'forgot') {
        await auth.sendPasswordReset(email);
        setMessage('重置邮件已发送，请检查收件箱和垃圾邮件。');
      } else if (mode === 'reset') {
        await auth.updatePassword(password);
        await auth.signOut();
        setMessage('密码已更新，请重新登录。');
        window.setTimeout(() => navigate('login'), 900);
      } else {
        await auth.signIn(email, password);
        navigate('editor');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <button type="button" className="auth-brand" onClick={() => isDesktopApp ? navigate('editor') : navigate('')}><BrandLockup fixedLight /></button>
      <div className="auth-layout">
        <figure className="auth-version-visual">
          <img src={versionImage} alt="东尼菜市场新版功能：网页与Windows双版本、原图本地保存、大图预览与后台处理" />
        </figure>
        <section className="auth-card">
        <div className="auth-card-heading"><span><LockKeyhole size={18} /></span><div><h1>{title}</h1><p>{description}</p></div></div>
        {!auth.configured && <div className="auth-config-error"><strong>登录服务尚未配置</strong><span>请按照项目中的免费部署说明配置Supabase环境变量。</span></div>}
        {offlineBlocked && <div className="auth-config-error"><strong>离线授权不可用或已过期</strong><span>请联网登录一次，Windows版随后可离线使用30天。</span></div>}
        {auth.developmentMode && <div className="auth-development-note">当前为本地开发预览登录，生产构建不会启用此模式。</div>}
        <form onSubmit={(event) => void submit(event)}>
          {mode !== 'reset' && <label><span>邮箱</span><input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" /></label>}
          {mode !== 'forgot' && <label><span>{mode === 'reset' ? '新密码' : '密码'}</span><input type="password" required minLength={6} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少6位" /></label>}
          {mode === 'register' && <label><span>确认密码</span><input type="password" required minLength={6} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>}
          {error && <div className="auth-message error" role="alert">{error}</div>}
          {message && <div className="auth-message success" role="status">{message}</div>}
          <button type="submit" className="auth-submit" disabled={busy || !auth.configured || offlineBlocked}>{busy ? '正在处理…' : mode === 'register' ? '注册并发送验证邮件' : mode === 'forgot' ? '发送重置邮件' : mode === 'reset' ? '保存新密码' : '登录并进入编辑器'}</button>
        </form>
        <div className="auth-links">
          {mode === 'login' && <><button type="button" onClick={() => navigate('register')}>注册账号</button><button type="button" onClick={() => navigate('forgot')}>忘记密码</button></>}
          {mode !== 'login' && <button type="button" onClick={() => navigate('login')}>返回登录</button>}
        </div>
        <small className="auth-privacy">账号服务由Supabase免费层提供；图片和工程不会上传。</small>
        </section>
      </div>
    </main>
  );
}

function RoutedApp() {
  const route = useRoute();
  const auth = useAuth();
  const authMode = useMemo<AuthMode>(() => route === 'register' || route === 'forgot' || route === 'reset' ? route : 'login', [route]);

  useEffect(() => {
    if (route !== 'editor') return;
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) activeElement.blur();
    window.requestAnimationFrame(() => window.scrollTo(0, 0));
  }, [route]);

  if (auth.loading) return <div className="app-boot-screen"><Carrot size={30} /><strong>正在验证登录状态…</strong></div>;
  if (route === 'home' && !isDesktopApp) return <LandingPage />;
  if (route === 'reset') return <AuthScreen mode="reset" />;
  if (route !== 'editor') return auth.session ? <App /> : <AuthScreen mode={authMode} />;
  if (!auth.session) return <AuthScreen mode="login" />;
  return <App />;
}

export default function RootApp() {
  return <AuthProvider><RoutedApp /></AuthProvider>;
}
