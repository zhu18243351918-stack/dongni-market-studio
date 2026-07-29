import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ChevronDown,
  Carrot,
  Check,
  CircleHelp,
  CircleUserRound,
  BoxSelect,
  Download,
  FileImage,
  FilePlus2,
  FolderOpen,
  Maximize,
  Grid3X3,
  LogOut,
  Magnet,
  Moon,
  Plus,
  PanelsTopLeft,
  Redo2,
  Save,
  Scaling,
  Settings2,
  Sun,
  Undo2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorEngine } from '../editor/EditorEngine';
import { useEditorStore } from '../store/editorStore';
import { useAuth } from '../auth/authContext';
import { inspectImportFile } from '../lib/importPreflight';
import type { ImportPreflightResult, WorkspaceDocumentTab } from '../types';

interface TopBarProps {
  engine: EditorEngine | null;
  documents: WorkspaceDocumentTab[];
  activeDocumentId: string;
  onSwitchDocument: (id: string) => Promise<void>;
  onNew: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExport: () => void;
  onShowGuide: () => void;
  onToast: (message: string, tone?: 'default' | 'success' | 'error') => void;
}

export function TopBar({ engine, documents, activeDocumentId, onSwitchDocument, onNew, onSave, onSaveAs, onExport, onShowGuide, onToast }: TopBarProps) {
  const auth = useAuth();
  const openFileInput = useRef<HTMLInputElement>(null);
  const smartObjectInput = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [preflight, setPreflight] = useState<ImportPreflightResult | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importAsSmartObject, setImportAsSmartObject] = useState(false);
  const canUndo = useEditorStore((state) => state.canUndo);
  const canRedo = useEditorStore((state) => state.canRedo);
  const theme = useEditorStore((state) => state.theme);
  const toggleTheme = useEditorStore((state) => state.toggleTheme);
  const showGrid = useEditorStore((state) => state.showGrid);
  const snapEnabled = useEditorStore((state) => state.snapEnabled);
  const uniformScaling = useEditorStore((state) => state.uniformScaling);
  const showControls = useEditorStore((state) => state.showControls);
  const setShowGrid = useEditorStore((state) => state.setShowGrid);
  const setSnapEnabled = useEditorStore((state) => state.setSnapEnabled);
  const setUniformScaling = useEditorStore((state) => state.setUniformScaling);
  const setShowControls = useEditorStore((state) => state.setShowControls);

  const queueImport = useCallback(async (file: File, asSmartObject = false) => {
    setImportAsSmartObject(asSmartObject);
    setPendingFile(file);
    setPreflight(null);
    setInspecting(true);
    try {
      setPreflight(await inspectImportFile(file));
    } catch (error) {
      onToast(error instanceof Error ? error.message : '无法读取文件信息', 'error');
      setPendingFile(null);
    } finally {
      setInspecting(false);
    }
  }, [onToast]);

  useEffect(() => {
    const handleRequest = (event: Event) => {
      const file = (event as CustomEvent<File>).detail;
      if (file) void queueImport(file);
    };
    window.addEventListener('dongni:request-import', handleRequest);
    return () => window.removeEventListener('dongni:request-import', handleRequest);
  }, [queueImport]);

  useEffect(() => {
    const openImage = () => openFileInput.current?.click();
    window.addEventListener('dongni:open-image', openImage);
    return () => window.removeEventListener('dongni:open-image', openImage);
  }, []);

  const confirmImport = async () => {
    if (!engine || !pendingFile || !preflight?.allowed) return;
    setImporting(true);
    try {
      if (preflight.kind === 'psd') await engine.importPsd(pendingFile, preflight);
      else if (preflight.kind === 'tiff') {
        await engine.addTiffFromFile(pendingFile, preflight);
        if (importAsSmartObject) await engine.convertToSmartObject('selection');
      }
      else {
        await engine.addImageFromFile(pendingFile, preflight);
        if (importAsSmartObject) await engine.convertToSmartObject('selection');
      }
      setPendingFile(null);
      setPreflight(null);
    } catch (error) {
      onToast(error instanceof Error ? error.message : '导入失败，已撤回本次操作', 'error');
    } finally {
      setImporting(false);
    }
  };

  const formatBytes = (bytes: number) => bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(bytes > 100 * 1024 ** 2 ? 0 : 1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;

  return (
    <header className="topbar">
      <div className="brand-lockup">
        <span className="brand-mark"><Carrot size={25} strokeWidth={2.7} /></span>
        <div><strong>东尼菜市场</strong><span>STUDIO</span></div>
      </div>
      <div className="topbar-divider" />
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button type="button" className="menu-trigger menu-trigger-primary"><span className="nav-plus-circle"><Plus size={12} strokeWidth={3} /></span>文件</button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="dropdown-content" align="start" sideOffset={7}>
            <DropdownMenu.Item className="dropdown-item" onSelect={onNew}><FilePlus2 size={15} />新建文档<kbd>Ctrl N</kbd></DropdownMenu.Item>
            <DropdownMenu.Item className="dropdown-item" onSelect={() => engine?.createArtboard()}><PanelsTopLeft size={15} />新建画板</DropdownMenu.Item>
            <DropdownMenu.Separator className="dropdown-separator" />
            <DropdownMenu.Item className="dropdown-item" onSelect={() => openFileInput.current?.click()}><FileImage size={15} />打开文件…<kbd>Ctrl O</kbd></DropdownMenu.Item>
            <DropdownMenu.Item className="dropdown-item" onSelect={() => smartObjectInput.current?.click()}><BoxSelect size={15} />打开为智能对象…</DropdownMenu.Item>
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger className="dropdown-item dropdown-sub-trigger"><FolderOpen size={15} />最近打开文件<span>›</span></DropdownMenu.SubTrigger>
              <DropdownMenu.Portal><DropdownMenu.SubContent className="dropdown-content" sideOffset={7} alignOffset={-4}>
                {documents.map((document) => <DropdownMenu.Item key={document.id} className="dropdown-item" onSelect={() => void onSwitchDocument(document.id)}><FileImage size={14} />{document.name}{document.id === activeDocumentId && <Check size={13} />}</DropdownMenu.Item>)}
              </DropdownMenu.SubContent></DropdownMenu.Portal>
            </DropdownMenu.Sub>
            <DropdownMenu.Separator className="dropdown-separator" />
            <DropdownMenu.Item className="dropdown-item" onSelect={onSave}><Save size={15} />存储<kbd>Ctrl S</kbd></DropdownMenu.Item>
            <DropdownMenu.Item className="dropdown-item" onSelect={onSaveAs}><Save size={15} />存储为…<kbd>Ctrl Shift S</kbd></DropdownMenu.Item>
            <DropdownMenu.Item className="dropdown-item" onSelect={() => void engine?.exportProject()}><Save size={15} />存储副本…</DropdownMenu.Item>
            <DropdownMenu.Item className="dropdown-item" onSelect={onExport}><Download size={15} />导出作品<kbd>Ctrl E</kbd></DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button type="button" className="menu-trigger menu-trigger-secondary"><span className="nav-settings-circle"><Settings2 size={12} /></span>设置 <ChevronDown size={12} /></button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="dropdown-content settings-menu" align="start" sideOffset={7}>
            <DropdownMenu.CheckboxItem className="dropdown-item dropdown-check" checked={showGrid} onCheckedChange={(value) => setShowGrid(value === true)}>
              <Grid3X3 size={15} />显示工作区网格<DropdownMenu.ItemIndicator className="dropdown-check-indicator"><Check size={13} /></DropdownMenu.ItemIndicator>
            </DropdownMenu.CheckboxItem>
            <DropdownMenu.CheckboxItem className="dropdown-item dropdown-check" checked={snapEnabled} onCheckedChange={(value) => setSnapEnabled(value === true)}>
              <Magnet size={15} />智能吸附<DropdownMenu.ItemIndicator className="dropdown-check-indicator"><Check size={13} /></DropdownMenu.ItemIndicator>
            </DropdownMenu.CheckboxItem>
            <DropdownMenu.CheckboxItem className="dropdown-item dropdown-check" checked={uniformScaling} onCheckedChange={(value) => setUniformScaling(value === true)}>
              <Scaling size={15} />缩放时保持比例<DropdownMenu.ItemIndicator className="dropdown-check-indicator"><Check size={13} /></DropdownMenu.ItemIndicator>
            </DropdownMenu.CheckboxItem>
            <DropdownMenu.CheckboxItem className="dropdown-item dropdown-check" checked={showControls} onCheckedChange={(value) => setShowControls(value === true)}>
              <BoxSelect size={15} />显示变换控件<DropdownMenu.ItemIndicator className="dropdown-check-indicator"><Check size={13} /></DropdownMenu.ItemIndicator>
            </DropdownMenu.CheckboxItem>
            <DropdownMenu.Separator className="dropdown-separator" />
            <DropdownMenu.Item className="dropdown-item" onSelect={onShowGuide}><CircleHelp size={15} />功能引导</DropdownMenu.Item>
            <DropdownMenu.Item className="dropdown-item" onSelect={() => engine?.fitToScreen()}><Maximize size={15} />画布适合窗口</DropdownMenu.Item>
            <DropdownMenu.Item className="dropdown-item" onSelect={toggleTheme}><Settings2 size={15} />切换深浅主题</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <input
        ref={openFileInput}
        hidden
        type="file"
        accept=".png,.jpg,.jpeg,.webp,.tif,.tiff,.psd,.psb,.json,.tuyan.json,image/png,image/jpeg,image/webp,image/tiff,image/vnd.adobe.photoshop,application/json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file && engine) {
            if (/\.(json|tuyan\.json)$/i.test(file.name)) void engine.importProject(file).catch(() => onToast('工程文件无法打开', 'error'));
            else void queueImport(file, false);
          }
          event.currentTarget.value = '';
        }}
      />
      <input
        ref={smartObjectInput}
        hidden
        type="file"
        accept=".png,.jpg,.jpeg,.webp,.tif,.tiff,image/png,image/jpeg,image/webp,image/tiff"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file && engine) void queueImport(file, true);
          event.currentTarget.value = '';
        }}
      />
      <div className="history-actions">
        <button type="button" aria-label="撤销" disabled={!canUndo} onClick={() => void engine?.undo()}><Undo2 size={17} /></button>
        <button type="button" aria-label="重做" disabled={!canRedo} onClick={() => void engine?.redo()}><Redo2 size={17} /></button>
      </div>
      <div className="topbar-spacer" />
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button type="button" className="account-trigger" aria-label="账号菜单"><CircleUserRound size={17} /><span>{auth.session?.email || '账号'}</span>{auth.session && !auth.session.online && <i>离线</i>}</button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="dropdown-content account-menu" align="end" sideOffset={7}>
            <div className="account-menu-summary"><strong>{auth.session?.email}</strong><span>{auth.session?.online ? '账号已验证 · 图片保存在本机' : '离线使用中 · 30天内有效'}</span></div>
            <DropdownMenu.Separator className="dropdown-separator" />
            <DropdownMenu.Item className="dropdown-item" onSelect={() => void auth.signOut()}><LogOut size={15} />退出登录</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <button type="button" className="theme-toggle" aria-label="切换主题" onClick={toggleTheme}>
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>
      <button type="button" className="export-button" onClick={onExport}><span className="export-grid-icon"><i /><i /><i /><i /></span><span>导出作品</span></button>
      <Dialog.Root open={Boolean(pendingFile)} onOpenChange={(open) => { if (!open && !importing) { setPendingFile(null); setPreflight(null); } }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content import-preflight-dialog">
            <div className="dialog-header"><div><Dialog.Title>导入前内存检查</Dialog.Title><Dialog.Description>原图只保存一份，编辑时自动使用低清预览</Dialog.Description></div><Dialog.Close className="dialog-close" disabled={importing}><X size={17} /></Dialog.Close></div>
            {inspecting || !preflight ? <div className="import-preflight-loading"><span className="processing-spinner" /><strong>正在读取尺寸并估算内存…</strong></div> : <>
              <div className={`import-permission-banner ${preflight.allowed ? 'allowed' : 'blocked'}`}><strong>{preflight.allowed ? '可以安全导入' : '内存不足，无法继续'}</strong><span>{preflight.allowed ? `${preflight.deviceClass === 'mobile' ? '手机' : '桌面'}限制内，编辑器将生成 ${preflight.previewWidth} × ${preflight.previewHeight} 预览。` : '请撤回本次导入，或先在其他工具中降低图片尺寸。'}</span></div>
              <div className="import-file-summary"><FileImage size={25} /><div><strong>{preflight.fileName}</strong><span>{formatBytes(preflight.fileBytes)} · {preflight.kind.toUpperCase()}</span></div></div>
              <div className="import-metric-grid">
                <div><span>原图尺寸</span><strong>{preflight.width} × {preflight.height}</strong><small>{preflight.megapixels.toFixed(1)} MP</small></div>
                <div><span>预计峰值内存</span><strong>{formatBytes(preflight.estimatedPeakBytes)}</strong><small>解码 {formatBytes(preflight.estimatedDecodedBytes)}</small></div>
                <div><span>设备强制限制</span><strong>{Math.round(preflight.pixelLimit / 1_000_000)} MP</strong><small>{preflight.deviceClass === 'mobile' ? '手机/低内存' : '桌面浏览器'}</small></div>
                <div><span>编辑预览</span><strong>{preflight.previewWidth} × {preflight.previewHeight}</strong><small>{Math.round(preflight.previewScale * 100)}% 比例</small></div>
              </div>
              {preflight.layerCount !== undefined && <div className="psd-layer-estimate">检测到 {preflight.layerCount} 个PSD图层，将在后台线程逐层解析。</div>}
            </>}
            <div className="dialog-footer"><button type="button" className="secondary-action" disabled={importing} onClick={() => { setPendingFile(null); setPreflight(null); }}>{preflight?.allowed ? '取消' : '撤回导入'}</button><button type="button" className="primary-action" disabled={!preflight?.allowed || inspecting || importing} onClick={() => void confirmImport()}>{importing ? '正在导入…' : '确认导入'}</button></div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </header>
  );
}
