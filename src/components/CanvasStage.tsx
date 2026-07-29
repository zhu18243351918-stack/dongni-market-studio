import { useEffect, useRef } from 'react';
import { EditorEngine } from '../editor/EditorEngine';
import { restoreStoredFonts } from '../lib/fontManager';
import { useEditorStore } from '../store/editorStore';
import { useAuth } from '../auth/authContext';
import { isDesktopApp } from '../auth/supabase';
import type { ProjectDocument, SmartObjectSource } from '../types';

const DROP_MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  psd: 'image/vnd.adobe.photoshop',
  psb: 'image/vnd.adobe.photoshop',
  json: 'application/json',
};

interface CanvasStageProps {
  onReady: (engine: EditorEngine) => void;
  initialProject?: ProjectDocument;
  onInitialized?: (project: ProjectDocument) => void;
  onDocumentChange?: (project: ProjectDocument) => void;
  onOpenSmartObject?: (source: SmartObjectSource) => void;
  onToast: (message: string, tone?: 'default' | 'success' | 'error') => void;
}

export function CanvasStage({ onReady, initialProject, onInitialized, onDocumentChange, onOpenSmartObject, onToast }: CanvasStageProps) {
  const auth = useAuth();
  const userId = auth.session?.userId || 'anonymous';
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const showGrid = useEditorStore((state) => state.showGrid);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!wrapper || !canvas || !overlay) return;

    const store = useEditorStore.getState();
    let active = true;
    let unlistenNativeDrop: (() => void) | undefined;
    const engine = new EditorEngine(canvas, overlay, {
      onLayers: (layers) => useEditorStore.getState().setLayers(layers),
      onArtboards: (artboards, activeArtboardId) => useEditorStore.getState().setArtboards(artboards, activeArtboardId),
      onRegions: (regions) => useEditorStore.getState().setRegions(regions),
      onWorkflows: (workflows) => useEditorStore.getState().setWorkflows(workflows),
      onSelection: (id, type, inspector, adjustments, selectedIds) => {
        const state = useEditorStore.getState();
        state.setSelection(id, type, selectedIds);
        if (inspector) state.setInspector(inspector);
        if (adjustments) state.setAdjustments(adjustments);
      },
      onHistory: (canUndo, canRedo) => useEditorStore.getState().setHistoryState(canUndo, canRedo),
      onZoom: (zoom) => useEditorStore.getState().setZoom(zoom),
      onViewport: (x, y) => useEditorStore.getState().setViewport(x, y),
      onDocumentChange: (project) => {
        onDocumentChange?.(project);
      },
      onProcessing: (processing, label) => useEditorStore.getState().setProcessing(processing, label),
      onToast,
      onToolChange: (tool) => useEditorStore.getState().setTool(tool),
      onOpenSmartObject,
    }, { userId });
    engine.setTool(store.activeTool);
    onReady(engine);

    const resize = () => engine.resize(wrapper.clientWidth, wrapper.clientHeight);
    let mobileRefitTimer: number | null = null;
    const refitMobile = () => {
      if (!window.matchMedia('(max-width: 767px), (max-width: 900px) and (pointer: coarse)').matches) return;
      if (mobileRefitTimer !== null) window.clearTimeout(mobileRefitTimer);
      mobileRefitTimer = window.setTimeout(() => {
        if (!active || document.visibilityState === 'hidden') return;
        window.scrollTo(0, 0);
        resize();
      }, 120);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refitMobile();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(wrapper);
    resize();
    window.addEventListener('pageshow', refitMobile);
    window.addEventListener('orientationchange', refitMobile);
    window.visualViewport?.addEventListener('resize', refitMobile);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    if (isDesktopApp) {
      void Promise.all([import('@tauri-apps/api/window'), import('@tauri-apps/api/core')]).then(async ([windowApi, coreApi]) => {
        if (!active) return;
        unlistenNativeDrop = await windowApi.getCurrentWindow().onDragDropEvent((event) => {
          if (!active || event.payload.type !== 'drop' || !event.payload.paths.length) return;
          const paths = [...event.payload.paths];
          const path = paths[0];
          const fileName = path.split(/[\\/]/).pop() || 'dropped-file';
          const extension = fileName.split('.').pop()?.toLowerCase() || '';
          onToast('正在读取拖入的文件…');
          void coreApi.invoke<ArrayBuffer | Uint8Array | number[]>('read_dropped_file', { path }).then((payload) => {
            if (!active) return;
            const bytes = payload instanceof ArrayBuffer
              ? new Uint8Array(payload)
              : payload instanceof Uint8Array
                ? payload
                : Uint8Array.from(payload);
            const buffer = new ArrayBuffer(bytes.byteLength);
            new Uint8Array(buffer).set(bytes);
            const file = new File([buffer], fileName, { type: DROP_MIME_TYPES[extension] || 'application/octet-stream' });
            window.dispatchEvent(new CustomEvent('dongni:request-import', { detail: file }));
            if (paths.length > 1) onToast('已读取第一个文件，请完成导入后再拖入其他文件');
          }).catch((error: unknown) => {
            onToast(error instanceof Error ? error.message : '拖入文件读取失败', 'error');
          });
        });
      }).catch(() => onToast('Windows 文件拖放初始化失败，请使用“打开文件”', 'error'));
    }

    void restoreStoredFonts()
      .then((fonts) => {
        if (!active) return;
        useEditorStore.getState().setFontFamilies(fonts);
        return engine.initialize(initialProject);
      })
      .catch(() => active ? engine.initialize() : undefined)
      .then(() => { if (active) onInitialized?.(engine.serializeProject()); });

    const pointers = new Map<number, { x: number; y: number }>();
    let lastDistance = 0;
    let lastMidpoint: { x: number; y: number } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        lastDistance = Math.hypot(a.x - b.x, a.y - b.y);
        lastMidpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size !== 2) return;
      event.preventDefault();
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (lastDistance > 0) engine.zoomBy(distance / lastDistance);
      if (lastMidpoint) engine.panBy(midpoint.x - lastMidpoint.x, midpoint.y - lastMidpoint.y);
      lastDistance = distance;
      lastMidpoint = midpoint;
    };
    const onPointerUp = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) {
        lastDistance = 0;
        lastMidpoint = null;
      }
    };
    wrapper.addEventListener('pointerdown', onPointerDown);
    wrapper.addEventListener('pointermove', onPointerMove, { passive: false });
    wrapper.addEventListener('pointerup', onPointerUp);
    wrapper.addEventListener('pointercancel', onPointerUp);

    return () => {
      active = false;
      if (mobileRefitTimer !== null) window.clearTimeout(mobileRefitTimer);
      observer.disconnect();
      window.removeEventListener('pageshow', refitMobile);
      window.removeEventListener('orientationchange', refitMobile);
      window.visualViewport?.removeEventListener('resize', refitMobile);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unlistenNativeDrop?.();
      wrapper.removeEventListener('pointerdown', onPointerDown);
      wrapper.removeEventListener('pointermove', onPointerMove);
      wrapper.removeEventListener('pointerup', onPointerUp);
      wrapper.removeEventListener('pointercancel', onPointerUp);
      engine.destroy();
    };
  }, [initialProject, onDocumentChange, onInitialized, onOpenSmartObject, onReady, onToast, userId]);

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) window.dispatchEvent(new CustomEvent('dongni:request-import', { detail: file }));
  };

  return (
    <div
      ref={wrapperRef}
      className="canvas-stage"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      {showGrid && <div className="canvas-grid" />}
      <canvas ref={canvasRef} />
      <canvas ref={overlayRef} className="selection-overlay" />
      <div className="drop-hint">拖入 PNG、JPEG、WebP、TIFF、PSD 或 PSB</div>
    </div>
  );
}
