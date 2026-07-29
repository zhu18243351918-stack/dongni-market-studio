import * as Tabs from '@radix-ui/react-tabs';
import * as Tooltip from '@radix-ui/react-tooltip';
import { motion, useReducedMotion } from 'motion/react';
import {
  Brush,
  Crop,
  Download,
  Eraser,
  Hand,
  ImagePlus,
  Layers3,
  Lasso,
  MousePointer2,
  PanelRight,
  PenLine,
  ScanSearch,
  Scissors,
  Shapes,
  TextCursorInput,
  Trash2,
  WandSparkles,
  RotateCcw,
  Sparkles,
  Move,
  LayoutTemplate,
  Maximize,
  Minus,
  Plus,
  SlidersHorizontal,
  ScanLine,
  Workflow,
  Palette,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { useAuth } from './auth/authContext';
import { CanvasStage } from './components/CanvasStage';
import { ExportDialog, NewCanvasDialog, type NewDocumentRequest } from './components/Dialogs';
import { LayersPanel } from './components/LayersPanel';
import { PropertiesPanel } from './components/PropertiesPanel';
import { ToolButton } from './components/ToolButton';
import { TopBar } from './components/TopBar';
import type { EditorEngine } from './editor/EditorEngine';
import { TEMPLATE_PRESETS } from './data/editorPresets';
import { loadCurrentProject, loadDocumentWorkspace, saveCurrentProject, saveDocumentWorkspace } from './lib/projectDb';
import { useEditorStore } from './store/editorStore';
import type { CustomTemplateRecord, ProjectDocument, SmartObjectSource, ToolId, WorkspaceDocumentTab } from './types';

interface ToastState {
  message: string;
  tone: 'default' | 'success' | 'error';
}

const AMBIENT_VIDEO_URL = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260508_215831_c6a8989c-d716-4d8d-8745-e972a2eec711.mp4';

const tools: Array<{ id: ToolId; label: string; shortcut?: string; icon: typeof MousePointer2; group?: string }> = [
  { id: 'select', label: '选择与移动', shortcut: 'V', icon: MousePointer2, group: 'basic' },
  { id: 'hand', label: '抓手工具', shortcut: 'H', icon: Hand, group: 'basic' },
  { id: 'crop', label: '裁剪', shortcut: 'C', icon: Crop, group: 'basic' },
  { id: 'edge-cutout', label: '一键抠图', icon: Scissors, group: 'cutout' },
  { id: 'quick-select', label: '快速选择', shortcut: 'W', icon: ScanSearch, group: 'cutout' },
  { id: 'magic-wand', label: '魔棒', shortcut: 'M', icon: WandSparkles, group: 'cutout' },
  { id: 'lasso', label: '套索', shortcut: 'L', icon: Lasso, group: 'cutout' },
  { id: 'polygon-lasso', label: '多边形套索', shortcut: 'P', icon: PenLine, group: 'cutout' },
  { id: 'text', label: '文字', shortcut: 'T', icon: TextCursorInput, group: 'create' },
  { id: 'shapes', label: '几何图形', shortcut: 'R', icon: Shapes, group: 'create' },
  { id: 'brush', label: '画笔', shortcut: 'B', icon: Brush, group: 'create' },
  { id: 'erase-brush', label: '擦除笔刷', shortcut: 'E', icon: Eraser, group: 'retouch' },
  { id: 'restore-brush', label: '恢复笔刷', shortcut: 'Q', icon: RotateCcw, group: 'retouch' },
  { id: 'face-retouch', label: '一键美颜', shortcut: 'F', icon: Sparkles, group: 'retouch' },
  { id: 'liquify', label: '局部拉扯', shortcut: 'U', icon: Move, group: 'retouch' },
  { id: 'templates', label: '模板市场', icon: LayoutTemplate, group: 'productivity' },
  { id: 'filters', label: '分类滤镜', shortcut: 'J', icon: SlidersHorizontal, group: 'productivity' },
  { id: 'styles', label: '风格转换', icon: Palette, group: 'productivity' },
  { id: 'region', label: '区域批填', shortcut: 'G', icon: ScanLine, group: 'productivity' },
  { id: 'workflow', label: '自动工作流', icon: Workflow, group: 'productivity' },
];

const toolNames = Object.fromEntries(tools.map((tool) => [tool.id, tool.label])) as Record<ToolId, string>;

const mobileQuickActions: Array<{
  id: string;
  label: string;
  icon: typeof MousePointer2;
  tool?: ToolId;
  panel?: 'tools' | 'properties';
}> = [
  { id: 'templates', label: '模板', icon: LayoutTemplate, tool: 'templates' },
  { id: 'crop', label: '裁剪', icon: Crop, tool: 'crop' },
  { id: 'cutout', label: '抠图', icon: Scissors, tool: 'edge-cutout' },
  { id: 'adjust', label: '调色', icon: SlidersHorizontal, panel: 'properties' },
  { id: 'filters', label: '滤镜', icon: Palette, tool: 'filters' },
  { id: 'erase', label: '消除笔', icon: Eraser, tool: 'erase-brush' },
  { id: 'text', label: '文字', icon: TextCursorInput, tool: 'text' },
  { id: 'beauty', label: '美颜', icon: Sparkles, tool: 'face-retouch' },
  { id: 'more', label: '更多', icon: Plus, panel: 'tools' },
];

function App() {
  const reduceMotion = useReducedMotion();
  const auth = useAuth();
  const userId = auth.session?.userId || 'anonymous';
  const [engine, setEngine] = useState<EditorEngine | null>(null);
  const engineRef = useRef<EditorEngine | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [editorInitialized, setEditorInitialized] = useState(false);
  const [quickGuideForced, setQuickGuideForced] = useState(false);
  const [showQuickGuide, setShowQuickGuide] = useState(() => {
    try { return window.localStorage.getItem('dongni-market-quick-guide-v2') !== 'done'; }
    catch { return true; }
  });
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<number | null>(null);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [initialProject, setInitialProject] = useState<ProjectDocument | undefined>();
  const [documents, setDocuments] = useState<WorkspaceDocumentTab[]>([]);
  const [activeDocumentId, setActiveDocumentId] = useState('');
  const documentsRef = useRef<WorkspaceDocumentTab[]>([]);
  const activeDocumentIdRef = useRef('');
  const documentCounterRef = useRef(1);
  const activeTool = useEditorStore((state) => state.activeTool);
  const setTool = useEditorStore((state) => state.setTool);
  const rightTab = useEditorStore((state) => state.rightTab);
  const setRightTab = useEditorStore((state) => state.setRightTab);
  const mobilePanel = useEditorStore((state) => state.mobilePanel);
  const setMobilePanel = useEditorStore((state) => state.setMobilePanel);
  const selectedId = useEditorStore((state) => state.selectedId);
  const layers = useEditorStore((state) => state.layers);
  const zoom = useEditorStore((state) => state.zoom);
  const isProcessing = useEditorStore((state) => state.isProcessing);
  const processingLabel = useEditorStore((state) => state.processingLabel);
  const theme = useEditorStore((state) => state.theme);
  const selectionCombine = useEditorStore((state) => state.selectionCombine);
  const selectionTolerance = useEditorStore((state) => state.selectionTolerance);
  const selectionContiguous = useEditorStore((state) => state.selectionContiguous);
  const brushSize = useEditorStore((state) => state.brushSize);
  const eraserSize = useEditorStore((state) => state.eraserSize);
  const brushSubtract = useEditorStore((state) => state.brushSubtract);
  const previewMode = useEditorStore((state) => state.previewMode);
  const snapEnabled = useEditorStore((state) => state.snapEnabled);
  const uniformScaling = useEditorStore((state) => state.uniformScaling);
  const showControls = useEditorStore((state) => state.showControls);
  const artboards = useEditorStore((state) => state.artboards);
  const activeArtboardId = useEditorStore((state) => state.activeArtboardId);
  const viewportX = useEditorStore((state) => state.viewportX);
  const viewportY = useEditorStore((state) => state.viewportY);
  const liquifySize = useEditorStore((state) => state.liquifySize);
  const liquifyStrength = useEditorStore((state) => state.liquifyStrength);
  const activeArtboard = artboards.find((artboard) => artboard.id === activeArtboardId) || artboards[0];
  const documentInfo = engine?.getDocumentInfo();

  useEffect(() => {
    let active = true;
    setWorkspaceReady(false);
    void Promise.all([loadDocumentWorkspace(userId), loadCurrentProject(userId)]).then(([workspace, currentProject]) => {
      if (!active) return;
      const restored = workspace?.documents?.length
        ? workspace.documents
        : [{ id: `file-${Date.now().toString(36)}`, name: '文件 1', project: currentProject, updatedAt: new Date().toISOString() }];
      const restoredActiveId = restored.some((document) => document.id === workspace?.activeDocumentId)
        ? workspace!.activeDocumentId
        : restored[0].id;
      documentsRef.current = restored;
      activeDocumentIdRef.current = restoredActiveId;
      documentCounterRef.current = Math.max(restored.length, ...restored.map((document) => Number(document.name.match(/\d+/)?.[0] || 0))) + 1;
      setDocuments(restored);
      setActiveDocumentId(restoredActiveId);
      setInitialProject(restored.find((document) => document.id === restoredActiveId)?.project);
      setWorkspaceReady(true);
    }).catch(() => {
      if (!active) return;
      const fallback = { id: `file-${Date.now().toString(36)}`, name: '文件 1', updatedAt: new Date().toISOString() };
      documentsRef.current = [fallback];
      activeDocumentIdRef.current = fallback.id;
      documentCounterRef.current = 2;
      setDocuments([fallback]);
      setActiveDocumentId(fallback.id);
      setWorkspaceReady(true);
    });
    return () => { active = false; };
  }, [userId]);

  const persistWorkspace = useCallback((nextDocuments: WorkspaceDocumentTab[], nextActiveId: string) => {
    documentsRef.current = nextDocuments;
    activeDocumentIdRef.current = nextActiveId;
    void saveDocumentWorkspace({ version: 1, activeDocumentId: nextActiveId, documents: nextDocuments }, userId);
  }, [userId]);

  const updateDocumentProject = useCallback((project: ProjectDocument, documentId = activeDocumentIdRef.current) => {
    const now = new Date().toISOString();
    const next = documentsRef.current.map((document) => document.id === documentId ? { ...document, project, updatedAt: now } : document);
    documentsRef.current = next;
    setDocuments(next);
    persistWorkspace(next, activeDocumentIdRef.current);
    if (documentId === activeDocumentIdRef.current) void saveCurrentProject(project, userId);
  }, [persistWorkspace, userId]);

  const showToast = useCallback((message: string, tone: ToastState['tone'] = 'default') => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ message, tone });
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const onEngineReady = useCallback((nextEngine: EditorEngine) => {
    engineRef.current = nextEngine;
    setEngine(nextEngine);
    (window as Window & { tuyanEngine?: EditorEngine }).tuyanEngine = nextEngine;
  }, []);

  const onEditorInitialized = useCallback((project: ProjectDocument) => {
    updateDocumentProject(project);
    setEditorInitialized(true);
  }, [updateDocumentProject]);

  const onDocumentChange = useCallback((project: ProjectDocument) => {
    updateDocumentProject(project);
  }, [updateDocumentProject]);

  const dismissQuickGuide = useCallback(() => {
    setShowQuickGuide(false);
    setQuickGuideForced(false);
    try { window.localStorage.setItem('dongni-market-quick-guide-v2', 'done'); } catch { /* Keep the session usable without storage. */ }
  }, []);

  const showQuickGuideAgain = useCallback(() => {
    setQuickGuideForced(true);
    setShowQuickGuide(true);
  }, []);

  const openImageFromGuide = useCallback(() => {
    dismissQuickGuide();
    window.dispatchEvent(new Event('dongni:open-image'));
  }, [dismissQuickGuide]);

  const createDocumentFile = useCallback(async (
    build: (nextEngine: EditorEngine) => Promise<void>,
    preferredName?: string,
  ) => {
    const currentEngine = engineRef.current;
    if (!currentEngine) return;
    const previousId = activeDocumentIdRef.current;
    const previousProject = currentEngine.serializeProject();
    const existing = documentsRef.current.map((document) => document.id === previousId
      ? { ...document, project: previousProject, updatedAt: new Date().toISOString() }
      : document);
    const number = documentCounterRef.current++;
    const id = `file-${Date.now().toString(36)}-${number}`;
    const newTab: WorkspaceDocumentTab = { id, name: preferredName || `文件 ${number}`, updatedAt: new Date().toISOString() };
    const pending = [...existing, newTab];
    setDocuments(pending);
    setActiveDocumentId(id);
    persistWorkspace(pending, id);
    try {
      await build(currentEngine);
      const project = currentEngine.serializeProject();
      const completed = documentsRef.current.map((document) => document.id === id ? { ...document, project, updatedAt: new Date().toISOString() } : document);
      setDocuments(completed);
      persistWorkspace(completed, id);
      void saveCurrentProject(project, userId);
      currentEngine.setTool('select');
      setTool('select');
    } catch (error) {
      const restored = documentsRef.current.filter((document) => document.id !== id);
      setDocuments(restored);
      setActiveDocumentId(previousId);
      persistWorkspace(restored, previousId);
      await currentEngine.loadProject(previousProject);
      showToast(error instanceof Error ? error.message : '新文件创建失败', 'error');
    }
  }, [persistWorkspace, setTool, showToast, userId]);

  const createBlankDocumentFile = useCallback(async (request: NewDocumentRequest) => {
    await createDocumentFile(
      (nextEngine) => nextEngine.newDocument(request.width, request.height, request.background, true, request),
    );
  }, [createDocumentFile]);

  const createPresetTemplateFile = useCallback(async (templateId: string) => {
    const template = TEMPLATE_PRESETS.find((item) => item.id === templateId);
    if (!template) return;
    const background = templateId === 'business-card' ? '#f4f0e6'
      : templateId === 'video-cover' ? '#101827'
        : templateId === 'product-main' ? '#f4efe4'
          : templateId === 'poster' ? '#172554'
            : '#f1f1f1';
    await createDocumentFile(async (nextEngine) => {
      await nextEngine.newDocument(template.width, template.height, background, true, { name: template.name });
      await nextEngine.applyTemplate(templateId);
    });
  }, [createDocumentFile]);

  const createCustomTemplateFile = useCallback(async (template: CustomTemplateRecord) => {
    await createDocumentFile(async (nextEngine) => {
      await nextEngine.newDocument(template.width, template.height, template.background, true, { name: template.name });
      await nextEngine.applyCustomTemplate(template);
    });
  }, [createDocumentFile]);

  const openSmartObjectFile = useCallback(async (source: SmartObjectSource) => {
    await createDocumentFile(async (nextEngine) => {
      await nextEngine.newDocument(source.width, source.height, source.background, true, { name: source.name, format: source.format || 'psd' });
      await nextEngine.loadSmartObjectSource(source);
    }, source.name);
  }, [createDocumentFile]);

  const switchDocument = useCallback(async (id: string) => {
    if (!engine || id === activeDocumentIdRef.current) return;
    const currentId = activeDocumentIdRef.current;
    const currentProject = engine.serializeProject();
    const nextDocuments = documentsRef.current.map((document) => document.id === currentId
      ? { ...document, project: currentProject, updatedAt: new Date().toISOString() }
      : document);
    const target = nextDocuments.find((document) => document.id === id);
    if (!target) return;
    setDocuments(nextDocuments);
    setActiveDocumentId(id);
    persistWorkspace(nextDocuments, id);
    if (target.project) await engine.loadProject(target.project);
    else await engine.newDocument(1080, 1080, '#ffffff', true, { name: target.name });
    engine.setTool('select');
    setTool('select');
  }, [engine, persistWorkspace, setTool]);

  const closeDocument = useCallback(async (id: string) => {
    if (!engine || documentsRef.current.length <= 1) return;
    const closingIndex = documentsRef.current.findIndex((document) => document.id === id);
    if (closingIndex < 0) return;
    const wasActive = id === activeDocumentIdRef.current;
    let nextDocuments = documentsRef.current;
    if (wasActive) {
      const currentProject = engine.serializeProject();
      nextDocuments = nextDocuments.map((document) => document.id === id ? { ...document, project: currentProject, updatedAt: new Date().toISOString() } : document);
    }
    nextDocuments = nextDocuments.filter((document) => document.id !== id);
    const nextActiveId = wasActive
      ? nextDocuments[Math.min(closingIndex, nextDocuments.length - 1)].id
      : activeDocumentIdRef.current;
    setDocuments(nextDocuments);
    setActiveDocumentId(nextActiveId);
    persistWorkspace(nextDocuments, nextActiveId);
    if (wasActive) {
      const target = nextDocuments.find((document) => document.id === nextActiveId);
      if (target?.project) await engine.loadProject(target.project);
    }
  }, [engine, persistWorkspace]);

  const saveActiveDocument = useCallback(() => {
    if (!engine) return;
    updateDocumentProject(engine.serializeProject());
    showToast('已保存到本机工作区', 'success');
  }, [engine, showToast, updateDocumentProject]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    engine?.canvas.requestRenderAll();
  }, [engine, theme]);

  useEffect(() => {
    engine?.setSelectionOptions({
      combine: selectionCombine,
      tolerance: selectionTolerance,
      contiguous: selectionContiguous,
      brushSize,
      eraserSize,
      brushSubtract,
      previewMode,
    });
  }, [engine, selectionCombine, selectionTolerance, selectionContiguous, brushSize, eraserSize, brushSubtract, previewMode]);

  useEffect(() => {
    engine?.setEditorPreferences({ snapEnabled, uniformScaling, showControls });
  }, [engine, snapEnabled, uniformScaling, showControls]);

  useEffect(() => {
    engine?.setLiquifyOptions({ size: liquifySize, strength: liquifyStrength });
  }, [engine, liquifySize, liquifyStrength]);

  useEffect(() => {
    const shell = document.querySelector<HTMLElement>('.editor-shell');
    if (shell) shell.scrollTop = 0;
  }, [mobilePanel]);

  const chooseTool = useCallback((tool: ToolId) => {
    if (!engine) return;
    if (tool === 'edge-cutout') {
      setTool('select');
      engine.setTool('select');
      void engine.oneClickCutout();
    } else if (tool === 'text') {
      engine.setTool('select');
      engine.addText();
      setTool('select');
    } else {
      setTool(tool);
      engine.setTool(tool);
    }
    const opensInspector = ['quick-select', 'magic-wand', 'lasso', 'polygon-lasso', 'erase-brush', 'restore-brush', 'face-retouch', 'liquify', 'shapes', 'templates', 'filters', 'styles', 'region', 'workflow'].includes(tool);
    if (opensInspector) {
      setRightTab('properties');
      setMobilePanel(window.matchMedia('(max-width: 767px)').matches ? 'properties' : null);
    } else {
      setMobilePanel(null);
    }
  }, [engine, setMobilePanel, setRightTab, setTool]);

  const chooseMobileQuickAction = useCallback((action: (typeof mobileQuickActions)[number]) => {
    if (action.panel === 'tools') {
      setMobilePanel('tools');
      return;
    }
    if (action.panel === 'properties') {
      setRightTab('properties');
      setMobilePanel('properties');
      return;
    }
    if (action.tool) chooseTool(action.tool);
  }, [chooseTool, setMobilePanel, setRightTab]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.matches('input, textarea, select, [contenteditable="true"]')) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) void engine?.redo(); else void engine?.undo();
        return;
      }
      if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); void engine?.redo(); return; }
      if (modifier && event.key.toLowerCase() === 'd') { event.preventDefault(); engine?.duplicateActive(); return; }
      if (modifier && event.key.toLowerCase() === 'c') { event.preventDefault(); void engine?.copyActive(); return; }
      if (modifier && event.key.toLowerCase() === 'v') { event.preventDefault(); void engine?.pasteClipboard(); return; }
      if (modifier && event.key.toLowerCase() === 'g') { event.preventDefault(); engine?.groupActive(); return; }
      if (modifier && event.key.toLowerCase() === 's') { event.preventDefault(); if (event.shiftKey) setExportOpen(true); else saveActiveDocument(); return; }
      if (modifier && event.key.toLowerCase() === 'e') { event.preventDefault(); setExportOpen(true); return; }
      if (modifier && event.key.toLowerCase() === 'n') { event.preventDefault(); setNewOpen(true); return; }
      if (event.key === 'Delete' || event.key === 'Backspace') { engine?.deleteActive(); return; }
      const shortcutMap: Record<string, ToolId> = {
        v: 'select', h: 'hand', c: 'crop', w: 'quick-select', m: 'magic-wand', l: 'lasso', p: 'polygon-lasso',
        t: 'text', r: 'shapes', b: 'brush', e: 'erase-brush', q: 'restore-brush', f: 'face-retouch', u: 'liquify', j: 'filters', g: 'region',
      };
      const tool = shortcutMap[event.key.toLowerCase()];
      if (tool) chooseTool(tool);
    };
    const onPaste = (event: ClipboardEvent) => {
      const image = [...event.clipboardData?.items || []].find((item) => item.type.startsWith('image/'))?.getAsFile();
      if (image && engine) void engine.addImageFromFile(image).catch((error: Error) => showToast(error.message, 'error'));
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('paste', onPaste);
    };
  }, [chooseTool, engine, saveActiveDocument, showToast]);

  const groupedTools = useMemo(() => {
    const result: Array<(typeof tools)[number] | 'separator'> = [];
    let group = '';
    for (const tool of tools) {
      if (group && group !== tool.group) result.push('separator');
      result.push(tool);
      group = tool.group || '';
    }
    return result;
  }, []);

  return (
    <Tooltip.Provider>
      <div className="app-shell">
        <motion.div
          className="ambient-video"
          aria-hidden="true"
          initial={reduceMotion ? false : { opacity: 0, scale: 1.05 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: reduceMotion ? 0 : 1.8, ease: [0.16, 1, 0.3, 1] }}
        >
          <video src={AMBIENT_VIDEO_URL} autoPlay muted loop playsInline preload="metadata" />
        </motion.div>
        <div className="ambient-wash" aria-hidden="true" />
        <motion.div
          className="topbar-motion"
          initial={reduceMotion ? false : { y: -16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: reduceMotion ? 0 : 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          <TopBar
            engine={engine}
            documents={documents}
            activeDocumentId={activeDocumentId}
            onSwitchDocument={switchDocument}
            onNew={() => setNewOpen(true)}
            onSave={saveActiveDocument}
            onSaveAs={() => setExportOpen(true)}
            onExport={() => setExportOpen(true)}
            onShowGuide={showQuickGuideAgain}
            onToast={showToast}
          />
        </motion.div>
        <motion.main
          className="editor-shell"
          initial={reduceMotion ? false : { y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: reduceMotion ? 0 : 0.35, duration: reduceMotion ? 0 : 1, ease: [0.16, 1, 0.3, 1] }}
        >
          <aside
            className={`tool-rail ${mobilePanel === 'tools' ? 'is-mobile-open' : ''}`}
            aria-label="编辑工具"
          >
            <div className="mobile-sheet-header"><strong>全部工具</strong><button type="button" aria-label="关闭全部工具" onClick={() => setMobilePanel(null)}><X size={18} /></button></div>
            <div className="tool-list">
              {groupedTools.map((item, index) => item === 'separator' ? <div className="tool-separator" key={`separator-${index}`} /> : (
                <div className="tool-item-wrap" key={item.id}>
                  <ToolButton {...item} active={activeTool === item.id} onClick={chooseTool} />
                  <span className="mobile-tool-label">{item.label}</span>
                </div>
              ))}
            </div>
            <div className="tool-rail-bottom">
              <button type="button" className="tool-button" aria-label="删除所选图层" disabled={!selectedId} onClick={() => engine?.deleteActive()}><Trash2 size={18} /></button>
            </div>
          </aside>

          <motion.section
            className="workspace"
            initial={reduceMotion ? false : { opacity: 0, scale: 1.015 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: reduceMotion ? 0 : 0.25, duration: reduceMotion ? 0 : 1.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="context-bar">
              <div className="context-tool"><span className="context-icon"><Scissors size={14} /></span><strong>{toolNames[activeTool]}</strong></div>
              <span className="context-hint">
                {activeTool === 'quick-select' && '在主体上涂抹；切换“标记背景”可减去错误区域'}
                {activeTool === 'magic-wand' && '点击相近颜色区域，通过容差控制选取范围'}
                {activeTool === 'lasso' && '按住并绘制自由选区，松开完成'}
                {activeTool === 'polygon-lasso' && '逐点点击轮廓，双击完成选区'}
                {activeTool === 'erase-brush' && '在图片上涂抹以擦除，松开后写入非破坏性蒙版'}
                {activeTool === 'restore-brush' && '在已擦除区域涂抹，恢复上传时的原图内容'}
                {activeTool === 'face-retouch' && '先识别人脸建立选区，再调节磨皮与瘦脸强度'}
                {activeTool === 'liquify' && '在人物轮廓上按住并拖动：向内推可瘦脸瘦身，向外推可恢复或塑形'}
                {activeTool === 'shapes' && '选择矩形、圆形、三角形或直线；创建后可继续调节圆角、描边和尺寸'}
                {activeTool === 'templates' && '从身份名片、视频封面、商品主图、海报和表情包模板快速开始'}
                {activeTool === 'filters' && '按风景、食物和人像分类选择滤镜，可应用到当前或全部画板'}
                {activeTool === 'styles' && '将图片图层一键转换为像素风格或漫画风格，处理在本机完成'}
                {activeTool === 'region' && '在画板上拖拽框选区域，命名后可向所有画板批量填写文字'}
                {activeTool === 'workflow' && '自由组合画板、滤镜、区域文字和导出步骤，然后一键执行'}
                {!['quick-select', 'magic-wand', 'lasso', 'polygon-lasso', 'erase-brush', 'restore-brush', 'face-retouch', 'liquify', 'shapes', 'templates', 'filters', 'styles', 'region', 'workflow'].includes(activeTool) && '所有编辑均在本机完成，图片不会上传'}
              </span>
            </div>
            <div className="document-tabs-bar" role="tablist" aria-label="打开的文件">
              <div className="document-tabs-scroll">
                {documents.map((document) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={document.id === activeDocumentId}
                    className={`document-tab ${document.id === activeDocumentId ? 'is-active' : ''}`}
                    key={document.id}
                    onClick={() => void switchDocument(document.id)}
                    title={document.project?.name || document.name}
                  >
                    <span>{document.name}</span>
                    <small>@ {Math.round(zoom * 100)}% · {(documentInfo?.format || 'psd').toUpperCase()} · {documentInfo?.colorMode?.toUpperCase() || 'RGB'}/{documentInfo?.bitDepth || 8}</small>
                    {documents.length > 1 && <span className="document-tab-close" role="button" aria-label={`关闭${document.name}`} onClick={(event) => { event.stopPropagation(); void closeDocument(document.id); }}><X size={12} /></span>}
                  </button>
                ))}
              </div>
              <button type="button" className="document-tab-add" aria-label="新建文件" onClick={() => setNewOpen(true)}><Plus size={14} /></button>
            </div>
            {workspaceReady
              ? <CanvasStage initialProject={initialProject} onReady={onEngineReady} onInitialized={onEditorInitialized} onDocumentChange={onDocumentChange} onOpenSmartObject={openSmartObjectFile} onToast={showToast} />
              : <div className="canvas-stage workspace-loading"><span />正在读取本地文件…</div>}
            {editorInitialized && showQuickGuide && (layers.length === 0 || quickGuideForced) && (
              <aside className="canvas-quick-guide" aria-labelledby="quick-guide-title">
                <div className="quick-guide-card">
                  <span className="quick-guide-kicker">快速开始</span>
                  <h2 id="quick-guide-title">三步完成第一张作品</h2>
                  <p>从本地打开图片，选择左侧工具处理，再从右上角导出。图片始终保存在你的设备中。</p>
                  <div className="quick-guide-steps">
                    <div><span><ImagePlus size={16} /></span><strong>导入素材</strong><small>文件 → 打开图片，或直接拖入画布</small></div>
                    <div><span><Scissors size={16} /></span><strong>处理图片</strong><small>抠图、滤镜、美颜和文字都在左侧</small></div>
                    <div><span><Download size={16} /></span><strong>导出作品</strong><small>支持PNG、JPEG、WebP、PDF和PSD</small></div>
                  </div>
                  <div className="quick-guide-actions">
                    <button type="button" className="quick-guide-skip" onClick={dismissQuickGuide}>暂时跳过</button>
                    <button type="button" className="quick-guide-primary" onClick={openImageFromGuide}><ImagePlus size={15} />打开一张图片</button>
                  </div>
                </div>
              </aside>
            )}
            <div className="canvas-zoom-control" aria-label="画布缩放">
              <button type="button" aria-label="缩小" onClick={() => engine?.zoomBy(0.85)}><Minus size={14} /></button>
              <button type="button" className="zoom-value" onClick={() => engine?.fitToScreen()}>{Math.round(zoom * 100)}%</button>
              <button type="button" aria-label="放大" onClick={() => engine?.zoomBy(1.18)}><Plus size={14} /></button>
              <button type="button" aria-label="适合画布" onClick={() => engine?.fitToScreen()}><Maximize size={15} /></button>
            </div>
            <div className="canvas-status">
              <span>{activeArtboard?.name || '画板 1'} {activeArtboard?.width || 1080} × {activeArtboard?.height || 1080} · {(documentInfo?.format || 'psd').toUpperCase()} · {documentInfo?.colorMode?.toUpperCase() || 'RGB'} / {documentInfo?.bitDepth || 8} bit · {Math.round(documentInfo?.resolution || 72)} ppi · 视图 X {Math.round(viewportX)} Y {Math.round(viewportY)}</span>
              <span><i className="privacy-dot" />本地处理</span>
              <span>按住空格拖动画布</span>
            </div>
          </motion.section>

          <aside
            className={`right-panel ${mobilePanel === 'properties' || mobilePanel === 'layers' ? 'is-mobile-open' : ''}`}
          >
            <div className="mobile-sheet-header"><strong>{mobilePanel === 'layers' ? '图层' : '属性'}</strong><button type="button" onClick={() => setMobilePanel(null)}><X size={18} /></button></div>
            {engine ? (
              <Tabs.Root value={mobilePanel === 'layers' ? 'layers' : rightTab} onValueChange={(value) => setRightTab(value as 'properties' | 'layers')} className="right-tabs">
                <Tabs.List className="right-tabs-list">
                  <Tabs.Trigger value="properties"><PanelRight size={14} />属性</Tabs.Trigger>
                  <Tabs.Trigger value="layers"><Layers3 size={14} />图层</Tabs.Trigger>
                </Tabs.List>
                <Tabs.Content value="properties" className="right-tabs-content"><PropertiesPanel engine={engine} onCreateTemplateDocument={createPresetTemplateFile} onCreateCustomTemplateDocument={createCustomTemplateFile} /></Tabs.Content>
                <Tabs.Content value="layers" className="right-tabs-content"><LayersPanel engine={engine} /></Tabs.Content>
              </Tabs.Root>
            ) : <div className="panel-loading">正在准备编辑器…</div>}
          </aside>
        </motion.main>

        <div className="mobile-command-dock">
          <nav className="mobile-quick-tools" aria-label="常用图片功能">
            {mobileQuickActions.map((action) => {
              const Icon = action.icon;
              const active = Boolean(action.tool && activeTool === action.tool) || Boolean(action.panel && mobilePanel === action.panel);
              return <button type="button" key={action.id} className={active ? 'is-active' : ''} onClick={() => chooseMobileQuickAction(action)}><Icon size={21} strokeWidth={1.8} /><span>{action.label}</span></button>;
            })}
          </nav>
          <nav className="mobile-bottom-nav" aria-label="移动端操作">
            <button type="button" className={mobilePanel === 'tools' ? 'is-active' : ''} onClick={() => setMobilePanel(mobilePanel === 'tools' ? null : 'tools')}><Scissors size={19} /><span>全部工具</span></button>
            <button type="button" className={mobilePanel === 'properties' ? 'is-active' : ''} onClick={() => setMobilePanel(mobilePanel === 'properties' ? null : 'properties')}><PanelRight size={19} /><span>属性</span></button>
            <button type="button" className={mobilePanel === 'layers' ? 'is-active' : ''} onClick={() => setMobilePanel(mobilePanel === 'layers' ? null : 'layers')}><Layers3 size={19} /><span>图层</span></button>
            <button type="button" onClick={() => setExportOpen(true)}><Download size={19} /><span>导出</span></button>
          </nav>
        </div>

        {isProcessing && (
          <div className="processing-card" role="status">
            <span className="processing-spinner" />
            <div><strong>{processingLabel || '正在处理…'}</strong><span>计算在本机进行，请稍候</span></div>
            <button type="button" onClick={() => engine?.cancelProcessing()}>取消</button>
          </div>
        )}
        {toast && <div className={`toast ${toast.tone}`}><span>{toast.message}</span><button type="button" onClick={() => setToast(null)}><X size={15} /></button></div>}

        <NewCanvasDialog open={newOpen} onOpenChange={setNewOpen} engine={engine} onCreate={createBlankDocumentFile} />
        <ExportDialog open={exportOpen} onOpenChange={setExportOpen} engine={engine} onToast={showToast} />
      </div>
    </Tooltip.Provider>
  );
}

export default App;
