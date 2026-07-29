import * as Dialog from '@radix-ui/react-dialog';
import {
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Download,
  FileImage,
  FolderOpen,
  Image as ImageIcon,
  Monitor,
  Printer,
  RectangleHorizontal,
  RectangleVertical,
  Save,
  Smartphone,
  Sparkles,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { EditorEngine } from '../editor/EditorEngine';
import type { StorageEstimate } from '../storage/AssetStore';
import { useEditorStore } from '../store/editorStore';
import type { DocumentBitDepth, DocumentColorMode, DocumentNativeFormat } from '../types';
import { getSaveLocationMode, setSaveLocationMode, supportsSystemSavePicker, type SaveLocationMode } from '../lib/saveFile';

type NewDocumentCategory = 'recent' | 'saved' | 'common' | 'photo' | 'print' | 'web' | 'mobile' | 'video';
type SizeUnit = 'px' | 'mm' | 'cm' | 'in';
type ResolutionUnit = 'ppi' | 'ppcm';
type BackgroundMode = 'white' | 'black' | 'transparent' | 'custom';

export interface NewDocumentRequest {
  width: number;
  height: number;
  background: string;
  name: string;
  resolution: number;
  colorMode: DocumentColorMode;
  bitDepth: DocumentBitDepth;
  colorProfile: string;
  pixelAspectRatio: number;
  format: DocumentNativeFormat;
}

interface NewDocumentPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  unit: SizeUnit;
  resolution: number;
  colorMode: DocumentColorMode;
  bitDepth: DocumentBitDepth;
  colorProfile: string;
  pixelAspectRatio: number;
  backgroundMode: BackgroundMode;
  backgroundColor: string;
}

const RECENT_DOCUMENTS_KEY = 'dongni-market-recent-documents';
const SAVED_DOCUMENTS_KEY = 'dongni-market-saved-document-presets';

const COLOR_PROFILES: Record<DocumentColorMode, string[]> = {
  rgb: ['sRGB IEC61966-2.1', 'Display P3', 'Adobe RGB (1998)'],
  cmyk: ['Coated FOGRA39', 'Japan Color 2001 Coated', 'U.S. Web Coated (SWOP) v2'],
  grayscale: ['Gray Gamma 2.2', 'Dot Gain 20%'],
};

const DOCUMENT_CATEGORIES: Array<{ id: NewDocumentCategory; label: string; icon: typeof Clock3 }> = [
  { id: 'recent', label: '最近使用', icon: Clock3 },
  { id: 'saved', label: '已保存', icon: Bookmark },
  { id: 'common', label: '常用', icon: Sparkles },
  { id: 'photo', label: '照片', icon: ImageIcon },
  { id: 'print', label: '打印', icon: Printer },
  { id: 'web', label: 'Web', icon: Monitor },
  { id: 'mobile', label: '移动设备', icon: Smartphone },
  { id: 'video', label: '视频', icon: Video },
];

const DOCUMENT_PRESETS: Record<Exclude<NewDocumentCategory, 'recent' | 'saved'>, NewDocumentPreset[]> = {
  common: [
    { id: 'square-1080', label: '方形设计', width: 1080, height: 1080, unit: 'px', resolution: 72, colorMode: 'rgb', bitDepth: 8, colorProfile: 'sRGB IEC61966-2.1', pixelAspectRatio: 1, backgroundMode: 'white', backgroundColor: '#ffffff' },
    { id: 'landscape-hd', label: '横版高清', width: 1920, height: 1080, unit: 'px', resolution: 72, colorMode: 'rgb', bitDepth: 8, colorProfile: 'sRGB IEC61966-2.1', pixelAspectRatio: 1, backgroundMode: 'white', backgroundColor: '#ffffff' },
    { id: 'portrait-hd', label: '竖版高清', width: 1080, height: 1920, unit: 'px', resolution: 72, colorMode: 'rgb', bitDepth: 8, colorProfile: 'sRGB IEC61966-2.1', pixelAspectRatio: 1, backgroundMode: 'white', backgroundColor: '#ffffff' },
    { id: 'transparent-icon', label: '透明图标', width: 1024, height: 1024, unit: 'px', resolution: 72, colorMode: 'rgb', bitDepth: 8, colorProfile: 'sRGB IEC61966-2.1', pixelAspectRatio: 1, backgroundMode: 'transparent', backgroundColor: '#ffffff' },
  ],
  photo: [
    { id: 'photo-6x4', label: '照片 6 × 4 英寸', width: 6, height: 4, unit: 'in', resolution: 300, colorMode: 'rgb', bitDepth: 8, colorProfile: 'sRGB IEC61966-2.1', pixelAspectRatio: 1, backgroundMode: 'white', backgroundColor: '#ffffff' },
    { id: 'photo-5x7', label: '照片 5 × 7 英寸', width: 5, height: 7, unit: 'in', resolution: 300, colorMode: 'rgb', bitDepth: 8, colorProfile: 'Adobe RGB (1998)', pixelAspectRatio: 1, backgroundMode: 'white', backgroundColor: '#ffffff' },
    { id: 'id-photo', label: '证件照', width: 295, height: 413, unit: 'px', resolution: 300, colorMode: 'rgb', bitDepth: 8, colorProfile: 'sRGB IEC61966-2.1', pixelAspectRatio: 1, backgroundMode: 'white', backgroundColor: '#ffffff' },
    { id: 'photo-large', label: '高质量照片', width: 4000, height: 3000, unit: 'px', resolution: 300, colorMode: 'rgb', bitDepth: 16, colorProfile: 'Adobe RGB (1998)', pixelAspectRatio: 1, backgroundMode: 'white', backgroundColor: '#ffffff' },
  ],
  print: [
    { id: 'print-a4', label: 'A4 打印', width: 210, height: 297, unit: 'mm', resolution: 300, colorMode: 'cmyk', bitDepth: 8, colorProfile: 'Coated FOGRA39', pixelAspectRatio: 1, backgroundMode: 'white', backgroundColor: '#ffffff' },
    { id: 'print-a3', label: 'A3 海报', width: 297, height: 420, unit: 'mm', resolution: 300, colorMode: 'cmyk', bitDepth: 8, colorProfile: 'Coated FOGRA39', pixelAspectRatio: 1, backgroundMode: 'white', backgroundColor: '#ffffff' },
    { id: 'business-card', label: '标准名片', width: 90, height: 54, unit: 'mm', resolution: 300, colorMode: 'cmyk', bitDepth: 8, colorProfile: 'Coated FOGRA39', pixelAspectRatio: 1, backgroundMode: 'white', backgroundColor: '#ffffff' },
    { id: 'print-poster', label: '宣传单页', width: 148, height: 210, unit: 'mm', resolution: 300, colorMode: 'cmyk', bitDepth: 8, colorProfile: 'Japan Color 2001 Coated', pixelAspectRatio: 1, backgroundMode: 'white', backgroundColor: '#ffffff' },
  ],
  web: [
    { id: 'web-desktop', label: '桌面网页', width: 1440, height: 900, unit: 'px', resolution: 72, colorMode: 'rgb', bitDepth: 8, colorProfile: 'sRGB IEC61966-2.1', pixelAspectRatio: 1, backgroundMode: 'white', backgroundColor: '#ffffff' },
    { id: 'web-full-hd', label: '全高清网页', width: 1920, height: 1080, unit: 'px', resolution: 72, colorMode: 'rgb', bitDepth: 8, colorProfile: 'sRGB IEC61966-2.1', pixelAspectRatio: 1, backgroundMode: 'white', backgroundColor: '#ffffff' },
    { id: 'web-social-link', label: '社交分享图', width: 1200, height: 628, unit: 'px', resolution: 72, colorMode: 'rgb', bitDepth: 8, colorProfile: 'sRGB IEC61966-2.1', pixelAspectRatio: 1, backgroundMode: 'white', backgroundColor: '#ffffff' },
    { id: 'web-banner', label: '网页横幅', width: 1920, height: 600, unit: 'px', resolution: 72, colorMode: 'rgb', bitDepth: 8, colorProfile: 'sRGB IEC61966-2.1', pixelAspectRatio: 1, backgroundMode: 'white', backgroundColor: '#ffffff' },
  ],
  mobile: [
    { id: 'mobile-story', label: '手机竖屏', width: 1080, height: 1920, unit: 'px', resolution: 72, colorMode: 'rgb', bitDepth: 8, colorProfile: 'Display P3', pixelAspectRatio: 1, backgroundMode: 'white', backgroundColor: '#ffffff' },
    { id: 'mobile-iphone', label: 'iPhone 屏幕', width: 1170, height: 2532, unit: 'px', resolution: 72, colorMode: 'rgb', bitDepth: 8, colorProfile: 'Display P3', pixelAspectRatio: 1, backgroundMode: 'white', backgroundColor: '#ffffff' },
    { id: 'mobile-post', label: '竖版帖子', width: 1080, height: 1350, unit: 'px', resolution: 72, colorMode: 'rgb', bitDepth: 8, colorProfile: 'sRGB IEC61966-2.1', pixelAspectRatio: 1, backgroundMode: 'white', backgroundColor: '#ffffff' },
    { id: 'mobile-square', label: '方形社交图', width: 1080, height: 1080, unit: 'px', resolution: 72, colorMode: 'rgb', bitDepth: 8, colorProfile: 'sRGB IEC61966-2.1', pixelAspectRatio: 1, backgroundMode: 'white', backgroundColor: '#ffffff' },
  ],
  video: [
    { id: 'video-hd', label: 'HD 视频', width: 1280, height: 720, unit: 'px', resolution: 72, colorMode: 'rgb', bitDepth: 8, colorProfile: 'sRGB IEC61966-2.1', pixelAspectRatio: 1, backgroundMode: 'black', backgroundColor: '#000000' },
    { id: 'video-full-hd', label: 'Full HD 视频', width: 1920, height: 1080, unit: 'px', resolution: 72, colorMode: 'rgb', bitDepth: 8, colorProfile: 'sRGB IEC61966-2.1', pixelAspectRatio: 1, backgroundMode: 'black', backgroundColor: '#000000' },
    { id: 'video-4k', label: '4K UHD 视频', width: 3840, height: 2160, unit: 'px', resolution: 72, colorMode: 'rgb', bitDepth: 8, colorProfile: 'Display P3', pixelAspectRatio: 1, backgroundMode: 'black', backgroundColor: '#000000' },
    { id: 'video-vertical', label: '竖屏短视频', width: 1080, height: 1920, unit: 'px', resolution: 72, colorMode: 'rgb', bitDepth: 8, colorProfile: 'sRGB IEC61966-2.1', pixelAspectRatio: 1, backgroundMode: 'black', backgroundColor: '#000000' },
  ],
};

function readStoredPresets(key: string) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) as NewDocumentPreset[] : [];
  } catch {
    return [];
  }
}

function writeStoredPresets(key: string, presets: NewDocumentPreset[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(presets));
  } catch {
    // Storage can be unavailable in private browsing; document creation still works.
  }
}

function unitToPixels(value: number, unit: SizeUnit, resolution: number) {
  if (unit === 'px') return value;
  if (unit === 'in') return value * resolution;
  if (unit === 'cm') return value / 2.54 * resolution;
  return value / 25.4 * resolution;
}

function pixelsToUnit(value: number, unit: SizeUnit, resolution: number) {
  if (unit === 'px') return value;
  if (unit === 'in') return value / resolution;
  if (unit === 'cm') return value / resolution * 2.54;
  return value / resolution * 25.4;
}

function formatDimension(value: number) {
  return Math.round(value * 100) / 100;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(bytes > 100 * 1024 ** 2 ? 0 : 1)} MB`;
}

function presetBackgroundKey(preset: NewDocumentPreset) {
  if (preset.backgroundMode === 'transparent') return 'transparent';
  if (preset.backgroundMode === 'black') return '#000000';
  if (preset.backgroundMode === 'custom') return preset.backgroundColor;
  return '#ffffff';
}

export function NewCanvasDialog({
  open,
  onOpenChange,
  engine,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  engine: EditorEngine | null;
  onCreate?: (request: NewDocumentRequest) => Promise<void>;
}) {
  const [activeCategory, setActiveCategory] = useState<NewDocumentCategory>('recent');
  const [activePresetId, setActivePresetId] = useState('');
  const [recentPresets, setRecentPresets] = useState<NewDocumentPreset[]>([]);
  const [savedPresets, setSavedPresets] = useState<NewDocumentPreset[]>([]);
  const [name, setName] = useState('未标题-1');
  const [width, setWidth] = useState(1080);
  const [height, setHeight] = useState(1080);
  const [unit, setUnit] = useState<SizeUnit>('px');
  const [resolution, setResolution] = useState(72);
  const [resolutionUnit, setResolutionUnit] = useState<ResolutionUnit>('ppi');
  const [colorMode, setColorMode] = useState<DocumentColorMode>('rgb');
  const [bitDepth, setBitDepth] = useState<DocumentBitDepth>(8);
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>('white');
  const [backgroundColor, setBackgroundColor] = useState('#ffffff');
  const [colorProfile, setColorProfile] = useState('sRGB IEC61966-2.1');
  const [pixelAspectRatio, setPixelAspectRatio] = useState(1);
  const [nativeFormat, setNativeFormat] = useState<DocumentNativeFormat>('psd');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const recent = readStoredPresets(RECENT_DOCUMENTS_KEY);
    const saved = readStoredPresets(SAVED_DOCUMENTS_KEY);
    setRecentPresets(recent);
    setSavedPresets(saved);
    setActiveCategory(recent.length ? 'recent' : 'common');
    setError('');
  }, [open]);

  const pixelWidth = Math.max(1, Math.round(unitToPixels(width, unit, resolution)));
  const pixelHeight = Math.max(1, Math.round(unitToPixels(height, unit, resolution)));
  const resolutionDisplay = resolutionUnit === 'ppi' ? resolution : resolution / 2.54;
  const channelCount = colorMode === 'grayscale' ? 2 : colorMode === 'cmyk' ? 5 : 4;
  const estimatedMemory = pixelWidth * pixelHeight * channelCount * (bitDepth / 8);
  const currentPresets = activeCategory === 'recent'
    ? recentPresets
    : activeCategory === 'saved'
      ? savedPresets
      : DOCUMENT_PRESETS[activeCategory];

  const resolveBackground = () => {
    if (backgroundMode === 'transparent') return 'transparent';
    if (backgroundMode === 'black') return '#000000';
    if (backgroundMode === 'custom') return backgroundColor;
    return '#ffffff';
  };

  const applyPreset = (preset: NewDocumentPreset) => {
    setActivePresetId(preset.id);
    setWidth(preset.width);
    setHeight(preset.height);
    setUnit(preset.unit);
    setResolution(preset.resolution);
    setResolutionUnit('ppi');
    setColorMode(preset.colorMode);
    setBitDepth(preset.bitDepth);
    setColorProfile(preset.colorProfile);
    setPixelAspectRatio(preset.pixelAspectRatio);
    setBackgroundMode(preset.backgroundMode);
    setBackgroundColor(preset.backgroundColor);
    setError('');
  };

  const markCustom = () => {
    setActivePresetId('');
    setError('');
  };

  const changeUnit = (nextUnit: SizeUnit) => {
    const widthPixels = unitToPixels(width, unit, resolution);
    const heightPixels = unitToPixels(height, unit, resolution);
    setUnit(nextUnit);
    setWidth(formatDimension(pixelsToUnit(widthPixels, nextUnit, resolution)));
    setHeight(formatDimension(pixelsToUnit(heightPixels, nextUnit, resolution)));
    markCustom();
  };

  const changeColorMode = (nextMode: DocumentColorMode) => {
    setColorMode(nextMode);
    setColorProfile(COLOR_PROFILES[nextMode][0]);
    markCustom();
  };

  const currentPreset = (id: string, label: string): NewDocumentPreset => ({
    id,
    label,
    width,
    height,
    unit,
    resolution,
    colorMode,
    bitDepth,
    colorProfile,
    pixelAspectRatio,
    backgroundMode,
    backgroundColor,
  });

  const saveCurrentPreset = () => {
    const preset = currentPreset(`saved-${Date.now()}`, name.trim() || `自定义 ${pixelWidth} × ${pixelHeight}`);
    const next = [preset, ...savedPresets].slice(0, 20);
    setSavedPresets(next);
    writeStoredPresets(SAVED_DOCUMENTS_KEY, next);
    setActiveCategory('saved');
    setActivePresetId(preset.id);
  };

  const deleteSavedPreset = (id: string) => {
    const next = savedPresets.filter((preset) => preset.id !== id);
    setSavedPresets(next);
    writeStoredPresets(SAVED_DOCUMENTS_KEY, next);
    if (activePresetId === id) setActivePresetId('');
  };

  const createDocument = async () => {
    if (!engine) return;
    if (!Number.isFinite(pixelWidth) || !Number.isFinite(pixelHeight) || pixelWidth < 64 || pixelHeight < 64) {
      setError('宽度和高度至少需要 64 像素。');
      return;
    }
    if (pixelWidth > 16384 || pixelHeight > 16384 || pixelWidth * pixelHeight > 150_000_000) {
      setError('当前尺寸过大，最长边不能超过 16384 像素，总像素不能超过 1.5 亿。');
      return;
    }
    const recentPreset = currentPreset(`recent-${Date.now()}`, name.trim() || `自定义 ${pixelWidth} × ${pixelHeight}`);
    const signature = `${pixelWidth}x${pixelHeight}-${resolution}-${colorMode}-${bitDepth}-${resolveBackground()}`;
    const nextRecent = [recentPreset, ...recentPresets.filter((preset) => {
      const presetSignature = `${Math.round(unitToPixels(preset.width, preset.unit, preset.resolution))}x${Math.round(unitToPixels(preset.height, preset.unit, preset.resolution))}-${preset.resolution}-${preset.colorMode}-${preset.bitDepth}-${presetBackgroundKey(preset)}`;
      return presetSignature !== signature;
    })].slice(0, 12);
    try {
      const request: NewDocumentRequest = {
        width: pixelWidth,
        height: pixelHeight,
        background: resolveBackground(),
        name: name.trim() || '未标题-1',
        resolution,
        colorMode,
        bitDepth,
        colorProfile,
        pixelAspectRatio,
        format: nativeFormat,
      };
      if (onCreate) await onCreate(request);
      else await engine.newDocument(request.width, request.height, request.background, true, request);
      writeStoredPresets(RECENT_DOCUMENTS_KEY, nextRecent);
      setRecentPresets(nextRecent);
      onOpenChange(false);
    } catch {
      setError('无法创建当前文档，请减小尺寸或位深后重试。');
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content new-document-dialog">
          <header className="new-document-header">
            <div><Dialog.Title>新建文档</Dialog.Title><Dialog.Description>从专业预设开始，或精确设置尺寸、分辨率与颜色模式</Dialog.Description></div>
            <Dialog.Close className="dialog-close"><X size={18} /></Dialog.Close>
          </header>

          <nav className="new-document-tabs" aria-label="文档预设分类">
            {DOCUMENT_CATEGORIES.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" className={activeCategory === id ? 'is-active' : ''} onClick={() => { setActiveCategory(id); setActivePresetId(''); }}>
                <Icon size={15} /><span>{label}</span>
                {id === 'recent' && recentPresets.length > 0 && <small>{recentPresets.length}</small>}
                {id === 'saved' && savedPresets.length > 0 && <small>{savedPresets.length}</small>}
              </button>
            ))}
          </nav>

          <div className="new-document-body">
            <section className="preset-browser">
              <div className="preset-browser-heading">
                <div><strong>{DOCUMENT_CATEGORIES.find((category) => category.id === activeCategory)?.label}</strong><span>{currentPresets.length ? `共 ${currentPresets.length} 个预设` : '本机暂无记录'}</span></div>
                <span>选择后仍可在右侧继续调整</span>
              </div>
              {currentPresets.length > 0 ? (
                <div className="document-preset-grid">
                  {currentPresets.map((preset) => {
                    const presetPixelWidth = Math.round(unitToPixels(preset.width, preset.unit, preset.resolution));
                    const presetPixelHeight = Math.round(unitToPixels(preset.height, preset.unit, preset.resolution));
                    const isSaved = activeCategory === 'saved';
                    return (
                      <article key={preset.id} className={`document-preset-card ${activePresetId === preset.id ? 'is-active' : ''}`}>
                        <button type="button" className="document-preset-main" onClick={() => applyPreset(preset)}>
                          <span className="preset-canvas-preview"><i style={{ aspectRatio: `${presetPixelWidth} / ${presetPixelHeight}`, background: presetBackgroundKey(preset) === 'transparent' ? 'transparent' : presetBackgroundKey(preset) }} /></span>
                          <span className="preset-card-copy"><strong>{preset.label}</strong><small>{formatDimension(preset.width)} × {formatDimension(preset.height)} {preset.unit} · {preset.resolution} ppi</small><em>{preset.colorMode.toUpperCase()} · {preset.bitDepth} bit</em></span>
                          {activePresetId === preset.id && <Check className="preset-check" size={15} />}
                        </button>
                        {isSaved && <button type="button" className="preset-delete" aria-label={`删除预设 ${preset.label}`} onClick={() => deleteSavedPreset(preset.id)}><Trash2 size={14} /></button>}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="new-document-empty">
                  {activeCategory === 'recent' ? <Clock3 size={30} /> : <Bookmark size={30} />}
                  <strong>{activeCategory === 'recent' ? '还没有最近使用的文档' : '还没有保存的预设'}</strong>
                  <span>{activeCategory === 'recent' ? '创建文档后，尺寸和颜色设置会自动出现在这里。' : '在右侧设置完成后，点击“保存当前预设”。'}</span>
                  <button type="button" onClick={() => setActiveCategory('common')}>浏览常用预设</button>
                </div>
              )}
            </section>

            <aside className="document-settings-panel">
              <div className="settings-panel-heading"><div><strong>预设详细信息</strong><span>{pixelWidth} × {pixelHeight} 像素</span></div><FileImage size={19} /></div>
              <label className="new-doc-name"><span>名称</span><input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></label>

              <div className="new-doc-field-group">
                <span className="new-doc-field-label">尺寸</span>
                <div className="dimension-row">
                  <label><span>宽度</span><input type="number" min={0.01} step={unit === 'px' ? 1 : 0.01} value={width} onChange={(event) => { setWidth(Number(event.target.value)); markCustom(); }} /></label>
                  <label><span>高度</span><input type="number" min={0.01} step={unit === 'px' ? 1 : 0.01} value={height} onChange={(event) => { setHeight(Number(event.target.value)); markCustom(); }} /></label>
                  <label className="unit-field"><span>单位</span><select value={unit} onChange={(event) => changeUnit(event.target.value as SizeUnit)}><option value="px">像素</option><option value="mm">毫米</option><option value="cm">厘米</option><option value="in">英寸</option></select></label>
                </div>
                <div className="orientation-row">
                  <span>方向</span>
                  <div><button type="button" className={pixelHeight >= pixelWidth ? 'is-active' : ''} aria-label="竖向" onClick={() => { if (pixelWidth > pixelHeight) { setWidth(height); setHeight(width); markCustom(); } }}><RectangleVertical size={18} /></button><button type="button" className={pixelWidth >= pixelHeight ? 'is-active' : ''} aria-label="横向" onClick={() => { if (pixelHeight > pixelWidth) { setWidth(height); setHeight(width); markCustom(); } }}><RectangleHorizontal size={18} /></button></div>
                  <small>实际像素 {pixelWidth} × {pixelHeight}</small>
                </div>
              </div>

              <div className="new-doc-two-column">
                <label><span>分辨率</span><div className="input-with-select"><input type="number" min={1} max={2400} step={1} value={formatDimension(resolutionDisplay)} onChange={(event) => { const value = Number(event.target.value); setResolution(resolutionUnit === 'ppi' ? value : value * 2.54); markCustom(); }} /><select value={resolutionUnit} onChange={(event) => setResolutionUnit(event.target.value as ResolutionUnit)}><option value="ppi">像素/英寸</option><option value="ppcm">像素/厘米</option></select></div></label>
                <label><span>位深度</span><select value={bitDepth} onChange={(event) => { setBitDepth(Number(event.target.value) as DocumentBitDepth); markCustom(); }}><option value={8}>8 bit</option><option value={16}>16 bit</option></select></label>
              </div>

              <div className="new-doc-two-column">
                <label><span>颜色模式</span><select value={colorMode} onChange={(event) => changeColorMode(event.target.value as DocumentColorMode)}><option value="rgb">RGB 颜色</option><option value="cmyk">CMYK 颜色</option><option value="grayscale">灰度</option></select></label>
                <label><span>背景内容</span><select value={backgroundMode} onChange={(event) => { setBackgroundMode(event.target.value as BackgroundMode); markCustom(); }}><option value="white">白色</option><option value="black">黑色</option><option value="transparent">透明</option><option value="custom">自定义颜色</option></select></label>
              </div>

              <label className="new-doc-format"><span>默认文档格式</span><select value={nativeFormat} onChange={(event) => setNativeFormat(event.target.value as DocumentNativeFormat)}><option value="psd">PSD · 默认分层文档</option><option value="psb">PSB · 超大分层文档</option><option value="tiff">TIFF · 高质量图像</option><option value="tuyan">东尼工程 · 本地工程</option></select></label>

              {backgroundMode === 'custom' && <label className="custom-background-row"><span>背景颜色</span><div><input type="color" value={backgroundColor} onChange={(event) => { setBackgroundColor(event.target.value); markCustom(); }} /><code>{backgroundColor.toUpperCase()}</code></div></label>}

              {colorMode === 'cmyk' && <div className="color-mode-notice"><Printer size={15} /><span><strong>CMYK 打印设置</strong>浏览器画布仍以 RGB 预览；颜色模式与配置文件会保存到工程中，PNG/JPEG/WebP 导出会转换为 RGB。</span></div>}

              <button type="button" className="advanced-options-toggle" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((value) => !value)}>{advancedOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}高级选项</button>
              {advancedOpen && <div className="advanced-options-panel">
                <label><span>颜色配置文件</span><select value={colorProfile} onChange={(event) => { setColorProfile(event.target.value); markCustom(); }}>{COLOR_PROFILES[colorMode].map((profile) => <option key={profile} value={profile}>{profile}</option>)}</select></label>
                <label><span>像素长宽比</span><select value={pixelAspectRatio} onChange={(event) => { setPixelAspectRatio(Number(event.target.value)); markCustom(); }}><option value={1}>方形像素 (1.0)</option><option value={0.91}>NTSC 标准 (0.91)</option><option value={1.09}>PAL 标准 (1.09)</option><option value={1.33}>变形宽银幕 (1.33)</option></select></label>
              </div>}

              <div className="new-document-metrics"><div><span>画布像素</span><strong>{(pixelWidth * pixelHeight / 1_000_000).toFixed(1)} MP</strong></div><div><span>预计内存</span><strong>{formatBytes(estimatedMemory)}</strong></div><div><span>颜色</span><strong>{colorMode.toUpperCase()} / {bitDepth} bit</strong></div></div>
              {error && <div className="new-document-error" role="alert">{error}</div>}
              <button type="button" className="save-document-preset" onClick={saveCurrentPreset}><Save size={14} />保存当前预设</button>
            </aside>
          </div>

          <footer className="dialog-footer new-document-footer"><div><span>所有设置仅保存在本机</span><small>当前最大支持 16384 px 长边</small></div><Dialog.Close asChild><button type="button" className="secondary-action">取消</button></Dialog.Close><button type="button" className="primary-action" disabled={!engine} onClick={() => void createDocument()}>创建文档</button></footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ExportDialog({
  open,
  onOpenChange,
  engine,
  onToast,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  engine: EditorEngine | null;
  onToast: (message: string, tone?: 'default' | 'success' | 'error') => void;
}) {
  const [format, setFormat] = useState<'project' | 'png' | 'jpeg' | 'webp' | 'tiff' | 'pdf' | 'psd' | 'psb'>('psd');
  const [quality, setQuality] = useState(0.92);
  const [filename, setFilename] = useState('东尼菜市场作品');
  const [exporting, setExporting] = useState(false);
  const [outputWidth, setOutputWidth] = useState(1080);
  const [outputHeight, setOutputHeight] = useState(1080);
  const [lockAspect, setLockAspect] = useState(true);
  const [storageInfo, setStorageInfo] = useState<StorageEstimate | null>(null);
  const [saveLocation, setSaveLocation] = useState<SaveLocationMode>(() => getSaveLocationMode());
  const artboards = useEditorStore((state) => state.artboards);
  const documentInfo = engine?.getDocumentInfo() ?? { width: 1080, height: 1080, rawBytes: 1080 * 1080 * 4, layerCount: 0 };
  const aspect = documentInfo.width / documentInfo.height;

  useEffect(() => {
    if (!open || !engine) return;
    const info = engine.getDocumentInfo();
    setOutputWidth(info.width);
    setOutputHeight(info.height);
    setFilename(info.name || '东尼菜市场作品');
    setFormat(info.format === 'tuyan' ? 'project' : info.format || 'psd');
    void engine.getStorageInfo().then(setStorageInfo).catch(() => setStorageInfo(null));
  }, [open, engine]);

  useEffect(() => {
    setSaveLocationMode(saveLocation);
  }, [saveLocation]);

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
    if (bytes < 1024 ** 4) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
    return `${(bytes / 1024 ** 4).toFixed(2)} TB`;
  };
  const rawBytes = outputWidth * outputHeight * 4;
  const layeredEstimatedBytes = engine?.estimateLayeredDocumentBytes() || documentInfo.rawBytes;
  const autoPsb = format === 'psd' && layeredEstimatedBytes >= 2 * 1024 ** 3;
  const effectiveFormat = autoPsb ? 'psb' : format;
  const isLayeredFormat = ['project', 'psd', 'psb'].includes(format);
  const projectEstimatedBytes = engine ? new Blob([JSON.stringify(engine.serializeProject())]).size : 0;
  const compressionFactor = format === 'png' ? 0.48 : format === 'tiff' ? 1.02 : format === 'jpeg' ? 0.1 + quality * 0.2 : format === 'webp' ? 0.08 + quality * 0.16 : format === 'pdf' ? 0.16 + quality * 0.2 : 0.55;
  const estimatedBytes = format === 'project' ? projectEstimatedBytes : ['psd', 'psb'].includes(format) ? layeredEstimatedBytes : rawBytes * compressionFactor;
  const storageBackend = storageInfo?.backend === 'tauri'
    ? 'Windows AppData 本机目录'
    : storageInfo?.backend === 'opfs'
      ? '浏览器本地文件系统（OPFS）'
      : storageInfo?.backend === 'indexeddb'
        ? '浏览器数据库（IndexedDB 回退）'
        : '正在检测本机存储…';

  const formatOptions = [
    { id: 'project', label: '工程', hint: '可继续编辑' },
    { id: 'psd', label: 'PSD', hint: '保留图层' },
    { id: 'psb', label: 'PSB', hint: '超大文档' },
    { id: 'png', label: 'PNG', hint: '透明背景' },
    { id: 'jpeg', label: 'JPEG', hint: '体积较小' },
    { id: 'webp', label: 'WebP', hint: '现代格式' },
    { id: 'tiff', label: 'TIFF', hint: '无损高质量' },
    { id: 'pdf', label: 'PDF', hint: '单页文档' },
  ] as const;

  const exportFile = async () => {
    if (!engine) return;
    setExporting(true);
    try {
      let result: { bytes: number; width: number; height: number; cancelled?: boolean };
      if (format === 'project') result = await engine.exportProject();
      else if (format === 'pdf') result = await engine.exportPdf(outputWidth, outputHeight, filename, quality);
      else if (format === 'tiff') result = await engine.exportTiff(outputWidth, outputHeight, filename);
      else if (format === 'psd' || format === 'psb') result = await engine.exportPsd(filename, effectiveFormat === 'psb');
      else result = await engine.exportImage(format, quality, outputWidth, outputHeight, filename);
      if (result.cancelled) return;
      onToast(`${effectiveFormat === 'project' ? '工程' : effectiveFormat.toUpperCase()} 已导出，文件大小 ${formatBytes(result.bytes)}`, 'success');
      onOpenChange(false);
    } catch (error) {
      onToast(error instanceof Error ? error.message : '导出失败，请降低分辨率后重试', 'error');
    } finally {
      setExporting(false);
    }
  };

  const exportAll = async () => {
    if (!engine || !['png', 'jpeg', 'webp'].includes(format)) return;
    setExporting(true);
    try {
      const multiplier = Math.max(1, Math.round(outputWidth / documentInfo.width));
      const result = await engine.exportAllArtboards(format as 'png' | 'jpeg' | 'webp', quality, multiplier);
      if (result.cancelled) return;
      onToast(`已导出 ${result.count} 个画板，总大小 ${formatBytes(result.bytes)}`, 'success');
      onOpenChange(false);
    } catch {
      onToast('批量导出失败，请降低分辨率后重试', 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content export-dialog">
          <div className="dialog-header"><div><Dialog.Title>存储与导出</Dialog.Title><Dialog.Description>选择可继续编辑的工程格式，或输出通用图片文件</Dialog.Description></div><Dialog.Close className="dialog-close"><X size={17} /></Dialog.Close></div>
          <div className="export-preview"><div className="checker-preview"><FileImage size={34} /><span>{isLayeredFormat ? '图层、智能对象和画板信息将随文件保存' : '透明区域将显示为网格，导出后按所选格式处理'}</span></div></div>
          <label className="dialog-field"><span>文件名</span><input value={filename} onChange={(event) => setFilename(event.target.value)} /></label>
          <div className="dialog-field"><span>格式</span><div className="format-options">
            {formatOptions.map((item) => <button key={item.id} type="button" className={format === item.id ? 'is-active' : ''} onClick={() => setFormat(item.id)}>{item.label}<small>{item.hint}</small></button>)}
          </div></div>
          {autoPsb && <div className="psb-auto-notice"><strong>将自动改用 PSB</strong><span>当前分层数据预计为 {formatBytes(layeredEstimatedBytes)}，超过 PSD 的 2GB 建议边界。</span></div>}
          {format === 'psb' && !autoPsb && <div className="psb-auto-notice is-manual"><strong>PSB 超大文档</strong><span>适合大型分层文件；普通文件也可以手动选择 PSB。</span></div>}
          {['jpeg', 'webp', 'pdf'].includes(format) && <label className="dialog-field"><span>图片质量 <output>{Math.round(quality * 100)}%</output></span><input type="range" min={0.4} max={1} step={0.01} value={quality} onChange={(event) => setQuality(Number(event.target.value))} /></label>}
          {!isLayeredFormat && <div className="dialog-field export-size-field">
            <span>图片大小 <button type="button" className={lockAspect ? 'aspect-lock is-active' : 'aspect-lock'} onClick={() => setLockAspect((value) => !value)}>{lockAspect ? '比例已锁定' : '自由尺寸'}</button></span>
            <div className="export-size-inputs">
              <label><small>宽度 px</small><input type="number" min={1} max={16384} value={outputWidth} onChange={(event) => {
                const width = Math.max(1, Number(event.target.value));
                setOutputWidth(width);
                if (lockAspect) setOutputHeight(Math.max(1, Math.round(width / aspect)));
              }} /></label>
              <span>×</span>
              <label><small>高度 px</small><input type="number" min={1} max={16384} value={outputHeight} onChange={(event) => {
                const height = Math.max(1, Number(event.target.value));
                setOutputHeight(height);
                if (lockAspect) setOutputWidth(Math.max(1, Math.round(height * aspect)));
              }} /></label>
            </div>
            <div className="multiplier-options">{[1, 2, 3].map((item) => <button key={item} type="button" className={outputWidth === documentInfo.width * item && outputHeight === documentInfo.height * item ? 'is-active' : ''} onClick={() => { setOutputWidth(documentInfo.width * item); setOutputHeight(documentInfo.height * item); }}>{item}×</button>)}</div>
          </div>}
          <div className="dialog-field storage-format-options">
            <span>文件存储方式</span>
            <div className="save-location-options" role="radiogroup" aria-label="电脑保存位置">
              <label className={saveLocation === 'ask' ? 'is-active' : ''}>
                <input type="radio" name="save-location" value="ask" checked={saveLocation === 'ask'} onChange={() => setSaveLocation('ask')} />
                <i><FolderOpen size={16} /></i>
                <span><strong>每次选择电脑位置</strong><small>保存时打开系统窗口，可选择桌面、磁盘或任意文件夹</small></span>
              </label>
              <label className={saveLocation === 'downloads' ? 'is-active' : ''}>
                <input type="radio" name="save-location" value="downloads" checked={saveLocation === 'downloads'} onChange={() => setSaveLocation('downloads')} />
                <i><Download size={16} /></i>
                <span><strong>浏览器默认下载目录</strong><small>不再询问位置，直接使用浏览器设置的下载文件夹</small></span>
              </label>
            </div>
            {saveLocation === 'ask' && !supportsSystemSavePicker() && <div className="save-location-note">当前浏览器不支持系统保存窗口，将自动使用默认下载目录；建议使用 Chrome、Edge 或 Windows 下载版。</div>}
            <div className="storage-method-list">
              <div><i className="storage-status-dot" /><span><strong>{storageBackend}</strong><small>{storageInfo?.backend === 'tauri' ? '原图与工程分块保存在当前 Windows 用户目录' : storageInfo ? `已使用 ${formatBytes(storageInfo.usage)} · 可用 ${formatBytes(storageInfo.remaining)}` : '图片不会上传服务器'}</small></span></div>
              <div><i>1</i><span><strong>东尼工程 · .tuyan.json</strong><small>备份画板、图层、区域、工作流和智能对象信息</small></span></div>
              <div><i>2</i><span><strong>Photoshop 交换 · PSD / PSB</strong><small>PSD 适合普通分层文件，预计超过 2GB 时自动切换 PSB</small></span></div>
              <div><i>3</i><span><strong>通用交付 · PNG / JPEG / WebP / TIFF / PDF</strong><small>TIFF 用于高质量存储，其余格式适合发布、打印或发送</small></span></div>
            </div>
          </div>
          <div className="export-metrics">
            <div><span>输出尺寸</span><strong>{isLayeredFormat ? `${documentInfo.width} × ${documentInfo.height}` : `${outputWidth} × ${outputHeight}`} px</strong></div>
            <div><span>{isLayeredFormat ? '分层数据' : '像素内存'}</span><strong>{formatBytes(isLayeredFormat ? layeredEstimatedBytes : rawBytes)}</strong></div>
            <div><span>预计文件</span><strong>约 {formatBytes(estimatedBytes)}</strong></div>
          </div>
          <div className="dialog-footer export-dialog-footer">
            <Dialog.Close asChild><button type="button" className="secondary-action">取消</button></Dialog.Close>
            {artboards.length > 1 && ['png', 'jpeg', 'webp'].includes(format) && <button type="button" className="secondary-action export-all-action" disabled={exporting} onClick={() => void exportAll()}><Download size={16} />导出全部画板</button>}
            <button type="button" className="primary-action" disabled={exporting} onClick={() => void exportFile()}><Download size={16} />{exporting ? '正在存储…' : `${saveLocation === 'ask' ? '选择位置并保存' : '下载'} ${effectiveFormat === 'project' ? '工程' : effectiveFormat.toUpperCase()}`}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
