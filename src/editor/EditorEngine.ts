import {
  ActiveSelection,
  Canvas,
  Circle,
  Color,
  FabricImage,
  FabricObject,
  Gradient,
  Group,
  IText,
  Line,
  PencilBrush,
  Point,
  Rect,
  Shadow,
  StaticCanvas,
  Textbox,
  Triangle,
  filters,
  util,
} from 'fabric';
import type {
  BrushSeed,
  AssetDescriptor,
  ArtboardItem,
  ArtboardDocumentRef,
  CustomTemplateRecord,
  DocumentSettings,
  EditorObjectMetadata,
  FaceRect,
  ImageAdjustments,
  ImportPreflightResult,
  InspectorState,
  LayerItem,
  LayerStyleSettings,
  ProjectDocument,
  ProjectDocumentV2,
  RegionDefinition,
  SelectionCombineMode,
  SelectionMask,
  SelectionPreviewMode,
  SelectionRefineSettings,
  SmartObjectSource,
  StrokePosition,
  ToolId,
  WorkflowDefinition,
  WorkflowStep,
} from '../types';
import { DEFAULT_ADJUSTMENTS, DEFAULT_LAYER_STYLE } from '../types';
import { SelectionService } from '../lib/SelectionService';
import { FaceDetectionService } from '../lib/FaceDetectionService';
import type { Layer as PsdLayer, Psd } from 'ag-psd';
import { FILTER_PRESETS, TEMPLATE_PRESETS } from '../data/editorPresets';
import { HistoryManager } from './HistoryManager';
import { createAssetStore, type AssetStore } from '../storage/AssetStore';
import { loadArtboardDocument, saveArtboardDocument } from '../lib/projectDb';
import { assetWorkerBroker, psdWorkerBroker, rasterWorkerBroker } from '../lib/WorkerBroker';
import { chooseSaveDestination, saveBlobToComputer } from '../lib/saveFile';

type EditorObject = FabricObject & Partial<EditorObjectMetadata>;
type EditorImage = FabricImage & Partial<EditorObjectMetadata>;

interface EditorCallbacks {
  onLayers: (layers: LayerItem[]) => void;
  onArtboards: (artboards: ArtboardItem[], activeArtboardId: string) => void;
  onRegions: (regions: RegionDefinition[]) => void;
  onWorkflows: (workflows: WorkflowDefinition[]) => void;
  onSelection: (
    id: string | null,
    type: string | null,
    inspector?: Partial<InspectorState>,
    adjustments?: ImageAdjustments,
    selectedIds?: string[],
  ) => void;
  onHistory: (canUndo: boolean, canRedo: boolean) => void;
  onZoom: (zoom: number) => void;
  onViewport: (x: number, y: number) => void;
  onDocumentChange: (project: ProjectDocument) => void;
  onProcessing: (processing: boolean, label?: string) => void;
  onToast: (message: string, tone?: 'default' | 'success' | 'error') => void;
  onToolChange?: (tool: ToolId) => void;
  onOpenSmartObject?: (source: SmartObjectSource) => void;
}

interface SelectionOptions {
  combine: SelectionCombineMode;
  tolerance: number;
  contiguous: boolean;
  brushSize: number;
  eraserSize: number;
  brushSubtract: boolean;
  previewMode: SelectionPreviewMode;
}

const CUSTOM_PROPERTIES = [
  'id',
  'name',
  'locked',
  'maskEnabled',
  'originalSrc',
  'maskSrc',
  'adjustments',
  'paintLayer',
  'beautyBaseSrc',
  'artboardId',
  'isArtboard',
  'regionId',
  'assetId',
  'previewAssetId',
  'renderAssetId',
  'maskAssetId',
  'originalWidth',
  'originalHeight',
  'lazyVisible',
  'assetSuspended',
  'renderObjectUrl',
  'layerStyle',
  'layerStyleBaseFill',
  'layerStyleBaseStroke',
  'layerStyleBaseStrokeWidth',
  'clippingMaskSourceId',
  'smartObjectSource',
  'backgroundLayer',
  'strokePosition',
  'visualStyle',
  'shapeKind',
  'cornerRadii',
  'cornersLinked',
  'textKerning',
  'textTracking',
  'textCompression',
  'textHorizontalScale',
  'textVerticalScale',
  'textBaselineShift',
  'textCase',
  'textOriginalText',
  'textBaseFontWeight',
  'textFauxBold',
  'textFauxItalic',
  'textSuperscript',
  'textSubscript',
];

FabricObject.customProperties = CUSTOM_PROPERTIES;

type ShapeRenderer = EditorObject & {
  _renderPaintInOrder: (context: CanvasRenderingContext2D) => void;
};

function normalizeCornerRadii(object: EditorObject) {
  const fallback = object.type === 'rect' ? Number((object as Rect).rx || 0) : 0;
  const source = object.cornerRadii || {
    topLeft: fallback,
    topRight: fallback,
    bottomRight: fallback,
    bottomLeft: fallback,
  };
  const width = Math.max(0, object.width || 0);
  const height = Math.max(0, object.height || 0);
  const radii = {
    topLeft: Math.max(0, source.topLeft || 0),
    topRight: Math.max(0, source.topRight || 0),
    bottomRight: Math.max(0, source.bottomRight || 0),
    bottomLeft: Math.max(0, source.bottomLeft || 0),
  };
  const ratios = [
    radii.topLeft + radii.topRight ? width / (radii.topLeft + radii.topRight) : 1,
    radii.bottomLeft + radii.bottomRight ? width / (radii.bottomLeft + radii.bottomRight) : 1,
    radii.topLeft + radii.bottomLeft ? height / (radii.topLeft + radii.bottomLeft) : 1,
    radii.topRight + radii.bottomRight ? height / (radii.topRight + radii.bottomRight) : 1,
  ];
  const scale = Math.min(1, ...ratios);
  return {
    topLeft: radii.topLeft * scale,
    topRight: radii.topRight * scale,
    bottomRight: radii.bottomRight * scale,
    bottomLeft: radii.bottomLeft * scale,
  };
}

function drawIndependentRoundedRect(context: CanvasRenderingContext2D, object: EditorObject) {
  const width = object.width || 0;
  const height = object.height || 0;
  const left = -width / 2;
  const top = -height / 2;
  const radii = normalizeCornerRadii(object);
  context.beginPath();
  context.moveTo(left + radii.topLeft, top);
  context.lineTo(left + width - radii.topRight, top);
  context.quadraticCurveTo(left + width, top, left + width, top + radii.topRight);
  context.lineTo(left + width, top + height - radii.bottomRight);
  context.quadraticCurveTo(left + width, top + height, left + width - radii.bottomRight, top + height);
  context.lineTo(left + radii.bottomLeft, top + height);
  context.quadraticCurveTo(left, top + height, left, top + height - radii.bottomLeft);
  context.lineTo(left, top + radii.topLeft);
  context.quadraticCurveTo(left, top, left + radii.topLeft, top);
  context.closePath();
}

function drawRoundedTriangle(context: CanvasRenderingContext2D, object: EditorObject) {
  const width = object.width || 0;
  const height = object.height || 0;
  const source = normalizeCornerRadii(object);
  const vertices = [
    { x: 0, y: -height / 2, radius: (source.topLeft + source.topRight) / 2 },
    { x: width / 2, y: height / 2, radius: source.bottomRight },
    { x: -width / 2, y: height / 2, radius: source.bottomLeft },
  ];
  const rounded = vertices.map((vertex, index) => {
    const previous = vertices[(index + vertices.length - 1) % vertices.length];
    const next = vertices[(index + 1) % vertices.length];
    const previousLength = Math.hypot(previous.x - vertex.x, previous.y - vertex.y);
    const nextLength = Math.hypot(next.x - vertex.x, next.y - vertex.y);
    const distance = Math.min(Math.max(0, vertex.radius), previousLength * .42, nextLength * .42);
    const toward = (target: { x: number; y: number }, length: number) => ({
      x: vertex.x + (target.x - vertex.x) / Math.max(1, length) * distance,
      y: vertex.y + (target.y - vertex.y) / Math.max(1, length) * distance,
    });
    return { vertex, entry: toward(previous, previousLength), exit: toward(next, nextLength) };
  });
  context.beginPath();
  context.moveTo(rounded[0].entry.x, rounded[0].entry.y);
  rounded.forEach(({ vertex, exit }, index) => {
    context.quadraticCurveTo(vertex.x, vertex.y, exit.x, exit.y);
    const nextEntry = rounded[(index + 1) % rounded.length].entry;
    context.lineTo(nextEntry.x, nextEntry.y);
  });
  context.closePath();
}

const baseRectRenderer = (Rect.prototype as unknown as { _render: (context: CanvasRenderingContext2D) => void })._render;
(Rect.prototype as unknown as { _render: (context: CanvasRenderingContext2D) => void })._render = function renderIndependentRoundedRect(context) {
  const object = this as unknown as ShapeRenderer;
  if (!object.cornerRadii || object.backgroundLayer || object.isArtboard) {
    baseRectRenderer.call(object, context);
    return;
  }
  drawIndependentRoundedRect(context, object);
  object._renderPaintInOrder(context);
};

const baseCircleRenderer = (Circle.prototype as unknown as { _render: (context: CanvasRenderingContext2D) => void })._render;
(Circle.prototype as unknown as { _render: (context: CanvasRenderingContext2D) => void })._render = function renderRoundedEllipse(context) {
  const object = this as unknown as ShapeRenderer;
  if (!object.cornerRadii || object.shapeKind !== 'ellipse') {
    baseCircleRenderer.call(object, context);
    return;
  }
  drawIndependentRoundedRect(context, object);
  object._renderPaintInOrder(context);
};

const baseTriangleRenderer = (Triangle.prototype as unknown as { _render: (context: CanvasRenderingContext2D) => void })._render;
(Triangle.prototype as unknown as { _render: (context: CanvasRenderingContext2D) => void })._render = function renderIndependentRoundedTriangle(context) {
  const object = this as unknown as ShapeRenderer;
  if (!object.cornerRadii) {
    baseTriangleRenderer.call(object, context);
    return;
  }
  drawRoundedTriangle(context, object);
  object._renderPaintInOrder(context);
};

const baseStrokeRenderer = (FabricObject.prototype as unknown as { _renderStroke: (context: CanvasRenderingContext2D) => void })._renderStroke;
(FabricObject.prototype as unknown as { _renderStroke: (context: CanvasRenderingContext2D) => void })._renderStroke = function renderPositionedStroke(context) {
  const object = this as unknown as EditorObject;
  const position = object.strokePosition || 'center';
  const supportsPosition = ['rect', 'circle', 'triangle'].includes(object.type || '');
  if (position === 'center' || !supportsPosition) {
    baseStrokeRenderer.call(object, context);
    return;
  }
  if (!object.stroke || !object.strokeWidth) return;

  const renderable = object as EditorObject & {
    _removeShadow: (context: CanvasRenderingContext2D) => void;
    _setLineDash: (context: CanvasRenderingContext2D, dashArray: number[] | null) => void;
    _setStrokeStyles: (context: CanvasRenderingContext2D, object: FabricObject) => void;
  };
  if (object.shadow && !object.shadow.affectStroke) renderable._removeShadow(context);
  context.save();
  if (object.strokeUniform) {
    const scaling = object.getObjectScaling();
    context.scale(1 / scaling.x, 1 / scaling.y);
  }
  renderable._setLineDash(context, object.strokeDashArray);
  renderable._setStrokeStyles(context, object);
  if (position === 'inside') {
    context.clip();
  } else {
    const extent = Math.max(object.width || 0, object.height || 0, object.strokeWidth || 0) * 4 + 2048;
    context.rect(-extent, -extent, extent * 2, extent * 2);
    context.clip('evenodd');
  }
  context.stroke();
  context.restore();
};

const LEGACY_ARTBOARD_ID = '__artboard';
const ARTBOARD_PREFIX = '__artboard:';
const MAX_HISTORY = 50;
const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

function createId(prefix = 'layer') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function safeFilename(value: string) {
  return (value || '画板').replace(/[\\/:*?"<>|]/g, '-').trim() || '画板';
}

function imageFromUrl(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片读取失败'));
    image.src = url;
  });
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('无法保存模板图片'));
    reader.readAsDataURL(blob);
  });
}

type PixelPayload = { width: number; height: number; data: Uint8Array | Uint8ClampedArray };

function imageDataToBlob(imageData: ImageData | PixelPayload, type = 'image/png') {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建PSD图层预览');
  let pixels: ImageData;
  if (imageData instanceof ImageData) pixels = imageData;
  else {
    const data = new Uint8ClampedArray(imageData.data.byteLength);
    data.set(imageData.data);
    pixels = new ImageData(data, imageData.width, imageData.height);
  }
  context.putImageData(pixels, 0, 0);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PSD图层编码失败')), type));
}

function clampOpacity(value: number) {
  return Math.max(0, Math.min(1, value));
}

function getColorInfo(value: unknown, fallback: string) {
  const input = typeof value === 'string' ? value : fallback;
  let color = new Color(input);
  if (color.isUnrecognised) color = new Color(fallback);
  return {
    hex: `#${color.toHex()}`,
    opacity: clampOpacity(color.getAlpha()),
  };
}

function colorWithOpacity(value: string, opacity: number, fallback = '#000000') {
  let color = new Color(value);
  if (color.isUnrecognised) color = new Color(fallback);
  return color.setAlpha(clampOpacity(opacity)).toRgba();
}

function getPaintColorInfo(value: unknown, fallback: string) {
  if (value instanceof Gradient) {
    return getColorInfo(value.colorStops[0]?.color, fallback);
  }
  return getColorInfo(value, fallback);
}

function setPaintOpacity(object: EditorObject, property: 'fill' | 'stroke', opacity: number) {
  const paint = object[property];
  const nextOpacity = clampOpacity(opacity);
  if (typeof paint === 'string') {
    object.set(property, colorWithOpacity(paint, nextOpacity, property === 'fill' ? '#ffffff' : '#000000'));
    return;
  }
  if (paint instanceof Gradient) {
    paint.colorStops.forEach((stop) => {
      stop.color = colorWithOpacity(stop.color, nextOpacity);
    });
    object.dirty = true;
  }
}

function isImageObject(object: FabricObject | null | undefined): object is EditorImage {
  return Boolean(object && object.type?.toLowerCase() === 'image');
}

function isTextObject(object: FabricObject | null | undefined): object is EditorObject & IText {
  return Boolean(object && ['i-text', 'textbox', 'text'].includes(object.type?.toLowerCase() || ''));
}

export class EditorEngine {
  readonly canvas: Canvas;
  private overlay: HTMLCanvasElement;
  private overlayContext: CanvasRenderingContext2D;
  private callbacks: EditorCallbacks;
  private selectionService = new SelectionService();
  private faceDetectionService = new FaceDetectionService();
  private currentTool: ToolId = 'select';
  private documentWidth = 1080;
  private documentHeight = 1080;
  private documentBackground = '#ffffff';
  private documentName = '未标题-1';
  private documentSettings: DocumentSettings = {
    resolution: 72,
    colorMode: 'rgb',
    bitDepth: 8,
    colorProfile: 'sRGB IEC61966-2.1',
    pixelAspectRatio: 1,
    format: 'psd',
  };
  private artboards: ArtboardItem[] = [];
  private activeArtboardId = '';
  private regions: RegionDefinition[] = [];
  private workflows: WorkflowDefinition[] = [];
  private history = new HistoryManager<{
    canvas: Record<string, unknown>;
    regions: RegionDefinition[];
    workflows: WorkflowDefinition[];
    activeArtboardId: string;
  }>(MAX_HISTORY);
  private userId: string;
  private projectId: string;
  private assetStore: AssetStore;
  private assets: AssetDescriptor[] = [];
  private objectUrls = new Set<string>();
  private lazyArtboards = true;
  private adjustmentTimers = new Map<string, number>();
  private adjustmentTokens = new Map<string, number>();
  private residentArtboards: string[] = [];
  private isRestoring = false;
  private saveTimer: number | null = null;
  private activeMask: SelectionMask | null = null;
  private maskTargetId: string | null = null;
  private selectionOptions: SelectionOptions = {
    combine: 'replace',
    tolerance: 28,
    contiguous: true,
    brushSize: 38,
    eraserSize: 54,
    brushSubtract: false,
    previewMode: 'overlay',
  };
  private workImageData: ImageData | null = null;
  private workImageScale = 1;
  private quickSeeds: BrushSeed[] = [];
  private lassoPoints: Point[] = [];
  private isPointerDown = false;
  private panLast = new Point(0, 0);
  private spacePressed = false;
  private previewCanvas: HTMLCanvasElement | null = null;
  private internalClipboard: EditorObject | null = null;
  private eraserPoints: Array<{ x: number; y: number }> = [];
  private eraserScenePoints: Point[] = [];
  private brushCursorPoint: Point | null = null;
  private activeFaces: FaceRect[] = [];
  private snapEnabled = true;
  private showControls = true;
  private liquifySize = 140;
  private liquifyStrength = 55;
  private liquifyStart: Point | null = null;
  private liquifyEnd: Point | null = null;
  private patchStart: Point | null = null;
  private patchEnd: Point | null = null;
  private regionStart: Point | null = null;
  private regionEnd: Point | null = null;
  private freeformShapeDrawing = false;
  private textHistoryTimer: number | null = null;

  constructor(
    canvasElement: HTMLCanvasElement,
    overlay: HTMLCanvasElement,
    callbacks: EditorCallbacks,
    runtime: { userId?: string; projectId?: string } = {},
  ) {
    this.callbacks = callbacks;
    this.userId = runtime.userId || 'anonymous';
    this.projectId = runtime.projectId || createId('project');
    this.assetStore = createAssetStore(this.userId, this.projectId);
    this.overlay = overlay;
    const context = overlay.getContext('2d');
    if (!context) throw new Error('无法创建选区画布');
    this.overlayContext = context;
    this.canvas = new Canvas(canvasElement, {
      preserveObjectStacking: true,
      selection: true,
      backgroundColor: 'transparent',
      enableRetinaScaling: true,
    });
    this.bindEvents();
  }

  private isArtboardObject(object: FabricObject | null | undefined) {
    const editorObject = object as EditorObject | null | undefined;
    return Boolean(editorObject && (editorObject.isArtboard || editorObject.id === LEGACY_ARTBOARD_ID || editorObject.id?.startsWith(ARTBOARD_PREFIX)));
  }

  private getActiveArtboard() {
    return this.artboards.find((artboard) => artboard.id === this.activeArtboardId) || this.artboards[0];
  }

  private syncDocumentFromActiveArtboard() {
    const artboard = this.getActiveArtboard();
    if (!artboard) return;
    this.activeArtboardId = artboard.id;
    this.documentWidth = artboard.width;
    this.documentHeight = artboard.height;
    this.documentBackground = artboard.background;
  }

  private createArtboardRect(artboard: ArtboardItem) {
    const rect = new Rect({
      left: artboard.x,
      top: artboard.y,
      width: artboard.width,
      height: artboard.height,
      originX: 'left',
      originY: 'top',
      fill: 'transparent',
      stroke: '#00000020',
      strokeWidth: 1,
      selectable: false,
      evented: false,
      objectCaching: false,
    }) as EditorObject;
    rect.id = `${ARTBOARD_PREFIX}${artboard.id}`;
    rect.artboardId = artboard.id;
    rect.isArtboard = true;
    rect.name = artboard.name;
    return rect;
  }

  private createBackgroundColorLayer(artboard: ArtboardItem, color: string) {
    const background = new Rect({
      left: artboard.x,
      top: artboard.y,
      width: artboard.width,
      height: artboard.height,
      originX: 'left',
      originY: 'top',
      fill: color,
      strokeWidth: 0,
      selectable: true,
      evented: true,
      hasControls: false,
      lockMovementX: true,
      lockMovementY: true,
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true,
      objectCaching: false,
    }) as EditorObject;
    background.id = createId('background-color');
    background.name = '背景颜色';
    background.artboardId = artboard.id;
    background.backgroundLayer = true;
    return background;
  }

  private syncArtboardsFromCanvas() {
    const artboards = (this.canvas.getObjects() as EditorObject[])
      .filter((object) => this.isArtboardObject(object))
      .map((object, index): ArtboardItem => ({
        id: object.artboardId || object.id?.replace(ARTBOARD_PREFIX, '') || `artboard-${index + 1}`,
        name: object.name || `画板 ${index + 1}`,
        x: Math.round(object.left || 0),
        y: Math.round(object.top || 0),
        width: Math.max(64, Math.round((object.width || 1) * Math.abs(object.scaleX || 1))),
        height: Math.max(64, Math.round((object.height || 1) * Math.abs(object.scaleY || 1))),
        background: this.artboards.find((artboard) => artboard.id === (object.artboardId || object.id?.replace(ARTBOARD_PREFIX, '')))?.background
          || (typeof object.fill === 'string' ? object.fill : 'transparent'),
      }))
      .sort((a, b) => a.x - b.x || a.y - b.y);
    this.artboards = artboards;
    if (!artboards.some((artboard) => artboard.id === this.activeArtboardId)) this.activeArtboardId = artboards[0]?.id || '';
    this.syncDocumentFromActiveArtboard();
    this.callbacks.onArtboards(this.artboards.map((artboard) => ({ ...artboard })), this.activeArtboardId);
  }

  private getSceneBounds() {
    if (this.lazyArtboards) {
      const active = this.getActiveArtboard();
      if (active) return { left: active.x, top: active.y, width: active.width, height: active.height };
    }
    if (!this.artboards.length) return { left: 0, top: 0, width: this.documentWidth, height: this.documentHeight };
    const left = Math.min(...this.artboards.map((artboard) => artboard.x));
    const top = Math.min(...this.artboards.map((artboard) => artboard.y));
    const right = Math.max(...this.artboards.map((artboard) => artboard.x + artboard.width));
    const bottom = Math.max(...this.artboards.map((artboard) => artboard.y + artboard.height));
    return { left, top, width: right - left, height: bottom - top };
  }

  private applyLazyArtboardVisibility() {
    if (!this.lazyArtboards) return;
    for (const object of this.canvas.getObjects() as EditorObject[]) {
      const active = object.artboardId === this.activeArtboardId;
      if (this.isArtboardObject(object)) {
        object.visible = active;
        continue;
      }
      if (active) {
        object.visible = object.lazyVisible ?? object.visible;
      } else {
        if (object.lazyVisible === undefined) object.lazyVisible = object.visible !== false;
        object.visible = false;
      }
    }
    this.canvas.requestRenderAll();
    void this.updateArtboardAssetResidency();
  }

  private async updateArtboardAssetResidency() {
    const mobile = matchMedia('(pointer: coarse)').matches || window.innerWidth < 768;
    this.residentArtboards = [this.activeArtboardId, ...this.residentArtboards.filter((id) => id !== this.activeArtboardId)].slice(0, mobile ? 1 : 2);
    const placeholder = document.createElement('canvas');
    placeholder.width = 1;
    placeholder.height = 1;
    for (const image of this.getEditableObjects().filter(isImageObject)) {
      if (!image.previewAssetId) continue;
      const shouldLoad = Boolean(image.artboardId && this.residentArtboards.includes(image.artboardId));
      if (shouldLoad && image.assetSuspended) {
        const descriptorId = image.renderAssetId || image.previewAssetId;
        const descriptor = this.assets.find((asset) => asset.id === descriptorId);
        if (!descriptor) continue;
        const url = await this.assetStore.createObjectUrl(descriptor);
        this.objectUrls.add(url);
        const originalDescriptor = image.assetId ? this.assets.find((asset) => asset.id === image.assetId) : undefined;
        const originalUrl = originalDescriptor && originalDescriptor.id !== descriptor.id
          ? await this.assetStore.createObjectUrl(originalDescriptor)
          : url;
        this.objectUrls.add(originalUrl);
        const dimensions = { width: image.width || descriptor.width || 1, height: image.height || descriptor.height || 1, scaleX: image.scaleX, scaleY: image.scaleY };
        await image.setSrc(url);
        image.set(dimensions);
        image.originalSrc = originalUrl;
        image.renderObjectUrl = url;
        image.assetSuspended = false;
      } else if (!shouldLoad && !image.assetSuspended) {
        const dimensions = { width: image.width || 1, height: image.height || 1, scaleX: image.scaleX, scaleY: image.scaleY };
        if (image.renderObjectUrl) {
          URL.revokeObjectURL(image.renderObjectUrl);
          this.objectUrls.delete(image.renderObjectUrl);
          image.renderObjectUrl = undefined;
        }
        image.setElement(placeholder);
        image.set(dimensions);
        image.originalSrc = TRANSPARENT_PIXEL;
        image.assetSuspended = true;
      }
    }
    this.canvas.requestRenderAll();
  }

  private emitViewport() {
    const viewport = this.canvas.viewportTransform;
    this.callbacks.onViewport(viewport[4] || 0, viewport[5] || 0);
  }

  private emitRegions() {
    this.callbacks.onRegions(this.regions.map((region) => ({ ...region })));
  }

  private emitWorkflows() {
    this.callbacks.onWorkflows(this.workflows.map((workflow) => ({
      ...workflow,
      artboardIds: [...workflow.artboardIds],
      steps: workflow.steps.map((step) => ({ ...step })),
    })));
  }

  async initialize(project?: ProjectDocument) {
    if (project) {
      await this.loadProject(project);
      return;
    }
    await this.newDocument(1080, 1080, '#f5f1e8', false);
    this.fitToScreen();
    this.commitHistory(true);
  }

  private bindEvents() {
    this.canvas.on('selection:created', () => this.syncSelection());
    this.canvas.on('selection:updated', () => this.syncSelection());
    this.canvas.on('selection:cleared', () => this.syncSelection());
    this.canvas.on('mouse:dblclick', (event) => {
      const target = event.target as EditorObject | undefined;
      if (target?.smartObjectSource) this.callbacks.onOpenSmartObject?.(structuredClone(target.smartObjectSource));
    });
    this.canvas.on('object:modified', () => {
      this.syncSelection();
      this.commitHistory();
    });
    this.canvas.on('object:moving', (event) => {
      this.handleObjectMoving(event.target as EditorObject | undefined);
      this.syncSelection();
    });
    this.canvas.on('object:scaling', () => this.syncSelection());
    this.canvas.on('object:rotating', () => this.syncSelection());
    this.canvas.on('object:added', (event) => {
      const object = event.target as EditorObject | undefined;
      if (!object || this.isArtboardObject(object) || this.isRestoring) return;
      object.set(object.backgroundLayer ? {
        hasControls: false,
        lockMovementX: true,
        lockMovementY: true,
        lockScalingX: true,
        lockScalingY: true,
        lockRotation: true,
      } : { hasControls: this.showControls });
      this.syncLayers();
    });
    this.canvas.on('object:removed', () => {
      if (!this.isRestoring) this.syncLayers();
    });
    this.canvas.on('path:created', (event) => {
      const object = event.path as EditorObject;
      if (this.freeformShapeDrawing) {
        const drawable = object as EditorObject & { path?: unknown[][] };
        if (drawable.path?.length && drawable.path[drawable.path.length - 1]?.[0] !== 'Z') drawable.path.push(['Z']);
        object.id = createId('freeform');
        object.name = '自由图形';
        object.paintLayer = false;
        object.shapeKind = 'freeform';
        object.cornerRadii = { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 };
        object.cornersLinked = true;
        object.artboardId = this.activeArtboardId;
        object.set({
          fill: '#38bdf8',
          stroke: '#172033',
          strokeWidth: 2,
          strokeLineCap: 'round',
          strokeLineJoin: 'round',
          objectCaching: false,
        });
        object.setCoords();
        this.freeformShapeDrawing = false;
        this.canvas.isDrawingMode = false;
        this.canvas.selection = true;
        this.canvas.skipTargetFind = false;
        this.canvas.setActiveObject(object);
        this.currentTool = 'select';
        this.applyToolCursor();
        this.callbacks.onToolChange?.('select');
        this.syncSelection();
        this.commitHistory();
        this.callbacks.onToast('自由图形已闭合，可继续调节填充、描边和尺寸', 'success');
        return;
      }
      object.id = createId('brush');
      object.name = '画笔';
      object.paintLayer = true;
      object.artboardId = this.activeArtboardId;
      this.canvas.setActiveObject(object);
      this.syncSelection();
      this.commitHistory();
    });
    this.canvas.on('text:changed', (event) => {
      const object = event.target as EditorObject | undefined;
      if (!isTextObject(object)) return;
      object.textOriginalText = object.text || '';
      this.syncSelection();
      if (this.textHistoryTimer !== null) window.clearTimeout(this.textHistoryTimer);
      this.textHistoryTimer = window.setTimeout(() => {
        this.textHistoryTimer = null;
        this.commitHistory();
      }, 420);
    });
    this.canvas.on('mouse:wheel', (event) => {
      const wheelEvent = event.e as WheelEvent;
      let zoom = this.canvas.getZoom() * 0.999 ** wheelEvent.deltaY;
      zoom = Math.max(0.08, Math.min(8, zoom));
      this.canvas.zoomToPoint(this.canvas.getViewportPoint(wheelEvent), zoom);
      wheelEvent.preventDefault();
      wheelEvent.stopPropagation();
      this.callbacks.onZoom(zoom);
      this.emitViewport();
      this.renderOverlay();
    });
    this.canvas.on('mouse:down', (event) => void this.handlePointerDown(event.e));
    this.canvas.on('mouse:move', (event) => this.handlePointerMove(event.e));
    this.canvas.on('mouse:up', (event) => void this.handlePointerUp(event.e));
    this.canvas.on('mouse:dblclick', () => void this.finishPolygonSelection());
    this.canvas.on('after:render', () => this.renderOverlay());
    this.canvas.upperCanvasEl.addEventListener('pointerleave', this.handleCanvasPointerLeave);

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    if (event.code === 'Space' && !this.spacePressed) {
      this.spacePressed = true;
      this.brushCursorPoint = null;
      this.canvas.defaultCursor = 'grab';
      this.canvas.hoverCursor = 'grab';
      this.canvas.freeDrawingCursor = 'grab';
      this.renderOverlay();
    }
  };

  private handleKeyUp = (event: KeyboardEvent) => {
    if (event.code === 'Space') {
      this.spacePressed = false;
      this.applyToolCursor();
    }
  };

  private handleCanvasPointerLeave = () => {
    if (!this.brushCursorPoint) return;
    this.brushCursorPoint = null;
    this.renderOverlay();
  };

  private isCircularBrushTool(tool = this.currentTool) {
    return ['brush', 'edge-cutout', 'quick-select', 'erase-brush', 'restore-brush', 'liquify'].includes(tool);
  }

  private applyToolCursor() {
    const circularBrush = this.isCircularBrushTool();
    const cursor = this.currentTool === 'hand'
      ? 'grab'
      : circularBrush
        ? 'none'
        : this.currentTool.includes('select') || this.currentTool.includes('lasso') || this.currentTool === 'magic-wand' || this.currentTool === 'patch' || this.currentTool === 'region'
          ? 'crosshair'
          : 'default';
    this.canvas.defaultCursor = cursor;
    this.canvas.hoverCursor = circularBrush ? 'none' : 'move';
    this.canvas.freeDrawingCursor = circularBrush ? 'none' : 'crosshair';
  }

  setEditorPreferences(options: { snapEnabled?: boolean; uniformScaling?: boolean; showControls?: boolean }) {
    if (options.snapEnabled !== undefined) this.snapEnabled = options.snapEnabled;
    if (options.uniformScaling !== undefined) this.canvas.uniformScaling = options.uniformScaling;
    if (options.showControls !== undefined) {
      this.showControls = options.showControls;
      for (const object of this.getEditableObjects()) object.set({ hasControls: options.showControls });
    }
    this.canvas.requestRenderAll();
  }

  setLiquifyOptions(options: { size?: number; strength?: number }) {
    if (options.size !== undefined) this.liquifySize = Math.max(20, Math.min(420, options.size));
    if (options.strength !== undefined) this.liquifyStrength = Math.max(1, Math.min(100, options.strength));
    this.renderOverlay();
  }

  private handleObjectMoving(target?: EditorObject) {
    if (!target || !this.snapEnabled || this.isArtboardObject(target)) return;
    const artboard = this.artboards.find((item) => item.id === target.artboardId) || this.getActiveArtboard();
    if (!artboard) return;
    const tolerance = 7 / this.canvas.getZoom();
    const center = target.getCenterPoint();
    const snapValue = (value: number, candidates: number[]) => {
      const exact = candidates.find((candidate) => Math.abs(candidate - value) <= tolerance);
      if (exact !== undefined) return exact;
      const grid = Math.round(value / 10) * 10;
      return Math.abs(grid - value) <= tolerance * 0.55 ? grid : value;
    };
    const x = snapValue(center.x, [artboard.x, artboard.x + artboard.width / 2, artboard.x + artboard.width]);
    const y = snapValue(center.y, [artboard.y, artboard.y + artboard.height / 2, artboard.y + artboard.height]);
    if (x !== center.x) target.set('left', (target.left || 0) + x - center.x);
    if (y !== center.y) target.set('top', (target.top || 0) + y - center.y);
  }

  resize(width: number, height: number) {
    if (width < 20 || height < 20) return;
    this.canvas.setDimensions({ width, height });
    const ratio = window.devicePixelRatio || 1;
    this.overlay.width = Math.round(width * ratio);
    this.overlay.height = Math.round(height * ratio);
    this.overlay.style.width = `${width}px`;
    this.overlay.style.height = `${height}px`;
    this.fitToScreen();
  }

  async newDocument(
    width: number,
    height: number,
    background = '#ffffff',
    addHistory = true,
    settings: Partial<DocumentSettings> & { name?: string } = {},
  ) {
    this.isRestoring = true;
    this.projectId = createId('project');
    this.assetStore = createAssetStore(this.userId, this.projectId);
    this.assets = [];
    this.canvas.clear();
    this.documentWidth = Math.max(64, Math.round(width));
    this.documentHeight = Math.max(64, Math.round(height));
    const backgroundColor = background;
    this.documentBackground = 'transparent';
    this.documentName = settings.name?.trim() || '未标题-1';
    this.documentSettings = {
      resolution: Math.max(1, Math.min(2400, settings.resolution ?? 72)),
      colorMode: settings.colorMode ?? 'rgb',
      bitDepth: settings.bitDepth ?? 8,
      colorProfile: settings.colorProfile || 'sRGB IEC61966-2.1',
      pixelAspectRatio: Math.max(0.1, Math.min(10, settings.pixelAspectRatio ?? 1)),
      format: settings.format ?? 'psd',
    };
    const firstArtboard: ArtboardItem = {
      id: createId('artboard'),
      name: '画板 1',
      x: 0,
      y: 0,
      width: this.documentWidth,
      height: this.documentHeight,
      background: 'transparent',
    };
    this.artboards = [firstArtboard];
    this.activeArtboardId = firstArtboard.id;
    this.regions = [];
    this.workflows = [];
    this.canvas.backgroundColor = 'transparent';
    this.canvas.add(this.createArtboardRect(firstArtboard));
    if (backgroundColor !== 'transparent') this.canvas.add(this.createBackgroundColorLayer(firstArtboard, backgroundColor));
    this.isRestoring = false;
    this.activeMask = null;
    this.maskTargetId = null;
    this.syncArtboardsFromCanvas();
    this.applyLazyArtboardVisibility();
    this.emitRegions();
    this.emitWorkflows();
    this.syncLayers();
    this.canvas.requestRenderAll();
    this.fitToScreen();
    if (addHistory) this.commitHistory(true);
  }

  createArtboard(width = this.documentWidth, height = this.documentHeight, background = '#ffffff') {
    const normalizedWidth = Math.max(64, Math.round(width));
    const normalizedHeight = Math.max(64, Math.round(height));
    const right = this.artboards.length
      ? Math.max(...this.artboards.map((artboard) => artboard.x + artboard.width))
      : 0;
    const top = this.artboards.length ? Math.min(...this.artboards.map((artboard) => artboard.y)) : 0;
    const artboard: ArtboardItem = {
      id: createId('artboard'),
      name: `画板 ${this.artboards.length + 1}`,
      x: right + 180,
      y: top,
      width: normalizedWidth,
      height: normalizedHeight,
      background: 'transparent',
    };
    this.canvas.add(this.createArtboardRect(artboard));
    if (background !== 'transparent') {
      const backgroundLayer = this.createBackgroundColorLayer(artboard, background);
      this.canvas.add(backgroundLayer);
      this.canvas.moveObjectTo(backgroundLayer, this.artboards.length + 1);
    }
    this.activeArtboardId = artboard.id;
    this.syncArtboardsFromCanvas();
    this.applyLazyArtboardVisibility();
    this.canvas.discardActiveObject();
    this.canvas.requestRenderAll();
    this.focusArtboard(artboard.id);
    this.syncSelection();
    this.commitHistory();
    this.callbacks.onToast(`已创建${artboard.name}`, 'success');
    return artboard;
  }

  renameArtboard(id: string, name: string) {
    const object = this.canvas.getObjects().find((item) => this.isArtboardObject(item) && (item as EditorObject).artboardId === id) as EditorObject | undefined;
    if (!object) return;
    object.name = name.trim() || '未命名画板';
    this.syncArtboardsFromCanvas();
    this.canvas.requestRenderAll();
    this.commitHistory();
  }

  selectArtboard(id: string, focus = false) {
    if (!this.artboards.some((artboard) => artboard.id === id)) return;
    this.activeArtboardId = id;
    this.syncDocumentFromActiveArtboard();
    this.canvas.discardActiveObject();
    this.clearPixelSelection();
    this.callbacks.onArtboards(this.artboards.map((artboard) => ({ ...artboard })), this.activeArtboardId);
    this.applyLazyArtboardVisibility();
    this.syncSelection();
    this.renderOverlay();
    if (focus) this.focusArtboard(id);
  }

  deleteArtboard(id: string) {
    if (this.artboards.length <= 1) {
      this.callbacks.onToast('至少保留一个画板', 'error');
      return;
    }
    const artboardObject = this.canvas.getObjects().find((item) => this.isArtboardObject(item) && (item as EditorObject).artboardId === id);
    const objects = this.getEditableObjects().filter((object) => object.artboardId === id);
    if (artboardObject) this.canvas.remove(artboardObject);
    if (objects.length) this.canvas.remove(...objects);
    this.activeArtboardId = this.artboards.find((artboard) => artboard.id !== id)?.id || '';
    this.syncArtboardsFromCanvas();
    this.applyLazyArtboardVisibility();
    this.syncLayers();
    this.canvas.requestRenderAll();
    this.fitToScreen();
    this.commitHistory();
  }

  async applyTemplate(templateId: string) {
    const template = TEMPLATE_PRESETS.find((item) => item.id === templateId);
    if (!template) return;
    const artboard = this.getActiveArtboard();
    if (!artboard) return;
    const scaleX = artboard.width / template.width;
    const scaleY = artboard.height / template.height;
    const scale = Math.min(scaleX, scaleY);
    this.isRestoring = true;
    const createdObjects: EditorObject[] = [];
    const add = (object: EditorObject, name: string) => {
      object.id = createId('template');
      object.name = name;
      object.artboardId = artboard.id;
      object.set(object.backgroundLayer ? {
        hasControls: false,
        lockMovementX: true,
        lockMovementY: true,
        lockScalingX: true,
        lockScalingY: true,
        lockRotation: true,
      } : { hasControls: this.showControls });
      this.canvas.add(object);
      createdObjects.push(object);
    };
    const text = (value: string, left: number, top: number, width: number, fontSize: number, fill: string, weight = '600', align: 'left' | 'center' | 'right' = 'left') => new Textbox(value, {
      left: artboard.x + left * scaleX,
      top: artboard.y + top * scaleY,
      width: width * scaleX,
      fontSize: fontSize * scale,
      fill,
      fontFamily: 'Microsoft YaHei',
      fontWeight: weight,
      textAlign: align,
      lineHeight: 1.05,
      originX: 'left',
      originY: 'top',
    }) as EditorObject;
    const rect = (left: number, top: number, width: number, height: number, fill: string | Gradient<'linear'>, radius = 0) => new Rect({
      left: artboard.x + left * scaleX,
      top: artboard.y + top * scaleY,
      width: width * scaleX,
      height: height * scaleY,
      fill,
      rx: radius * scale,
      ry: radius * scale,
      originX: 'left',
      originY: 'top',
    }) as EditorObject;
    const circle = (left: number, top: number, radius: number, fill: string) => new Circle({
      left: artboard.x + left * scaleX,
      top: artboard.y + top * scaleY,
      radius: radius * scale,
      fill,
      originX: 'left',
      originY: 'top',
    }) as EditorObject;

    if (templateId === 'business-card') {
      add(rect(0, 0, 350, 600, '#121a14'), '品牌色块');
      add(circle(75, 78, 56, '#f97316'), '品牌圆形');
      add(rect(104, 54, 18, 55, '#4d7c0f', 9), '胡萝卜叶');
      add(text('YOUR\nNAME', 54, 230, 250, 58, '#fff7ed', '600'), '姓名');
      add(text('品牌设计师 / PRODUCT DESIGNER', 54, 380, 255, 18, '#fdba74', '500'), '职位');
      add(text('身份名片', 430, 72, 520, 28, '#9a3412', '600'), '模板标签');
      add(text('让每一次介绍\n都更有记忆点', 430, 135, 520, 62, '#172019', '600'), '名片标题');
      add(text('电话  138 0000 0000\n邮箱  hello@example.com\n地址  在这里填写联系地址', 430, 385, 500, 24, '#59635b', '400'), '联系方式');
    } else if (templateId === 'video-cover') {
      add(rect(0, 0, 1920, 1080, new Gradient({ type: 'linear', coords: { x1: 0, y1: 0, x2: 1920, y2: 1080 }, colorStops: [{ offset: 0, color: '#101827' }, { offset: 1, color: '#3b1428' }] })), '封面渐变');
      add(circle(1280, 115, 325, '#f97316'), '视觉圆形');
      add(circle(1395, 225, 205, '#111827'), '图片占位');
      add(text('VIDEO / 2026', 125, 125, 620, 30, '#fb923c', '600'), '封面栏目');
      add(text('把视频标题\n写在这里', 125, 245, 1050, 148, '#fff7ed', '600'), '视频标题');
      add(text('一句话说明视频价值，让观众快速理解内容', 135, 690, 900, 32, '#cbd5e1', '400'), '封面副标题');
      add(rect(125, 820, 360, 82, '#fff7ed', 41), '行动按钮');
      add(text('立即观看  →', 125, 840, 360, 31, '#111827', '600', 'center'), '按钮文字');
    } else if (templateId === 'product-main') {
      add(rect(0, 0, 1080, 1080, '#ffffff'), '商品卡片');
      const placeholder = rect(180, 175, 720, 590, '#f3f4f6', 32);
      placeholder.set({ stroke: '#9ca3af', strokeDashArray: [14, 10], strokeWidth: 2 });
      add(placeholder, '商品图片占位');
      add(text('放置商品图片', 330, 425, 420, 34, '#9ca3af', '500', 'center'), '占位提示');
      add(circle(785, 105, 92, '#ef4444'), '促销徽章');
      add(text('新品\n上市', 798, 145, 160, 31, '#ffffff', '600', 'center'), '促销文字');
      add(text('商品名称写在这里', 170, 805, 740, 46, '#111827', '600'), '商品名称');
      add(text('¥ 199', 170, 875, 340, 58, '#dc2626', '600'), '商品价格');
      add(text('核心卖点 · 品质保障 · 快速发货', 485, 895, 430, 21, '#6b7280', '400', 'right'), '商品卖点');
    } else if (templateId === 'poster') {
      add(rect(0, 0, 1080, 1440, new Gradient({ type: 'linear', coords: { x1: 0, y1: 0, x2: 1080, y2: 1440 }, colorStops: [{ offset: 0, color: '#172554' }, { offset: .55, color: '#312e81' }, { offset: 1, color: '#111827' }] })), '海报渐变');
      add(circle(600, 115, 305, '#f97316'), '海报主视觉');
      add(circle(720, 250, 190, '#fef3c7'), '图片占位');
      add(text('SUMMER EVENT', 90, 95, 500, 28, '#fdba74', '600'), '活动英文');
      add(text('活动主标题\n写在这里', 90, 280, 800, 112, '#fff7ed', '600'), '活动标题');
      add(text('2026.08.18  /  19:30', 95, 735, 700, 36, '#fbbf24', '600'), '活动时间');
      add(text('在这里补充活动介绍、地点、参与方式等信息。\n保持内容简洁，让用户快速抓住重点。', 95, 825, 805, 30, '#c7d2fe', '400'), '活动介绍');
      add(rect(90, 1155, 390, 95, '#fff7ed', 48), '报名按钮');
      add(text('立即报名', 90, 1180, 390, 35, '#172554', '600', 'center'), '报名文字');
    } else if (templateId === 'meme') {
      add(rect(0, 0, 1080, 1080, '#ffffff'), '表情包卡片');
      const placeholder = rect(105, 225, 870, 625, '#e5e7eb', 14);
      placeholder.set({ stroke: '#111827', strokeWidth: 3 });
      add(placeholder, '表情图片占位');
      add(text('在这里放图片', 255, 495, 570, 42, '#6b7280', '600', 'center'), '图片提示');
      add(text('当我打开工作群', 105, 92, 870, 64, '#111827', '600', 'center'), '上方文字');
      add(text('发现又有新需求', 105, 875, 870, 64, '#111827', '600', 'center'), '下方文字');
    }
    this.isRestoring = false;
    this.focusArtboard(artboard.id);
    const preferredObject = createdObjects.find((object) => object.name?.includes('标题'))
      || createdObjects.find((object) => object instanceof Textbox)
      || createdObjects[createdObjects.length - 1];
    if (preferredObject) this.canvas.setActiveObject(preferredObject);
    else this.canvas.discardActiveObject();
    this.canvas.requestRenderAll();
    this.syncLayers();
    this.syncSelection();
    this.commitHistory();
    this.callbacks.onToast(`${template.name}模板已添加到当前画板，可撤销或继续修改`, 'success');
  }

  private async serializeReusableObjects(objects: EditorObject[], originX: number, originY: number) {
    return Promise.all(objects.map(async (object) => {
      const serialized = object.toObject(CUSTOM_PROPERTIES) as Record<string, unknown>;
      serialized.left = (object.left || 0) - originX;
      serialized.top = (object.top || 0) - originY;
      delete serialized.id;
      delete serialized.artboardId;
      if (isImageObject(object)) {
        const source = object.getSrc();
        if (source && !source.startsWith('data:')) {
          const blob = await (await fetch(source)).blob();
          const dataUrl = await blobToDataUrl(blob);
          serialized.src = dataUrl;
          serialized.originalSrc = dataUrl;
        }
        delete serialized.assetId;
        delete serialized.previewAssetId;
        delete serialized.renderAssetId;
        delete serialized.maskAssetId;
        delete serialized.renderObjectUrl;
      }
      return serialized;
    }));
  }

  async createCustomTemplate(name: string): Promise<CustomTemplateRecord> {
    const artboard = this.getActiveArtboard();
    if (!artboard) throw new Error('请先创建画板');
    const objects = this.getEditableObjects().filter((object) => object.artboardId === artboard.id);
    if (!objects.length) throw new Error('当前画板没有可保存的图层');
    const serializedObjects = await this.serializeReusableObjects(objects, artboard.x, artboard.y);
    const previewCanvas = new StaticCanvas(undefined, {
      width: artboard.width,
      height: artboard.height,
      backgroundColor: artboard.background,
      enableRetinaScaling: false,
    });
    await previewCanvas.loadFromJSON({ objects: serializedObjects });
    previewCanvas.renderAll();
    const previewMultiplier = Math.min(1, 360 / artboard.width, 220 / artboard.height);
    const previewDataUrl = previewCanvas.toDataURL({
      format: 'png',
      multiplier: previewMultiplier,
      left: 0,
      top: 0,
      width: artboard.width,
      height: artboard.height,
    });
    previewCanvas.dispose();
    const now = new Date().toISOString();
    return {
      id: createId('custom-template'),
      userId: this.userId,
      name: name.trim() || `${artboard.name}模板`,
      width: artboard.width,
      height: artboard.height,
      background: artboard.background,
      previewDataUrl,
      objects: serializedObjects,
      createdAt: now,
      updatedAt: now,
    };
  }

  async applyCustomTemplate(template: CustomTemplateRecord) {
    const artboard = this.getActiveArtboard();
    if (!artboard) return;
    const scaleX = artboard.width / template.width;
    const scaleY = artboard.height / template.height;
    const temporary = new StaticCanvas(undefined, { enableRetinaScaling: false });
    await temporary.loadFromJSON({ objects: template.objects });
    const loaded = temporary.getObjects() as EditorObject[];
    temporary.remove(...loaded);
    temporary.dispose();
    this.isRestoring = true;
    const background = new Rect({
      left: artboard.x,
      top: artboard.y,
      width: artboard.width,
      height: artboard.height,
      fill: template.background,
      originX: 'left',
      originY: 'top',
      selectable: true,
    }) as EditorObject;
    background.id = createId('template');
    background.name = `${template.name}背景`;
    background.artboardId = artboard.id;
    background.set({ hasControls: this.showControls });
    this.canvas.add(background);
    const createdObjects: EditorObject[] = [background];
    for (const object of loaded) {
      object.id = createId('template');
      object.artboardId = artboard.id;
      object.set({
        left: artboard.x + (object.left || 0) * scaleX,
        top: artboard.y + (object.top || 0) * scaleY,
        scaleX: (object.scaleX || 1) * scaleX,
        scaleY: (object.scaleY || 1) * scaleY,
        hasControls: this.showControls,
      });
      this.canvas.add(object);
      createdObjects.push(object);
    }
    this.isRestoring = false;
    const preferred = createdObjects.find((object) => object.name?.includes('标题'))
      || createdObjects.find((object) => object instanceof Textbox)
      || createdObjects[createdObjects.length - 1];
    if (preferred) this.canvas.setActiveObject(preferred);
    this.canvas.requestRenderAll();
    this.syncLayers();
    this.syncSelection();
    this.commitHistory();
    this.callbacks.onToast(`已添加本地模板“${template.name}”`, 'success');
  }

  async convertToSmartObject(scope: 'selection' | 'artboard' = 'selection') {
    const artboard = this.getActiveArtboard();
    if (!artboard) return;
    let objects: EditorObject[] = [];
    let bounds = { left: artboard.x, top: artboard.y, width: artboard.width, height: artboard.height };
    let name = `${artboard.name}智能对象`;
    let background = artboard.background;
    if (scope === 'artboard') {
      objects = this.getEditableObjects().filter((object) => object.artboardId === artboard.id);
      if (!objects.length) {
        this.callbacks.onToast('当前画板没有可转换的图层', 'error');
        return;
      }
    } else {
      let active = this.canvas.getActiveObject() as EditorObject | undefined;
      if (!active || this.isArtboardObject(active)) {
        this.callbacks.onToast('请先选择要转为智能对象的图层', 'error');
        return;
      }
      if (active instanceof ActiveSelection) {
        const selected = active.getObjects() as EditorObject[];
        this.canvas.discardActiveObject();
        this.canvas.remove(...selected);
        const group = new Group(selected, { originX: 'center', originY: 'center' }) as EditorObject;
        group.id = createId('group');
        group.name = '智能对象内容';
        group.artboardId = artboard.id;
        this.canvas.add(group);
        active = group;
      }
      objects = [active];
      bounds = active.getBoundingRect();
      name = `${active.name || '图层'} 智能对象`;
      background = 'transparent';
    }
    const serializedObjects = await this.serializeReusableObjects(objects, bounds.left, bounds.top);
    const source: SmartObjectSource = {
      id: createId('smart-source'),
      name,
      width: Math.max(1, Math.ceil(bounds.width)),
      height: Math.max(1, Math.ceil(bounds.height)),
      background,
      format: 'psd',
      objects: serializedObjects,
      createdAt: new Date().toISOString(),
    };
    const preview = new StaticCanvas(undefined, {
      width: source.width,
      height: source.height,
      backgroundColor: background,
      enableRetinaScaling: false,
    });
    await preview.loadFromJSON({ objects: serializedObjects });
    preview.renderAll();
    const dataUrl = preview.toDataURL({ format: 'png', multiplier: 1, left: 0, top: 0, width: source.width, height: source.height });
    preview.dispose();
    this.isRestoring = true;
    this.canvas.discardActiveObject();
    this.canvas.remove(...objects);
    const smartObject = await FabricImage.fromURL(dataUrl, {}, { originX: 'center', originY: 'center' }) as EditorImage;
    smartObject.id = createId('smart-object');
    smartObject.name = name;
    smartObject.originalSrc = dataUrl;
    smartObject.smartObjectSource = source;
    smartObject.artboardId = artboard.id;
    smartObject.adjustments = { ...DEFAULT_ADJUSTMENTS };
    smartObject.set({
      left: bounds.left + bounds.width / 2,
      top: bounds.top + bounds.height / 2,
      hasControls: this.showControls,
    });
    this.canvas.add(smartObject);
    this.canvas.setActiveObject(smartObject);
    this.isRestoring = false;
    this.canvas.requestRenderAll();
    this.syncLayers();
    this.syncSelection();
    this.commitHistory();
    this.callbacks.onToast('已转为智能对象，双击可进入源文件', 'success');
  }

  openSmartObject(id?: string) {
    const target = id ? this.findObject(id) : this.canvas.getActiveObject() as EditorObject | undefined;
    if (!target?.smartObjectSource) {
      this.callbacks.onToast('当前图层不是智能对象', 'error');
      return;
    }
    this.canvas.setActiveObject(target);
    this.syncSelection();
    this.callbacks.onOpenSmartObject?.(structuredClone(target.smartObjectSource));
  }

  async loadSmartObjectSource(source: SmartObjectSource) {
    const artboard = this.getActiveArtboard();
    if (!artboard) return;
    const temporary = new StaticCanvas(undefined, { enableRetinaScaling: false });
    await temporary.loadFromJSON({ objects: source.objects });
    const loaded = temporary.getObjects() as EditorObject[];
    temporary.remove(...loaded);
    temporary.dispose();
    this.isRestoring = true;
    for (const object of loaded) {
      object.id = createId(object.type || 'smart-content');
      object.artboardId = artboard.id;
      object.set({
        left: artboard.x + (object.left || 0),
        top: artboard.y + (object.top || 0),
        hasControls: this.showControls,
      });
      this.canvas.add(object);
    }
    this.isRestoring = false;
    if (loaded.length) this.canvas.setActiveObject(loaded[loaded.length - 1]);
    this.canvas.requestRenderAll();
    this.syncLayers();
    this.syncSelection();
    this.commitHistory();
  }

  getActiveLayerStyle(): LayerStyleSettings {
    const active = this.canvas.getActiveObject() as EditorObject | undefined;
    const stored = active?.layerStyle;
    return {
      clippingMask: Boolean(active?.clipPath || stored?.clippingMask),
      dropShadow: { ...DEFAULT_LAYER_STYLE.dropShadow, ...(stored?.dropShadow || {}) },
      colorOverlay: { ...DEFAULT_LAYER_STYLE.colorOverlay, ...(stored?.colorOverlay || {}) },
      bevel: { ...DEFAULT_LAYER_STYLE.bevel, ...(stored?.bevel || {}) },
    };
  }

  async toggleClippingMask(enabled?: boolean) {
    const active = this.canvas.getActiveObject() as EditorObject | undefined;
    if (!active || active instanceof ActiveSelection || this.isArtboardObject(active)) return;
    const shouldEnable = enabled ?? !active.clipPath;
    if (!shouldEnable) {
      active.clipPath = undefined;
      active.clippingMaskSourceId = undefined;
      active.layerStyle = { ...this.getActiveLayerStyle(), clippingMask: false };
      active.dirty = true;
      this.canvas.requestRenderAll();
      this.commitHistory();
      this.callbacks.onToast('已取消剪切蒙版', 'success');
      return;
    }
    const objects = this.getEditableObjects().filter((object) => object.artboardId === active.artboardId);
    const index = objects.indexOf(active);
    const source = index > 0 ? objects[index - 1] : undefined;
    if (!source) {
      this.callbacks.onToast('当前图层下方没有可用作剪切蒙版的图层', 'error');
      return;
    }
    const clip = await source.clone(CUSTOM_PROPERTIES) as EditorObject;
    clip.set({ selectable: false, evented: false, absolutePositioned: true });
    active.clipPath = clip;
    active.clippingMaskSourceId = source.id;
    active.layerStyle = { ...this.getActiveLayerStyle(), clippingMask: true };
    active.dirty = true;
    this.canvas.requestRenderAll();
    this.commitHistory();
    this.callbacks.onToast(`已剪切到“${source.name || '下方图层'}”`, 'success');
  }

  updateActiveLayerStyle(style: LayerStyleSettings, commit = false) {
    const active = this.canvas.getActiveObject() as EditorObject | undefined;
    if (!active || active instanceof ActiveSelection || this.isArtboardObject(active)) return;
    const next: LayerStyleSettings = {
      clippingMask: Boolean(active.clipPath),
      dropShadow: { ...style.dropShadow },
      colorOverlay: { ...style.colorOverlay },
      bevel: { ...style.bevel },
    };
    active.layerStyle = next;
    if (isImageObject(active)) {
      if (active.previewAssetId) {
        active.filters = next.colorOverlay.enabled
          ? [new filters.BlendColor({ color: next.colorOverlay.color, mode: 'tint', alpha: clampOpacity(next.colorOverlay.opacity) })]
          : [];
        active.applyFilters();
      } else this.applyAdjustmentsToImage(active, active.adjustments || DEFAULT_ADJUSTMENTS);
    } else {
      if (active.layerStyleBaseFill === undefined && typeof active.fill === 'string') active.layerStyleBaseFill = active.fill;
      if (active.layerStyleBaseStroke === undefined) active.layerStyleBaseStroke = typeof active.stroke === 'string' ? active.stroke : '';
      if (active.layerStyleBaseStrokeWidth === undefined) active.layerStyleBaseStrokeWidth = active.strokeWidth || 0;
      if (next.colorOverlay.enabled) active.set('fill', colorWithOpacity(next.colorOverlay.color, next.colorOverlay.opacity, '#f97316'));
      else if (active.layerStyleBaseFill !== undefined) active.set('fill', active.layerStyleBaseFill);
      if (next.bevel.enabled) {
        active.set({
          stroke: `rgba(255,255,255,${Math.min(.85, .24 + next.bevel.depth / 120)})`,
          strokeWidth: Math.max(active.layerStyleBaseStrokeWidth || 0, next.bevel.size * .55),
        });
      } else {
        active.set({
          stroke: active.layerStyleBaseStroke || undefined,
          strokeWidth: active.layerStyleBaseStrokeWidth ?? active.strokeWidth,
        });
      }
    }
    const shadowStyle = next.dropShadow.enabled
      ? next.dropShadow
      : next.bevel.enabled
        ? {
            color: '#000000',
            opacity: Math.min(.65, next.bevel.depth / 140),
            angle: 45,
            distance: Math.max(1, next.bevel.size * .7),
            blur: next.bevel.softness,
          }
        : null;
    if (shadowStyle) {
      const radians = shadowStyle.angle * Math.PI / 180;
      active.set('shadow', new Shadow({
        color: colorWithOpacity(shadowStyle.color, shadowStyle.opacity, '#000000'),
        blur: shadowStyle.blur,
        offsetX: Math.cos(radians) * shadowStyle.distance,
        offsetY: Math.sin(radians) * shadowStyle.distance,
      }));
    } else active.set('shadow', undefined);
    active.dirty = true;
    active.setCoords();
    this.canvas.requestRenderAll();
    this.syncSelection();
    if (commit) this.commitHistory();
  }

  private finishRegionDraft() {
    const artboard = this.getActiveArtboard();
    const start = this.regionStart;
    const end = this.regionEnd;
    this.regionStart = null;
    this.regionEnd = null;
    if (!artboard || !start || !end) return;
    const left = Math.max(artboard.x, Math.min(start.x, end.x));
    const top = Math.max(artboard.y, Math.min(start.y, end.y));
    const right = Math.min(artboard.x + artboard.width, Math.max(start.x, end.x));
    const bottom = Math.min(artboard.y + artboard.height, Math.max(start.y, end.y));
    if (right - left < 16 || bottom - top < 16) {
      this.renderOverlay();
      return;
    }
    const index = this.regions.length;
    const defaultName = index < 26 ? String.fromCharCode(97 + index) : `区域${index + 1}`;
    this.regions.push({
      id: createId('region'),
      name: defaultName,
      xRatio: (left - artboard.x) / artboard.width,
      yRatio: (top - artboard.y) / artboard.height,
      widthRatio: (right - left) / artboard.width,
      heightRatio: (bottom - top) / artboard.height,
      text: '',
      fontSize: Math.max(18, Math.round((bottom - top) * .38)),
      color: '#111111',
    });
    this.emitRegions();
    this.renderOverlay();
    this.commitHistory();
    this.callbacks.onToast(`区域 ${defaultName} 已创建，可在右侧设置名称和文字`, 'success');
  }

  updateRegion(id: string, changes: Partial<Omit<RegionDefinition, 'id'>>) {
    const region = this.regions.find((item) => item.id === id);
    if (!region) return;
    Object.assign(region, changes);
    this.emitRegions();
    this.renderOverlay();
    this.commitHistory();
  }

  deleteRegion(id: string) {
    this.regions = this.regions.filter((region) => region.id !== id);
    const generated = this.getEditableObjects().filter((object) => object.regionId === id);
    if (generated.length) this.canvas.remove(...generated);
    this.emitRegions();
    this.canvas.requestRenderAll();
    this.renderOverlay();
    this.commitHistory();
  }

  fillRegionAcrossArtboards(regionId: string, textValue?: string, artboardIds?: string[], commit = true) {
    const region = this.regions.find((item) => item.id === regionId);
    if (!region) return 0;
    const value = textValue ?? region.text;
    if (!value.trim()) {
      this.callbacks.onToast('请先填写要批量写入的文字', 'error');
      return 0;
    }
    const targets = this.artboards.filter((artboard) => !artboardIds?.length || artboardIds.includes(artboard.id));
    for (const artboard of targets) {
      const left = artboard.x + region.xRatio * artboard.width;
      const top = artboard.y + region.yRatio * artboard.height;
      const width = Math.max(20, region.widthRatio * artboard.width);
      const fontSize = Math.max(10, region.fontSize * Math.min(artboard.width / this.documentWidth, artboard.height / this.documentHeight));
      const existing = this.getEditableObjects().find((object) => object.regionId === region.id && object.artboardId === artboard.id) as (EditorObject & Partial<Textbox>) | undefined;
      if (existing) {
        existing.set({ left, top, width, fontSize, fill: region.color });
        (existing as unknown as Textbox).set('text', value);
        existing.setCoords();
      } else {
        const textbox = new Textbox(value, {
          left,
          top,
          width,
          fontSize,
          fill: region.color,
          fontFamily: 'Microsoft YaHei',
          fontWeight: '600',
          originX: 'left',
          originY: 'top',
          lineHeight: 1.08,
        }) as EditorObject;
        textbox.id = createId('region-text');
        textbox.name = `区域 ${region.name} 文字`;
        textbox.artboardId = artboard.id;
        textbox.regionId = region.id;
        this.canvas.add(textbox);
      }
    }
    region.text = value;
    this.emitRegions();
    this.canvas.requestRenderAll();
    this.syncLayers();
    if (commit) this.commitHistory();
    if (commit) this.callbacks.onToast(`已向 ${targets.length} 个画板的区域 ${region.name} 填写文字`, 'success');
    return targets.length;
  }

  fillAllRegionsAcrossArtboards(artboardIds?: string[]) {
    let count = 0;
    for (const region of this.regions.filter((item) => item.text.trim())) count += this.fillRegionAcrossArtboards(region.id, region.text, artboardIds, false);
    if (count) {
      this.commitHistory();
      this.callbacks.onToast('所有已设置文字的区域均已批量填写', 'success');
    } else this.callbacks.onToast('请先为至少一个区域设置文字', 'error');
  }

  createWorkflow(name?: string) {
    const workflow: WorkflowDefinition = {
      id: createId('workflow'),
      name: name?.trim() || `工作流 ${String.fromCharCode(65 + Math.min(25, this.workflows.length))}`,
      artboardIds: this.activeArtboardId ? [this.activeArtboardId] : [],
      steps: [],
    };
    this.workflows.push(workflow);
    this.emitWorkflows();
    this.commitHistory();
    return workflow.id;
  }

  updateWorkflow(id: string, changes: Partial<Pick<WorkflowDefinition, 'name' | 'artboardIds'>>) {
    const workflow = this.workflows.find((item) => item.id === id);
    if (!workflow) return;
    if (changes.name !== undefined) workflow.name = changes.name.trim() || '未命名工作流';
    if (changes.artboardIds !== undefined) workflow.artboardIds = [...changes.artboardIds];
    this.emitWorkflows();
    this.commitHistory();
  }

  deleteWorkflow(id: string) {
    this.workflows = this.workflows.filter((workflow) => workflow.id !== id);
    this.emitWorkflows();
    this.commitHistory();
  }

  addWorkflowStep(workflowId: string, step:
    | Omit<Extract<WorkflowStep, { type: 'filter' }>, 'id'>
    | Omit<Extract<WorkflowStep, { type: 'region-fill' }>, 'id'>
    | Omit<Extract<WorkflowStep, { type: 'export' }>, 'id'>) {
    const workflow = this.workflows.find((item) => item.id === workflowId);
    if (!workflow) return;
    workflow.steps.push({ ...step, id: createId('step') } as WorkflowStep);
    this.emitWorkflows();
    this.commitHistory();
  }

  removeWorkflowStep(workflowId: string, stepId: string) {
    const workflow = this.workflows.find((item) => item.id === workflowId);
    if (!workflow) return;
    workflow.steps = workflow.steps.filter((step) => step.id !== stepId);
    this.emitWorkflows();
    this.commitHistory();
  }

  moveWorkflowStep(workflowId: string, stepId: string, direction: -1 | 1) {
    const workflow = this.workflows.find((item) => item.id === workflowId);
    if (!workflow) return;
    const index = workflow.steps.findIndex((step) => step.id === stepId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= workflow.steps.length) return;
    [workflow.steps[index], workflow.steps[target]] = [workflow.steps[target], workflow.steps[index]];
    this.emitWorkflows();
    this.commitHistory();
  }

  async runWorkflow(id: string) {
    const workflow = this.workflows.find((item) => item.id === id);
    if (!workflow || !workflow.steps.length) {
      this.callbacks.onToast('请先为工作流添加执行步骤', 'error');
      return;
    }
    const artboardIds = workflow.artboardIds.length
      ? workflow.artboardIds.filter((artboardId) => this.artboards.some((artboard) => artboard.id === artboardId))
      : this.artboards.map((artboard) => artboard.id);
    if (!artboardIds.length) {
      this.callbacks.onToast('工作流没有可执行的画板', 'error');
      return;
    }
    let changed = false;
    try {
      for (let index = 0; index < workflow.steps.length; index += 1) {
        const step = workflow.steps[index];
        this.callbacks.onProcessing(true, `正在执行 ${workflow.name} · ${index + 1}/${workflow.steps.length}`);
        if (step.type === 'filter') {
          changed = (await this.applyFilterToArtboards(step.presetId, artboardIds, false, false)) > 0 || changed;
        } else if (step.type === 'region-fill') {
          changed = this.fillRegionAcrossArtboards(step.regionId, step.text, artboardIds, false) > 0 || changed;
        } else if (step.type === 'export') {
          if (changed) {
            this.commitHistory();
            changed = false;
          }
          await this.exportArtboards(artboardIds, step.format, .92, step.scale, workflow.name);
        }
        await new Promise((resolve) => window.setTimeout(resolve, 80));
      }
      if (changed) this.commitHistory();
      this.callbacks.onToast(`${workflow.name} 已执行完成`, 'success');
    } catch {
      this.callbacks.onToast(`${workflow.name} 执行失败，已保留完成的步骤`, 'error');
    } finally {
      this.callbacks.onProcessing(false);
    }
  }

  async addImageFromFile(file: File, preflight?: ImportPreflightResult) {
    if (!file.type.startsWith('image/')) throw new Error('请选择 PNG、JPEG、WebP 或 TIFF 图片');
    if (preflight && !preflight.allowed) throw new Error(preflight.reason || '内存不足，无法继续，请撤回本次导入');
    this.callbacks.onProcessing(true, '正在把原图分块保存到本机…');
    try {
      const estimate = await this.assetStore.estimateQuota();
      if (estimate.quota && estimate.remaining < file.size * 1.25) throw new Error('本地存储空间不足，已撤回本次导入');
      const original = await this.assetStore.putStream(file, {
        name: file.name,
        mimeType: file.type,
        kind: 'original',
        width: preflight?.width,
        height: preflight?.height,
        onProgress: (progress) => this.callbacks.onProcessing(true, `正在保存原图 ${Math.round(progress * 100)}%…`),
      });
      let preview = original;
      if (preflight && preflight.previewScale < .999) {
        this.callbacks.onProcessing(true, '正在后台生成低清编辑预览…');
        const outputType = file.type === 'image/png' ? 'image/png' : 'image/webp';
        const result = await assetWorkerBroker.run<{ blob?: Blob; imageBitmap?: ImageBitmap; width: number; height: number }>({
          type: 'create-preview',
          file,
          maxLongEdge: Math.max(preflight.previewWidth, preflight.previewHeight),
          outputType,
        });
        let previewBlob = result.blob;
        if (!previewBlob && result.imageBitmap) {
          const fallbackCanvas = document.createElement('canvas');
          fallbackCanvas.width = result.width;
          fallbackCanvas.height = result.height;
          const fallbackContext = fallbackCanvas.getContext('2d', { alpha: true });
          if (!fallbackContext) throw new Error('无法创建兼容预览画布');
          fallbackContext.drawImage(result.imageBitmap, 0, 0);
          result.imageBitmap.close();
          previewBlob = await new Promise<Blob>((resolve, reject) => fallbackCanvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('无法编码兼容预览')), outputType, .9));
        }
        if (!previewBlob) throw new Error('后台预览生成失败');
        preview = await this.assetStore.putStream(previewBlob, {
          name: `${file.name.replace(/\.[^.]+$/, '')}-preview`,
          mimeType: previewBlob.type,
          kind: 'preview',
          width: result.width,
          height: result.height,
          sourceAssetId: original.id,
        });
      }
      this.assets = await this.assetStore.list();
      const url = await this.assetStore.createObjectUrl(preview);
      this.objectUrls.add(url);
      await this.addImageFromUrl(url, file.name.replace(/\.[^.]+$/, ''), true, {
        assetId: original.id,
        previewAssetId: preview.id,
        originalWidth: preflight?.width || original.width,
        originalHeight: preflight?.height || original.height,
      });
    } catch (error) {
      throw error instanceof Error ? error : new Error('图片导入失败，已撤回本次操作');
    } finally {
      this.callbacks.onProcessing(false);
    }
  }

  async addTiffFromFile(file: File, preflight?: ImportPreflightResult) {
    if (!/\.(tif|tiff)$/i.test(file.name) && !['image/tiff', 'image/x-tiff'].includes(file.type)) throw new Error('请选择 TIFF 文件');
    if (preflight && !preflight.allowed) throw new Error(preflight.reason || '内存不足，无法继续，请撤回本次导入');
    this.callbacks.onProcessing(true, '正在后台解码 TIFF…');
    try {
      const estimate = await this.assetStore.estimateQuota();
      if (estimate.quota && estimate.remaining < file.size * 1.5) throw new Error('本地存储空间不足，已撤回本次导入');
      const original = await this.assetStore.putStream(file, {
        name: file.name,
        mimeType: 'image/tiff',
        kind: 'original',
        width: preflight?.width,
        height: preflight?.height,
      });
      const buffer = await file.arrayBuffer();
      const result = await assetWorkerBroker.run<{
        blob?: Blob;
        rgba?: ArrayBuffer;
        width: number;
        height: number;
        sourceWidth: number;
        sourceHeight: number;
      }>({
        type: 'decode-tiff',
        buffer,
        maxLongEdge: Math.max(preflight?.previewWidth || 4096, preflight?.previewHeight || 4096),
      }, [buffer], (progress) => this.callbacks.onProcessing(true, `正在解码 TIFF ${Math.round(progress * 100)}%…`));
      let previewBlob = result.blob;
      let previewWidth = result.width;
      let previewHeight = result.height;
      if (!previewBlob && result.rgba) {
        const source = document.createElement('canvas');
        source.width = result.width;
        source.height = result.height;
        const sourceContext = source.getContext('2d');
        if (!sourceContext) throw new Error('无法创建 TIFF 兼容画布');
        sourceContext.putImageData(new ImageData(new Uint8ClampedArray(result.rgba), result.width, result.height), 0, 0);
        previewWidth = preflight?.previewWidth || result.width;
        previewHeight = preflight?.previewHeight || result.height;
        const previewCanvas = document.createElement('canvas');
        previewCanvas.width = previewWidth;
        previewCanvas.height = previewHeight;
        const previewContext = previewCanvas.getContext('2d');
        if (!previewContext) throw new Error('无法创建 TIFF 预览');
        previewContext.imageSmoothingEnabled = true;
        previewContext.imageSmoothingQuality = 'high';
        previewContext.drawImage(source, 0, 0, previewWidth, previewHeight);
        previewBlob = await new Promise<Blob>((resolve, reject) => previewCanvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('TIFF 预览编码失败')), 'image/png'));
      }
      if (!previewBlob) throw new Error('TIFF 解码失败');
      const preview = await this.assetStore.putStream(previewBlob, {
        name: `${file.name.replace(/\.(tif|tiff)$/i, '')}-preview`,
        mimeType: 'image/png',
        kind: 'preview',
        width: previewWidth,
        height: previewHeight,
        sourceAssetId: original.id,
      });
      this.assets = await this.assetStore.list();
      const url = await this.assetStore.createObjectUrl(preview);
      this.objectUrls.add(url);
      await this.addImageFromUrl(url, file.name.replace(/\.(tif|tiff)$/i, ''), true, {
        assetId: original.id,
        previewAssetId: preview.id,
        originalWidth: result.sourceWidth,
        originalHeight: result.sourceHeight,
      });
      this.documentSettings.format = 'tiff';
      this.callbacks.onToast('TIFF 已打开并生成本地编辑预览', 'success');
    } catch (error) {
      throw error instanceof Error ? error : new Error('TIFF 文件无法打开');
    } finally {
      this.callbacks.onProcessing(false);
    }
  }

  async addImageFromUrl(
    url: string,
    name = '图片',
    commit = true,
    asset?: Pick<EditorObjectMetadata, 'assetId' | 'previewAssetId' | 'originalWidth' | 'originalHeight'>,
  ) {
    const image = (await FabricImage.fromURL(url, {}, {
      originX: 'center',
      originY: 'center',
    })) as EditorImage;
    image.id = createId('image');
    image.name = name;
    image.originalSrc = url;
    image.assetId = asset?.assetId;
    image.previewAssetId = asset?.previewAssetId;
    image.originalWidth = asset?.originalWidth;
    image.originalHeight = asset?.originalHeight;
    image.adjustments = { ...DEFAULT_ADJUSTMENTS };
    image.artboardId = this.activeArtboardId;
    const artboard = this.getActiveArtboard() || { x: 0, y: 0, width: this.documentWidth, height: this.documentHeight };
    const scale = Math.min(
      artboard.width / (image.width || 1),
      artboard.height / (image.height || 1),
    );
    image.set({
      left: artboard.x + artboard.width / 2,
      top: artboard.y + artboard.height / 2,
      scaleX: scale,
      scaleY: scale,
      cornerColor: '#67e8f9',
      borderColor: '#38bdf8',
      cornerStyle: 'circle',
      transparentCorners: false,
    });
    this.canvas.add(image);
    this.canvas.setActiveObject(image);
    this.syncSelection();
    if (commit) this.commitHistory();
    return image;
  }

  setTool(tool: ToolId) {
    this.freeformShapeDrawing = false;
    const selectionTools: ToolId[] = ['edge-cutout', 'quick-select', 'magic-wand', 'lasso', 'polygon-lasso'];
    const selectionAwareTools: ToolId[] = [...selectionTools, 'patch', 'face-retouch'];
    if (selectionAwareTools.includes(this.currentTool) && !selectionAwareTools.includes(tool)) this.clearPixelSelection();
    this.currentTool = tool;
    const activeObject = this.canvas.getActiveObject() as EditorObject | undefined;
    const imageRequired = [...selectionTools, 'restore-brush', 'patch', 'face-retouch', 'liquify'].includes(tool);
    const eraseHasTarget = tool === 'erase-brush' && activeObject && (isImageObject(activeObject) || this.isPaintLayer(activeObject));
    if ((imageRequired || (tool === 'erase-brush' && !eraseHasTarget)) && !isImageObject(activeObject)) {
      const editable = this.getEditableObjects().slice().reverse();
      const target = tool === 'erase-brush'
        ? editable.find((object) => this.isPaintLayer(object) || isImageObject(object))
        : editable.find((object) => isImageObject(object));
      if (target) {
        if (target.artboardId && target.artboardId !== this.activeArtboardId) {
          this.activeArtboardId = target.artboardId;
          this.syncDocumentFromActiveArtboard();
          this.callbacks.onArtboards(this.artboards.map((artboard) => ({ ...artboard })), this.activeArtboardId);
        }
        this.canvas.setActiveObject(target);
        if (isImageObject(target)) this.maskTargetId = target.id || null;
        this.syncSelection();
      }
    }
    this.canvas.isDrawingMode = tool === 'brush';
    this.canvas.selection = tool === 'select';
    this.canvas.skipTargetFind = !['select', 'crop', 'magic-wand'].includes(tool);
    this.applyToolCursor();
    if (tool === 'brush') {
      const brush = new PencilBrush(this.canvas);
      brush.color = '#38bdf8';
      brush.width = Math.max(1, this.selectionOptions.brushSize);
      this.canvas.freeDrawingBrush = brush;
    }
    if (!this.isCircularBrushTool(tool)) this.brushCursorPoint = null;
    this.lassoPoints = [];
    this.quickSeeds = [];
    this.eraserPoints = [];
    this.eraserScenePoints = [];
    this.liquifyStart = null;
    this.liquifyEnd = null;
    this.patchStart = null;
    this.patchEnd = null;
    this.regionStart = null;
    this.regionEnd = null;
    this.renderOverlay();
  }

  beginFreeformShape() {
    this.setTool('shapes');
    this.freeformShapeDrawing = true;
    this.canvas.discardActiveObject();
    this.canvas.isDrawingMode = true;
    this.canvas.selection = false;
    this.canvas.skipTargetFind = true;
    const brush = new PencilBrush(this.canvas);
    brush.color = '#172033';
    brush.width = 2;
    this.canvas.freeDrawingBrush = brush;
    this.canvas.freeDrawingCursor = 'crosshair';
    this.callbacks.onToast('在画板上拖动绘制轮廓，松开后自动闭合', 'default');
    this.renderOverlay();
  }

  private isPaintLayer(object: FabricObject | null | undefined): object is EditorObject {
    const editorObject = object as EditorObject | null | undefined;
    return Boolean(editorObject && (editorObject.paintLayer || editorObject.id?.startsWith('brush-') || editorObject.name?.startsWith('画笔')));
  }

  setSelectionOptions(options: Partial<SelectionOptions>) {
    this.selectionOptions = { ...this.selectionOptions, ...options };
    if (options.brushSize !== undefined && this.canvas.freeDrawingBrush) {
      this.canvas.freeDrawingBrush.width = Math.max(1, options.brushSize);
    }
    this.renderOverlay();
  }

  addText() {
    const artboard = this.getActiveArtboard() || { x: 0, y: 0, width: this.documentWidth, height: this.documentHeight };
    const text = new IText('双击编辑文字', {
      left: artboard.x + artboard.width / 2,
      top: artboard.y + artboard.height / 2,
      originX: 'center',
      originY: 'center',
      fill: '#172033',
      fontFamily: 'Source Han Sans SC',
      fontSize: 64,
      fontWeight: '600',
      lineHeight: 1.2,
      charSpacing: 0,
      padding: 6,
    }) as EditorObject & IText;
    text.id = createId('text');
    text.name = '文字';
    text.artboardId = this.activeArtboardId;
    text.textOriginalText = text.text || '';
    text.textBaseFontWeight = String(text.fontWeight || '400');
    text.textCase = 'normal';
    text.textKerning = 0;
    text.textTracking = 0;
    text.textCompression = 0;
    text.textHorizontalScale = 100;
    text.textVerticalScale = 100;
    text.textBaselineShift = 0;
    text.textFauxBold = false;
    text.textFauxItalic = false;
    text.textSuperscript = false;
    text.textSubscript = false;
    this.addAndSelect(text);
  }

  addShape(type: 'rect' | 'ellipse' | 'triangle' | 'line') {
    const artboard = this.getActiveArtboard() || { x: 0, y: 0, width: this.documentWidth, height: this.documentHeight };
    let object: EditorObject;
    if (type === 'ellipse') {
      object = new Circle({
        radius: 110,
        fill: '#38bdf8',
        left: artboard.x + artboard.width / 2,
        top: artboard.y + artboard.height / 2,
        originX: 'center',
        originY: 'center',
      }) as EditorObject;
    } else if (type === 'triangle') {
      object = new Triangle({
        width: 280,
        height: 240,
        fill: '#38bdf8',
        left: artboard.x + artboard.width / 2,
        top: artboard.y + artboard.height / 2,
        originX: 'center',
        originY: 'center',
      }) as EditorObject;
    } else if (type === 'line') {
      object = new Line([-140, 0, 140, 0], {
        stroke: '#38bdf8',
        strokeWidth: 12,
        left: artboard.x + artboard.width / 2,
        top: artboard.y + artboard.height / 2,
        originX: 'center',
        originY: 'center',
      }) as EditorObject;
    } else {
      object = new Rect({
        width: 300,
        height: 210,
        rx: 24,
        ry: 24,
        fill: '#38bdf8',
        left: artboard.x + artboard.width / 2,
        top: artboard.y + artboard.height / 2,
        originX: 'center',
        originY: 'center',
      }) as EditorObject;
    }
    object.id = createId(type);
    object.name = type === 'ellipse' ? '圆形' : type === 'triangle' ? '三角形' : type === 'line' ? '直线' : '矩形';
    object.artboardId = this.activeArtboardId;
    object.strokePosition = 'center';
    object.shapeKind = type;
    const defaultRadius = type === 'ellipse' ? Math.min(object.width || 0, object.height || 0) / 2 : type === 'rect' ? 24 : type === 'triangle' ? 18 : 0;
    object.cornerRadii = {
      topLeft: defaultRadius,
      topRight: defaultRadius,
      bottomRight: defaultRadius,
      bottomLeft: defaultRadius,
    };
    object.cornersLinked = true;
    if (type !== 'line') object.objectCaching = false;
    this.addAndSelect(object);
  }

  private addAndSelect(object: EditorObject) {
    this.canvas.add(object);
    this.canvas.setActiveObject(object);
    this.canvas.requestRenderAll();
    this.syncSelection();
    this.commitHistory();
  }

  updateActiveProperties(properties: Partial<InspectorState>) {
    const active = this.canvas.getActiveObject() as EditorObject | undefined;
    if (!active) return;
    const next: Record<string, unknown> = {};
    if (properties.x !== undefined) next.left = properties.x;
    if (properties.y !== undefined) next.top = properties.y;
    if (properties.angle !== undefined) next.angle = properties.angle;
    if (properties.opacity !== undefined) {
      const opacity = clampOpacity(properties.opacity);
      if (active instanceof ActiveSelection) {
        active.getObjects().forEach((object) => object.set('opacity', opacity));
        active.dirty = true;
      } else {
        next.opacity = opacity;
      }
    }
    if (properties.fill !== undefined && 'fill' in active) {
      const currentOpacity = properties.fillOpacity ?? getPaintColorInfo(active.fill, '#ffffff').opacity;
      next.fill = colorWithOpacity(properties.fill, currentOpacity, '#ffffff');
    } else if (properties.fillOpacity !== undefined && 'fill' in active) {
      setPaintOpacity(active, 'fill', properties.fillOpacity);
    }
    if (properties.stroke !== undefined) {
      const currentOpacity = properties.strokeOpacity ?? getPaintColorInfo(active.stroke, '#000000').opacity;
      next.stroke = colorWithOpacity(properties.stroke, currentOpacity);
    } else if (properties.strokeOpacity !== undefined) {
      setPaintOpacity(active, 'stroke', properties.strokeOpacity);
    }
    const strokeTarget = active instanceof ActiveSelection ? undefined : active;
    const supportsStrokePosition = ['rect', 'circle', 'triangle'].includes(strokeTarget?.type || '');
    const currentStrokePosition = supportsStrokePosition ? (strokeTarget?.strokePosition || 'center') : 'center';
    const logicalStrokeWidth = (strokeTarget?.strokeWidth || active.strokeWidth || 0) / (currentStrokePosition === 'center' ? 1 : 2);
    if (supportsStrokePosition && properties.strokePosition !== undefined) {
      const nextStrokePosition = properties.strokePosition as StrokePosition;
      strokeTarget!.strokePosition = nextStrokePosition;
      next.strokeWidth = (properties.strokeWidth ?? logicalStrokeWidth) * (nextStrokePosition === 'center' ? 1 : 2);
      strokeTarget!.dirty = true;
    } else if (properties.strokeWidth !== undefined) {
      next.strokeWidth = properties.strokeWidth * (currentStrokePosition === 'center' ? 1 : 2);
    }
    const supportsCorners = Boolean(strokeTarget && ['rect', 'circle', 'triangle', 'path'].includes(strokeTarget.type || '') && !strokeTarget.backgroundLayer && !this.isArtboardObject(strokeTarget));
    if (supportsCorners && strokeTarget) {
      const current = normalizeCornerRadii(strokeTarget);
      const linked = properties.cornersLinked ?? strokeTarget.cornersLinked ?? true;
      const updates = {
        topLeft: properties.cornerTopLeft,
        topRight: properties.cornerTopRight,
        bottomRight: properties.cornerBottomRight,
        bottomLeft: properties.cornerBottomLeft,
      };
      if (properties.cornerRadius !== undefined) {
        const radius = Math.max(0, properties.cornerRadius);
        strokeTarget.cornerRadii = { topLeft: radius, topRight: radius, bottomRight: radius, bottomLeft: radius };
      } else if (Object.values(updates).some((value) => value !== undefined)) {
        const changed = Object.entries(updates).filter(([, value]) => value !== undefined);
        if (linked && changed.length === 1) {
          const radius = Math.max(0, Number(changed[0][1]));
          strokeTarget.cornerRadii = { topLeft: radius, topRight: radius, bottomRight: radius, bottomLeft: radius };
        } else {
          strokeTarget.cornerRadii = {
            topLeft: Math.max(0, updates.topLeft ?? current.topLeft),
            topRight: Math.max(0, updates.topRight ?? current.topRight),
            bottomRight: Math.max(0, updates.bottomRight ?? current.bottomRight),
            bottomLeft: Math.max(0, updates.bottomLeft ?? current.bottomLeft),
          };
        }
      }
      strokeTarget.cornersLinked = linked;
      if (strokeTarget.type === 'rect' && strokeTarget.cornerRadii) {
        next.rx = Math.max(...Object.values(strokeTarget.cornerRadii));
        next.ry = next.rx;
      }
      strokeTarget.objectCaching = false;
      strokeTarget.dirty = true;
    }
    if (isTextObject(active)) {
      if (properties.fontSize !== undefined) next.fontSize = Math.max(1, properties.fontSize);
      if (properties.fontFamily !== undefined) {
        next.fontFamily = properties.fontFamily;
        void document.fonts.load(`16px "${properties.fontFamily}"`).then(() => {
          active.dirty = true;
          this.canvas.requestRenderAll();
        });
      }
      if (properties.fontWeight !== undefined) {
        next.fontWeight = properties.fontWeight;
        if (properties.textFauxBold !== true) active.textBaseFontWeight = String(properties.fontWeight);
      }
      if (properties.textAlign !== undefined) next.textAlign = properties.textAlign;
      if (properties.lineHeight !== undefined) next.lineHeight = Math.max(.5, properties.lineHeight);
      if (properties.textKerning !== undefined) active.textKerning = properties.textKerning;
      if (properties.textTracking !== undefined) active.textTracking = properties.textTracking;
      if (properties.textCompression !== undefined) active.textCompression = Math.max(0, Math.min(100, properties.textCompression));
      if (properties.textKerning !== undefined || properties.textTracking !== undefined || properties.textCompression !== undefined) {
        next.charSpacing = (active.textKerning || 0) + (active.textTracking || 0) - (active.textCompression || 0) * 5;
      }
      if (properties.textHorizontalScale !== undefined) {
        const previous = Math.max(1, active.textHorizontalScale || 100);
        const target = Math.max(10, Math.min(400, properties.textHorizontalScale));
        active.scaleX = (active.scaleX || 1) * target / previous;
        active.textHorizontalScale = target;
      }
      if (properties.textVerticalScale !== undefined) {
        const previous = Math.max(1, active.textVerticalScale || 100);
        const target = Math.max(10, Math.min(400, properties.textVerticalScale));
        active.scaleY = (active.scaleY || 1) * target / previous;
        active.textVerticalScale = target;
      }
      if (properties.textBaselineShift !== undefined) active.textBaselineShift = properties.textBaselineShift;
      if (properties.textSuperscript !== undefined) {
        active.textSuperscript = properties.textSuperscript;
        if (properties.textSuperscript) active.textSubscript = false;
      }
      if (properties.textSubscript !== undefined) {
        active.textSubscript = properties.textSubscript;
        if (properties.textSubscript) active.textSuperscript = false;
      }
      if (properties.textBaselineShift !== undefined || properties.textSuperscript !== undefined || properties.textSubscript !== undefined || properties.fontSize !== undefined) {
        const fontSize = Number(next.fontSize || active.fontSize || 48);
        const scriptShift = active.textSuperscript ? -fontSize * .35 : active.textSubscript ? fontSize * .22 : 0;
        next.deltaY = -(active.textBaselineShift || 0) + scriptShift;
      }
      if (properties.textFauxBold !== undefined) {
        if (properties.textFauxBold && !active.textFauxBold) {
          active.textBaseFontWeight = String(properties.fontWeight || active.fontWeight || '400');
        }
        active.textFauxBold = properties.textFauxBold;
        next.fontWeight = properties.textFauxBold
          ? '700'
          : String(properties.fontWeight || active.textBaseFontWeight || '400');
      }
      if (properties.textFauxItalic !== undefined) {
        active.textFauxItalic = properties.textFauxItalic;
        next.fontStyle = properties.textFauxItalic ? 'italic' : 'normal';
      }
      if (properties.textCase !== undefined && properties.textCase !== active.textCase) {
        if (!active.textOriginalText || active.textCase === 'normal') active.textOriginalText = active.text || '';
        active.textCase = properties.textCase;
        next.text = properties.textCase === 'normal'
          ? (active.textOriginalText || active.text || '')
          : (active.textOriginalText || active.text || '').toLocaleUpperCase('zh-CN');
      }
      if (properties.underline !== undefined) next.underline = properties.underline;
      if (properties.linethrough !== undefined) next.linethrough = properties.linethrough;
      active.objectCaching = false;
      active.dirty = true;
    }
    active.set(next);
    if (properties.width !== undefined && active.width) active.scaleX = properties.width / active.width;
    if (properties.height !== undefined && active.height) active.scaleY = properties.height / active.height;
    active.setCoords();
    this.canvas.requestRenderAll();
    this.syncSelection();
  }

  commitPropertyChange() {
    this.commitHistory();
  }

  applyActiveGradient(startColor: string, endColor: string, angle: number, opacity = 1) {
    const active = this.canvas.getActiveObject() as EditorObject | undefined;
    if (!active || active.type === 'image' || active.type === 'line') return;
    const width = Math.max(1, active.width || 1);
    const height = Math.max(1, active.height || 1);
    const radians = (angle * Math.PI) / 180;
    const radius = Math.sqrt(width ** 2 + height ** 2) / 2;
    const centerX = width / 2;
    const centerY = height / 2;
    active.set('fill', new Gradient({
      type: 'linear',
      gradientUnits: 'pixels',
      coords: {
        x1: centerX - Math.cos(radians) * radius,
        y1: centerY - Math.sin(radians) * radius,
        x2: centerX + Math.cos(radians) * radius,
        y2: centerY + Math.sin(radians) * radius,
      },
      colorStops: [
        { offset: 0, color: colorWithOpacity(startColor, opacity) },
        { offset: 1, color: colorWithOpacity(endColor, opacity) },
      ],
    }));
    this.canvas.requestRenderAll();
    this.syncSelection();
    this.commitHistory();
  }

  clearActiveGradient(color: string, opacity = 1) {
    const active = this.canvas.getActiveObject() as EditorObject | undefined;
    if (!active || active.type === 'image' || active.type === 'line') return;
    active.set('fill', colorWithOpacity(color, opacity, '#ffffff'));
    this.canvas.requestRenderAll();
    this.syncSelection();
    this.commitHistory();
  }

  applyActiveStrokeGradient(startColor: string, endColor: string, angle: number, opacity = 1) {
    const active = this.canvas.getActiveObject() as EditorObject | undefined;
    if (!active || active.type === 'image') return;
    const width = Math.max(1, active.width || 1);
    const height = Math.max(1, active.height || 1);
    const radians = (angle * Math.PI) / 180;
    const radius = Math.sqrt(width ** 2 + height ** 2) / 2;
    const centerX = width / 2;
    const centerY = height / 2;
    active.set('stroke', new Gradient({
      type: 'linear',
      gradientUnits: 'pixels',
      coords: {
        x1: centerX - Math.cos(radians) * radius,
        y1: centerY - Math.sin(radians) * radius,
        x2: centerX + Math.cos(radians) * radius,
        y2: centerY + Math.sin(radians) * radius,
      },
      colorStops: [
        { offset: 0, color: colorWithOpacity(startColor, opacity) },
        { offset: 1, color: colorWithOpacity(endColor, opacity) },
      ],
    }));
    if (!active.strokeWidth) active.set('strokeWidth', 4);
    this.canvas.requestRenderAll();
    this.syncSelection();
    this.commitHistory();
  }

  clearActiveStrokeGradient(color: string, opacity = 1) {
    const active = this.canvas.getActiveObject() as EditorObject | undefined;
    if (!active || active.type === 'image') return;
    active.set('stroke', colorWithOpacity(color, opacity, '#000000'));
    this.canvas.requestRenderAll();
    this.syncSelection();
    this.commitHistory();
  }

  updateImageAdjustments(adjustments: ImageAdjustments, commit = false) {
    const active = this.canvas.getActiveObject() as EditorImage | undefined;
    if (!isImageObject(active)) return;
    if (active.previewAssetId) {
      this.queueAssetAdjustment(active, adjustments, commit);
      return;
    }
    this.applyAdjustmentsToImage(active, adjustments);
    this.canvas.requestRenderAll();
    if (commit) this.commitHistory();
  }

  private queueAssetAdjustment(image: EditorImage, adjustments: ImageAdjustments, commit: boolean) {
    image.adjustments = { ...adjustments };
    const id = image.id || createId('image');
    image.id = id;
    const previousTimer = this.adjustmentTimers.get(id);
    if (previousTimer) window.clearTimeout(previousTimer);
    const token = (this.adjustmentTokens.get(id) || 0) + 1;
    this.adjustmentTokens.set(id, token);
    const timer = window.setTimeout(() => {
      this.adjustmentTimers.delete(id);
      void this.renderAssetAdjustment(image, adjustments, commit, token);
    }, commit ? 0 : 90);
    this.adjustmentTimers.set(id, timer);
  }

  private async renderAssetAdjustment(image: EditorImage, adjustments: ImageAdjustments, commit: boolean, token: number, persistResult = commit) {
    const base = this.assets.find((asset) => asset.id === image.previewAssetId);
    if (!base || !image.id) return;
    try {
      if (commit) this.callbacks.onProcessing(true, '正在后台应用滤镜…');
      const sourceBlob = await this.assetStore.createBlob(base);
      const result = await rasterWorkerBroker.run<{ blob: Blob; width: number; height: number }>({
        type: 'filter',
        blob: sourceBlob,
        adjustments,
        outputType: base.mimeType === 'image/png' ? 'image/png' : 'image/webp',
        quality: .92,
      });
      if (this.adjustmentTokens.get(image.id) !== token) return;
      let descriptor = undefined as AssetDescriptor | undefined;
      if (persistResult) {
        descriptor = await this.assetStore.putStream(result.blob, {
          name: `${image.name || '图片'}-filter`,
          mimeType: result.blob.type,
          kind: 'derived',
          width: result.width,
          height: result.height,
          sourceAssetId: image.assetId,
        });
        image.renderAssetId = descriptor.id;
        this.assets = await this.assetStore.list();
      }
      const url = descriptor ? await this.assetStore.createObjectUrl(descriptor) : URL.createObjectURL(result.blob);
      this.objectUrls.add(url);
      if (image.renderObjectUrl) {
        URL.revokeObjectURL(image.renderObjectUrl);
        this.objectUrls.delete(image.renderObjectUrl);
      }
      const dimensions = { width: image.width || result.width, height: image.height || result.height, scaleX: image.scaleX, scaleY: image.scaleY };
      await image.setSrc(url);
      image.set(dimensions);
      image.renderObjectUrl = url;
      image.originalSrc = url;
      image.visualStyle = undefined;
      const overlay = image.layerStyle?.colorOverlay;
      image.filters = overlay?.enabled
        ? [new filters.BlendColor({ color: overlay.color, mode: 'tint', alpha: clampOpacity(overlay.opacity) })]
        : [];
      image.applyFilters();
      image.setCoords();
      this.canvas.requestRenderAll();
      if (commit) this.commitHistory();
    } catch (error) {
      if (commit) this.callbacks.onToast(error instanceof Error ? error.message : '滤镜处理失败，已撤回本次操作', 'error');
    } finally {
      if (commit) this.callbacks.onProcessing(false);
    }
  }

  private async persistMaskResult(image: EditorImage, maskUrl: string, maskedUrl: string) {
    const maskBlob = await (await fetch(maskUrl)).blob();
    const renderedBlob = await (await fetch(maskedUrl)).blob();
    const mask = await this.assetStore.putStream(maskBlob, {
      name: `${image.name || '图片'}-mask`,
      mimeType: 'image/png',
      kind: 'mask',
      width: image.originalWidth || image.width,
      height: image.originalHeight || image.height,
      sourceAssetId: image.assetId,
    });
    const rendered = await this.assetStore.putStream(renderedBlob, {
      name: `${image.name || '图片'}-masked`,
      mimeType: 'image/png',
      kind: 'derived',
      width: image.width,
      height: image.height,
      sourceAssetId: image.assetId,
    });
    this.assets = await this.assetStore.list();
    const nextMaskUrl = await this.assetStore.createObjectUrl(mask);
    const nextRenderedUrl = await this.assetStore.createObjectUrl(rendered);
    this.objectUrls.add(nextMaskUrl);
    this.objectUrls.add(nextRenderedUrl);
    image.maskAssetId = mask.id;
    image.renderAssetId = rendered.id;
    image.maskSrc = nextMaskUrl;
    image.renderObjectUrl = nextRenderedUrl;
    return { maskUrl: nextMaskUrl, maskedUrl: nextRenderedUrl };
  }

  private applyAdjustmentsToImage(image: EditorImage, adjustments: ImageAdjustments) {
    image.visualStyle = undefined;
    image.adjustments = { ...adjustments };
    const imageFilters: unknown[] = [];
    if (adjustments.brightness) imageFilters.push(new filters.Brightness({ brightness: adjustments.brightness / 100 }));
    if (adjustments.contrast) imageFilters.push(new filters.Contrast({ contrast: adjustments.contrast / 100 }));
    if (adjustments.saturation) imageFilters.push(new filters.Saturation({ saturation: adjustments.saturation / 100 }));
    if (adjustments.hue) imageFilters.push(new filters.HueRotation({ rotation: adjustments.hue / 180 }));
    if (adjustments.blur) imageFilters.push(new filters.Blur({ blur: Math.min(1, adjustments.blur / 20) }));
    if (adjustments.temperature) {
      imageFilters.push(
        new filters.BlendColor({
          color: adjustments.temperature > 0 ? '#ff8a35' : '#4f7cff',
          mode: 'tint',
          alpha: Math.abs(adjustments.temperature) / 420,
        }),
      );
    }
    const overlay = image.layerStyle?.colorOverlay;
    if (overlay?.enabled) {
      imageFilters.push(new filters.BlendColor({
        color: overlay.color,
        mode: 'tint',
        alpha: clampOpacity(overlay.opacity),
      }));
    }
    image.filters = imageFilters as FabricImage['filters'];
    image.applyFilters();
  }

  applyFilterPreset(presetId: string) {
    const legacyPresets: Record<string, ImageAdjustments> = {
      none: { ...DEFAULT_ADJUSTMENTS },
      mono: { ...DEFAULT_ADJUSTMENTS, saturation: -100, contrast: 12 },
      vivid: { ...DEFAULT_ADJUSTMENTS, saturation: 28, contrast: 14, brightness: 4 },
      warm: { ...DEFAULT_ADJUSTMENTS, temperature: 34, saturation: 9 },
      cool: { ...DEFAULT_ADJUSTMENTS, temperature: -32, contrast: 7 },
    };
    const adjustments = FILTER_PRESETS.find((preset) => preset.id === presetId)?.adjustments || legacyPresets[presetId];
    if (!adjustments) return;
    this.updateImageAdjustments(adjustments, true);
    this.callbacks.onSelection(
      (this.canvas.getActiveObject() as EditorObject | undefined)?.id ?? null,
      this.canvas.getActiveObject()?.type ?? null,
      undefined,
      adjustments,
    );
  }

  async applyFilterToArtboards(presetId: string, artboardIds: string[] = [this.activeArtboardId], commit = true, notify = true) {
    const preset = FILTER_PRESETS.find((item) => item.id === presetId);
    if (!preset) return 0;
    const targets = this.getEditableObjects().filter((object) => artboardIds.includes(object.artboardId || '') && isImageObject(object)) as EditorImage[];
    for (const image of targets) {
      if (image.previewAssetId) {
        const token = (this.adjustmentTokens.get(image.id || '') || 0) + 1;
        if (image.id) this.adjustmentTokens.set(image.id, token);
        await this.renderAssetAdjustment(image, preset.adjustments, false, token, true);
        image.adjustments = { ...preset.adjustments };
      } else this.applyAdjustmentsToImage(image, preset.adjustments);
    }
    this.canvas.requestRenderAll();
    if (commit && targets.length) this.commitHistory();
    if (notify && targets.length) this.callbacks.onToast(`已应用“${preset.name}”到 ${targets.length} 个图片图层`, 'success');
    else if (notify) this.callbacks.onToast('所选画板中没有图片图层', 'error');
    return targets.length;
  }

  private applyVisualStyleToImage(image: EditorImage, style: 'pixel' | 'comic') {
    image.visualStyle = style;
    image.filters = style === 'pixel'
      ? [
          new filters.Pixelate({ blocksize: 9 }),
          new filters.Contrast({ contrast: .2 }),
          new filters.Saturation({ saturation: .22 }),
        ]
      : [
          new filters.Contrast({ contrast: .28 }),
          new filters.Saturation({ saturation: .48 }),
          new filters.Convolute({ opaque: false, matrix: [0, -1, 0, -1, 5.4, -1, 0, -1, 0] }),
          new filters.BlendColor({ color: '#f59e0b', mode: 'tint', alpha: .08 }),
        ];
    image.applyFilters();
    image.dirty = true;
    image.setCoords();
  }

  applyVisualStyle(style: 'pixel' | 'comic', artboardIds: string[] = [this.activeArtboardId]) {
    const targets = this.getEditableObjects().filter((object) => artboardIds.includes(object.artboardId || '') && isImageObject(object)) as EditorImage[];
    for (const image of targets) {
      this.applyVisualStyleToImage(image, style);
    }
    this.canvas.requestRenderAll();
    if (targets.length) {
      this.commitHistory();
      this.callbacks.onToast(`已将 ${targets.length} 个图片图层转换为${style === 'pixel' ? '像素' : '漫画'}风格`, 'success');
    } else this.callbacks.onToast('所选画板中没有图片图层', 'error');
    return targets.length;
  }

  cropSelected(ratio: number | null) {
    const image = this.canvas.getActiveObject() as EditorImage | undefined;
    if (!isImageObject(image)) return;
    const element = image.getElement() as HTMLImageElement;
    const naturalWidth = element.naturalWidth || element.width;
    const naturalHeight = element.naturalHeight || element.height;
    if (!ratio) {
      image.set({ cropX: 0, cropY: 0, width: naturalWidth, height: naturalHeight });
    } else if (naturalWidth / naturalHeight > ratio) {
      const width = naturalHeight * ratio;
      image.set({ cropX: (naturalWidth - width) / 2, cropY: 0, width, height: naturalHeight });
    } else {
      const height = naturalWidth / ratio;
      image.set({ cropX: 0, cropY: (naturalHeight - height) / 2, width: naturalWidth, height });
    }
    image.setCoords();
    this.canvas.requestRenderAll();
    this.syncSelection();
    this.commitHistory();
  }

  duplicateActive() {
    const active = this.canvas.getActiveObject();
    if (!active || this.isArtboardObject(active)) return;
    void active.clone(CUSTOM_PROPERTIES).then((clone: EditorObject) => {
      clone.id = createId(active.type);
      clone.name = `${(active as EditorObject).name || '图层'} 副本`;
      clone.set({ left: (active.left || 0) + 24, top: (active.top || 0) + 24 });
      this.canvas.add(clone);
      this.canvas.setActiveObject(clone);
      this.canvas.requestRenderAll();
      this.commitHistory();
    });
  }

  async copyActive() {
    const active = this.canvas.getActiveObject();
    if (!active || this.isArtboardObject(active)) return;
    this.internalClipboard = await active.clone(CUSTOM_PROPERTIES) as EditorObject;
    this.callbacks.onToast('已复制所选对象', 'success');
  }

  async pasteClipboard() {
    if (!this.internalClipboard) return;
    const clone = await this.internalClipboard.clone(CUSTOM_PROPERTIES) as EditorObject;
    clone.id = createId(clone.type || 'layer');
    clone.name = `${clone.name || '图层'} 副本`;
    clone.set({ left: (clone.left || 0) + 28, top: (clone.top || 0) + 28 });
    this.internalClipboard.set({ left: clone.left, top: clone.top });
    this.canvas.add(clone);
    this.canvas.setActiveObject(clone);
    this.canvas.requestRenderAll();
    this.syncSelection();
    this.commitHistory();
  }

  deleteActive() {
    const active = this.canvas.getActiveObject();
    if (!active) return;
    if (active instanceof ActiveSelection) this.canvas.remove(...active.getObjects());
    else if (!this.isArtboardObject(active)) this.canvas.remove(active);
    this.canvas.discardActiveObject();
    this.canvas.requestRenderAll();
    this.commitHistory();
  }

  deleteLayer(id: string) {
    const object = this.findObject(id);
    if (!object || this.isArtboardObject(object)) return;
    this.canvas.remove(object);
    if (this.canvas.getActiveObject() === object) this.canvas.discardActiveObject();
    this.canvas.requestRenderAll();
    this.commitHistory();
  }

  flip(axis: 'x' | 'y') {
    const active = this.canvas.getActiveObject();
    if (!active) return;
    active.set(axis === 'x' ? { flipX: !active.flipX } : { flipY: !active.flipY });
    this.canvas.requestRenderAll();
    this.commitHistory();
  }

  align(direction: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') {
    const active = this.canvas.getActiveObject();
    if (!active) return;
    const editorActive = active as EditorObject;
    const artboard = this.artboards.find((item) => item.id === editorActive.artboardId) || this.getActiveArtboard();
    if (!artboard) return;
    const bounds = active.getBoundingRect();
    if (direction === 'left') active.left = (active.left || 0) + artboard.x - bounds.left;
    if (direction === 'right') active.left = (active.left || 0) + artboard.x + artboard.width - (bounds.left + bounds.width);
    if (direction === 'top') active.top = (active.top || 0) + artboard.y - bounds.top;
    if (direction === 'bottom') active.top = (active.top || 0) + artboard.y + artboard.height - (bounds.top + bounds.height);
    if (direction === 'center') active.left = (active.left || 0) + artboard.x + artboard.width / 2 - (bounds.left + bounds.width / 2);
    if (direction === 'middle') active.top = (active.top || 0) + artboard.y + artboard.height / 2 - (bounds.top + bounds.height / 2);
    active.setCoords();
    this.canvas.requestRenderAll();
    this.commitHistory();
  }

  groupActive() {
    const active = this.canvas.getActiveObject();
    if (!(active instanceof ActiveSelection)) return;
    const objects = active.getObjects();
    this.canvas.discardActiveObject();
    this.canvas.remove(...objects);
    const group = new Group(objects, { originX: 'center', originY: 'center' }) as EditorObject;
    group.id = createId('group');
    group.name = '组合';
    group.artboardId = (objects[0] as EditorObject | undefined)?.artboardId || this.activeArtboardId;
    this.canvas.add(group);
    this.canvas.setActiveObject(group);
    this.commitHistory();
  }

  ungroupActive() {
    const active = this.canvas.getActiveObject();
    if (!(active instanceof Group)) return;
    const group = active;
    const objects = group.getObjects();
    this.canvas.discardActiveObject();
    for (const object of [...objects]) group.exitGroup(object);
    this.canvas.remove(group);
    this.canvas.add(...objects);
    const selection = new ActiveSelection(objects, { canvas: this.canvas });
    this.canvas.setActiveObject(selection);
    this.canvas.requestRenderAll();
    this.commitHistory();
  }

  async mergeVisibleLayers() {
    const objects = this.getEditableObjects().filter((object) => object.artboardId === this.activeArtboardId && object.visible !== false);
    if (objects.length < 2) {
      this.callbacks.onToast('至少需要两个可见图层才能合并', 'error');
      return;
    }
    await this.mergeObjects(objects, '合并图层');
  }

  async mergeActiveDown() {
    const active = this.canvas.getActiveObject() as EditorObject | undefined;
    if (!active || active instanceof ActiveSelection || this.isArtboardObject(active)) return;
    const objects = this.getEditableObjects().filter((object) => object.artboardId === active.artboardId);
    const index = objects.indexOf(active);
    if (index <= 0) {
      this.callbacks.onToast('当前图层下方没有可合并图层', 'error');
      return;
    }
    await this.mergeObjects([objects[index - 1], active], '向下合并');
  }

  private async mergeObjects(objects: EditorObject[], name: string) {
    this.callbacks.onProcessing(true, '正在合并图层…');
    try {
      const artboard = this.artboards.find((item) => item.id === objects[0]?.artboardId) || this.getActiveArtboard();
      if (!artboard) return;
      const serializedObjects = objects.map((object) => object.toObject());
      const temporary = new StaticCanvas(undefined, {
        width: artboard.width,
        height: artboard.height,
        backgroundColor: 'transparent',
        enableRetinaScaling: false,
      });
      await temporary.loadFromJSON({ objects: serializedObjects });
      for (const object of temporary.getObjects()) object.set({ left: (object.left || 0) - artboard.x, top: (object.top || 0) - artboard.y });
      temporary.renderAll();
      const dataUrl = temporary.toDataURL({
        format: 'png',
        multiplier: 1,
        left: 0,
        top: 0,
        width: artboard.width,
        height: artboard.height,
      });
      temporary.dispose();
      const targetIndex = Math.min(...objects.map((object) => this.canvas.getObjects().indexOf(object)));
      this.canvas.remove(...objects);
      const merged = await FabricImage.fromURL(dataUrl, {}, { originX: 'center', originY: 'center' }) as EditorImage;
      merged.id = createId('merged');
      merged.name = name;
      merged.originalSrc = dataUrl;
      merged.adjustments = { ...DEFAULT_ADJUSTMENTS };
      merged.artboardId = artboard.id;
      merged.set({ left: artboard.x + artboard.width / 2, top: artboard.y + artboard.height / 2 });
      this.canvas.add(merged);
      this.canvas.moveObjectTo(merged, Math.max(this.artboards.length, targetIndex));
      this.canvas.setActiveObject(merged);
      this.canvas.requestRenderAll();
      this.syncSelection();
      this.commitHistory();
      this.callbacks.onToast('图层已合并', 'success');
    } catch {
      this.callbacks.onToast('图层合并失败', 'error');
    } finally {
      this.callbacks.onProcessing(false);
    }
  }

  setLayerVisibility(id: string) {
    const object = this.findObject(id);
    if (!object) return;
    object.visible = !object.visible;
    object.lazyVisible = object.visible;
    this.canvas.requestRenderAll();
    this.commitHistory();
  }

  setLayerLocked(id: string) {
    const object = this.findObject(id);
    if (!object) return;
    object.locked = !object.locked;
    object.set({
      selectable: !object.locked,
      evented: !object.locked,
      lockMovementX: Boolean(object.locked),
      lockMovementY: Boolean(object.locked),
      lockScalingX: Boolean(object.locked),
      lockScalingY: Boolean(object.locked),
      lockRotation: Boolean(object.locked),
    });
    this.canvas.requestRenderAll();
    this.commitHistory();
  }

  renameLayer(id: string, name: string) {
    const object = this.findObject(id);
    if (!object) return;
    object.name = name.trim() || '未命名图层';
    this.syncLayers();
    this.commitHistory();
  }

  selectLayer(id: string, additive = false) {
    const object = this.findObject(id);
    if (!object || object.locked) return;
    if (object.artboardId && object.artboardId !== this.activeArtboardId) {
      this.activeArtboardId = object.artboardId;
      this.syncDocumentFromActiveArtboard();
      this.callbacks.onArtboards(this.artboards.map((artboard) => ({ ...artboard })), this.activeArtboardId);
    }
    if (!additive) {
      this.canvas.setActiveObject(object);
    } else {
      const current = this.canvas.getActiveObject();
      const existing = current instanceof ActiveSelection
        ? current.getObjects() as EditorObject[]
        : current && !this.isArtboardObject(current)
          ? [current as EditorObject]
          : [];
      const contains = existing.includes(object);
      const next = contains ? existing.filter((item) => item !== object) : [...existing, object];
      this.canvas.discardActiveObject();
      if (next.length === 1) this.canvas.setActiveObject(next[0]);
      else if (next.length > 1) this.canvas.setActiveObject(new ActiveSelection(next, { canvas: this.canvas }));
    }
    this.canvas.requestRenderAll();
    this.syncSelection();
  }

  reorderLayer(activeId: string, overId: string) {
    const objects = this.getEditableObjects();
    const from = objects.findIndex((object) => object.id === activeId);
    const to = objects.findIndex((object) => object.id === overId);
    if (from < 0 || to < 0) return;
    if (objects[from].artboardId !== objects[to].artboardId) return;
    const absoluteTarget = this.canvas.getObjects().indexOf(objects[to]);
    this.canvas.moveObjectTo(objects[from], Math.max(this.artboards.length, absoluteTarget));
    this.canvas.requestRenderAll();
    this.commitHistory();
  }

  private findObject(id: string) {
    return this.canvas.getObjects().find((object) => (object as EditorObject).id === id) as EditorObject | undefined;
  }

  private getEditableObjects() {
    return this.canvas.getObjects().filter((object) => !this.isArtboardObject(object)) as EditorObject[];
  }

  private syncLayers() {
    const layers = this.getEditableObjects()
      .slice()
      .reverse()
      .map((object) => ({
        id: object.id || createId(object.type),
        name: object.name || object.type || '图层',
        type: object.smartObjectSource ? 'smart-object' : object.type || 'object',
        visible: object.artboardId === this.activeArtboardId ? object.visible !== false : ((object.lazyVisible ?? object.visible) !== false),
        locked: Boolean(object.locked),
        artboardId: object.artboardId || this.activeArtboardId,
      }));
    this.callbacks.onLayers(layers);
  }

  private syncSelection() {
    const active = this.canvas.getActiveObject() as EditorObject | undefined;
    if (!active || this.isArtboardObject(active)) {
      this.callbacks.onSelection(null, null, undefined, undefined, []);
      return;
    }
    const selectionArtboardId = active instanceof ActiveSelection
      ? (active.getObjects()[0] as EditorObject | undefined)?.artboardId
      : active.artboardId;
    if (selectionArtboardId && selectionArtboardId !== this.activeArtboardId) {
      this.activeArtboardId = selectionArtboardId;
      this.syncDocumentFromActiveArtboard();
      this.callbacks.onArtboards(this.artboards.map((artboard) => ({ ...artboard })), this.activeArtboardId);
    }
    const selectedIds = active instanceof ActiveSelection
      ? active.getObjects().map((object) => (object as EditorObject).id).filter((id): id is string => Boolean(id))
      : active.id ? [active.id] : [];
    const bounds = active.getBoundingRect();
    const appearanceTarget = active instanceof ActiveSelection
      ? active.getObjects()[0] as EditorObject | undefined
      : active;
    const fillInfo = getPaintColorInfo(appearanceTarget?.fill, '#ffffff');
    const strokeInfo = getPaintColorInfo(appearanceTarget?.stroke, '#000000');
    const strokePosition: StrokePosition = ['rect', 'circle', 'triangle'].includes(appearanceTarget?.type || '')
      ? (appearanceTarget?.strokePosition || 'center')
      : 'center';
    const text = active as unknown as IText;
    const cornerRadii = appearanceTarget ? normalizeCornerRadii(appearanceTarget) : { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 };
    const inspector: Partial<InspectorState> = {
      x: Math.round(active.left || 0),
      y: Math.round(active.top || 0),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
      angle: Math.round(active.angle || 0),
      opacity: active instanceof ActiveSelection
        ? ((active.getObjects()[0] as EditorObject | undefined)?.opacity ?? 1)
        : (active.opacity ?? 1),
      fill: fillInfo.hex,
      fillOpacity: fillInfo.opacity,
      stroke: strokeInfo.hex,
      strokeOpacity: strokeInfo.opacity,
      strokeWidth: (appearanceTarget?.strokeWidth || 0) / (strokePosition === 'center' ? 1 : 2),
      strokePosition,
      shapeKind: appearanceTarget?.shapeKind || '',
      cornerRadius: cornerRadii.topLeft,
      cornerTopLeft: cornerRadii.topLeft,
      cornerTopRight: cornerRadii.topRight,
      cornerBottomRight: cornerRadii.bottomRight,
      cornerBottomLeft: cornerRadii.bottomLeft,
      cornersLinked: appearanceTarget?.cornersLinked ?? true,
      fontSize: text.fontSize || 48,
      fontFamily: text.fontFamily || 'Source Han Sans SC',
      fontWeight: String(text.fontWeight || '400'),
      textAlign: text.textAlign || 'left',
      lineHeight: text.lineHeight || 1.2,
      textKerning: appearanceTarget?.textKerning || 0,
      textTracking: appearanceTarget?.textTracking || 0,
      textCompression: appearanceTarget?.textCompression || 0,
      textHorizontalScale: appearanceTarget?.textHorizontalScale || 100,
      textVerticalScale: appearanceTarget?.textVerticalScale || 100,
      textBaselineShift: appearanceTarget?.textBaselineShift || 0,
      textCase: appearanceTarget?.textCase || 'normal',
      textFauxBold: Boolean(appearanceTarget?.textFauxBold),
      textFauxItalic: Boolean(appearanceTarget?.textFauxItalic),
      textSuperscript: Boolean(appearanceTarget?.textSuperscript),
      textSubscript: Boolean(appearanceTarget?.textSubscript),
      underline: Boolean(text.underline),
      linethrough: Boolean(text.linethrough),
    };
    this.callbacks.onSelection(
      active.id || selectedIds[selectedIds.length - 1] || null,
      active.type || null,
      inspector,
      isImageObject(active) ? { ...DEFAULT_ADJUSTMENTS, ...(active.adjustments || {}) } : undefined,
      selectedIds,
    );
  }

  private async handlePointerDown(event: Event) {
    const pointerEvent = event as MouseEvent;
    const scenePoint = this.canvas.getScenePoint(pointerEvent);
    if (this.currentTool === 'hand' || this.spacePressed) {
      this.isPointerDown = true;
      this.panLast = new Point(pointerEvent.clientX, pointerEvent.clientY);
      this.canvas.defaultCursor = 'grabbing';
      this.canvas.hoverCursor = 'grabbing';
      this.canvas.freeDrawingCursor = 'grabbing';
      return;
    }
    if (this.currentTool === 'region') {
      const artboard = this.getActiveArtboard();
      if (!artboard || scenePoint.x < artboard.x || scenePoint.x > artboard.x + artboard.width || scenePoint.y < artboard.y || scenePoint.y > artboard.y + artboard.height) {
        this.callbacks.onToast('请在当前画板内部拖拽框选区域', 'error');
        return;
      }
      this.isPointerDown = true;
      this.regionStart = scenePoint;
      this.regionEnd = scenePoint;
      this.renderOverlay();
      return;
    }
    if (this.currentTool === 'liquify') {
      let active = this.canvas.getActiveObject();
      if (!isImageObject(active)) {
        const images = this.getEditableObjects().filter((object) => isImageObject(object)) as EditorImage[];
        active = images.find((image) => {
          const bounds = image.getBoundingRect();
          return scenePoint.x >= bounds.left && scenePoint.x <= bounds.left + bounds.width && scenePoint.y >= bounds.top && scenePoint.y <= bounds.top + bounds.height;
        }) || images.find((image) => image.artboardId === this.activeArtboardId);
        if (isImageObject(active)) {
          this.canvas.setActiveObject(active);
          this.syncSelection();
        }
      }
      if (!isImageObject(active)) {
        this.callbacks.onToast('请先选择需要瘦脸或瘦身的图片图层', 'error');
        return;
      }
      this.isPointerDown = true;
      this.liquifyStart = scenePoint;
      this.liquifyEnd = scenePoint;
      return;
    }
    if (this.currentTool === 'patch') {
      if (!this.activeMask) {
        this.callbacks.onToast('请先用套索或多边形套索框选需要修补的区域', 'error');
        return;
      }
      if (!isImageObject(this.canvas.getActiveObject())) {
        this.callbacks.onToast('请先选择需要修补的图片图层', 'error');
        return;
      }
      this.isPointerDown = true;
      this.patchStart = scenePoint;
      this.patchEnd = scenePoint;
      this.renderOverlay();
      return;
    }
    if (this.currentTool === 'magic-wand') {
      await this.runMagicWand(scenePoint);
      return;
    }
    if (this.currentTool === 'erase-brush' || this.currentTool === 'restore-brush') {
      this.isPointerDown = true;
      this.eraserScenePoints = [scenePoint];
      this.eraserPoints = [];
      const active = this.canvas.getActiveObject();
      if (isImageObject(active)) {
        const pixel = await this.sceneToWorkPixel(scenePoint);
        if (pixel) this.eraserPoints = [pixel];
      }
      return;
    }
    if (this.currentTool === 'quick-select' || this.currentTool === 'edge-cutout') {
      const pixel = await this.sceneToWorkPixel(scenePoint);
      if (!pixel) return;
      this.isPointerDown = true;
      this.quickSeeds = [
        {
          ...pixel,
          radius: this.selectionOptions.brushSize * this.workImageScale / 2,
          foreground: !this.selectionOptions.brushSubtract,
        },
      ];
      this.renderOverlay();
      return;
    }
    if (this.currentTool === 'lasso') {
      this.isPointerDown = true;
      this.lassoPoints = [scenePoint];
      this.renderOverlay();
      return;
    }
    if (this.currentTool === 'polygon-lasso') {
      this.lassoPoints.push(scenePoint);
      this.renderOverlay();
    }
  }

  private handlePointerMove(event: Event) {
    const pointerEvent = event as MouseEvent;
    if (this.isCircularBrushTool() && !this.spacePressed) {
      this.brushCursorPoint = this.canvas.getViewportPoint(pointerEvent);
      this.renderOverlay();
    }
    if ((this.currentTool === 'hand' || this.spacePressed) && this.isPointerDown) {
      const next = new Point(pointerEvent.clientX, pointerEvent.clientY);
      this.canvas.relativePan(next.subtract(this.panLast));
      this.panLast = next;
      this.emitViewport();
      this.renderOverlay();
      return;
    }
    if (!this.isPointerDown) return;
    const scenePoint = this.canvas.getScenePoint(pointerEvent);
    if (this.currentTool === 'region') {
      this.regionEnd = scenePoint;
      this.renderOverlay();
      return;
    }
    if (this.currentTool === 'liquify') {
      this.liquifyEnd = scenePoint;
      this.renderOverlay();
      return;
    }
    if (this.currentTool === 'patch') {
      this.patchEnd = scenePoint;
      this.renderOverlay();
      return;
    }
    if (this.currentTool === 'erase-brush' || this.currentTool === 'restore-brush') {
      const lastScene = this.eraserScenePoints[this.eraserScenePoints.length - 1];
      if (!lastScene || lastScene.distanceFrom(scenePoint) > Math.max(1, this.selectionOptions.eraserSize * 0.12)) {
        this.eraserScenePoints.push(scenePoint);
      }
      if (isImageObject(this.canvas.getActiveObject())) {
        void this.sceneToWorkPixel(scenePoint).then((pixel) => {
          if (!pixel) return;
          const last = this.eraserPoints[this.eraserPoints.length - 1];
          if (!last || Math.hypot(last.x - pixel.x, last.y - pixel.y) > Math.max(2, this.selectionOptions.eraserSize * this.workImageScale * 0.15)) {
            this.eraserPoints.push(pixel);
          }
        });
      }
      return;
    }
    if (this.currentTool === 'lasso') {
      const last = this.lassoPoints[this.lassoPoints.length - 1];
      if (!last || last.distanceFrom(scenePoint) > 4 / this.canvas.getZoom()) this.lassoPoints.push(scenePoint);
      this.renderOverlay();
    }
    if (this.currentTool === 'quick-select' || this.currentTool === 'edge-cutout') {
      void this.sceneToWorkPixel(scenePoint).then((pixel) => {
        if (!pixel) return;
        const last = this.quickSeeds[this.quickSeeds.length - 1];
        if (!last || Math.hypot(last.x - pixel.x, last.y - pixel.y) > this.selectionOptions.brushSize * this.workImageScale * 0.25) {
          this.quickSeeds.push({
            ...pixel,
            radius: this.selectionOptions.brushSize * this.workImageScale / 2,
            foreground: !this.selectionOptions.brushSubtract,
          });
          this.renderOverlay();
        }
      });
    }
  }

  private async handlePointerUp(_event: Event) {
    if (this.currentTool === 'hand' || this.spacePressed) {
      this.isPointerDown = false;
      this.applyToolCursor();
      return;
    }
    if ((this.currentTool === 'quick-select' || this.currentTool === 'edge-cutout') && this.isPointerDown) {
      this.isPointerDown = false;
      await this.runQuickSelection();
    }
    if ((this.currentTool === 'erase-brush' || this.currentTool === 'restore-brush') && this.isPointerDown) {
      this.isPointerDown = false;
      await this.applyEraserStroke(this.currentTool === 'restore-brush');
    }
    if (this.currentTool === 'liquify' && this.isPointerDown) {
      this.isPointerDown = false;
      const start = this.liquifyStart;
      const end = this.liquifyEnd;
      this.liquifyStart = null;
      this.liquifyEnd = null;
      if (start && end && start.distanceFrom(end) > 1 / this.canvas.getZoom()) await this.applyLiquifyStroke(start, end);
    }
    if (this.currentTool === 'patch' && this.isPointerDown) {
      this.isPointerDown = false;
      const start = this.patchStart;
      const end = this.patchEnd;
      this.patchStart = null;
      this.patchEnd = null;
      if (start && end && start.distanceFrom(end) > 1 / this.canvas.getZoom()) await this.applyPatchStroke(start, end);
      else this.callbacks.onToast('请把选区拖到附近的干净取样区域', 'error');
      this.renderOverlay();
    }
    if (this.currentTool === 'region' && this.isPointerDown) {
      this.isPointerDown = false;
      this.finishRegionDraft();
    }
    if (this.currentTool === 'lasso' && this.isPointerDown) {
      this.isPointerDown = false;
      await this.finishLasso();
    }
  }

  private async prepareWorkImage() {
    const current = this.canvas.getActiveObject() as EditorImage | undefined;
    const active = isImageObject(current)
      ? current
      : this.maskTargetId
        ? (this.findObject(this.maskTargetId) as EditorImage | undefined)
        : undefined;
    if (!isImageObject(active)) {
      this.callbacks.onToast('请先选中一个图片图层', 'error');
      return null;
    }
    if (this.maskTargetId === active.id && this.workImageData) return { image: active, imageData: this.workImageData };
    const targetChanged = this.maskTargetId !== active.id;
    const source = active.originalSrc || active.getSrc();
    const htmlImage = await imageFromUrl(source);
    const maxSide = 2048;
    this.workImageScale = Math.min(1, maxSide / Math.max(htmlImage.naturalWidth, htmlImage.naturalHeight));
    const width = Math.max(1, Math.round(htmlImage.naturalWidth * this.workImageScale));
    const height = Math.max(1, Math.round(htmlImage.naturalHeight * this.workImageScale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('无法读取图片像素');
    context.drawImage(htmlImage, 0, 0, width, height);
    this.workImageData = context.getImageData(0, 0, width, height);
    this.maskTargetId = active.id || null;
    if (targetChanged) {
      this.activeMask = null;
      this.activeFaces = [];
    }
    return { image: active, imageData: this.workImageData };
  }

  private async sceneToWorkPixel(scenePoint: Point) {
    const prepared = await this.prepareWorkImage();
    if (!prepared) return null;
    const { image, imageData } = prepared;
    const local = util.transformPoint(scenePoint, util.invertTransform(image.calcTransformMatrix()));
    const cropX = image.cropX || 0;
    const cropY = image.cropY || 0;
    const x = Math.round((cropX + local.x + (image.width || 0) / 2) * this.workImageScale);
    const y = Math.round((cropY + local.y + (image.height || 0) / 2) * this.workImageScale);
    if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) return null;
    return { x, y };
  }

  private async runMagicWand(scenePoint: Point) {
    const pixel = await this.sceneToWorkPixel(scenePoint);
    if (!pixel || !this.workImageData) return;
    this.callbacks.onProcessing(true, '正在识别相近颜色…');
    try {
      const backgroundSelection = await this.selectionService.magic(
        this.workImageData,
        pixel.x,
        pixel.y,
        this.selectionOptions.tolerance,
        this.selectionOptions.contiguous,
        undefined,
        'replace',
      );
      const foreground = new Uint8ClampedArray(backgroundSelection.data.length);
      for (let index = 0; index < foreground.length; index += 1) foreground[index] = 255 - backgroundSelection.data[index];
      if (!this.activeMask || this.selectionOptions.combine === 'replace') {
        this.activeMask = { ...backgroundSelection, data: foreground };
      } else {
        const combined = new Uint8ClampedArray(foreground.length);
        for (let index = 0; index < combined.length; index += 1) {
          combined[index] = this.selectionOptions.combine === 'add'
            ? Math.min(this.activeMask.data[index], foreground[index])
            : Math.max(this.activeMask.data[index], backgroundSelection.data[index]);
        }
        this.activeMask = { ...backgroundSelection, data: combined };
      }
      await this.buildPreviewCanvas();
      const target = this.maskTargetId ? this.findObject(this.maskTargetId) : undefined;
      if (target) this.canvas.setActiveObject(target);
      this.syncSelection();
      this.renderOverlay();
    } catch (error) {
      if ((error as Error).message !== '已取消') this.callbacks.onToast('魔棒选区计算失败', 'error');
    } finally {
      this.callbacks.onProcessing(false);
    }
  }

  async oneClickCutout() {
    if (!isImageObject(this.canvas.getActiveObject()) && !this.maskTargetId) {
      const image = this.getEditableObjects().slice().reverse().find((object) => isImageObject(object));
      if (image) {
        this.canvas.setActiveObject(image);
        this.maskTargetId = image.id || null;
      }
    }
    const prepared = await this.prepareWorkImage();
    if (!prepared) return;
    this.callbacks.onProcessing(true, '正在从图片四周识别连续背景…');
    try {
      this.activeMask = await this.selectionService.edgeBackground(prepared.imageData);
      await this.buildPreviewCanvas();
      this.canvas.setActiveObject(prepared.image);
      this.syncSelection();
      this.renderOverlay();
      this.callbacks.onToast('已生成主体选区预览，请检查并确认抠图', 'success');
    } catch (error) {
      if ((error as Error).message !== '已取消') this.callbacks.onToast('背景识别失败，原图未被修改', 'error');
    } finally {
      this.callbacks.onProcessing(false);
    }
  }

  private async runQuickSelection() {
    const prepared = await this.prepareWorkImage();
    if (!prepared || !this.quickSeeds.length) return;
    this.callbacks.onProcessing(true, '正在分析边缘…');
    try {
      this.activeMask = await this.selectionService.quick(
        prepared.imageData,
        this.quickSeeds,
        this.activeMask?.data,
        'replace',
      );
      this.quickSeeds = [];
      await this.buildPreviewCanvas();
      const target = this.maskTargetId ? this.findObject(this.maskTargetId) : undefined;
      if (target) this.canvas.setActiveObject(target);
      this.syncSelection();
      this.renderOverlay();
    } catch (error) {
      if ((error as Error).message !== '已取消') this.callbacks.onToast('快速选择失败，已保留原选区', 'error');
    } finally {
      this.callbacks.onProcessing(false);
    }
  }

  async detectFaceSelection() {
    const prepared = await this.prepareWorkImage();
    if (!prepared) return 0;
    this.callbacks.onProcessing(true, '正在本地识别人脸…');
    try {
      const faces = await this.faceDetectionService.detect(prepared.imageData);
      if (!faces.length) {
        this.activeFaces = [];
        this.callbacks.onToast('没有识别到清晰正脸，可使用套索手动框选美颜区域', 'error');
        return 0;
      }
      this.activeFaces = faces;
      const mask = new Uint8ClampedArray(prepared.imageData.width * prepared.imageData.height);
      for (const face of faces) {
        const centerX = face.x + face.width / 2;
        const centerY = face.y + face.height * 0.53;
        const radiusX = face.width * 0.64;
        const radiusY = face.height * 0.8;
        const minX = Math.max(0, Math.floor(centerX - radiusX));
        const maxX = Math.min(prepared.imageData.width - 1, Math.ceil(centerX + radiusX));
        const minY = Math.max(0, Math.floor(centerY - radiusY));
        const maxY = Math.min(prepared.imageData.height - 1, Math.ceil(centerY + radiusY));
        for (let y = minY; y <= maxY; y += 1) {
          for (let x = minX; x <= maxX; x += 1) {
            const distance = ((x - centerX) / radiusX) ** 2 + ((y - centerY) / radiusY) ** 2;
            if (distance <= 1) mask[y * prepared.imageData.width + x] = 255;
          }
        }
      }
      this.activeMask = { width: prepared.imageData.width, height: prepared.imageData.height, data: mask };
      prepared.image.beautyBaseSrc ||= prepared.image.getSrc();
      await this.buildPreviewCanvas();
      this.canvas.setActiveObject(prepared.image);
      this.syncSelection();
      this.renderOverlay();
      this.callbacks.onToast(`已识别 ${faces.length} 张人脸并建立脸部选区`, 'success');
      return faces.length;
    } catch (error) {
      this.callbacks.onToast(error instanceof Error ? error.message : '人脸识别失败，请稍后重试', 'error');
      return 0;
    } finally {
      this.callbacks.onProcessing(false);
    }
  }

  async useCurrentSelectionAsFaceRegion() {
    const prepared = await this.prepareWorkImage();
    if (!prepared || !this.activeMask || prepared.image.id !== this.maskTargetId) {
      this.callbacks.onToast('请先用套索或多边形套索框选需要美颜的脸部区域', 'error');
      return false;
    }
    let minX = this.activeMask.width;
    let minY = this.activeMask.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < this.activeMask.height; y += 1) {
      for (let x = 0; x < this.activeMask.width; x += 1) {
        if (this.activeMask.data[y * this.activeMask.width + x] < 16) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (maxX < minX || maxY < minY) {
      this.callbacks.onToast('当前选区为空，请重新框选脸部区域', 'error');
      return false;
    }
    this.activeFaces = [{ x: minX, y: minY, width: Math.max(1, maxX - minX + 1), height: Math.max(1, maxY - minY + 1) }];
    prepared.image.beautyBaseSrc ||= prepared.image.getSrc();
    this.canvas.setActiveObject(prepared.image);
    this.syncSelection();
    this.renderOverlay();
    this.callbacks.onToast('已使用当前选区作为手动美颜区域', 'success');
    return true;
  }

  async applyFaceRetouch(smoothing: number, slimming: number) {
    let prepared = await this.prepareWorkImage();
    if (!prepared) return;
    if (!this.activeFaces.length) {
      if (this.activeMask) {
        const selected = await this.useCurrentSelectionAsFaceRegion();
        if (!selected) return;
      } else {
        const count = await this.detectFaceSelection();
        if (!count) return;
      }
      prepared = await this.prepareWorkImage();
      if (!prepared) return;
    }
    const image = prepared.image;
    const faceMask = this.activeMask
      ? { width: this.activeMask.width, height: this.activeMask.height, data: new Uint8ClampedArray(this.activeMask.data) }
      : null;
    const baseSource = image.beautyBaseSrc || image.getSrc();
    image.beautyBaseSrc ||= baseSource;
    this.callbacks.onProcessing(true, '正在应用美颜与瘦脸…');
    try {
      const source = await imageFromUrl(baseSource);
      const canvas = document.createElement('canvas');
      canvas.width = source.naturalWidth;
      canvas.height = source.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('无法处理图片');
      context.drawImage(source, 0, 0);
      const scale = 1 / this.workImageScale;
      const faces = this.activeFaces.map((face) => ({
        x: face.x * scale,
        y: face.y * scale,
        width: face.width * scale,
        height: face.height * scale,
      }));
      if (slimming > 0) this.applyFaceSlimWarp(context, canvas.width, canvas.height, faces, slimming);
      if (smoothing > 0) this.applyFaceSmoothing(canvas, faces, smoothing, faceMask);
      await image.setSrc(canvas.toDataURL('image/png'));
      this.workImageData = null;
      this.maskTargetId = null;
      this.activeFaces = [];
      this.clearPixelSelection();
      image.setCoords();
      this.canvas.setActiveObject(image);
      this.canvas.requestRenderAll();
      this.syncSelection();
      this.commitHistory();
      this.callbacks.onToast('美颜与瘦脸已应用，可撤销恢复', 'success');
    } catch {
      this.callbacks.onToast('人像处理失败，已保留原图', 'error');
    } finally {
      this.callbacks.onProcessing(false);
    }
  }

  async oneClickBeauty() {
    await this.applyFaceRetouch(42, 22);
  }

  private applyFaceSlimWarp(context: CanvasRenderingContext2D, width: number, height: number, faces: FaceRect[], strength: number) {
    const source = context.getImageData(0, 0, width, height);
    const output = new ImageData(new Uint8ClampedArray(source.data), width, height);
    const amount = Math.min(0.32, Math.max(0, strength) / 100 * 0.32);
    for (const face of faces) {
      const centerX = face.x + face.width / 2;
      const centerY = face.y + face.height * 0.54;
      const radiusX = face.width * 0.58;
      const radiusY = face.height * 0.72;
      const minY = Math.max(0, Math.floor(centerY - radiusY));
      const maxY = Math.min(height - 1, Math.ceil(centerY + radiusY));
      for (let y = minY; y <= maxY; y += 1) {
        const normalizedY = (y - centerY) / radiusY;
        if (Math.abs(normalizedY) >= 1) continue;
        const rowRadius = radiusX * Math.sqrt(1 - normalizedY ** 2);
        const minX = Math.max(0, Math.floor(centerX - rowRadius));
        const maxX = Math.min(width - 1, Math.ceil(centerX + rowRadius));
        for (let x = minX; x <= maxX; x += 1) {
          const normalizedX = (x - centerX) / Math.max(1, rowRadius);
          const influence = (1 - Math.abs(normalizedX)) * (1 - normalizedY ** 2);
          const sourceX = Math.max(0, Math.min(width - 1, Math.round(centerX + (x - centerX) * (1 + amount * influence))));
          const sourceOffset = (y * width + sourceX) * 4;
          const targetOffset = (y * width + x) * 4;
          output.data[targetOffset] = source.data[sourceOffset];
          output.data[targetOffset + 1] = source.data[sourceOffset + 1];
          output.data[targetOffset + 2] = source.data[sourceOffset + 2];
          output.data[targetOffset + 3] = source.data[sourceOffset + 3];
        }
      }
    }
    context.putImageData(output, 0, 0);
  }

  private applyFaceSmoothing(canvas: HTMLCanvasElement, faces: FaceRect[], strength: number, selectionMask: SelectionMask | null = null) {
    const blurred = document.createElement('canvas');
    blurred.width = canvas.width;
    blurred.height = canvas.height;
    const blurredContext = blurred.getContext('2d');
    const context = canvas.getContext('2d');
    if (!blurredContext || !context) return;
    blurredContext.filter = `blur(${Math.max(1, strength / 12)}px)`;
    blurredContext.drawImage(canvas, 0, 0);
    const mask = document.createElement('canvas');
    mask.width = canvas.width;
    mask.height = canvas.height;
    const maskContext = mask.getContext('2d');
    if (!maskContext) return;
    const blendOpacity = Math.min(0.72, 0.12 + strength / 100 * 0.6);
    if (selectionMask) {
      const selectionCanvas = document.createElement('canvas');
      selectionCanvas.width = selectionMask.width;
      selectionCanvas.height = selectionMask.height;
      const selectionContext = selectionCanvas.getContext('2d');
      if (selectionContext) {
        const pixels = selectionContext.createImageData(selectionMask.width, selectionMask.height);
        for (let index = 0; index < selectionMask.data.length; index += 1) {
          const offset = index * 4;
          pixels.data[offset] = 255;
          pixels.data[offset + 1] = 255;
          pixels.data[offset + 2] = 255;
          pixels.data[offset + 3] = Math.round(selectionMask.data[index] * blendOpacity);
        }
        selectionContext.putImageData(pixels, 0, 0);
        maskContext.drawImage(selectionCanvas, 0, 0, canvas.width, canvas.height);
      }
    } else {
      maskContext.fillStyle = `rgba(255,255,255,${blendOpacity})`;
      for (const face of faces) {
        maskContext.beginPath();
        maskContext.ellipse(face.x + face.width / 2, face.y + face.height * 0.54, face.width * 0.55, face.height * 0.7, 0, 0, Math.PI * 2);
        maskContext.fill();
      }
    }
    blurredContext.globalCompositeOperation = 'destination-in';
    blurredContext.drawImage(mask, 0, 0);
    context.drawImage(blurred, 0, 0);
  }

  private async applyLiquifyStroke(startScene: Point, endScene: Point) {
    const image = this.canvas.getActiveObject();
    if (!isImageObject(image)) return;
    this.callbacks.onProcessing(true, '正在应用局部拉扯…');
    try {
      const sourceImage = await imageFromUrl(image.getSrc());
      const width = sourceImage.naturalWidth || sourceImage.width;
      const height = sourceImage.naturalHeight || sourceImage.height;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('无法处理图片');
      context.drawImage(sourceImage, 0, 0, width, height);
      const inverse = util.invertTransform(image.calcTransformMatrix());
      const startLocal = util.transformPoint(startScene, inverse);
      const endLocal = util.transformPoint(endScene, inverse);
      const cropX = image.cropX || 0;
      const cropY = image.cropY || 0;
      const startX = cropX + startLocal.x + (image.width || width) / 2;
      const startY = cropY + startLocal.y + (image.height || height) / 2;
      const endX = cropX + endLocal.x + (image.width || width) / 2;
      const endY = cropY + endLocal.y + (image.height || height) / 2;
      const strength = 0.15 + this.liquifyStrength / 100 * 0.85;
      const dx = (endX - startX) * strength;
      const dy = (endY - startY) * strength;
      const radius = Math.max(10, this.liquifySize / 2);
      const source = context.getImageData(0, 0, width, height);
      const output = new ImageData(new Uint8ClampedArray(source.data), width, height);
      const minX = Math.max(0, Math.floor(endX - radius));
      const maxX = Math.min(width - 1, Math.ceil(endX + radius));
      const minY = Math.max(0, Math.floor(endY - radius));
      const maxY = Math.min(height - 1, Math.ceil(endY + radius));
      const sample = (x: number, y: number, channel: number) => {
        const clampedX = Math.max(0, Math.min(width - 1, x));
        const clampedY = Math.max(0, Math.min(height - 1, y));
        const x0 = Math.floor(clampedX);
        const y0 = Math.floor(clampedY);
        const x1 = Math.min(width - 1, x0 + 1);
        const y1 = Math.min(height - 1, y0 + 1);
        const tx = clampedX - x0;
        const ty = clampedY - y0;
        const a = source.data[(y0 * width + x0) * 4 + channel] * (1 - tx) + source.data[(y0 * width + x1) * 4 + channel] * tx;
        const b = source.data[(y1 * width + x0) * 4 + channel] * (1 - tx) + source.data[(y1 * width + x1) * 4 + channel] * tx;
        return Math.round(a * (1 - ty) + b * ty);
      };
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const distance = Math.hypot(x - endX, y - endY);
          if (distance >= radius) continue;
          const influence = (1 - distance / radius) ** 2;
          const sourceX = x - dx * influence;
          const sourceY = y - dy * influence;
          const target = (y * width + x) * 4;
          for (let channel = 0; channel < 4; channel += 1) output.data[target + channel] = sample(sourceX, sourceY, channel);
        }
      }
      context.putImageData(output, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');
      await image.setSrc(dataUrl);
      image.beautyBaseSrc = dataUrl;
      image.setCoords();
      this.workImageData = null;
      this.maskTargetId = null;
      this.activeFaces = [];
      this.canvas.setActiveObject(image);
      this.canvas.requestRenderAll();
      this.syncSelection();
      this.commitHistory();
      this.callbacks.onToast('局部拉扯已应用，可继续拖动或撤销', 'success');
    } catch {
      this.callbacks.onToast('局部拉扯失败，原图未被修改', 'error');
    } finally {
      this.callbacks.onProcessing(false);
    }
  }

  private async applyPatchStroke(startScene: Point, endScene: Point) {
    const prepared = await this.prepareWorkImage();
    if (!prepared || !this.activeMask || prepared.image.id !== this.maskTargetId) {
      this.callbacks.onToast('修补选区已失效，请重新使用套索框选', 'error');
      return;
    }
    const start = await this.sceneToWorkPixel(startScene);
    const end = await this.sceneToWorkPixel(endScene);
    if (!start || !end) {
      this.callbacks.onToast('请在同一张图片内拖到干净的取样区域', 'error');
      return;
    }
    const image = prepared.image;
    this.callbacks.onProcessing(true, '正在融合周围像素…');
    try {
      const source = await imageFromUrl(image.getSrc());
      const width = source.naturalWidth || source.width;
      const height = source.naturalHeight || source.height;
      const output = document.createElement('canvas');
      output.width = width;
      output.height = height;
      const outputContext = output.getContext('2d');
      if (!outputContext) throw new Error('无法处理修补区域');
      outputContext.drawImage(source, 0, 0, width, height);

      const scaleX = width / this.activeMask.width;
      const scaleY = height / this.activeMask.height;
      const offsetX = (end.x - start.x) * scaleX;
      const offsetY = (end.y - start.y) * scaleY;
      const smallMask = document.createElement('canvas');
      smallMask.width = this.activeMask.width;
      smallMask.height = this.activeMask.height;
      const smallMaskContext = smallMask.getContext('2d');
      if (!smallMaskContext) throw new Error('无法读取修补选区');
      const maskPixels = smallMaskContext.createImageData(smallMask.width, smallMask.height);
      for (let index = 0; index < this.activeMask.data.length; index += 1) {
        const offset = index * 4;
        maskPixels.data[offset] = 255;
        maskPixels.data[offset + 1] = 255;
        maskPixels.data[offset + 2] = 255;
        maskPixels.data[offset + 3] = this.activeMask.data[index];
      }
      smallMaskContext.putImageData(maskPixels, 0, 0);

      const fullMask = document.createElement('canvas');
      fullMask.width = width;
      fullMask.height = height;
      const fullMaskContext = fullMask.getContext('2d');
      if (!fullMaskContext) throw new Error('无法融合修补边缘');
      fullMaskContext.filter = `blur(${Math.max(1, Math.round(Math.max(scaleX, scaleY) * 2))}px)`;
      fullMaskContext.drawImage(smallMask, 0, 0, width, height);

      const sampled = document.createElement('canvas');
      sampled.width = width;
      sampled.height = height;
      const sampledContext = sampled.getContext('2d');
      if (!sampledContext) throw new Error('无法创建修补图层');
      sampledContext.drawImage(source, -offsetX, -offsetY, width, height);
      sampledContext.globalCompositeOperation = 'destination-in';
      sampledContext.drawImage(fullMask, 0, 0);
      outputContext.drawImage(sampled, 0, 0);

      const dataUrl = output.toDataURL('image/png');
      let nextSource = dataUrl;
      if (image.assetId) {
        const blob = await (await fetch(dataUrl)).blob();
        const descriptor = await this.assetStore.putStream(blob, {
          name: `${image.name || '图片'}-patch`,
          mimeType: 'image/png',
          kind: 'derived',
          width,
          height,
          sourceAssetId: image.assetId,
        });
        this.assets = await this.assetStore.list();
        nextSource = await this.assetStore.createObjectUrl(descriptor);
        this.objectUrls.add(nextSource);
        image.renderAssetId = descriptor.id;
        image.renderObjectUrl = nextSource;
      }
      await image.setSrc(nextSource);
      image.beautyBaseSrc = nextSource;
      image.setCoords();

      const workCanvas = document.createElement('canvas');
      workCanvas.width = this.activeMask.width;
      workCanvas.height = this.activeMask.height;
      const workContext = workCanvas.getContext('2d', { willReadFrequently: true });
      if (workContext) {
        workContext.drawImage(output, 0, 0, workCanvas.width, workCanvas.height);
        this.workImageData = workContext.getImageData(0, 0, workCanvas.width, workCanvas.height);
      }
      this.canvas.setActiveObject(image);
      this.canvas.requestRenderAll();
      this.syncSelection();
      this.commitHistory();
      this.callbacks.onToast('修补完成，选区仍保留，可继续取样或撤销', 'success');
    } catch {
      this.callbacks.onToast('修补失败，原图未被修改', 'error');
    } finally {
      this.callbacks.onProcessing(false);
    }
  }

  private async finishLasso() {
    if (this.lassoPoints.length < 3) return;
    await this.applyPolygonSelection(this.lassoPoints);
    this.lassoPoints = [];
  }

  async finishPolygonSelection() {
    if (this.currentTool !== 'polygon-lasso' || this.lassoPoints.length < 3) return;
    await this.applyPolygonSelection(this.lassoPoints);
    this.lassoPoints = [];
    this.renderOverlay();
  }

  private async applyPolygonSelection(points: Point[]) {
    const prepared = await this.prepareWorkImage();
    if (!prepared) return;
    const polygon = document.createElement('canvas');
    polygon.width = prepared.imageData.width;
    polygon.height = prepared.imageData.height;
    const context = polygon.getContext('2d');
    if (!context) return;
    context.fillStyle = '#fff';
    context.beginPath();
    for (let index = 0; index < points.length; index += 1) {
      const pixel = await this.sceneToWorkPixel(points[index]);
      if (!pixel) continue;
      if (index === 0) context.moveTo(pixel.x, pixel.y);
      else context.lineTo(pixel.x, pixel.y);
    }
    context.closePath();
    context.fill();
    const alpha = context.getImageData(0, 0, polygon.width, polygon.height).data;
    const next = new Uint8ClampedArray(polygon.width * polygon.height);
    for (let index = 0; index < next.length; index += 1) next[index] = alpha[index * 4 + 3];
    this.activeMask = {
      width: polygon.width,
      height: polygon.height,
      data: this.combineMask(next, this.activeMask?.data, this.selectionOptions.combine),
    };
    await this.buildPreviewCanvas();
    const target = this.maskTargetId ? this.findObject(this.maskTargetId) : undefined;
    if (target) this.canvas.setActiveObject(target);
    this.syncSelection();
    this.renderOverlay();
  }

  private combineMask(next: Uint8ClampedArray, current: Uint8ClampedArray | undefined, mode: SelectionCombineMode) {
    if (!current || mode === 'replace') return next;
    const result = new Uint8ClampedArray(next.length);
    for (let index = 0; index < next.length; index += 1) {
      result[index] = mode === 'add' ? Math.max(current[index], next[index]) : current[index] && !next[index] ? current[index] : 0;
    }
    return result;
  }

  async refineSelection(settings: SelectionRefineSettings) {
    if (!this.activeMask) {
      this.callbacks.onToast('请先建立选区', 'error');
      return;
    }
    this.callbacks.onProcessing(true, '正在优化选区边缘…');
    try {
      this.activeMask = await this.selectionService.refine(this.activeMask, settings);
      await this.buildPreviewCanvas();
      this.renderOverlay();
      this.callbacks.onToast('边缘优化完成', 'success');
    } catch (error) {
      if ((error as Error).message !== '已取消') this.callbacks.onToast('边缘优化失败', 'error');
    } finally {
      this.callbacks.onProcessing(false);
    }
  }

  clearPixelSelection() {
    this.activeMask = null;
    this.previewCanvas = null;
    this.renderOverlay();
  }

  async selectAllPixels() {
    const prepared = await this.prepareWorkImage();
    if (!prepared) return;
    const data = new Uint8ClampedArray(prepared.imageData.width * prepared.imageData.height);
    data.fill(255);
    this.activeMask = { width: prepared.imageData.width, height: prepared.imageData.height, data };
    await this.buildPreviewCanvas();
    this.renderOverlay();
  }

  async invertPixelSelection() {
    if (!this.activeMask) return;
    for (let index = 0; index < this.activeMask.data.length; index += 1) {
      this.activeMask.data[index] = 255 - this.activeMask.data[index];
    }
    await this.buildPreviewCanvas();
    this.renderOverlay();
  }

  setPreviewMode(mode: SelectionPreviewMode) {
    this.selectionOptions.previewMode = mode;
    void this.buildPreviewCanvas().then(() => this.renderOverlay());
  }

  async applySelectionMask() {
    const current = this.canvas.getActiveObject() as EditorImage | undefined;
    const active = isImageObject(current)
      ? current
      : this.maskTargetId
        ? (this.findObject(this.maskTargetId) as EditorImage | undefined)
        : undefined;
    if (!isImageObject(active) || !this.activeMask || active.id !== this.maskTargetId) {
      this.callbacks.onToast('请先在当前图片上建立选区', 'error');
      return;
    }
    this.callbacks.onProcessing(true, '正在生成图层蒙版…');
    try {
      const source = active.originalSrc || active.getSrc();
      const { maskedUrl, maskUrl } = await this.compositeMask(source, this.activeMask);
      const stored = await this.persistMaskResult(active, maskUrl, maskedUrl);
      active.originalSrc = source;
      active.maskEnabled = true;
      await active.setSrc(stored.maskedUrl);
      active.setCoords();
      this.clearPixelSelection();
      this.canvas.requestRenderAll();
      this.commitHistory();
      this.callbacks.onToast('已生成非破坏性图层蒙版', 'success');
    } catch {
      this.callbacks.onToast('生成蒙版失败，原图未被修改', 'error');
    } finally {
      this.callbacks.onProcessing(false);
    }
  }

  async duplicateSelectionAsLayer() {
    const current = this.canvas.getActiveObject() as EditorImage | undefined;
    const active = isImageObject(current)
      ? current
      : this.maskTargetId
        ? (this.findObject(this.maskTargetId) as EditorImage | undefined)
        : undefined;
    if (!isImageObject(active) || !this.activeMask) {
      this.callbacks.onToast('请先建立选区', 'error');
      return;
    }
    const source = active.originalSrc || active.getSrc();
    const { maskedUrl, maskUrl } = await this.compositeMask(source, this.activeMask);
    const clone = (await FabricImage.fromURL(maskedUrl, {}, {
      originX: active.originX,
      originY: active.originY,
    })) as EditorImage;
    clone.id = createId('cutout');
    clone.name = `${active.name || '图片'} 抠图`;
    clone.originalSrc = source;
    clone.assetId = active.assetId;
    clone.previewAssetId = active.previewAssetId;
    clone.originalWidth = active.originalWidth;
    clone.originalHeight = active.originalHeight;
    const stored = await this.persistMaskResult(clone, maskUrl, maskedUrl);
    await clone.setSrc(stored.maskedUrl);
    clone.maskEnabled = true;
    clone.adjustments = { ...DEFAULT_ADJUSTMENTS };
    clone.set({
      left: (active.left || 0) + 20,
      top: (active.top || 0) + 20,
      scaleX: active.scaleX,
      scaleY: active.scaleY,
      angle: active.angle,
      flipX: active.flipX,
      flipY: active.flipY,
    });
    this.canvas.add(clone);
    this.canvas.setActiveObject(clone);
    this.clearPixelSelection();
    this.commitHistory();
  }

  async fillPixelSelection(color: string, opacity = 1) {
    const current = this.canvas.getActiveObject() as EditorImage | undefined;
    const active = isImageObject(current)
      ? current
      : this.maskTargetId
        ? (this.findObject(this.maskTargetId) as EditorImage | undefined)
        : undefined;
    if (!isImageObject(active) || !this.activeMask || active.id !== this.maskTargetId) {
      this.callbacks.onToast('请先在图片上建立套索选区', 'error');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = this.activeMask.width;
    canvas.height = this.activeMask.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    const rgba = new Color(color).getSource();
    const imageData = context.createImageData(canvas.width, canvas.height);
    const alpha = Math.max(0, Math.min(1, opacity));
    for (let index = 0; index < this.activeMask.data.length; index += 1) {
      const offset = index * 4;
      imageData.data[offset] = rgba[0];
      imageData.data[offset + 1] = rgba[1];
      imageData.data[offset + 2] = rgba[2];
      imageData.data[offset + 3] = Math.round(this.activeMask.data[index] * alpha);
    }
    context.putImageData(imageData, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    const layer = await FabricImage.fromURL(dataUrl, {}, { originX: active.originX, originY: active.originY }) as EditorImage;
    layer.id = createId('selection-fill');
    layer.name = '选区填色';
    layer.originalSrc = dataUrl;
    layer.adjustments = { ...DEFAULT_ADJUSTMENTS };
    layer.artboardId = active.artboardId || this.activeArtboardId;
    layer.set({
      left: active.left,
      top: active.top,
      scaleX: (active.scaleX || 1) * ((active.width || canvas.width) / canvas.width),
      scaleY: (active.scaleY || 1) * ((active.height || canvas.height) / canvas.height),
      angle: active.angle,
      flipX: active.flipX,
      flipY: active.flipY,
      hasControls: this.showControls,
    });
    this.canvas.add(layer);
    this.canvas.setActiveObject(layer);
    this.clearPixelSelection();
    this.syncSelection();
    this.commitHistory();
    this.callbacks.onToast('已将选区填色生成独立图层', 'success');
  }

  private async applyEraserStroke(restore: boolean) {
    if (!this.eraserScenePoints.length) return;
    const active = this.canvas.getActiveObject();
    this.callbacks.onProcessing(true, restore ? '正在恢复原图细节…' : '正在擦除图层内容…');
    try {
      let changed = false;
      if (!restore && !isImageObject(active)) changed = await this.erasePaintLayers(active) || changed;
      if (isImageObject(active)) {
        await this.prepareWorkImage();
        const points: Array<{ x: number; y: number }> = [];
        for (const scenePoint of this.eraserScenePoints) {
          const pixel = await this.sceneToWorkPixel(scenePoint);
          if (pixel) points.push(pixel);
        }
        if (points.length) this.eraserPoints = points;
        if (this.workImageData && this.eraserPoints.length) changed = await this.applyImageMaskStroke(active, restore) || changed;
      }
      if (!changed && !restore) changed = await this.erasePaintLayers(active) || changed;
      this.eraserPoints = [];
      this.eraserScenePoints = [];
      if (changed) {
        this.canvas.requestRenderAll();
        this.syncSelection();
        this.commitHistory();
      } else {
        this.callbacks.onToast(restore ? '当前图层没有可恢复的图片内容' : '请先选择画笔或图片图层', 'error');
      }
    } catch {
      this.callbacks.onToast('笔刷处理失败，已保留上一步结果', 'error');
    } finally {
      this.callbacks.onProcessing(false);
    }
  }

  private async applyImageMaskStroke(image: EditorImage, restore: boolean) {
    if (!this.workImageData || !this.eraserPoints.length) return false;
    if (restore && !image.maskSrc) return false;
    const source = image.originalSrc || image.getSrc();
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = this.workImageData.width;
    maskCanvas.height = this.workImageData.height;
    const context = maskCanvas.getContext('2d');
    if (!context) return false;
    if (image.maskSrc) {
      const existingMask = await imageFromUrl(image.maskSrc);
      context.drawImage(existingMask, 0, 0, maskCanvas.width, maskCanvas.height);
    } else {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
    }
    context.save();
    context.globalCompositeOperation = restore ? 'source-over' : 'destination-out';
    context.strokeStyle = '#ffffff';
    context.fillStyle = '#ffffff';
    context.lineWidth = Math.max(2, this.selectionOptions.eraserSize * this.workImageScale);
    this.drawRoundStroke(context, this.eraserPoints);
    context.restore();
    const rgba = context.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
    const data = new Uint8ClampedArray(maskCanvas.width * maskCanvas.height);
    for (let index = 0; index < data.length; index += 1) data[index] = rgba[index * 4 + 3];
    const result = await this.compositeMask(source, { width: maskCanvas.width, height: maskCanvas.height, data });
    const stored = await this.persistMaskResult(image, result.maskUrl, result.maskedUrl);
    image.originalSrc = source;
    image.maskEnabled = true;
    await image.setSrc(stored.maskedUrl);
    image.setCoords();
    this.canvas.setActiveObject(image);
    return true;
  }

  private drawRoundStroke(context: CanvasRenderingContext2D, points: Array<{ x: number; y: number }>) {
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    points.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    if (points.length === 1) {
      const point = points[0];
      context.beginPath();
      context.arc(point.x, point.y, context.lineWidth / 2, 0, Math.PI * 2);
      context.fill();
    } else {
      context.stroke();
    }
  }

  private async erasePaintLayers(active: FabricObject | undefined) {
    const activeObjects = active instanceof ActiveSelection ? active.getObjects() as EditorObject[] : active ? [active as EditorObject] : [];
    const selectedPaint = activeObjects.filter((object) => this.isPaintLayer(object));
    const strokeBounds = this.getStrokeBounds(this.eraserScenePoints, this.selectionOptions.eraserSize / 2);
    const candidates = (selectedPaint.length ? selectedPaint : this.getEditableObjects().slice().reverse().filter((object) => this.isPaintLayer(object)))
      .filter((object) => this.rectsIntersect(object.getBoundingRect(), strokeBounds));
    if (!candidates.length) return false;
    const replacements: EditorObject[] = [];
    for (const object of candidates) {
      const bounds = object.getBoundingRect();
      const padding = Math.ceil(this.selectionOptions.eraserSize / 2 + 4);
      const left = Math.floor(bounds.left - padding);
      const top = Math.floor(bounds.top - padding);
      const width = Math.max(1, Math.ceil(bounds.width + padding * 2));
      const height = Math.max(1, Math.ceil(bounds.height + padding * 2));
      const temporary = new StaticCanvas(undefined, { width, height, backgroundColor: 'transparent', enableRetinaScaling: false });
      const clone = await object.clone() as EditorObject;
      clone.set({ left: (clone.left || 0) - left, top: (clone.top || 0) - top, selectable: false, evented: false });
      temporary.add(clone);
      temporary.renderAll();
      const context = temporary.getContext();
      const originalDataUrl = (context.canvas as HTMLCanvasElement).toDataURL('image/png');
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = width;
      maskCanvas.height = height;
      const maskContext = maskCanvas.getContext('2d');
      if (!maskContext) {
        temporary.dispose();
        continue;
      }
      maskContext.fillStyle = '#ffffff';
      maskContext.fillRect(0, 0, width, height);
      maskContext.save();
      maskContext.globalCompositeOperation = 'destination-out';
      maskContext.strokeStyle = '#000000';
      maskContext.fillStyle = '#000000';
      maskContext.lineWidth = this.selectionOptions.eraserSize;
      this.drawRoundStroke(maskContext, this.eraserScenePoints.map((point) => ({ x: point.x - left, y: point.y - top })));
      maskContext.restore();
      context.save();
      context.globalCompositeOperation = 'destination-in';
      context.drawImage(maskCanvas, 0, 0);
      context.restore();
      const dataUrl = (context.canvas as HTMLCanvasElement).toDataURL('image/png');
      temporary.dispose();
      const replacement = await FabricImage.fromURL(dataUrl, {}, { originX: 'left', originY: 'top' }) as EditorImage;
      replacement.id = object.id || createId('brush');
      replacement.name = object.name || '画笔';
      replacement.paintLayer = true;
      replacement.originalSrc = originalDataUrl;
      replacement.adjustments = { ...DEFAULT_ADJUSTMENTS };
      replacement.artboardId = object.artboardId || this.activeArtboardId;
      replacement.locked = object.locked;
      replacement.originalWidth = width;
      replacement.originalHeight = height;
      const originalBlob = await (await fetch(originalDataUrl)).blob();
      const originalAsset = await this.assetStore.putStream(originalBlob, {
        name: `${replacement.name}-original`,
        mimeType: 'image/png',
        kind: 'original',
        width,
        height,
      });
      replacement.assetId = originalAsset.id;
      replacement.previewAssetId = originalAsset.id;
      const stored = await this.persistMaskResult(replacement, maskCanvas.toDataURL('image/png'), dataUrl);
      await replacement.setSrc(stored.maskedUrl);
      replacement.maskEnabled = true;
      replacement.set({ left, top, visible: object.visible, opacity: 1, hasControls: this.showControls });
      const index = this.canvas.getObjects().indexOf(object);
      this.canvas.remove(object);
      this.canvas.insertAt(Math.max(1, index), replacement);
      replacements.push(replacement);
    }
    if (replacements.length === 1) this.canvas.setActiveObject(replacements[0]);
    else if (replacements.length > 1) this.canvas.setActiveObject(new ActiveSelection(replacements, { canvas: this.canvas }));
    return true;
  }

  private getStrokeBounds(points: Point[], radius: number) {
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const left = Math.min(...xs) - radius;
    const top = Math.min(...ys) - radius;
    return { left, top, width: Math.max(...xs) - Math.min(...xs) + radius * 2, height: Math.max(...ys) - Math.min(...ys) + radius * 2 };
  }

  private rectsIntersect(a: { left: number; top: number; width: number; height: number }, b: { left: number; top: number; width: number; height: number }) {
    return a.left <= b.left + b.width && a.left + a.width >= b.left && a.top <= b.top + b.height && a.top + a.height >= b.top;
  }

  async toggleActiveMask() {
    const image = this.canvas.getActiveObject() as EditorImage | undefined;
    if (!isImageObject(image) || !image.maskSrc || !image.originalSrc) return;
    image.maskEnabled = !image.maskEnabled;
    if (image.maskEnabled) {
      const maskImage = await imageFromUrl(image.maskSrc);
      const temp = document.createElement('canvas');
      temp.width = maskImage.naturalWidth;
      temp.height = maskImage.naturalHeight;
      const context = temp.getContext('2d');
      if (!context) return;
      context.drawImage(maskImage, 0, 0);
      const data = context.getImageData(0, 0, temp.width, temp.height).data;
      const mask = new Uint8ClampedArray(temp.width * temp.height);
      for (let index = 0; index < mask.length; index += 1) mask[index] = data[index * 4 + 3];
      const result = await this.compositeMask(image.originalSrc, { width: temp.width, height: temp.height, data: mask });
      await image.setSrc(result.maskedUrl);
    } else {
      await image.setSrc(image.originalSrc);
    }
    this.canvas.requestRenderAll();
    this.commitHistory();
  }

  async deleteActiveMask() {
    const image = this.canvas.getActiveObject() as EditorImage | undefined;
    if (!isImageObject(image) || !image.originalSrc) return;
    await image.setSrc(image.originalSrc);
    delete image.maskSrc;
    image.maskEnabled = false;
    this.canvas.requestRenderAll();
    this.commitHistory();
  }

  async restoreOriginalImage() {
    const current = this.canvas.getActiveObject() as EditorImage | undefined;
    const image = isImageObject(current)
      ? current
      : this.maskTargetId
        ? (this.findObject(this.maskTargetId) as EditorImage | undefined)
        : undefined;
    if (!isImageObject(image) || !image.originalSrc) return;
    await image.setSrc(image.originalSrc);
    delete image.maskSrc;
    image.maskEnabled = false;
    image.filters = [];
    image.adjustments = { ...DEFAULT_ADJUSTMENTS };
    image.applyFilters();
    this.canvas.setActiveObject(image);
    this.canvas.requestRenderAll();
    this.syncSelection();
    this.commitHistory();
    this.callbacks.onToast('已恢复上传时的原图', 'success');
  }

  private async compositeMask(sourceUrl: string, mask: SelectionMask) {
    const source = await imageFromUrl(sourceUrl);
    const canvas = document.createElement('canvas');
    canvas.width = source.naturalWidth;
    canvas.height = source.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法生成蒙版');
    context.drawImage(source, 0, 0);

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = mask.width;
    maskCanvas.height = mask.height;
    const maskContext = maskCanvas.getContext('2d');
    if (!maskContext) throw new Error('无法生成蒙版');
    const maskImage = maskContext.createImageData(mask.width, mask.height);
    for (let index = 0; index < mask.data.length; index += 1) {
      maskImage.data[index * 4] = 255;
      maskImage.data[index * 4 + 1] = 255;
      maskImage.data[index * 4 + 2] = 255;
      maskImage.data[index * 4 + 3] = mask.data[index];
    }
    maskContext.putImageData(maskImage, 0, 0);
    context.globalCompositeOperation = 'destination-in';
    context.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height);
    return { maskedUrl: canvas.toDataURL('image/png'), maskUrl: maskCanvas.toDataURL('image/png') };
  }

  private async buildPreviewCanvas() {
    if (!this.activeMask) {
      this.previewCanvas = null;
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = this.activeMask.width;
    canvas.height = this.activeMask.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    const image = context.createImageData(canvas.width, canvas.height);
    const mode = this.selectionOptions.previewMode;
    for (let index = 0; index < this.activeMask.data.length; index += 1) {
      const selected = this.activeMask.data[index] / 255;
      const offset = index * 4;
      if (mode === 'overlay') {
        image.data[offset] = 244;
        image.data[offset + 1] = 63;
        image.data[offset + 2] = 94;
        image.data[offset + 3] = Math.round((1 - selected) * 115);
      } else if (mode === 'black' || mode === 'white') {
        const value = mode === 'white' ? 255 : 0;
        image.data[offset] = value;
        image.data[offset + 1] = value;
        image.data[offset + 2] = value;
        image.data[offset + 3] = Math.round((1 - selected) * 255);
      } else {
        const x = index % canvas.width;
        const y = Math.floor(index / canvas.width);
        const value = (Math.floor(x / 12) + Math.floor(y / 12)) % 2 ? 104 : 152;
        image.data[offset] = value;
        image.data[offset + 1] = value;
        image.data[offset + 2] = value;
        image.data[offset + 3] = Math.round((1 - selected) * 210);
      }
    }
    context.putImageData(image, 0, 0);
    this.previewCanvas = canvas;
  }

  private renderOverlay() {
    const ratio = window.devicePixelRatio || 1;
    const context = this.overlayContext;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, this.overlay.width, this.overlay.height);
    context.scale(ratio, ratio);
    const viewport = this.canvas.viewportTransform;
    const dark = document.documentElement.dataset.theme === 'dark';
    for (const artboard of this.lazyArtboards ? this.artboards.filter((item) => item.id === this.activeArtboardId) : this.artboards) {
      const topLeft = util.transformPoint(new Point(artboard.x, artboard.y), viewport);
      const bottomRight = util.transformPoint(new Point(artboard.x + artboard.width, artboard.y + artboard.height), viewport);
      const active = artboard.id === this.activeArtboardId;
      context.save();
      context.setLineDash(active ? [6, 5] : []);
      context.strokeStyle = active ? (dark ? 'rgba(255,255,255,.72)' : 'rgba(0,0,0,.48)') : 'transparent';
      context.lineWidth = 1;
      context.strokeRect(topLeft.x - .5, topLeft.y - .5, bottomRight.x - topLeft.x + 1, bottomRight.y - topLeft.y + 1);
      context.font = '600 11px Inter, Microsoft YaHei, sans-serif';
      const label = `${artboard.name}  ${artboard.width} × ${artboard.height}`;
      const width = context.measureText(label).width + 18;
      const labelY = Math.max(5, topLeft.y - 30);
      context.fillStyle = active ? (dark ? '#ffffff' : '#090909') : (dark ? 'rgba(35,35,37,.94)' : 'rgba(255,255,255,.94)');
      context.beginPath();
      context.roundRect(topLeft.x, labelY, width, 23, 11.5);
      context.fill();
      context.fillStyle = active ? (dark ? '#090909' : '#ffffff') : (dark ? 'rgba(255,255,255,.72)' : 'rgba(0,0,0,.62)');
      context.fillText(label, topLeft.x + 9, labelY + 15.5);
      context.restore();
    }
    if (this.currentTool === 'region') {
      for (const artboard of this.lazyArtboards ? this.artboards.filter((item) => item.id === this.activeArtboardId) : this.artboards) {
        for (const region of this.regions) {
        const topLeft = util.transformPoint(new Point(
          artboard.x + region.xRatio * artboard.width,
          artboard.y + region.yRatio * artboard.height,
        ), viewport);
        const bottomRight = util.transformPoint(new Point(
          artboard.x + (region.xRatio + region.widthRatio) * artboard.width,
          artboard.y + (region.yRatio + region.heightRatio) * artboard.height,
        ), viewport);
        context.save();
        context.setLineDash([5, 4]);
        context.strokeStyle = 'rgba(249,115,22,.95)';
        context.fillStyle = 'rgba(249,115,22,.08)';
        context.lineWidth = 1.5;
        context.fillRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
        context.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
        context.setLineDash([]);
        context.font = '600 10px Inter, Microsoft YaHei, sans-serif';
        const label = `区域 ${region.name}`;
        const labelWidth = context.measureText(label).width + 12;
        context.fillStyle = '#f97316';
        context.beginPath();
        context.roundRect(topLeft.x, Math.max(2, topLeft.y - 19), labelWidth, 18, 8);
        context.fill();
        context.fillStyle = '#ffffff';
        context.fillText(label, topLeft.x + 6, Math.max(14, topLeft.y - 6));
          context.restore();
        }
      }
    }
    if (this.regionStart && this.regionEnd) {
      const start = util.transformPoint(this.regionStart, viewport);
      const end = util.transformPoint(this.regionEnd, viewport);
      context.save();
      context.setLineDash([7, 5]);
      context.strokeStyle = '#f97316';
      context.fillStyle = 'rgba(249,115,22,.12)';
      context.lineWidth = 2;
      context.fillRect(Math.min(start.x, end.x), Math.min(start.y, end.y), Math.abs(end.x - start.x), Math.abs(end.y - start.y));
      context.strokeRect(Math.min(start.x, end.x), Math.min(start.y, end.y), Math.abs(end.x - start.x), Math.abs(end.y - start.y));
      context.restore();
    }
    const active = this.maskTargetId ? (this.findObject(this.maskTargetId) as EditorImage | undefined) : undefined;
    if (active && this.previewCanvas) {
      const viewport = this.canvas.viewportTransform;
      const transform = util.multiplyTransformMatrices(viewport, active.calcTransformMatrix());
      context.save();
      context.transform(...transform);
      context.drawImage(
        this.previewCanvas,
        -(active.width || 0) / 2,
        -(active.height || 0) / 2,
        active.width || 0,
        active.height || 0,
      );
      context.restore();
    }
    if (this.lassoPoints.length) {
      const viewport = this.canvas.viewportTransform;
      context.save();
      context.transform(...viewport);
      context.strokeStyle = '#f8fafc';
      context.lineWidth = 1 / this.canvas.getZoom();
      context.setLineDash([7 / this.canvas.getZoom(), 5 / this.canvas.getZoom()]);
      context.beginPath();
      this.lassoPoints.forEach((point, index) => (index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)));
      context.stroke();
      context.restore();
    }
    if (this.patchStart && this.patchEnd) {
      const start = util.transformPoint(this.patchStart, viewport);
      const end = util.transformPoint(this.patchEnd, viewport);
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      context.save();
      context.setLineDash([6, 4]);
      context.strokeStyle = '#f97316';
      context.fillStyle = '#f97316';
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
      context.setLineDash([]);
      context.beginPath();
      context.moveTo(end.x, end.y);
      context.lineTo(end.x - Math.cos(angle - Math.PI / 6) * 10, end.y - Math.sin(angle - Math.PI / 6) * 10);
      context.lineTo(end.x - Math.cos(angle + Math.PI / 6) * 10, end.y - Math.sin(angle + Math.PI / 6) * 10);
      context.closePath();
      context.fill();
      context.restore();
    }
    if (this.brushCursorPoint && this.isCircularBrushTool() && !this.spacePressed) {
      const diameter = this.getBrushCursorDiameter();
      const radius = Math.max(0.5, diameter / 2);
      context.save();
      context.setLineDash([]);
      context.beginPath();
      context.arc(this.brushCursorPoint.x, this.brushCursorPoint.y, radius, 0, Math.PI * 2);
      context.strokeStyle = 'rgba(15, 23, 42, 0.96)';
      context.lineWidth = 3;
      context.stroke();
      context.strokeStyle = 'rgba(255, 255, 255, 0.98)';
      context.lineWidth = 1.25;
      context.stroke();
      context.restore();
    }
  }

  private getBrushCursorDiameter() {
    if (this.currentTool === 'brush') {
      return Math.max(1, this.selectionOptions.brushSize * this.canvas.getZoom());
    }
    const current = this.canvas.getActiveObject();
    const image = isImageObject(current)
      ? current
      : this.currentTool === 'quick-select' || this.currentTool === 'edge-cutout' || this.currentTool === 'restore-brush'
        ? (this.maskTargetId ? this.findObject(this.maskTargetId) : undefined)
        : undefined;
    if (!isImageObject(image)) {
      const size = this.currentTool === 'liquify'
        ? this.liquifySize
        : this.currentTool === 'quick-select' || this.currentTool === 'edge-cutout'
          ? this.selectionOptions.brushSize
          : this.selectionOptions.eraserSize;
      return Math.max(1, size * this.canvas.getZoom());
    }
    const scale = image.getObjectScaling();
    const averageImageScale = (Math.abs(scale.x) + Math.abs(scale.y)) / 2;
    const size = this.currentTool === 'liquify'
      ? this.liquifySize
      : this.currentTool === 'quick-select' || this.currentTool === 'edge-cutout'
        ? this.selectionOptions.brushSize
        : this.selectionOptions.eraserSize;
    return Math.max(1, size * averageImageScale * this.canvas.getZoom());
  }

  cancelProcessing() {
    this.selectionService.cancelAll();
    assetWorkerBroker.cancelAll();
    rasterWorkerBroker.cancelAll();
    psdWorkerBroker.cancelAll();
    this.callbacks.onProcessing(false);
  }

  zoomBy(factor: number) {
    const center = new Point(this.canvas.getWidth() / 2, this.canvas.getHeight() / 2);
    const zoom = Math.max(0.08, Math.min(8, this.canvas.getZoom() * factor));
    this.canvas.zoomToPoint(center, zoom);
    this.callbacks.onZoom(zoom);
    this.emitViewport();
    this.renderOverlay();
  }

  panBy(x: number, y: number) {
    this.canvas.relativePan(new Point(x, y));
    this.emitViewport();
    this.renderOverlay();
  }

  fitToScreen() {
    const padding = this.canvas.getWidth() < 768 ? 28 : 72;
    const bounds = this.getSceneBounds();
    const zoom = Math.min(
      (this.canvas.getWidth() - padding * 2) / bounds.width,
      (this.canvas.getHeight() - padding * 2) / bounds.height,
      1,
    );
    const x = (this.canvas.getWidth() - bounds.width * zoom) / 2 - bounds.left * zoom;
    const y = (this.canvas.getHeight() - bounds.height * zoom) / 2 - bounds.top * zoom;
    this.canvas.setViewportTransform([zoom, 0, 0, zoom, x, y]);
    this.callbacks.onZoom(zoom);
    this.emitViewport();
    this.canvas.requestRenderAll();
  }

  focusArtboard(id = this.activeArtboardId) {
    const artboard = this.artboards.find((item) => item.id === id);
    if (!artboard) return;
    const padding = this.canvas.getWidth() < 768 ? 32 : 86;
    const zoom = Math.min(
      (this.canvas.getWidth() - padding * 2) / artboard.width,
      (this.canvas.getHeight() - padding * 2) / artboard.height,
      1,
    );
    const x = (this.canvas.getWidth() - artboard.width * zoom) / 2 - artboard.x * zoom;
    const y = (this.canvas.getHeight() - artboard.height * zoom) / 2 - artboard.y * zoom;
    this.canvas.setViewportTransform([zoom, 0, 0, zoom, x, y]);
    this.callbacks.onZoom(zoom);
    this.emitViewport();
    this.canvas.requestRenderAll();
  }

  async undo() {
    const state = this.history.undo();
    if (state) await this.restoreHistory(state);
  }

  async redo() {
    const state = this.history.redo();
    if (state) await this.restoreHistory(state);
  }

  private async restoreHistory(parsed: { canvas: Record<string, unknown>; regions: RegionDefinition[]; workflows: WorkflowDefinition[]; activeArtboardId: string }) {
    this.isRestoring = true;
    const viewport = [...this.canvas.viewportTransform] as [number, number, number, number, number, number];
    await this.canvas.loadFromJSON(await this.hydrateCanvasJson(parsed.canvas));
    for (const image of this.getEditableObjects().filter(isImageObject) as EditorImage[]) {
      if (image.visualStyle) this.applyVisualStyleToImage(image, image.visualStyle);
      else if (!image.renderAssetId && image.adjustments && Object.values(image.adjustments).some((value) => Number(value) !== 0)) {
        this.applyAdjustmentsToImage(image, image.adjustments);
      }
    }
    this.regions = parsed.regions.map((region) => ({ ...region }));
    this.workflows = parsed.workflows.map((workflow) => ({ ...workflow, artboardIds: [...workflow.artboardIds], steps: workflow.steps.map((step) => ({ ...step })) }));
    this.activeArtboardId = parsed.activeArtboardId || this.activeArtboardId;
    this.normalizeObjects();
    this.applyLazyArtboardVisibility();
    this.canvas.setViewportTransform(viewport);
    this.isRestoring = false;
    this.canvas.requestRenderAll();
    this.syncLayers();
    this.emitRegions();
    this.emitWorkflows();
    this.syncSelection();
    this.setTool(this.currentTool);
    this.callbacks.onHistory(this.history.canUndo(), this.history.canRedo());
    this.scheduleSave();
  }

  private commitHistory(reset = false) {
    if (this.isRestoring) return;
    const snapshot = {
      canvas: this.serializeCanvasForPersistence(),
      regions: this.regions.map((region) => ({ ...region })),
      workflows: this.workflows.map((workflow) => ({ ...workflow, artboardIds: [...workflow.artboardIds], steps: workflow.steps.map((step) => ({ ...step })) })),
      activeArtboardId: this.activeArtboardId,
    };
    if (reset) this.history.reset(snapshot);
    else this.history.commit(snapshot);
    this.syncLayers();
    this.callbacks.onHistory(this.history.canUndo(), this.history.canRedo());
    this.scheduleSave();
  }

  private scheduleSave() {
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      void this.persistArtboardDocuments()
        .then(() => this.callbacks.onDocumentChange(this.serializeProject()))
        .catch(() => this.callbacks.onToast('画板本地保存失败，请检查存储空间', 'error'));
    }, 900);
  }

  private documentKey(artboardId: string) {
    return `${this.userId}:${this.projectId}:artboard:${artboardId}`;
  }

  private serializeCanvasForPersistence() {
    const json = structuredClone(this.canvas.toJSON()) as Record<string, unknown>;
    const clean = (value: unknown) => {
      if (Array.isArray(value)) {
        value.forEach(clean);
        return;
      }
      if (!value || typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      if (record.type === 'Image' || record.type === 'image') {
        if (record.assetId || record.previewAssetId || record.renderAssetId) {
          delete record.src;
          delete record.originalSrc;
          delete record.renderObjectUrl;
        }
        if (record.maskAssetId) delete record.maskSrc;
      }
      Object.values(record).forEach(clean);
    };
    clean(json);
    return json;
  }

  private async hydrateCanvasJson(json: Record<string, unknown>) {
    const hydrated = structuredClone(json);
    const visit = async (value: unknown): Promise<void> => {
      if (Array.isArray(value)) {
        for (const item of value) await visit(item);
        return;
      }
      if (!value || typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      const renderAssetId = typeof record.renderAssetId === 'string' ? record.renderAssetId : undefined;
      const previewAssetId = typeof record.previewAssetId === 'string' ? record.previewAssetId : undefined;
      const assetId = typeof record.assetId === 'string' ? record.assetId : undefined;
      if ((record.type === 'Image' || record.type === 'image') && (renderAssetId || previewAssetId || assetId) && !record.src) {
        const shouldHydrate = record.artboardId === this.activeArtboardId;
        const displayDescriptor = shouldHydrate ? this.assets.find((asset) => asset.id === (renderAssetId || previewAssetId || assetId)) : undefined;
        const originalDescriptor = shouldHydrate && assetId ? this.assets.find((asset) => asset.id === assetId) : undefined;
        if (displayDescriptor && shouldHydrate) {
          const displayUrl = await this.assetStore.createObjectUrl(displayDescriptor);
          const originalUrl = originalDescriptor && originalDescriptor.id !== displayDescriptor.id
            ? await this.assetStore.createObjectUrl(originalDescriptor)
            : displayUrl;
          this.objectUrls.add(displayUrl);
          this.objectUrls.add(originalUrl);
          record.src = displayUrl;
          record.originalSrc = originalUrl;
          record.renderObjectUrl = displayUrl;
          record.assetSuspended = false;
        } else {
          record.src = TRANSPARENT_PIXEL;
          record.originalSrc = TRANSPARENT_PIXEL;
          record.assetSuspended = true;
        }
      }
      if ((record.type === 'Image' || record.type === 'image') && typeof record.maskAssetId === 'string' && !record.maskSrc) {
        const descriptor = this.assets.find((asset) => asset.id === record.maskAssetId);
        if (descriptor) {
          const url = await this.assetStore.createObjectUrl(descriptor);
          this.objectUrls.add(url);
          record.maskSrc = url;
        }
      }
      for (const child of Object.values(record)) await visit(child);
    };
    await visit(hydrated);
    return hydrated;
  }

  private async persistArtboardDocuments() {
    const canvas = this.serializeCanvasForPersistence();
    const objects = Array.isArray(canvas.objects) ? canvas.objects as Array<Record<string, unknown>> : [];
    for (const artboard of this.artboards) {
      const artboardObjects = objects.filter((object) => object.artboardId === artboard.id || object.id === `${ARTBOARD_PREFIX}${artboard.id}`);
      await saveArtboardDocument(this.documentKey(artboard.id), {
        version: 1,
        artboard: { ...artboard },
        objects: artboardObjects,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  serializeProject(name = this.documentName): ProjectDocumentV2 {
    const now = new Date().toISOString();
    const artboards: ArtboardDocumentRef[] = this.artboards.map((artboard) => ({
      ...artboard,
      documentKey: this.documentKey(artboard.id),
      updatedAt: now,
    }));
    return {
      version: 2,
      id: this.projectId,
      userId: this.userId,
      name,
      canvas: {
        width: this.documentWidth,
        height: this.documentHeight,
        background: this.documentBackground,
        resolution: this.documentSettings.resolution,
        colorMode: this.documentSettings.colorMode,
        bitDepth: this.documentSettings.bitDepth,
        colorProfile: this.documentSettings.colorProfile,
        pixelAspectRatio: this.documentSettings.pixelAspectRatio,
        format: this.documentSettings.format,
      },
      artboards,
      activeArtboardId: this.activeArtboardId,
      assets: this.assets.map((asset) => ({ ...asset })),
      regions: this.regions.map((region) => ({ ...region })),
      workflows: this.workflows.map((workflow) => ({ ...workflow, artboardIds: [...workflow.artboardIds], steps: workflow.steps.map((step) => ({ ...step })) })),
      history: this.history.records(),
      legacyFabricJson: this.serializeCanvasForPersistence(),
      createdAt: now,
      updatedAt: now,
    };
  }

  async loadProject(project: ProjectDocument) {
    this.isRestoring = true;
    if (project.version === 2) {
      this.projectId = project.id;
      this.assetStore = createAssetStore(this.userId, this.projectId);
      this.assets = project.assets?.map((asset) => ({ ...asset, userId: this.userId, projectId: this.projectId })) || [];
    } else {
      this.projectId = createId('project');
      this.assetStore = createAssetStore(this.userId, this.projectId);
      this.assets = [];
    }
    this.documentWidth = project.canvas.width;
    this.documentHeight = project.canvas.height;
    this.documentBackground = project.canvas.background;
    this.documentName = project.name || '未标题-1';
    this.documentSettings = {
      resolution: project.canvas.resolution ?? 72,
      colorMode: project.canvas.colorMode ?? 'rgb',
      bitDepth: project.canvas.bitDepth ?? 8,
      colorProfile: project.canvas.colorProfile || 'sRGB IEC61966-2.1',
      pixelAspectRatio: project.canvas.pixelAspectRatio ?? 1,
      format: project.canvas.format ?? 'psd',
    };
    this.artboards = project.artboards?.map((artboard) => ({ id: artboard.id, name: artboard.name, x: artboard.x, y: artboard.y, width: artboard.width, height: artboard.height, background: artboard.background })) || [];
    this.activeArtboardId = project.activeArtboardId || this.artboards[0]?.id || '';
    this.regions = project.regions?.map((region) => ({ ...region })) || [];
    this.workflows = project.workflows?.map((workflow) => ({ ...workflow, artboardIds: [...workflow.artboardIds], steps: workflow.steps.map((step) => ({ ...step })) })) || [];
    let fabricJson: Record<string, unknown> | undefined;
    if (project.version === 1) fabricJson = project.fabricJson;
    else fabricJson = project.legacyFabricJson;
    if (!fabricJson && project.version === 2) {
      const documents = await Promise.all(project.artboards.map((artboard) => loadArtboardDocument(artboard.documentKey)));
      fabricJson = { objects: documents.flatMap((document) => Array.isArray(document?.objects) ? document.objects : []) };
    }
    await this.canvas.loadFromJSON(await this.hydrateCanvasJson(fabricJson || { objects: [] }));
    await this.removeBundledDemoObjects();
    if (this.artboards.length && !this.canvas.getObjects().some((object) => this.isArtboardObject(object))) {
      for (const artboard of this.artboards) this.canvas.add(this.createArtboardRect(artboard));
    }
    this.normalizeObjects();
    this.applyLazyArtboardVisibility();
    this.emitRegions();
    this.emitWorkflows();
    this.isRestoring = false;
    this.canvas.requestRenderAll();
    this.fitToScreen();
    this.syncLayers();
    this.setTool(this.currentTool);
    this.commitHistory(true);
  }

  private async removeBundledDemoObjects() {
    const bundledHashPrefix = '2c58df801001fcc2e871b6d4';
    const bundled = (this.canvas.getObjects() as EditorObject[]).filter((object) => {
      const source = `${object.originalSrc || ''} ${isImageObject(object) ? object.getSrc() : ''}`;
      const isLegacySample = object.name === '七夕臻礼示例' && source.includes('samples/qixi-demo.png');
      const isBundledAsset = typeof object.assetId === 'string' && object.assetId.includes(bundledHashPrefix);
      return isLegacySample || isBundledAsset;
    });
    if (bundled.length) this.canvas.remove(...bundled);
    const storedAssets = await this.assetStore.list().catch(() => this.assets);
    const bundledOriginalIds = new Set(storedAssets.filter((asset) => asset.hash.startsWith(bundledHashPrefix)).map((asset) => asset.id));
    const bundledAssets = storedAssets.filter((asset) => asset.hash.startsWith(bundledHashPrefix) || Boolean(asset.sourceAssetId && bundledOriginalIds.has(asset.sourceAssetId)));
    await Promise.all(bundledAssets.map((asset) => this.assetStore.delete(asset.id).catch(() => undefined)));
    const deletedIds = new Set(bundledAssets.map((asset) => asset.id));
    this.assets = storedAssets.filter((asset) => !deletedIds.has(asset.id));
  }

  private normalizeObjects() {
    const objects = this.canvas.getObjects() as EditorObject[];
    let artboardIndex = 0;
    let artboardFound = false;
    for (const object of objects) {
      const looksLikeArtboard =
        !artboardFound &&
        object.type === 'rect' &&
        object.selectable === false &&
        Math.round(object.width || 0) === this.documentWidth &&
        Math.round(object.height || 0) === this.documentHeight;
      if (this.isArtboardObject(object) || looksLikeArtboard) {
        const existing = this.artboards[artboardIndex];
        const artboardId = object.artboardId || existing?.id || createId('artboard');
        object.id = `${ARTBOARD_PREFIX}${artboardId}`;
        object.artboardId = artboardId;
        object.isArtboard = true;
        object.name = object.name && object.name !== '画布背景' ? object.name : existing?.name || `画板 ${artboardIndex + 1}`;
        object.set({ selectable: false, evented: false, hasControls: false, objectCaching: false });
        artboardFound = true;
        artboardIndex += 1;
        continue;
      }
    }
    if (!artboardFound) {
      const fallback: ArtboardItem = this.artboards[0] || {
        id: createId('artboard'), name: '画板 1', x: 0, y: 0,
        width: this.documentWidth, height: this.documentHeight, background: this.documentBackground,
      };
      this.canvas.add(this.createArtboardRect(fallback));
    }
    this.syncArtboardsFromCanvas();
    let migratedBackground = false;
    for (const artboard of this.artboards) {
      const hasBackgroundLayer = (this.canvas.getObjects() as EditorObject[]).some((object) => object.artboardId === artboard.id && object.backgroundLayer);
      if (!hasBackgroundLayer && artboard.background && artboard.background !== 'transparent') {
        this.canvas.add(this.createBackgroundColorLayer(artboard, artboard.background));
        migratedBackground = true;
      }
      const artboardObject = (this.canvas.getObjects() as EditorObject[]).find((object) => this.isArtboardObject(object) && object.artboardId === artboard.id);
      artboardObject?.set('fill', 'transparent');
      artboard.background = 'transparent';
    }
    if (migratedBackground) this.syncArtboardsFromCanvas();
    const normalizedObjects = this.canvas.getObjects() as EditorObject[];
    for (const object of normalizedObjects) {
      if (this.isArtboardObject(object)) {
        this.canvas.moveObjectTo(object, 0);
        continue;
      }
      object.id ||= createId(object.type || 'layer');
      object.name ||= object.type === 'image' ? '图片' : object.type || '图层';
      if (!object.artboardId || !this.artboards.some((artboard) => artboard.id === object.artboardId)) {
        const center = object.getCenterPoint();
        object.artboardId = this.artboards.find((artboard) => center.x >= artboard.x && center.x <= artboard.x + artboard.width && center.y >= artboard.y && center.y <= artboard.y + artboard.height)?.id || this.activeArtboardId;
      }
      if (object.type === 'path' && (object.id.startsWith('brush-') || object.name.startsWith('画笔'))) object.paintLayer = true;
      if (!object.backgroundLayer && ['rect', 'circle', 'triangle', 'line'].includes(object.type || '')) {
        object.shapeKind ||= object.type === 'circle' ? 'ellipse' : object.type as EditorObject['shapeKind'];
        if (!object.cornerRadii && object.type !== 'line') {
          const defaultRadius = object.type === 'rect'
            ? Number((object as Rect).rx || 0)
            : object.type === 'circle'
              ? Math.min(object.width || 0, object.height || 0) / 2
              : 0;
          object.cornerRadii = { topLeft: defaultRadius, topRight: defaultRadius, bottomRight: defaultRadius, bottomLeft: defaultRadius };
        }
        object.cornersLinked ??= true;
        if (object.type !== 'line') object.objectCaching = false;
      }
      if (isTextObject(object)) {
        object.textOriginalText ||= object.text || '';
        object.textBaseFontWeight ||= String(object.fontWeight || '400');
        object.textCase ||= 'normal';
        object.textKerning ??= 0;
        object.textTracking ??= 0;
        object.textCompression ??= 0;
        object.textHorizontalScale ??= 100;
        object.textVerticalScale ??= 100;
        object.textBaselineShift ??= 0;
        object.textFauxBold ??= false;
        object.textFauxItalic ??= false;
        object.textSuperscript ??= false;
        object.textSubscript ??= false;
      }
      object.set(object.backgroundLayer ? {
        hasControls: false,
        lockMovementX: true,
        lockMovementY: true,
        lockScalingX: true,
        lockScalingY: true,
        lockRotation: true,
      } : { hasControls: this.showControls });
      if (isImageObject(object)) {
        object.originalSrc ||= object.getSrc();
        object.adjustments ||= { ...DEFAULT_ADJUSTMENTS };
      }
    }
    (this.canvas.getObjects() as EditorObject[])
      .filter((object) => object.backgroundLayer)
      .sort((a, b) => this.artboards.findIndex((artboard) => artboard.id === a.artboardId) - this.artboards.findIndex((artboard) => artboard.id === b.artboardId))
      .forEach((object, index) => this.canvas.moveObjectTo(object, this.artboards.length + index));
  }

  async exportProject() {
    const filename = `${safeFilename(this.documentName)}-${new Date().toISOString().slice(0, 10)}.tuyan.json`;
    const destination = await chooseSaveDestination(filename, 'application/json', ['.json']);
    if (!destination) return { bytes: 0, width: this.documentWidth, height: this.documentHeight, cancelled: true };
    const blob = new Blob([JSON.stringify(this.serializeProject(), null, 2)], { type: 'application/json' });
    const saved = await saveBlobToComputer(blob, destination);
    return { bytes: blob.size, width: this.documentWidth, height: this.documentHeight, cancelled: !saved.saved };
  }

  estimateLayeredDocumentBytes() {
    const objects = this.getEditableObjects().filter((object) => object.artboardId === this.activeArtboardId);
    const composite = this.documentWidth * this.documentHeight * 4;
    const layerPixels = objects.reduce((total, object) => {
      const bounds = object.getBoundingRect();
      return total + Math.max(1, Math.ceil(bounds.width)) * Math.max(1, Math.ceil(bounds.height)) * 4;
    }, 0);
    return Math.ceil((composite + layerPixels) * 1.12 + objects.length * 4096);
  }

  getStorageInfo() {
    return this.assetStore.estimateQuota();
  }

  async importProject(file: File) {
    const text = await file.text();
    const project = JSON.parse(text) as ProjectDocument;
    await this.loadProject(project);
  }

  async importPsd(file: File, preflight?: ImportPreflightResult) {
    if (!/\.(psd|psb)$/i.test(file.name)) throw new Error('请选择 PSD 或 PSB 文件');
    if (preflight && !preflight.allowed) throw new Error(preflight.reason || '内存不足，无法继续，请撤回本次导入');
    const previous = this.serializeProject();
    this.callbacks.onProcessing(true, '正在后台解析 PSD 图层…');
    try {
      const buffer = await file.arrayBuffer();
      const parsed = await psdWorkerBroker.run<{
        width: number;
        height: number;
        layers: Array<{ name: string; left: number; top: number; width: number; height: number; hidden: boolean; opacity: number; imageData?: PixelPayload }>;
        composite?: PixelPayload;
      }>({ type: 'parse', buffer, memoryLimit: Math.max(256 * 1024 * 1024, preflight?.estimatedPeakBytes || 0) }, [buffer], (progress) => this.callbacks.onProcessing(true, `正在解析 PSD ${Math.round(progress * 100)}%…`));
      await this.newDocument(parsed.width, parsed.height, 'transparent', false, {
        name: file.name.replace(/\.(psd|psb)$/i, '') || 'PSD 文档',
        format: file.name.toLowerCase().endsWith('.psb') ? 'psb' : 'psd',
      });
      const original = await this.assetStore.putStream(file, {
        name: file.name,
        mimeType: 'image/vnd.adobe.photoshop',
        kind: 'original',
        width: parsed.width,
        height: parsed.height,
      });
      this.isRestoring = true;
      let imported = 0;
      for (const layer of [...parsed.layers].reverse()) {
          if (!layer.imageData) continue;
          this.callbacks.onProcessing(true, `正在保存 PSD 图层 ${imported + 1}/${parsed.layers.length}…`);
          const blob = await imageDataToBlob(layer.imageData);
          const preview = await this.assetStore.putStream(blob, {
            name: layer.name,
            mimeType: 'image/png',
            kind: 'derived',
            width: layer.imageData.width,
            height: layer.imageData.height,
            sourceAssetId: original.id,
          });
          const url = await this.assetStore.createObjectUrl(preview);
          this.objectUrls.add(url);
          const image = await FabricImage.fromURL(url, {}, { originX: 'center', originY: 'center' }) as EditorImage;
          image.id = createId('psd');
          image.name = layer.name;
          image.originalSrc = url;
          image.assetId = original.id;
          image.previewAssetId = preview.id;
          image.originalWidth = layer.imageData.width;
          image.originalHeight = layer.imageData.height;
          image.adjustments = { ...DEFAULT_ADJUSTMENTS };
          image.artboardId = this.activeArtboardId;
          image.set({
            left: layer.left + layer.imageData.width / 2,
            top: layer.top + layer.imageData.height / 2,
            visible: !layer.hidden,
            opacity: Math.max(0, Math.min(1, layer.opacity / 255)),
            hasControls: this.showControls,
          });
          this.canvas.add(image);
          imported += 1;
      }
      if (!imported && parsed.composite) {
        const blob = await imageDataToBlob(parsed.composite);
        const preview = await this.assetStore.putStream(blob, { name: file.name, mimeType: 'image/png', kind: 'derived', width: parsed.width, height: parsed.height, sourceAssetId: original.id });
        const url = await this.assetStore.createObjectUrl(preview);
        this.objectUrls.add(url);
        await this.addImageFromUrl(url, file.name.replace(/\.(psd|psb)$/i, ''), false, { assetId: original.id, previewAssetId: preview.id, originalWidth: parsed.width, originalHeight: parsed.height });
        imported = 1;
      }
      this.assets = await this.assetStore.list();
      this.isRestoring = false;
      this.normalizeObjects();
      this.applyLazyArtboardVisibility();
      this.canvas.requestRenderAll();
      this.fitToScreen();
      this.syncLayers();
      this.commitHistory(true);
      this.callbacks.onToast(`PSD 已打开，共导入 ${imported} 个可编辑图层`, 'success');
    } catch (error) {
      this.isRestoring = false;
      await this.loadProject(previous).catch(() => undefined);
      throw error instanceof Error ? error : new Error('PSD 文件无法打开');
    } finally {
      this.callbacks.onProcessing(false);
    }
  }

  getDocumentInfo() {
    const artboard = this.getActiveArtboard();
    const width = artboard?.width || this.documentWidth;
    const height = artboard?.height || this.documentHeight;
    return {
      width,
      height,
      artboardCount: this.artboards.length,
      artboardName: artboard?.name || '画板 1',
      layerCount: this.getEditableObjects().filter((object) => object.artboardId === artboard?.id).length,
      rawBytes: width * height * 4,
      name: this.documentName,
      ...this.documentSettings,
    };
  }

  async exportImage(
    format: 'png' | 'jpeg' | 'webp',
    quality: number,
    outputWidth: number,
    outputHeight: number,
    filename: string,
  ) {
    const extension = format === 'jpeg' ? 'jpg' : format;
    const suggestedName = `${filename || '东尼菜市场作品'}.${extension}`;
    const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
    const destination = await chooseSaveDestination(suggestedName, mime, [`.${extension}`]);
    if (!destination) return { bytes: 0, width: outputWidth, height: outputHeight, cancelled: true };
    const finalCanvas = await this.renderDocumentCanvas(outputWidth, outputHeight);
    const blob = await new Promise<Blob>((resolve, reject) => {
      finalCanvas.toBlob((result) => result ? resolve(result) : reject(new Error('导出失败')), mime, quality);
    });
    const saved = await saveBlobToComputer(blob, destination);
    return { bytes: blob.size, width: finalCanvas.width, height: finalCanvas.height, cancelled: !saved.saved };
  }

  async exportTiff(outputWidth: number, outputHeight: number, filename: string) {
    const destination = await chooseSaveDestination(`${filename || '东尼菜市场作品'}.tiff`, 'image/tiff', ['.tif', '.tiff']);
    if (!destination) return { bytes: 0, width: outputWidth, height: outputHeight, cancelled: true };
    this.callbacks.onProcessing(true, '正在后台生成 TIFF…');
    try {
      const canvas = await this.renderDocumentCanvas(outputWidth, outputHeight);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('无法读取 TIFF 像素数据');
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const rgba = imageData.data.buffer.slice(0) as ArrayBuffer;
      const result = await assetWorkerBroker.run<{ blob: Blob; width: number; height: number }>({
        type: 'encode-tiff',
        rgba,
        width: canvas.width,
        height: canvas.height,
      }, [rgba], (progress) => this.callbacks.onProcessing(true, `正在编码 TIFF ${Math.round(progress * 100)}%…`));
      const saved = await saveBlobToComputer(result.blob, destination);
      return { bytes: result.blob.size, width: result.width, height: result.height, cancelled: !saved.saved };
    } finally {
      this.callbacks.onProcessing(false);
    }
  }

  private async renderDocumentCanvas(outputWidth: number, outputHeight: number) {
    const artboard = this.getActiveArtboard();
    if (!artboard) throw new Error('没有可导出的画板');
    return this.renderArtboardCanvas(artboard, outputWidth, outputHeight);
  }

  private async prepareCanvasJsonForExport(targetArtboardId: string) {
    const json = structuredClone(this.canvas.toJSON()) as Record<string, unknown>;
    const urls: string[] = [];
    const visit = async (value: unknown): Promise<void> => {
      if (Array.isArray(value)) {
        for (const item of value) await visit(item);
        return;
      }
      if (!value || typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      if (typeof record.artboardId === 'string') {
        const isTarget = record.artboardId === targetArtboardId;
        const isArtboard = typeof record.id === 'string' && record.id.startsWith(ARTBOARD_PREFIX);
        record.visible = isTarget ? (isArtboard ? true : (record.lazyVisible ?? record.visible ?? true)) : false;
      }
      if ((record.type === 'Image' || record.type === 'image') && typeof record.assetId === 'string') {
        const original = this.assets.find((asset) => asset.id === record.assetId
          && asset.mimeType.startsWith('image/')
          && asset.mimeType !== 'image/vnd.adobe.photoshop'
          && !['image/tiff', 'image/x-tiff'].includes(asset.mimeType));
        const fallbackId = typeof record.renderAssetId === 'string' ? record.renderAssetId : typeof record.previewAssetId === 'string' ? record.previewAssetId : undefined;
        const fallback = fallbackId ? this.assets.find((asset) => asset.id === fallbackId) : undefined;
        const descriptor = original || fallback;
        if (descriptor) {
          let blob = await this.assetStore.createBlob(descriptor);
          const adjustments = record.adjustments as ImageAdjustments | undefined;
          const hasAdjustments = adjustments && Object.values(adjustments).some((value) => Number(value) !== 0);
          if (original && hasAdjustments) {
            const filtered = await rasterWorkerBroker.run<{ blob: Blob }>({ type: 'filter', blob, adjustments, outputType: descriptor.mimeType === 'image/png' ? 'image/png' : 'image/webp', quality: .96 });
            blob = filtered.blob;
          }
          if (original && typeof record.maskAssetId === 'string') {
            const maskDescriptor = this.assets.find((asset) => asset.id === record.maskAssetId);
            if (maskDescriptor) {
              const mask = await this.assetStore.createBlob(maskDescriptor);
              const masked = await rasterWorkerBroker.run<{ blob: Blob }>({ type: 'mask', blob, mask, outputType: 'image/png', quality: 1 });
              blob = masked.blob;
            }
          }
          const url = URL.createObjectURL(blob);
          urls.push(url);
          const previewWidth = Number(record.width || descriptor.width || 1);
          const previewHeight = Number(record.height || descriptor.height || 1);
          if (descriptor.width && descriptor.height && original) {
            record.width = descriptor.width;
            record.height = descriptor.height;
            record.scaleX = Number(record.scaleX || 1) * previewWidth / descriptor.width;
            record.scaleY = Number(record.scaleY || 1) * previewHeight / descriptor.height;
          }
          record.src = url;
          record.originalSrc = url;
        }
      }
      for (const child of Object.values(record)) await visit(child);
    };
    await visit(json);
    return { json, urls };
  }

  private async renderArtboardCanvas(artboard: ArtboardItem, outputWidth: number, outputHeight: number) {
    const bounds = this.getSceneBounds();
    const copy = new StaticCanvas(undefined, {
      width: Math.max(1, Math.ceil(bounds.left + bounds.width)),
      height: Math.max(1, Math.ceil(bounds.top + bounds.height)),
      backgroundColor: 'transparent',
      enableRetinaScaling: false,
    });
    const exportSource = await this.prepareCanvasJsonForExport(artboard.id);
    await copy.loadFromJSON(exportSource.json);
    copy.setViewportTransform([1, 0, 0, 1, 0, 0]);
    copy.renderAll();
    const multiplier = Math.max(outputWidth / artboard.width, outputHeight / artboard.height);
    const rendered = copy.toCanvasElement(multiplier, {
      left: artboard.x,
      top: artboard.y,
      width: artboard.width,
      height: artboard.height,
    });
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = Math.max(1, Math.round(outputWidth));
    finalCanvas.height = Math.max(1, Math.round(outputHeight));
    const context = finalCanvas.getContext('2d');
    if (!context) throw new Error('无法创建导出画布');
    context.drawImage(rendered, 0, 0, finalCanvas.width, finalCanvas.height);
    copy.dispose();
    exportSource.urls.forEach((url) => URL.revokeObjectURL(url));
    return finalCanvas;
  }

  async exportArtboard(id: string, format: 'png' | 'jpeg' | 'webp' = 'png', quality = 0.92, scale = 1) {
    const artboard = this.artboards.find((item) => item.id === id);
    if (!artboard) throw new Error('画板不存在');
    const extension = format === 'jpeg' ? 'jpg' : format;
    const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
    const destination = await chooseSaveDestination(`${safeFilename(artboard.name)}.${extension}`, mime, [`.${extension}`]);
    if (!destination) return { bytes: 0, width: artboard.width * scale, height: artboard.height * scale, cancelled: true };
    const canvas = await this.renderArtboardCanvas(artboard, artboard.width * scale, artboard.height * scale);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('导出失败')), mime, quality));
    const saved = await saveBlobToComputer(blob, destination);
    return { bytes: blob.size, width: canvas.width, height: canvas.height, cancelled: !saved.saved };
  }

  async exportAllArtboards(format: 'png' | 'jpeg' | 'webp' = 'png', quality = 0.92, scale = 1) {
    return this.exportArtboards(this.artboards.map((artboard) => artboard.id), format, quality, scale, '全部画板');
  }

  async exportArtboards(artboardIds: string[], format: 'png' | 'jpeg' | 'webp' = 'png', quality = 0.92, scale = 1, archiveName = '画板导出') {
    const selected = this.artboards.filter((artboard) => artboardIds.includes(artboard.id));
    if (!selected.length) throw new Error('没有可导出的画板');
    const archiveFilename = `东尼菜市场-${safeFilename(archiveName)}-${new Date().toISOString().slice(0, 10)}.zip`;
    const destination = await chooseSaveDestination(archiveFilename, 'application/zip', ['.zip']);
    if (!destination) return { bytes: 0, count: 0, cancelled: true };
    this.callbacks.onProcessing(true, `正在导出 ${selected.length} 个画板…`);
    try {
      const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
      const extension = format === 'jpeg' ? 'jpg' : format;
      const files: Record<string, Uint8Array> = {};
      for (let index = 0; index < selected.length; index += 1) {
        const artboard = selected[index];
        const canvas = await this.renderArtboardCanvas(artboard, artboard.width * scale, artboard.height * scale);
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('导出失败')), mime, quality));
        files[`${String(index + 1).padStart(2, '0')}-${safeFilename(artboard.name)}.${extension}`] = new Uint8Array(await blob.arrayBuffer());
      }
      const { zipSync } = await import('fflate');
      const archive = zipSync(files, { level: 6 });
      const archiveBuffer = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer;
      const blob = new Blob([archiveBuffer], { type: 'application/zip' });
      const saved = await saveBlobToComputer(blob, destination);
      if (saved.saved) this.callbacks.onToast(`已导出 ${selected.length} 个画板`, 'success');
      return { bytes: blob.size, count: selected.length, cancelled: !saved.saved };
    } finally {
      this.callbacks.onProcessing(false);
    }
  }

  async exportPdf(outputWidth: number, outputHeight: number, filename: string, quality = 0.92) {
    const destination = await chooseSaveDestination(`${filename || '东尼菜市场作品'}.pdf`, 'application/pdf', ['.pdf']);
    if (!destination) return { bytes: 0, width: outputWidth, height: outputHeight, cancelled: true };
    this.callbacks.onProcessing(true, '正在生成 PDF…');
    try {
      const canvas = await this.renderDocumentCanvas(outputWidth, outputHeight);
      const { jsPDF } = await import('jspdf');
      const orientation = outputWidth >= outputHeight ? 'landscape' : 'portrait';
      const pdf = new jsPDF({ orientation, unit: 'px', format: [outputWidth, outputHeight], hotfixes: ['px_scaling'] });
      pdf.addImage(canvas.toDataURL('image/jpeg', quality), 'JPEG', 0, 0, outputWidth, outputHeight, undefined, 'FAST');
      const blob = pdf.output('blob');
      const saved = await saveBlobToComputer(blob, destination);
      return { bytes: blob.size, width: outputWidth, height: outputHeight, cancelled: !saved.saved };
    } finally {
      this.callbacks.onProcessing(false);
    }
  }

  async exportPsd(filename: string, forcePsb = false) {
    const estimatedBytes = this.estimateLayeredDocumentBytes();
    const usePsb = forcePsb || estimatedBytes >= 2 * 1024 ** 3;
    const extension = usePsb ? 'psb' : 'psd';
    const destination = await chooseSaveDestination(`${filename || '东尼菜市场作品'}.${extension}`, 'image/vnd.adobe.photoshop', [`.${extension}`]);
    if (!destination) return { bytes: 0, width: this.documentWidth, height: this.documentHeight, format: extension as 'psd' | 'psb', cancelled: true };
    this.callbacks.onProcessing(true, `正在生成分层 ${usePsb ? 'PSB' : 'PSD'}…`);
    try {
      const { initializeCanvas, writePsd } = await import('ag-psd');
      initializeCanvas((width, height) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
      });
      const composite = await this.renderDocumentCanvas(this.documentWidth, this.documentHeight);
      const children: PsdLayer[] = [];
      for (const object of [...this.getEditableObjects().filter((item) => item.artboardId === this.activeArtboardId)].reverse()) {
        const layer = await this.renderObjectForPsd(object);
        if (layer) children.push(layer);
      }
      if (this.documentBackground !== 'transparent') {
        const background = document.createElement('canvas');
        background.width = this.documentWidth;
        background.height = this.documentHeight;
        const context = background.getContext('2d');
        if (context) {
          context.fillStyle = this.documentBackground;
          context.fillRect(0, 0, background.width, background.height);
          children.push({ name: this.getActiveArtboard()?.name || '画板背景', canvas: background, left: 0, top: 0 });
        }
      }
      const psd: Psd = { width: this.documentWidth, height: this.documentHeight, canvas: composite, children };
      const buffer = writePsd(psd, { generateThumbnail: true, psb: usePsb, compress: usePsb });
      const blob = new Blob([buffer], { type: 'image/vnd.adobe.photoshop' });
      const saved = await saveBlobToComputer(blob, destination);
      return { bytes: blob.size, width: this.documentWidth, height: this.documentHeight, format: usePsb ? 'psb' as const : 'psd' as const, cancelled: !saved.saved };
    } finally {
      this.callbacks.onProcessing(false);
    }
  }

  private async renderObjectForPsd(object: EditorObject): Promise<PsdLayer | null> {
    const artboard = this.artboards.find((item) => item.id === object.artboardId) || this.getActiveArtboard();
    const bounds = object.getBoundingRect();
    const left = Math.floor(bounds.left);
    const top = Math.floor(bounds.top);
    const width = Math.max(1, Math.ceil(bounds.width));
    const height = Math.max(1, Math.ceil(bounds.height));
    const temporary = new StaticCanvas(undefined, { width, height, backgroundColor: 'transparent', enableRetinaScaling: false });
    const clone = await object.clone() as EditorObject;
    clone.set({
      left: (clone.left || 0) - left,
      top: (clone.top || 0) - top,
      visible: true,
      opacity: 1,
      selectable: false,
      evented: false,
    });
    temporary.add(clone);
    temporary.renderAll();
    const canvas = temporary.toCanvasElement(1, { left: 0, top: 0, width, height });
    temporary.dispose();
    return {
      name: object.name || object.type || '图层',
      canvas,
      left: left - (artboard?.x || 0),
      top: top - (artboard?.y || 0),
      hidden: object.visible === false,
      opacity: Math.round((object.opacity ?? 1) * 255),
    };
  }

  destroy() {
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    if (this.textHistoryTimer !== null) window.clearTimeout(this.textHistoryTimer);
    this.adjustmentTimers.forEach((timer) => window.clearTimeout(timer));
    this.adjustmentTimers.clear();
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    this.canvas.upperCanvasEl.removeEventListener('pointerleave', this.handleCanvasPointerLeave);
    this.selectionService.destroy();
    this.faceDetectionService.destroy();
    this.objectUrls.forEach((url) => URL.revokeObjectURL(url));
    this.objectUrls.clear();
    void this.canvas.dispose();
  }
}
