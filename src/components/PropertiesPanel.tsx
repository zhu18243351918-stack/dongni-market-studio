import * as ToggleGroup from '@radix-ui/react-toggle-group';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDown,
  ArrowUp,
  Bandage,
  Brush,
  Check,
  Copy,
  Crop,
  FlipHorizontal2,
  FlipVertical2,
  Group,
  Layers2,
  LayoutTemplate,
  Move,
  Play,
  Plus,
  ScanFace,
  ScanLine,
  Scissors,
  Circle,
  Minus,
  Square,
  Triangle,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Ungroup,
  Upload,
  Workflow,
  Grid3X3,
  Palette,
  PaintBucket,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/authContext';
import type { EditorEngine } from '../editor/EditorEngine';
import { importFontFile } from '../lib/fontManager';
import { useEditorStore } from '../store/editorStore';
import type { ImageAdjustments, InspectorState, SelectionRefineSettings } from '../types';
import type { RegionDefinition, WorkflowStep } from '../types';
import { FILTER_CATEGORIES, FILTER_PRESETS, TEMPLATE_PRESETS } from '../data/editorPresets';
import { deleteCustomTemplate, loadCustomTemplates, saveCustomTemplate } from '../lib/projectDb';
import type { CustomTemplateRecord } from '../types';

function RangeControl({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = '',
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
  onCommit?: () => void;
}) {
  return (
    <label className="range-control">
      <span><b>{label}</b><output>{Math.round(value * 10) / 10}{suffix}</output></span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  onCommit: () => void;
}) {
  return (
    <label className="number-field">
      <span>{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? Math.round(value * 10) / 10 : 0}
        onChange={(event) => onChange(Number(event.target.value))}
        onBlur={onCommit}
        onKeyDown={(event) => event.key === 'Enter' && onCommit()}
      />
    </label>
  );
}

function TransformSection({ engine }: { engine: EditorEngine }) {
  const inspector = useEditorStore((state) => state.inspector);
  const setInspector = useEditorStore((state) => state.setInspector);
  const selectedType = useEditorStore((state) => state.selectedType);

  const update = (value: Partial<InspectorState>) => {
    setInspector(value);
    engine.updateActiveProperties(value);
  };

  return (
    <section className="inspector-section">
      <div className="section-title"><span>变换</span><small>{selectedType}</small></div>
      <div className="field-grid">
        <NumberField label="X" value={inspector.x} onChange={(x) => update({ x })} onCommit={() => engine.commitPropertyChange()} />
        <NumberField label="Y" value={inspector.y} onChange={(y) => update({ y })} onCommit={() => engine.commitPropertyChange()} />
        <NumberField label="宽" value={inspector.width} onChange={(width) => update({ width })} onCommit={() => engine.commitPropertyChange()} />
        <NumberField label="高" value={inspector.height} onChange={(height) => update({ height })} onCommit={() => engine.commitPropertyChange()} />
        <NumberField label="旋转" value={inspector.angle} onChange={(angle) => update({ angle })} onCommit={() => engine.commitPropertyChange()} />
      </div>
      <div className="icon-button-row six">
        <button type="button" title="左对齐" onClick={() => engine.align('left')}><AlignStartVertical size={15} /></button>
        <button type="button" title="水平居中" onClick={() => engine.align('center')}><AlignCenterVertical size={15} /></button>
        <button type="button" title="右对齐" onClick={() => engine.align('right')}><AlignEndVertical size={15} /></button>
        <button type="button" title="顶对齐" onClick={() => engine.align('top')}><AlignStartHorizontal size={15} /></button>
        <button type="button" title="垂直居中" onClick={() => engine.align('middle')}><AlignCenterHorizontal size={15} /></button>
        <button type="button" title="底对齐" onClick={() => engine.align('bottom')}><AlignEndHorizontal size={15} /></button>
      </div>
      <div className="icon-button-row">
        <button type="button" onClick={() => engine.flip('x')}><FlipHorizontal2 size={15} />水平翻转</button>
        <button type="button" onClick={() => engine.flip('y')}><FlipVertical2 size={15} />垂直翻转</button>
      </div>
      <RangeControl
        label="图层不透明度"
        value={inspector.opacity * 100}
        min={0}
        max={100}
        suffix="%"
        onChange={(value) => update({ opacity: value / 100 })}
        onCommit={() => engine.commitPropertyChange()}
      />
    </section>
  );
}

type ShapeType = 'rect' | 'ellipse' | 'triangle' | 'line';

function ShapeLibrarySection({ engine }: { engine: EditorEngine }) {
  const setTool = useEditorStore((state) => state.setTool);
  const shapes: Array<{ id: ShapeType; name: string; hint: string; icon: typeof Square }> = [
    { id: 'rect', name: '矩形', hint: '支持圆角与三种描边位置', icon: Square },
    { id: 'ellipse', name: '圆形', hint: '创建正圆并自由缩放', icon: Circle },
    { id: 'triangle', name: '三角形', hint: '适合标识与几何构图', icon: Triangle },
    { id: 'line', name: '直线', hint: '可调颜色、宽度和旋转', icon: Minus },
  ];

  const createShape = (type: ShapeType) => {
    engine.setTool('select');
    engine.addShape(type);
    setTool('select');
  };

  return (
    <section className="inspector-section shape-library-section">
      <div className="section-title"><span>几何图形</span><small>创建后自动进入选择模式</small></div>
      <div className="shape-library-grid">
        {shapes.map((shape) => {
          const Icon = shape.icon;
          return (
            <button type="button" key={shape.id} onClick={() => createShape(shape.id)}>
              <span className="shape-library-icon"><Icon size={21} strokeWidth={1.8} /></span>
              <strong>{shape.name}</strong>
              <small>{shape.hint}</small>
            </button>
          );
        })}
      </div>
      <p className="shape-library-note">矩形、圆形和三角形支持内部、居中、外部描边；矩形创建后可继续调节圆角。</p>
    </section>
  );
}

function AppearanceSection({ engine }: { engine: EditorEngine }) {
  const inspector = useEditorStore((state) => state.inspector);
  const selectedType = useEditorStore((state) => state.selectedType);
  const setInspector = useEditorStore((state) => state.setInspector);
  const fontFamilies = useEditorStore((state) => state.fontFamilies);
  const addFontFamily = useEditorStore((state) => state.addFontFamily);
  const fontInput = useRef<HTMLInputElement>(null);
  const [gradientStart, setGradientStart] = useState('#38bdf8');
  const [gradientEnd, setGradientEnd] = useState('#6366f1');
  const [gradientAngle, setGradientAngle] = useState(0);
  const [strokeGradientStart, setStrokeGradientStart] = useState('#f97316');
  const [strokeGradientEnd, setStrokeGradientEnd] = useState('#7c3aed');
  const [strokeGradientAngle, setStrokeGradientAngle] = useState(0);
  const [fontStatus, setFontStatus] = useState('');
  const update = (value: Partial<InspectorState>) => {
    setInspector(value);
    engine.updateActiveProperties(value);
    engine.commitPropertyChange();
  };

  if (!['rect', 'circle', 'triangle', 'line', 'i-text', 'textbox', 'text', 'path'].includes(selectedType || '')) return null;
  const supportsStrokePosition = ['rect', 'circle', 'triangle'].includes(selectedType || '');
  const maxCornerRadius = Math.max(0, Math.min(200, Math.min(inspector.width, inspector.height) / 2));
  return (
    <section className="inspector-section">
      <div className="section-title"><span>外观</span></div>
      {selectedType !== 'line' && (
        <>
          <label className="color-field"><span>填充</span><input type="color" value={inspector.fill} onChange={(event) => update({ fill: event.target.value, fillOpacity: inspector.fillOpacity })} /><code>{inspector.fill}</code></label>
          <RangeControl
            label="填充颜色不透明度"
            value={inspector.fillOpacity * 100}
            min={0}
            max={100}
            suffix="%"
            onChange={(value) => { setInspector({ fillOpacity: value / 100 }); engine.updateActiveProperties({ fillOpacity: value / 100 }); }}
            onCommit={() => engine.commitPropertyChange()}
          />
        </>
      )}
      <label className="color-field"><span>描边</span><input type="color" value={inspector.stroke} onChange={(event) => update({ stroke: event.target.value, strokeOpacity: inspector.strokeOpacity })} /><code>{inspector.stroke}</code></label>
      <RangeControl
        label="描边颜色不透明度"
        value={inspector.strokeOpacity * 100}
        min={0}
        max={100}
        suffix="%"
        onChange={(value) => { setInspector({ strokeOpacity: value / 100 }); engine.updateActiveProperties({ strokeOpacity: value / 100 }); }}
        onCommit={() => engine.commitPropertyChange()}
      />
      <RangeControl label="描边宽度" value={inspector.strokeWidth} min={0} max={40} onChange={(strokeWidth) => { setInspector({ strokeWidth }); engine.updateActiveProperties({ strokeWidth }); }} onCommit={() => engine.commitPropertyChange()} />
      {supportsStrokePosition && (
        <div className="stroke-position-field">
          <span>描边位置</span>
          <ToggleGroup.Root
            type="single"
            className="segmented-control stroke-position-control"
            value={inspector.strokePosition}
            onValueChange={(strokePosition) => strokePosition && update({ strokePosition: strokePosition as InspectorState['strokePosition'] })}
            aria-label="描边位置"
          >
            <ToggleGroup.Item value="outside">外部</ToggleGroup.Item>
            <ToggleGroup.Item value="center">居中</ToggleGroup.Item>
            <ToggleGroup.Item value="inside">内部</ToggleGroup.Item>
          </ToggleGroup.Root>
        </div>
      )}
      {selectedType === 'rect' && (
        <RangeControl
          label="矩形圆角"
          value={inspector.cornerRadius}
          min={0}
          max={maxCornerRadius}
          suffix="px"
          onChange={(cornerRadius) => { setInspector({ cornerRadius }); engine.updateActiveProperties({ cornerRadius }); }}
          onCommit={() => engine.commitPropertyChange()}
        />
      )}
      {selectedType === 'i-text' && (
        <div className="text-controls">
          <label><span>字体</span><select value={inspector.fontFamily} onChange={(event) => update({ fontFamily: event.target.value })}>
            <option value="Microsoft YaHei">微软雅黑</option>
            <option value="SimSun">宋体</option>
            <option value="Arial">Arial</option>
            <option value="Georgia">Georgia</option>
            <option value="Impact">Impact</option>
            {fontFamilies.map((font) => <option key={font} value={font}>{font}</option>)}
          </select></label>
          <NumberField label="字号" value={inspector.fontSize} onChange={(fontSize) => { setInspector({ fontSize }); engine.updateActiveProperties({ fontSize }); }} onCommit={() => engine.commitPropertyChange()} />
          <button type="button" className="font-import-button" onClick={() => fontInput.current?.click()}><Upload size={14} />导入本地字体</button>
          <input
            ref={fontInput}
            hidden
            type="file"
            accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                setFontStatus('正在载入字体…');
                void importFontFile(file).then((font) => {
                  addFontFamily(font);
                  update({ fontFamily: font });
                  setFontStatus(`已导入 ${font}`);
                }).catch((error: Error) => setFontStatus(error.message || '字体文件无法载入'));
              }
              event.currentTarget.value = '';
            }}
          />
          {fontStatus && <small className="font-status">{fontStatus}</small>}
        </div>
      )}
      {selectedType !== 'line' && (
        <div className="gradient-controls">
          <div className="section-title"><span>渐变填充</span><small>线性</small></div>
          <div className="gradient-color-row">
            <label><span>起始</span><input type="color" value={gradientStart} onChange={(event) => setGradientStart(event.target.value)} /></label>
            <span className="gradient-arrow">→</span>
            <label><span>结束</span><input type="color" value={gradientEnd} onChange={(event) => setGradientEnd(event.target.value)} /></label>
          </div>
          <RangeControl label="渐变角度" value={gradientAngle} min={0} max={360} suffix="°" onChange={setGradientAngle} />
          <div className="icon-button-row">
            <button type="button" onClick={() => engine.applyActiveGradient(gradientStart, gradientEnd, gradientAngle, inspector.fillOpacity)}>应用渐变</button>
            <button type="button" onClick={() => engine.clearActiveGradient(inspector.fill, inspector.fillOpacity)}>恢复纯色</button>
          </div>
        </div>
      )}
      <div className="gradient-controls stroke-gradient-controls">
        <div className="section-title"><span>渐变描边</span><small>线性</small></div>
        <div className="gradient-color-row">
          <label><span>起始</span><input type="color" value={strokeGradientStart} onChange={(event) => setStrokeGradientStart(event.target.value)} /></label>
          <span className="gradient-arrow">→</span>
          <label><span>结束</span><input type="color" value={strokeGradientEnd} onChange={(event) => setStrokeGradientEnd(event.target.value)} /></label>
        </div>
        <RangeControl label="渐变角度" value={strokeGradientAngle} min={0} max={360} suffix="°" onChange={setStrokeGradientAngle} />
        <div className="icon-button-row">
          <button type="button" onClick={() => engine.applyActiveStrokeGradient(strokeGradientStart, strokeGradientEnd, strokeGradientAngle, inspector.strokeOpacity)}>应用渐变描边</button>
          <button type="button" onClick={() => engine.clearActiveStrokeGradient(inspector.stroke, inspector.strokeOpacity)}>恢复纯色描边</button>
        </div>
      </div>
    </section>
  );
}

function ImageSection({ engine }: { engine: EditorEngine }) {
  const adjustments = useEditorStore((state) => state.adjustments);
  const setAdjustments = useEditorStore((state) => state.setAdjustments);
  const update = (next: Partial<ImageAdjustments>) => {
    const merged = { ...adjustments, ...next };
    setAdjustments(next);
    engine.updateImageAdjustments(merged);
  };
  const controls: Array<[keyof ImageAdjustments, string, number, number]> = [
    ['brightness', '亮度', -100, 100],
    ['contrast', '对比度', -100, 100],
    ['saturation', '饱和度', -100, 100],
    ['temperature', '色温', -100, 100],
    ['hue', '色相', -180, 180],
    ['blur', '模糊', 0, 20],
  ];
  return (
    <>
      <section className="inspector-section">
        <div className="section-title"><span>快速裁剪</span><Crop size={14} /></div>
        <div className="preset-grid crop-grid">
          <button type="button" onClick={() => engine.cropSelected(null)}>原图</button>
          <button type="button" onClick={() => engine.cropSelected(1)}>1:1</button>
          <button type="button" onClick={() => engine.cropSelected(4 / 3)}>4:3</button>
          <button type="button" onClick={() => engine.cropSelected(16 / 9)}>16:9</button>
          <button type="button" onClick={() => engine.cropSelected(9 / 16)}>9:16</button>
        </div>
      </section>
      <section className="inspector-section">
        <div className="section-title"><span>调整</span><small>非破坏参数</small></div>
        {controls.map(([key, label, min, max]) => (
          <RangeControl
            key={key}
            label={label}
            value={adjustments[key]}
            min={min}
            max={max}
            onChange={(value) => update({ [key]: value })}
            onCommit={() => engine.updateImageAdjustments(adjustments, true)}
          />
        ))}
        <div className="filter-strip">
          <button type="button" onClick={() => engine.applyFilterPreset('none')}>原图</button>
          <button type="button" onClick={() => engine.applyFilterPreset('vivid')}>鲜明</button>
          <button type="button" onClick={() => engine.applyFilterPreset('warm')}>暖调</button>
          <button type="button" onClick={() => engine.applyFilterPreset('cool')}>冷调</button>
          <button type="button" onClick={() => engine.applyFilterPreset('mono')}>黑白</button>
        </div>
      </section>
      <section className="inspector-section">
        <div className="section-title"><span>图层蒙版</span><Scissors size={14} /></div>
        <div className="stacked-actions">
          <button type="button" onClick={() => void engine.toggleActiveMask()}>启用 / 停用蒙版</button>
          <button type="button" className="danger-subtle" onClick={() => void engine.deleteActiveMask()}>删除蒙版并恢复原图</button>
          <button type="button" className="danger-subtle" onClick={() => void engine.restoreOriginalImage()}>整图还原</button>
        </div>
      </section>
    </>
  );
}

function SelectionSection({ engine }: { engine: EditorEngine }) {
  const activeTool = useEditorStore((state) => state.activeTool);
  const combine = useEditorStore((state) => state.selectionCombine);
  const setCombine = useEditorStore((state) => state.setSelectionCombine);
  const tolerance = useEditorStore((state) => state.selectionTolerance);
  const setTolerance = useEditorStore((state) => state.setSelectionTolerance);
  const contiguous = useEditorStore((state) => state.selectionContiguous);
  const setContiguous = useEditorStore((state) => state.setSelectionContiguous);
  const brushSize = useEditorStore((state) => state.brushSize);
  const setBrushSize = useEditorStore((state) => state.setBrushSize);
  const brushSubtract = useEditorStore((state) => state.brushSubtract);
  const setBrushSubtract = useEditorStore((state) => state.setBrushSubtract);
  const previewMode = useEditorStore((state) => state.previewMode);
  const setPreviewMode = useEditorStore((state) => state.setPreviewMode);
  const refine = useEditorStore((state) => state.refine);
  const setRefine = useEditorStore((state) => state.setRefine);
  const setTool = useEditorStore((state) => state.setTool);
  const [fillColor, setFillColor] = useState('#ff6b35');
  const [fillOpacity, setFillOpacity] = useState(100);

  const selectionTools = ['edge-cutout', 'quick-select', 'magic-wand', 'lasso', 'polygon-lasso'];
  if (!selectionTools.includes(activeTool)) return null;

  const updateRefine = (next: Partial<SelectionRefineSettings>) => setRefine(next);
  return (
    <section className="selection-workflow">
      <div className="selection-hero">
        <div className="selection-orb"><Scissors size={18} /></div>
        <div><strong>{activeTool === 'edge-cutout' ? '主体选区预览' : activeTool === 'magic-wand' ? 'PS 魔棒删除背景' : '选择并遮住'}</strong><span>{activeTool === 'edge-cutout' ? '只预览、不直接删除；红色区域会被移除' : activeTool === 'magic-wand' ? '点击需要删除的背景颜色，红色区域将被隐藏' : '先建立选区，再优化边缘并生成蒙版'}</span></div>
      </div>
      <div className="inspector-section compact">
        <div className="section-title"><span>选区方式</span></div>
        <ToggleGroup.Root className="segmented-control" type="single" value={combine} onValueChange={(value) => value && setCombine(value as typeof combine)}>
          <ToggleGroup.Item value="replace">新建</ToggleGroup.Item>
          <ToggleGroup.Item value="add">{activeTool === 'magic-wand' ? '追加背景' : '添加'}</ToggleGroup.Item>
          <ToggleGroup.Item value="subtract">{activeTool === 'magic-wand' ? '恢复区域' : '减去'}</ToggleGroup.Item>
        </ToggleGroup.Root>
        {activeTool === 'magic-wand' && (
          <>
            <RangeControl label="颜色容差" value={tolerance} min={4} max={80} onChange={setTolerance} />
            <label className="checkbox-row"><input type="checkbox" checked={contiguous} onChange={(event) => setContiguous(event.target.checked)} /><span>只选择连续区域</span><small>避免选中主体内部的相同颜色</small></label>
          </>
        )}
        {(activeTool === 'quick-select' || activeTool === 'edge-cutout') && (
          <>
            <RangeControl label="画笔大小" value={brushSize} min={8} max={160} onChange={setBrushSize} suffix="px" />
            <ToggleGroup.Root className="segmented-control" type="single" value={brushSubtract ? 'subtract' : 'foreground'} onValueChange={(value) => value && setBrushSubtract(value === 'subtract')}>
              <ToggleGroup.Item value="foreground">标记主体</ToggleGroup.Item>
              <ToggleGroup.Item value="subtract">标记背景</ToggleGroup.Item>
            </ToggleGroup.Root>
            {activeTool === 'edge-cutout' && <button type="button" className="secondary-action full-width" onClick={() => void engine.oneClickCutout()}>重新识别主体预览</button>}
          </>
        )}
        {activeTool === 'polygon-lasso' && (
          <button type="button" className="primary-action full-width polygon-finish" onClick={() => void engine.finishPolygonSelection()}><Check size={15} />完成并闭合选区</button>
        )}
        <div className="selection-actions-grid">
          <button type="button" onClick={() => void engine.selectAllPixels()}>全选</button>
          <button type="button" onClick={() => void engine.invertPixelSelection()}>反选</button>
          <button type="button" onClick={() => engine.clearPixelSelection()}>清除</button>
        </div>
      </div>
      <div className="inspector-section compact">
        <div className="section-title"><span>预览背景</span></div>
        <ToggleGroup.Root className="preview-modes" type="single" value={previewMode} onValueChange={(value) => {
          if (!value) return;
          setPreviewMode(value as typeof previewMode);
          engine.setPreviewMode(value as typeof previewMode);
        }}>
          <ToggleGroup.Item value="overlay"><i className="preview-swatch red" />叠加</ToggleGroup.Item>
          <ToggleGroup.Item value="transparent"><i className="preview-swatch checker" />透明</ToggleGroup.Item>
          <ToggleGroup.Item value="black"><i className="preview-swatch black" />黑底</ToggleGroup.Item>
          <ToggleGroup.Item value="white"><i className="preview-swatch white" />白底</ToggleGroup.Item>
        </ToggleGroup.Root>
      </div>
      <div className="inspector-section compact">
        <div className="section-title"><span>边缘优化</span></div>
        <RangeControl label="平滑" value={refine.smooth} min={0} max={20} onChange={(smooth) => updateRefine({ smooth })} />
        <RangeControl label="羽化" value={refine.feather} min={0} max={20} onChange={(feather) => updateRefine({ feather })} suffix="px" />
        <RangeControl label="扩展 / 收缩" value={refine.expand} min={-20} max={20} onChange={(expand) => updateRefine({ expand })} suffix="px" />
        <RangeControl label="边缘对比度" value={refine.contrast} min={0} max={100} onChange={(contrast) => updateRefine({ contrast })} suffix="%" />
        <RangeControl label="边缘偏移" value={refine.shiftEdge} min={-20} max={20} onChange={(shiftEdge) => updateRefine({ shiftEdge })} suffix="px" />
        <button type="button" className="secondary-action" onClick={() => void engine.refineSelection(refine)}>更新边缘</button>
      </div>
      <div className="selection-output-actions">
        <button type="button" className="secondary-action" onClick={() => void engine.duplicateSelectionAsLayer()}><Copy size={15} />复制为新图层</button>
        <div className="selection-fill-controls">
          <label><span>填色</span><input type="color" value={fillColor} onChange={(event) => setFillColor(event.target.value)} /></label>
          <label><span>不透明度</span><input type="number" min={0} max={100} value={fillOpacity} onChange={(event) => setFillOpacity(Math.max(0, Math.min(100, Number(event.target.value))))} /></label>
          <button type="button" className="secondary-action" onClick={() => void engine.fillPixelSelection(fillColor, fillOpacity / 100)}><PaintBucket size={15} />选区填色</button>
        </div>
        <button type="button" className="secondary-action" onClick={() => { setTool('patch'); engine.setTool('patch'); }}><Bandage size={15} />使用选区修补</button>
        <button type="button" className="primary-action" onClick={() => void engine.applySelectionMask()}><Scissors size={15} />{activeTool === 'edge-cutout' ? '确认抠图并生成蒙版' : '生成图层蒙版'}</button>
      </div>
    </section>
  );
}

function EraserSection({ engine }: { engine: EditorEngine }) {
  const activeTool = useEditorStore((state) => state.activeTool);
  const eraserSize = useEditorStore((state) => state.eraserSize);
  const setEraserSize = useEditorStore((state) => state.setEraserSize);
  const restoring = activeTool === 'restore-brush';
  return (
    <section className="selection-workflow">
      <div className="selection-hero">
        <div className="selection-orb"><Brush size={18} /></div>
        <div><strong>{restoring ? '恢复笔刷' : '擦除笔刷'}</strong><span>{restoring ? '涂回上传时的原图细节，不会生成新像素' : '涂掉蒙版中的多余内容，松开鼠标后应用'}</span></div>
      </div>
      <div className="inspector-section">
        <RangeControl label="笔刷大小" value={eraserSize} min={8} max={240} suffix="px" onChange={setEraserSize} />
        <div className="eraser-note">每次笔刷操作都会进入撤销历史，可随时撤销或整图还原。</div>
        <button type="button" className="secondary-action full-width" onClick={() => void engine.restoreOriginalImage()}>恢复上传时的整张原图</button>
      </div>
    </section>
  );
}

function PaintBrushSection() {
  const brushSize = useEditorStore((state) => state.brushSize);
  const setBrushSize = useEditorStore((state) => state.setBrushSize);
  return (
    <section className="selection-workflow">
      <div className="selection-hero">
        <div className="selection-orb"><Brush size={18} /></div>
        <div><strong>自由画笔</strong><span>圆形光标会实时显示实际绘制范围</span></div>
      </div>
      <div className="inspector-section">
        <RangeControl label="画笔大小" value={brushSize} min={8} max={160} suffix="px" onChange={setBrushSize} />
        <div className="eraser-note">画笔圆圈会随缩放比例和笔刷大小同步变化。</div>
      </div>
    </section>
  );
}

function FaceRetouchSection({ engine }: { engine: EditorEngine }) {
  const beautySmooth = useEditorStore((state) => state.beautySmooth);
  const faceSlim = useEditorStore((state) => state.faceSlim);
  const setBeautySmooth = useEditorStore((state) => state.setBeautySmooth);
  const setFaceSlim = useEditorStore((state) => state.setFaceSlim);
  const setTool = useEditorStore((state) => state.setTool);
  return (
    <section className="selection-workflow">
      <div className="selection-hero">
        <div className="selection-orb"><ScanFace size={18} /></div>
        <div><strong>人脸识别与美颜</strong><span>本地识别清晰正脸，图片不会上传服务器</span></div>
      </div>
      <div className="inspector-section">
        <button type="button" className="primary-action full-width beauty-one-click" onClick={() => void engine.oneClickBeauty()}><Sparkles size={15} />一键美颜</button>
        <button type="button" className="secondary-action full-width" onClick={() => void engine.detectFaceSelection()}><ScanFace size={15} />识别人脸并建立选区</button>
        <button type="button" className="secondary-action full-width" onClick={() => void engine.useCurrentSelectionAsFaceRegion()}><Check size={15} />使用当前选区作为美颜区域</button>
        <button type="button" className="secondary-action full-width" onClick={() => { setTool('polygon-lasso'); engine.setTool('polygon-lasso'); }}><ScanLine size={15} />手动框选脸部区域</button>
        <RangeControl label="磨皮美颜" value={beautySmooth} min={0} max={100} suffix="%" onChange={setBeautySmooth} />
        <RangeControl label="瘦脸强度" value={faceSlim} min={0} max={100} suffix="%" onChange={setFaceSlim} />
        <div className="eraser-note">识别不到人脸时，可手动框选脸部、皮肤或需要磨皮的区域，再返回美颜工具应用。处理结果支持撤销。</div>
        <button type="button" className="primary-action full-width" onClick={() => void engine.applyFaceRetouch(beautySmooth, faceSlim)}><Sparkles size={15} />应用美颜与瘦脸</button>
      </div>
    </section>
  );
}

function PatchSection({ engine }: { engine: EditorEngine }) {
  const setTool = useEditorStore((state) => state.setTool);
  return (
    <section className="selection-workflow">
      <div className="selection-hero">
        <div className="selection-orb"><Bandage size={18} /></div>
        <div><strong>修补工具</strong><span>把附近干净像素复制并融合到框选区域</span></div>
      </div>
      <div className="inspector-section">
        <div className="patch-steps"><span>1</span><p>先用套索框选污点、杂物或需要修复的区域</p><span>2</span><p>切回修补工具，把选区拖到附近干净位置取样</p><span>3</span><p>松开后自动融合，选区会保留供继续修补</p></div>
        <button type="button" className="secondary-action full-width" onClick={() => { setTool('polygon-lasso'); engine.setTool('polygon-lasso'); }}><ScanLine size={15} />创建多边形修补选区</button>
        <button type="button" className="secondary-action full-width" onClick={() => { setTool('lasso'); engine.setTool('lasso'); }}><Brush size={15} />创建自由修补选区</button>
      </div>
    </section>
  );
}

function LiquifySection() {
  const liquifySize = useEditorStore((state) => state.liquifySize);
  const liquifyStrength = useEditorStore((state) => state.liquifyStrength);
  const setLiquifySize = useEditorStore((state) => state.setLiquifySize);
  const setLiquifyStrength = useEditorStore((state) => state.setLiquifyStrength);
  return (
    <section className="selection-workflow">
      <div className="selection-hero">
        <div className="selection-orb"><Move size={18} /></div>
        <div><strong>局部拉扯</strong><span>参考瘦脸瘦身液化笔，在人物轮廓上直接推拉</span></div>
      </div>
      <div className="inspector-section">
        <RangeControl label="作用范围" value={liquifySize} min={30} max={420} suffix="px" onChange={setLiquifySize} />
        <RangeControl label="拉扯强度" value={liquifyStrength} min={5} max={100} suffix="%" onChange={setLiquifyStrength} />
        <div className="liquify-guide">
          <span><i />向脸颊或腰部内侧拖动：收窄</span>
          <span><i />向外侧拖动：塑形或恢复</span>
        </div>
        <div className="eraser-note">圆形光标显示真实作用范围。每次松开鼠标会写入撤销历史，建议使用短距离、多次拖动。</div>
      </div>
    </section>
  );
}

function TemplateSection({
  engine,
  onCreateTemplateDocument,
  onCreateCustomTemplateDocument,
}: {
  engine: EditorEngine;
  onCreateTemplateDocument?: (templateId: string) => Promise<void>;
  onCreateCustomTemplateDocument?: (template: CustomTemplateRecord) => Promise<void>;
}) {
  const auth = useAuth();
  const setTool = useEditorStore((state) => state.setTool);
  const setRightTab = useEditorStore((state) => state.setRightTab);
  const activeArtboardId = useEditorStore((state) => state.activeArtboardId);
  const artboards = useEditorStore((state) => state.artboards);
  const [customTemplates, setCustomTemplates] = useState<CustomTemplateRecord[]>([]);
  const [customName, setCustomName] = useState('');
  const [saving, setSaving] = useState(false);
  const [customStatus, setCustomStatus] = useState<{ message: string; error?: boolean } | null>(null);
  const userId = auth.session?.userId || 'anonymous';

  useEffect(() => {
    void loadCustomTemplates(userId).then(setCustomTemplates);
  }, [userId]);

  const finishTemplateAction = () => {
    engine.setTool('select');
    setTool('select');
    setRightTab('properties');
  };

  const addPresetToCurrent = async (templateId: string) => {
    await engine.applyTemplate(templateId);
    finishTemplateAction();
  };

  const createPresetFile = async (templateId: string) => {
    await onCreateTemplateDocument?.(templateId);
    finishTemplateAction();
  };

  const addCustomToCurrent = async (template: CustomTemplateRecord) => {
    await engine.applyCustomTemplate(template);
    finishTemplateAction();
  };

  const createCustomFile = async (template: CustomTemplateRecord) => {
    await onCreateCustomTemplateDocument?.(template);
    finishTemplateAction();
  };

  const saveCurrentAsTemplate = async () => {
    if (saving) return;
    setSaving(true);
    setCustomStatus(null);
    try {
      const activeArtboard = artboards.find((artboard) => artboard.id === activeArtboardId);
      const template = await engine.createCustomTemplate(customName.trim() || `${activeArtboard?.name || '画板'}模板`);
      await saveCustomTemplate(template);
      setCustomTemplates(await loadCustomTemplates(userId));
      setCustomName('');
      setCustomStatus({ message: '已保存到本地模板，下次打开仍可使用。' });
    } catch (error) {
      setCustomStatus({ message: error instanceof Error ? error.message : '模板保存失败', error: true });
    } finally {
      setSaving(false);
    }
  };

  const removeCustomTemplate = async (id: string) => {
    await deleteCustomTemplate(id);
    setCustomTemplates((items) => items.filter((item) => item.id !== id));
  };

  return (
    <section className="selection-workflow productivity-panel">
      <div className="selection-hero">
        <div className="selection-orb"><LayoutTemplate size={18} /></div>
        <div><strong>模板市场</strong><span>选择模板即可生成可编辑画板，所有文字和形状都能继续修改</span></div>
      </div>
      <div className="template-library">
        {TEMPLATE_PRESETS.map((template) => (
          <article className="template-card" key={template.id}>
            <button
              type="button"
              className={`template-thumb template-${template.id}`}
              title={`使用${template.name}模板`}
              aria-label={`将${template.name}模板添加到当前画板`}
              onClick={() => void addPresetToCurrent(template.id)}
            >
              <span>{template.category}</span><strong>{template.name}</strong><small>点击使用</small>
            </button>
            <div className="template-card-copy"><strong>{template.name}</strong><span>{template.size}</span><small>{template.description}</small></div>
            <div className="template-card-actions">
              <button type="button" className="secondary-action" onClick={() => void addPresetToCurrent(template.id)}>添加到当前画板</button>
              <button type="button" className="primary-action" onClick={() => void createPresetFile(template.id)}>新文件创建</button>
            </div>
          </article>
        ))}
        {customTemplates.length > 0 && <div className="custom-template-heading"><strong>我的本地模板</strong><span>{customTemplates.length} 个</span></div>}
        {customTemplates.map((template) => (
          <article className="template-card custom-template-card" key={template.id}>
            <button type="button" className="template-thumb custom-template-thumb" onClick={() => void addCustomToCurrent(template)} aria-label={`将${template.name}添加到当前画板`}>
              <img src={template.previewDataUrl} alt="" /><span>本地</span><strong>{template.name}</strong><small>点击使用</small>
            </button>
            <div className="template-card-copy"><strong>{template.name}</strong><span>{template.width} × {template.height}</span><small>保存在本机，图层、文字和样式可继续编辑</small></div>
            <div className="template-card-actions custom-template-actions">
              <button type="button" className="secondary-action" onClick={() => void addCustomToCurrent(template)}>添加到当前画板</button>
              <button type="button" className="primary-action" onClick={() => void createCustomFile(template)}>新文件创建</button>
              <button type="button" className="custom-template-delete" onClick={() => void removeCustomTemplate(template.id)}><Trash2 size={13} />删除模板</button>
            </div>
          </article>
        ))}
        <section className="save-custom-template-card">
          <div><span><Plus size={16} /></span><strong>保存当前画板为模板</strong><small>保留图层、文字、形状和图层样式，仅保存在本机。</small></div>
          <input value={customName} onChange={(event) => setCustomName(event.target.value)} placeholder="模板名称，如：我的商品主图" maxLength={50} />
          {customStatus && <div className={`custom-template-status ${customStatus.error ? 'is-error' : ''}`}>{customStatus.message}</div>}
          <button type="button" className="primary-action" disabled={saving} onClick={() => void saveCurrentAsTemplate()}>{saving ? '正在保存…' : '保存到本地模板'}</button>
        </section>
      </div>
    </section>
  );
}

function FilterLibrarySection({ engine }: { engine: EditorEngine }) {
  const [category, setCategory] = useState<(typeof FILTER_CATEGORIES)[number]['id']>('landscape');
  const artboards = useEditorStore((state) => state.artboards);
  const activeArtboardId = useEditorStore((state) => state.activeArtboardId);
  const presets = FILTER_PRESETS.filter((preset) => preset.category === category);
  return (
    <section className="selection-workflow productivity-panel">
      <div className="selection-hero">
        <div className="selection-orb"><SlidersHorizontal size={18} /></div>
        <div><strong>分类滤镜</strong><span>风景、食物和人像分别提供多种本地滤镜</span></div>
      </div>
      <div className="filter-category-tabs">
        {FILTER_CATEGORIES.map((item) => <button type="button" key={item.id} className={category === item.id ? 'is-active' : ''} onClick={() => setCategory(item.id)}>{item.name}</button>)}
      </div>
      <div className="filter-library-grid">
        {presets.map((preset) => (
          <article className="filter-library-card" key={preset.id}>
            <button type="button" className="filter-swatch" style={{ background: `linear-gradient(135deg, ${preset.colors[0]}, ${preset.colors[1]})` }} onClick={() => engine.applyFilterToArtboards(preset.id, [activeArtboardId])} aria-label={`应用${preset.name}`}><Sparkles size={17} /></button>
            <div><strong>{preset.name}</strong><small>{preset.description}</small></div>
            <div className="filter-apply-actions">
              <button type="button" onClick={() => engine.applyFilterToArtboards(preset.id, [activeArtboardId])}>当前画板</button>
              <button type="button" onClick={() => engine.applyFilterToArtboards(preset.id, artboards.map((artboard) => artboard.id))}>全部画板</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function StyleLibrarySection({ engine }: { engine: EditorEngine }) {
  const artboards = useEditorStore((state) => state.artboards);
  const activeArtboardId = useEditorStore((state) => state.activeArtboardId);
  const styles = [
    { id: 'pixel' as const, name: '像素风格', description: '方块像素、鲜明轮廓，适合游戏素材和复古头像', icon: Grid3X3 },
    { id: 'comic' as const, name: '漫画风格', description: '加强线条与色彩对比，形成插画和漫画效果', icon: Palette },
  ];
  return (
    <section className="selection-workflow productivity-panel style-library-panel">
      <div className="selection-hero">
        <div className="selection-orb"><Palette size={18} /></div>
        <div><strong>风格转换</strong><span>一键转换当前或全部画板中的图片图层，原图仍保存在本机</span></div>
      </div>
      <div className="style-library-grid">
        {styles.map(({ id, name, description, icon: Icon }) => (
          <article className={`style-library-card style-${id}`} key={id}>
            <div className="style-preview"><Icon size={24} /><span>{id === 'pixel' ? '8 BIT' : 'COMIC'}</span></div>
            <div><strong>{name}</strong><small>{description}</small></div>
            <div className="style-apply-actions">
              <button type="button" onClick={() => engine.applyVisualStyle(id, [activeArtboardId])}>当前画板</button>
              <button type="button" onClick={() => engine.applyVisualStyle(id, artboards.map((artboard) => artboard.id))}>全部画板</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function RegionEditorCard({ region, engine }: { region: RegionDefinition; engine: EditorEngine }) {
  const [name, setName] = useState(region.name);
  const [text, setText] = useState(region.text);
  return (
    <article className="region-card">
      <div className="region-card-heading"><span>区域</span><input aria-label={`区域${region.name}名称`} value={name} onChange={(event) => setName(event.target.value)} onBlur={() => engine.updateRegion(region.id, { name })} /><button type="button" aria-label={`删除区域${region.name}`} onClick={() => engine.deleteRegion(region.id)}><Trash2 size={14} /></button></div>
      <label><span>批量文字</span><textarea value={text} onChange={(event) => setText(event.target.value)} onBlur={() => engine.updateRegion(region.id, { text })} placeholder="例如：新品上市 / 123" /></label>
      <div className="region-style-row">
        <label><span>字号</span><input type="number" min={10} max={300} value={region.fontSize} onChange={(event) => engine.updateRegion(region.id, { fontSize: Number(event.target.value) })} /></label>
        <label><span>颜色</span><input type="color" value={region.color} onChange={(event) => engine.updateRegion(region.id, { color: event.target.value })} /></label>
      </div>
      <button type="button" className="primary-action full-width" onClick={() => engine.fillRegionAcrossArtboards(region.id, text)}><ScanLine size={15} />填写到所有画板</button>
    </article>
  );
}

function RegionSection({ engine }: { engine: EditorEngine }) {
  const regions = useEditorStore((state) => state.regions);
  return (
    <section className="selection-workflow productivity-panel">
      <div className="selection-hero">
        <div className="selection-orb"><ScanLine size={18} /></div>
        <div><strong>跨画板区域</strong><span>在画板上拖拽框选，并命名为 a、b、c 或任意名称</span></div>
      </div>
      <div className="region-help">在当前画板中按住鼠标拖出矩形。区域位置会按比例同步到其他尺寸的画板。</div>
      {regions.length ? <div className="region-list">{regions.map((region) => <RegionEditorCard key={region.id} region={region} engine={engine} />)}</div> : <div className="panel-empty compact"><ScanLine size={24} /><strong>还没有区域</strong><span>请直接在画板上拖拽框选第一个区域</span></div>}
      {regions.length > 0 && <div className="region-batch-footer"><button type="button" className="primary-action full-width" onClick={() => engine.fillAllRegionsAcrossArtboards()}><Sparkles size={15} />一键填写所有区域</button></div>}
    </section>
  );
}

function describeWorkflowStep(step: WorkflowStep) {
  if (step.type === 'filter') return `滤镜 · ${FILTER_PRESETS.find((preset) => preset.id === step.presetId)?.name || step.presetId}`;
  if (step.type === 'region-fill') return `区域文字 · ${step.text || '未填写'}`;
  return `导出 · ${step.format.toUpperCase()} ${step.scale}×`;
}

function WorkflowSection({ engine }: { engine: EditorEngine }) {
  const workflows = useEditorStore((state) => state.workflows);
  const artboards = useEditorStore((state) => state.artboards);
  const regions = useEditorStore((state) => state.regions);
  const [activeId, setActiveId] = useState(workflows[0]?.id || '');
  const active = workflows.find((workflow) => workflow.id === activeId) || workflows[0];
  const [stepType, setStepType] = useState<'filter' | 'region-fill' | 'export'>('filter');
  const [presetId, setPresetId] = useState(FILTER_PRESETS[4].id);
  const [regionId, setRegionId] = useState(regions[0]?.id || '');
  const [stepText, setStepText] = useState('123');
  const [exportFormat, setExportFormat] = useState<'png' | 'jpeg' | 'webp'>('png');
  const [exportScale, setExportScale] = useState<1 | 2 | 3>(1);
  const create = () => {
    const id = engine.createWorkflow();
    setActiveId(id);
  };
  const addStep = () => {
    if (!active) return;
    if (stepType === 'filter') engine.addWorkflowStep(active.id, { type: 'filter', presetId });
    if (stepType === 'region-fill' && regionId) engine.addWorkflowStep(active.id, { type: 'region-fill', regionId, text: stepText });
    if (stepType === 'export') engine.addWorkflowStep(active.id, { type: 'export', format: exportFormat, scale: exportScale });
  };
  return (
    <section className="selection-workflow productivity-panel workflow-panel">
      <div className="selection-hero">
        <div className="selection-orb"><Workflow size={18} /></div>
        <div><strong>自动工作流</strong><span>自由组合滤镜、区域文字和导出步骤</span></div>
      </div>
      <div className="workflow-toolbar"><select aria-label="选择工作流" value={active?.id || ''} onChange={(event) => setActiveId(event.target.value)}><option value="">选择工作流</option>{workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}</select><button type="button" onClick={create}><Plus size={14} />新建</button></div>
      {active ? <>
        <div className="workflow-name-row"><input aria-label="工作流名称" defaultValue={active.name} onBlur={(event) => engine.updateWorkflow(active.id, { name: event.target.value })} /><button type="button" aria-label="删除工作流" onClick={() => { engine.deleteWorkflow(active.id); setActiveId(''); }}><Trash2 size={15} /></button></div>
        <div className="workflow-targets"><strong>执行画板</strong>{artboards.map((artboard) => <label key={artboard.id}><input type="checkbox" checked={active.artboardIds.includes(artboard.id)} onChange={(event) => engine.updateWorkflow(active.id, { artboardIds: event.target.checked ? [...active.artboardIds, artboard.id] : active.artboardIds.filter((id) => id !== artboard.id) })} />{artboard.name}</label>)}</div>
        <div className="workflow-step-builder">
          <strong>添加执行步骤</strong>
          <select value={stepType} onChange={(event) => setStepType(event.target.value as typeof stepType)}><option value="filter">应用滤镜</option><option value="region-fill">区域文字填写</option><option value="export">导出图片</option></select>
          {stepType === 'filter' && <select value={presetId} onChange={(event) => setPresetId(event.target.value)}>{FILTER_CATEGORIES.map((category) => <optgroup label={category.name} key={category.id}>{FILTER_PRESETS.filter((preset) => preset.category === category.id).map((preset) => <option value={preset.id} key={preset.id}>{preset.name}</option>)}</optgroup>)}</select>}
          {stepType === 'region-fill' && <><select value={regionId} onChange={(event) => setRegionId(event.target.value)}><option value="">选择区域</option>{regions.map((region) => <option key={region.id} value={region.id}>区域 {region.name}</option>)}</select><input value={stepText} onChange={(event) => setStepText(event.target.value)} placeholder="填写文字，例如 123" /></>}
          {stepType === 'export' && <div className="workflow-export-row"><select value={exportFormat} onChange={(event) => setExportFormat(event.target.value as typeof exportFormat)}><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option></select><select value={exportScale} onChange={(event) => setExportScale(Number(event.target.value) as 1 | 2 | 3)}><option value={1}>1×</option><option value={2}>2×</option><option value={3}>3×</option></select></div>}
          <button type="button" className="secondary-action full-width" disabled={stepType === 'region-fill' && !regionId} onClick={addStep}><Plus size={14} />加入工作流</button>
        </div>
        <div className="workflow-step-list">{active.steps.length ? active.steps.map((step, index) => <div className="workflow-step" key={step.id}><span>{index + 1}</span><strong>{describeWorkflowStep(step)}</strong><button type="button" disabled={index === 0} onClick={() => engine.moveWorkflowStep(active.id, step.id, -1)}><ArrowUp size={13} /></button><button type="button" disabled={index === active.steps.length - 1} onClick={() => engine.moveWorkflowStep(active.id, step.id, 1)}><ArrowDown size={13} /></button><button type="button" onClick={() => engine.removeWorkflowStep(active.id, step.id)}><Trash2 size={13} /></button></div>) : <div className="workflow-empty">还没有步骤，请从上方自由组合功能</div>}</div>
        <button type="button" className="primary-action workflow-run" disabled={!active.steps.length} onClick={() => void engine.runWorkflow(active.id)}><Play size={16} />开始执行 {active.name}</button>
      </> : <div className="panel-empty compact"><Workflow size={25} /><strong>创建第一个工作流</strong><span>例如：美食暖光 → 区域文字 123 → 导出 PNG</span><button type="button" className="primary-action" onClick={create}><Plus size={14} />新建工作流</button></div>}
    </section>
  );
}

export function PropertiesPanel({
  engine,
  onCreateTemplateDocument,
  onCreateCustomTemplateDocument,
}: {
  engine: EditorEngine;
  onCreateTemplateDocument?: (templateId: string) => Promise<void>;
  onCreateCustomTemplateDocument?: (template: CustomTemplateRecord) => Promise<void>;
}) {
  const selectedId = useEditorStore((state) => state.selectedId);
  const selectedType = useEditorStore((state) => state.selectedType);
  const activeTool = useEditorStore((state) => state.activeTool);
  const isSelectionTool = ['edge-cutout', 'quick-select', 'magic-wand', 'lasso', 'polygon-lasso'].includes(activeTool);
  const isEraserTool = ['erase-brush', 'restore-brush'].includes(activeTool);

  if (isSelectionTool) return <SelectionSection engine={engine} />;
  if (isEraserTool) return <EraserSection engine={engine} />;
  if (activeTool === 'patch') return <PatchSection engine={engine} />;
  if (activeTool === 'face-retouch') return <FaceRetouchSection engine={engine} />;
  if (activeTool === 'liquify') return <LiquifySection />;
  if (activeTool === 'shapes') return <ShapeLibrarySection engine={engine} />;
  if (activeTool === 'templates') return <TemplateSection engine={engine} onCreateTemplateDocument={onCreateTemplateDocument} onCreateCustomTemplateDocument={onCreateCustomTemplateDocument} />;
  if (activeTool === 'filters') return <FilterLibrarySection engine={engine} />;
  if (activeTool === 'styles') return <StyleLibrarySection engine={engine} />;
  if (activeTool === 'region') return <RegionSection engine={engine} />;
  if (activeTool === 'workflow') return <WorkflowSection engine={engine} />;
  if (activeTool === 'brush') return <PaintBrushSection />;
  if (!selectedId) {
    return (
      <div className="panel-empty large">
        <Layers2 size={28} />
        <strong>选择一个图层</strong>
        <span>这里将显示尺寸、外观、图片调整与蒙版设置</span>
      </div>
    );
  }

  return (
    <div className="properties-panel">
      <TransformSection engine={engine} />
      <div className="inspector-section action-strip">
        <button type="button" onClick={() => engine.groupActive()}><Group size={15} />组合</button>
        <button type="button" onClick={() => engine.ungroupActive()}><Ungroup size={15} />取消组合</button>
      </div>
      {selectedType === 'image' && <ImageSection engine={engine} />}
      <AppearanceSection engine={engine} />
    </div>
  );
}
